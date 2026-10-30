import argparse
import asyncio
import json
import socket
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from collections import deque
import numpy as np
from scipy.signal import iirnotch, butter, lfilter, lfilter_zi, welch, detrend
from scipy.ndimage import binary_dilation
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
import websockets

from session_export import SessionRecorder, ClientRegistry, RawEegWriter, P4_VALID_BANDS

# --- Etiqueta de calidad del electrodo (EXCELLENT / REVISAR) ---
ARTIFACT_THRESHOLD_UV = 150
FLATLINE_THRESHOLD_UV = 2
QUALITY_WINDOW = 20
QUALITY_BAD_RATIO = 0.3

# --- Detección de artefactos en la señal (congela las bandas) ---
BLINK_SAMPLE_THRESHOLD_UV = 60
STD_WINDOW_MS = 300
STD_SPIKE_FACTOR = 3.0
BASELINE_EWMA_ALPHA = 0.02
BASELINE_SLOW_ALPHA = 0.002   # durante un 'pico de variabilidad' la línea base sigue subiendo MUY despacio (si no, se queda pegada)
BLINK_MARGIN_MS = 100

# --- Control del valor de banda (delta como centinela) ---
DELTA_REJECT_FACTOR = 2.5
DELTA_HISTORY = 60
DELTA_MIN_HISTORY = 10
DELTA_MAX_CONSECUTIVE_REJECTS = 8
SMOOTHING_ALPHA = 0.5               # 1.0 = sin suavizado

# --- Entrenamiento ---
AVG_WINDOW_S = 5                    # promedio que se muestra como número principal
SUCCESS_WINDOW_S = 10               # ventana del Avg Success Rate
CALIBRATION_S = 25                  # fase de calibración antes de entrenar: N segundos VÁLIDOS (no se graba ni corre el reloj)
FILTER_WARMUP_S = 5                 # tras arrancar o reconectar, los primeros N s no se usan (el filtro se está asentando)
MAX_BANDS_PER_SIDE = 2              # el esquema de P4 admite 4; el formulario permite 2
REQUIRE_BOTH_SIDES = True           # el esquema de P4 exige >=1 banda a mejorar y >=1 a inhibir
DEFAULT_DURATION_MIN = 10
MAX_DURATION_MIN = 60

# --- Vigilancia de la conexión con el Muse ---
NO_DATA_WARN_S = 3
NO_DATA_RECONNECT_S = 8
DIAG_EVERY_S = 15

EXCLUDED_CHANNELS = ["TP10"]
NOTCH_FREQ = 60
# Cada banda es el intervalo [bajo, alto) en Hz. Los huecos entre bandas (3-4, 7-8, 15-16, 20-21) son parte de la definición.
BAND_DEFS = {
    "delta": (1, 3), "theta": (4, 7), "low_alpha": (8, 10), "high_alpha": (10, 12),
    "low_beta": (12, 15), "beta": (16, 20), "high_beta": (21, 30),
}

assert set(BAND_DEFS) <= P4_VALID_BANDS, "BAND_DEFS tiene bandas que el contrato con P4 (ADR 2) no acepta"

WS_PORT = 8765
HTTP_PORT = 8000
PROJECT_DIR = Path(__file__).resolve().parent.parent
# Solo estas páginas se sirven por HTTP (nunca data/, que tiene las sesiones)
PAGES = {"/": "dashboard.html", "/dashboard.html": "dashboard.html", "/feedback.html": "feedback.html"}

client_queues = {}
client_roles = {}   # websocket -> "full" (dashboard) | "feedback" (pantalla del cliente, solo mensajes livianos)
pending_commands = deque()


class StatefulFilter:
    def __init__(self, b, a, n_channels):
        self.b, self.a = b, a
        self.n_channels = n_channels
        self.zi = None

    def reset(self):
        self.zi = None

    def process(self, data):
        if self.zi is None:
            self.zi = [lfilter_zi(self.b, self.a) * data[ch, 0] for ch in range(self.n_channels)]
        out = np.zeros_like(data)
        for ch in range(self.n_channels):
            out[ch], self.zi[ch] = lfilter(self.b, self.a, data[ch], zi=self.zi[ch])
        return out


class DeltaGate:
    """Centinela: rechaza una ventana si su delta se sale de lo habitual de esa señal."""

    def __init__(self):
        self.history = deque(maxlen=DELTA_HISTORY)
        self.rejects = 0

    def accept(self, delta):
        if len(self.history) >= DELTA_MIN_HISTORY and delta > DELTA_REJECT_FACTOR * np.median(self.history):
            self.rejects += 1
            if self.rejects < DELTA_MAX_CONSECUTIVE_REJECTS:
                return False
            self.history.clear()  # el nivel cambió de verdad: se re-calibra
        self.rejects = 0
        self.history.append(delta)
        return True


def band_amplitudes(signal, sfreq):
    """Una sola Welch por señal. Valor de banda = raíz de la PSD promedio (amplitud, ~µV/√Hz)."""
    f, psd = welch(detrend(signal), fs=sfreq, nperseg=min(sfreq * 2, len(signal)))
    out = {}
    for name, (low, high) in BAND_DEFS.items():
        idx = (f >= low) & (f < high)   # [bajo, alto): el borde superior NO entra, así un bin nunca cuenta en dos bandas
        out[name] = float(np.sqrt(psd[idx].mean())) if idx.any() else 0.0
    return out


def average_bands(last_good, quality, excluded, n_ch):
    result = {}
    for band in BAND_DEFS:
        vals = [last_good[ch][band] for ch in range(n_ch)
                if ch not in excluded and quality[ch] == "excellent"]
        if not vals:
            vals = [last_good[ch][band] for ch in range(n_ch) if ch not in excluded]
        result[band] = sum(vals) / len(vals) if vals else 0.0
    return result


class TrainingSession:
    """Entrenamiento activo. Cada segundo de entrenamiento recibe la señal derivada (activo - referencia)."""

    def __init__(self, protocol, client_id, duration_s, sfreq, eeg_names=None, thresholds=None, calibrate=True, save_raw=False):
        self.protocol = protocol
        self.name = protocol["name"]
        self.active = protocol["active"]
        self.reference = protocol["reference"]
        self.reward = protocol["reward"]
        self.inhibit = protocol["inhibit"]
        self.bands = self.reward + self.inhibit
        self.client_id = client_id
        self.duration_s = duration_s
        self.sfreq = sfreq
        self.eeg_names = eeg_names
        self.paused = False
        self.gate = DeltaGate()
        self.smoothed = None
        self.records = {b: deque(maxlen=SUCCESS_WINDOW_S) for b in self.bands}  # (valor, válido)
        self.threshold = {b: None for b in self.bands}
        self.phase = "calibrating" if calibrate else "training"
        self.calib_valid = 0          # segundos válidos acumulados en la calibración
        for b, v in (thresholds or {}).items():  # umbrales puestos a mano al iniciar: sin calibración
            if b in self.threshold:
                self.threshold[b] = float(v)
        self.baseline = {b: [] for b in self.bands}
        self.seq = 0
        self.invalid_reasons = {}   # segundos inválidos por causa: electrodo / artefacto / delta
        self.feedback = {"state": "calibrating", "met": 0, "total": len(self.bands)}
        self.recorder = SessionRecorder(protocol, client_id, sfreq, duration_s, eeg_channels=eeg_names)
        self.recorder.band_ranges = {b: list(BAND_DEFS[b]) for b in self.bands}
        if save_raw and eeg_names:       # opcional: señal cruda solo local (ver RawEegWriter)
            self.recorder.raw = RawEegWriter(self.recorder.session_id, eeg_names, sfreq)

    @property
    def session_id(self):
        return self.recorder.session_id

    def restarted(self):
        """Empieza de cero con el mismo protocolo y cliente. Conserva los umbrales que ya existían."""
        keep_raw = self.recorder.raw is not None
        self.recorder.discard()
        self.recorder.discard_raw()
        # si ya estaba entrenando, no se vuelve a calibrar (se conservan los umbrales)
        new = TrainingSession(self.protocol, self.client_id, self.duration_s, self.sfreq, self.eeg_names,
                              calibrate=(self.phase == "calibrating"), save_raw=keep_raw)
        for b in new.bands:
            if self.threshold[b] is not None:
                new.threshold[b] = self.threshold[b]
        return new

    def tick(self, signal, sfreq, invalid, reason=None):
        """reason: por qué el segundo es inválido ('electrodo' o 'artefacto'); 'delta' lo agrega el centinela."""
        self.seq += 1
        amps = None
        if invalid:
            self._count_invalid(reason or "artefacto")
        else:
            candidate = band_amplitudes(signal, sfreq)
            if self.gate.accept(candidate["delta"]):
                amps = candidate
            else:
                self._count_invalid("delta")

        if amps is not None:
            if self.smoothed is None:
                self.smoothed = amps
            else:
                self.smoothed = {b: SMOOTHING_ALPHA * amps[b] + (1 - SMOOTHING_ALPHA) * self.smoothed[b]
                                 for b in BAND_DEFS}

        for b in self.bands:
            if amps is not None:
                self.records[b].append((self.smoothed[b], True))
            else:
                last = self.records[b][-1][0] if self.records[b] else None
                self.records[b].append((last, False))

        if self.phase == "calibrating":
            self._calibration_step(amps is not None)
            return

        self.feedback = self.compute_feedback(amps is not None)

        # lo que pasó este segundo, para los archivos de salida
        self.recorder.add_second(
            {b: {"role": "reward" if b in self.reward else "inhibit",
                 "value": self.smoothed[b] if amps is not None else None,
                 "threshold": self.threshold[b]} for b in self.bands},
            valid=amps is not None,
        )

    def _calibration_step(self, valid):
        """Fase previa al entrenamiento: no corre el reloj ni se graba nada. Cuando se juntan CALIBRATION_S
        segundos válidos se fijan los umbrales que falten (mediana) y el entrenamiento empieza solo."""
        self.feedback = {"state": "calibrating", "met": 0, "total": len(self.bands)}
        if not valid:
            return
        self.calib_valid += 1
        for b in self.bands:
            if self.threshold[b] is None:
                self.baseline[b].append(self.smoothed[b])
        if self.calib_valid >= CALIBRATION_S:
            for b in self.bands:
                if self.threshold[b] is None:
                    self.threshold[b] = float(np.median(self.baseline[b]))
            self._start_training()

    def _start_training(self):
        """Fin de la calibración: reloj en 00:00 y todo lo que se grabe cuenta desde aquí."""
        self.phase = "training"
        self.records = {b: deque(maxlen=SUCCESS_WINDOW_S) for b in self.bands}   # la calibración no cuenta en el success rate
        self.invalid_reasons = {}
        self.recorder.restart()
        if self.recorder.raw is not None:
            self.recorder.raw.mark_training_start()
        print(f"[INFO] Calibración lista ({self.calib_valid} s válidos). Umbrales: "
              + ", ".join(f"{b}={t:.2f}" for b, t in self.threshold.items()) + " | empieza el entrenamiento")

    def _count_invalid(self, reason):
        self.invalid_reasons[reason] = self.invalid_reasons.get(reason, 0) + 1
        self.recorder.invalid_reasons = dict(self.invalid_reasons)

    def compute_feedback(self, valid):
        """Refuerzo (criterio de la entrenadora): TODAS las bandas cumplen su umbral -> 'success'.
        Si alguna no cumple -> 'fail' (se quita la recompensa, no hay estímulo aversivo).
        Segundo inválido (artefacto) -> 'invalid': ni premio ni castigo. Sin umbral aún -> 'calibrating'."""
        total = len(self.bands)
        if not valid:
            return {"state": "invalid", "met": 0, "total": total}
        if any(self.threshold[b] is None for b in self.bands):
            return {"state": "calibrating", "met": 0, "total": total}
        met = 0
        for b in self.bands:
            v, thr = self.smoothed[b], self.threshold[b]
            met += int(v > thr) if b in self.reward else int(v < thr)
        return {"state": "success" if met == total else "fail", "met": met, "total": total}

    def snapshot(self):
        bands = {}
        for b in self.bands:
            recs = list(self.records[b])
            valid_values = [v for v, ok in recs if ok]
            last_n = [v for v, ok in recs[-AVG_WINDOW_S:] if ok]
            thr = self.threshold[b]
            is_reward = b in self.reward
            success = None
            if thr is not None and valid_values and self.phase == "training":
                hits = sum(1 for v in valid_values if (v > thr if is_reward else v < thr))
                success = 100.0 * hits / len(valid_values)
            bands[b] = {
                "role": "reward" if is_reward else "inhibit",
                "value": recs[-1][0] if recs else None,
                "avg5": float(np.mean(last_n)) if last_n else None,
                "threshold": thr,
                "success": success,
            }
        rec = self.recorder
        return {
            "session_id": self.session_id,
            "name": self.name, "active": self.active, "reference": self.reference,
            "reward": self.reward, "inhibit": self.inhibit, "seq": self.seq, "bands": bands,
            "paused": self.paused,
            "phase": self.phase,
            "calib_valid": self.calib_valid,
            "calib_target": CALIBRATION_S,
            "feedback": self.feedback,
            "elapsed_s": rec.t_s,
            "target_s": self.duration_s,
            "valid_pct": round(100.0 * rec.valid_s / rec.t_s, 1) if rec.t_s else None,
            "invalid_reasons": dict(self.invalid_reasons),
        }


def parse_protocol(p, eeg_names):
    if not isinstance(p, dict):
        return None, "Protocolo inválido"
    name = str(p.get("name", "")).strip()[:40]
    active, reference = p.get("active"), p.get("reference")
    reward = list(dict.fromkeys(b for b in p.get("reward", []) if b in BAND_DEFS))
    inhibit = list(dict.fromkeys(b for b in p.get("inhibit", []) if b in BAND_DEFS))

    if not name:
        return None, "Ponle un nombre al protocolo"
    if active not in eeg_names or (reference is not None and reference not in eeg_names):
        return None, "Electrodo no válido"
    if reference == active:
        return None, "El activo y la referencia deben ser distintos"
    for ch in (active, reference):
        if ch in EXCLUDED_CHANNELS:
            return None, f"{ch} está excluido (electrodo defectuoso)"
    if len(reward) > MAX_BANDS_PER_SIDE or len(inhibit) > MAX_BANDS_PER_SIDE:
        return None, f"Máximo {MAX_BANDS_PER_SIDE} bandas por lado"
    if set(reward) & set(inhibit):
        return None, "Una banda no puede estar a mejorar y a inhibir a la vez"
    if not reward and not inhibit:
        return None, "Elige al menos una banda"
    if REQUIRE_BOTH_SIDES and (not reward or not inhibit):
        return None, "Elige al menos 1 banda a mejorar y 1 a inhibir (lo exige el esquema de P4)"
    return {"name": name, "active": active, "reference": reference,
            "reward": reward, "inhibit": inhibit}, None


def parse_thresholds(raw, protocol):
    """Umbrales opcionales {banda: valor}. Devuelve (dict, error)."""
    if raw in (None, {}):
        return {}, None
    if not isinstance(raw, dict):
        return None, "Umbrales inválidos"
    out = {}
    bands = protocol["reward"] + protocol["inhibit"]
    for band, value in raw.items():
        if band not in bands:
            return None, f"Umbral para una banda que no está en el protocolo: {band}"
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not (0 <= value < 1e6):
            return None, f"Umbral inválido para {band}"
        out[band] = float(value)
    return out, None


def parse_duration(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value * 60) if 1 <= value <= MAX_DURATION_MIN else None


def handle_command(cmd, training, eeg_names, sfreq, registry):
    kind = cmd.get("type") if isinstance(cmd, dict) else None

    if kind == "start_training":
        if training is not None:
            broadcast({"type": "error", "message": "Ya hay un entrenamiento en curso"})
            return training
        protocol, error = parse_protocol(cmd.get("protocol"), eeg_names)
        alias = str(cmd.get("client", "")).strip()[:40]
        duration_s = parse_duration(cmd.get("duration_min", DEFAULT_DURATION_MIN))
        thresholds = {}
        if not error:
            thresholds, error = parse_thresholds(cmd.get("thresholds"), protocol)
        if not error and not alias:
            error = "Escribe el alias del cliente"
        if not error and duration_s is None:
            error = f"La duración debe estar entre 1 y {MAX_DURATION_MIN} minutos"
        if error:
            broadcast({"type": "error", "message": error})
            return training
        client = registry.get_or_create(alias)
        save_raw = cmd.get("save_raw") is True
        session = TrainingSession(protocol, client["id"], duration_s, sfreq, eeg_names, thresholds, save_raw=save_raw)
        print(f"[INFO] Entrenamiento iniciado: {protocol['name']} ({protocol['active']} - {protocol['reference']}) "
              f"mejorar={protocol['reward']} inhibir={protocol['inhibit']} umbrales manuales={thresholds or 'no (auto)'} | señal cruda={'SI (local)' if save_raw else 'no'} | usuario {client['id']} | sesión {session.session_id[:8]}")
        return session

    if training is None:
        return training

    if kind == "pause_training":
        training.paused = bool(cmd.get("paused"))
        print("[INFO] Entrenamiento en pausa" if training.paused else "[INFO] Entrenamiento reanudado")
    elif kind == "restart_training":
        print("[INFO] Entrenamiento reiniciado (se descartaron los datos anteriores)")
        return training.restarted()
    elif kind == "discard_training":
        training.recorder.discard()
        training.recorder.discard_raw()
        print("[INFO] Entrenamiento descartado sin guardar")
        return None
    elif kind == "save_training":
        try:
            result = training.recorder.save()
        except (OSError, ValueError) as e:
            broadcast({"type": "error", "message": f"No se pudo guardar: {e}"})
            return training
        print(f"[INFO] Sesión {result['id_sesion']} guardada en {result['folder']}")
        for w in result["warnings"]:
            print(f"[AVISO] {w}")
        broadcast({"type": "saved", **result})
        return None
    elif kind == "set_threshold":
        band, value = cmd.get("band"), cmd.get("value")
        if band in training.bands and isinstance(value, (int, float)) and not isinstance(value, bool):
            training.threshold[band] = max(0.0, float(value))
    return training


def artifact_reason(channels, spike_buffer, var_buffer, eeg_names, dilation_struct):
    """Qué detector causó el artefacto: 'pico AF8', 'variabilidad TP9'... (para saber qué ajustar)."""
    for kind, buf in (("pico", spike_buffer), ("variabilidad", var_buffer)):
        for ch in channels:
            if binary_dilation(buf[ch], structure=dilation_struct).any():
                return f"{kind} {eeg_names[ch]}"
    return "artefacto"


def training_channels(training, eeg_names):
    a = eeg_names.index(training.active)
    r = eeg_names.index(training.reference) if training.reference is not None else None
    return a, r


def channels_ok(a, r, quality):
    return quality[a] == "excellent" and (r is None or quality[r] == "excellent")


async def sender_loop(websocket, queue):
    try:
        while True:
            await websocket.send(await queue.get())
    except Exception:
        pass


async def handle_client(websocket):
    queue = asyncio.Queue(maxsize=3)
    client_queues[websocket] = queue
    client_roles[websocket] = "full"
    sender = asyncio.create_task(sender_loop(websocket, queue))
    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if isinstance(msg, dict) and msg.get("type") == "hello":
                # la pantalla del cliente se anuncia así: solo recibe feedback liviano y no puede mandar comandos
                client_roles[websocket] = "feedback" if msg.get("role") == "feedback" else "full"
            elif client_roles.get(websocket) == "full":
                pending_commands.append(msg)
    finally:
        sender.cancel()
        client_queues.pop(websocket, None)
        client_roles.pop(websocket, None)


def feedback_message(training, state_override=None):
    """Mensaje mínimo para la pantalla del cliente: nada de señal, alias ni números de banda."""
    if state_override:
        state, met, total = state_override, 0, 0
    elif training is None:
        state, met, total = "idle", 0, 0
    elif training.paused:
        state, met, total = "paused", 0, 0
    else:
        state, met, total = training.feedback["state"], training.feedback["met"], training.feedback["total"]
    return {"type": "feedback", "state": state, "met": met, "total": total,
            "seq": training.seq if training is not None else 0}


def broadcast(message, roles=("full",)):
    """Cola acotada por cliente: si uno va lento se descartan frames viejos,
    así el atraso nunca crece ni bloquea la adquisición. `roles` filtra quién lo recibe."""
    if not client_queues:
        return
    data = json.dumps(message)
    for ws, queue in client_queues.items():
        if client_roles.get(ws, "full") not in roles:
            continue
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        queue.put_nowait(data)


async def reconnect(board):
    print("[INFO] Intentando reconectar con el Muse...")
    for step in (board.stop_stream, board.release_session):
        try:
            await asyncio.to_thread(step)
        except Exception:
            pass
    await asyncio.sleep(1)
    try:
        await asyncio.to_thread(board.prepare_session)
        await asyncio.to_thread(board.start_stream)
        print("[INFO] Reconexión lista")
    except Exception as e:
        print(f"[ERROR] No se pudo reconectar: {e}")


async def acquisition_loop():
    board_id = BoardIds.MUSE_2_BOARD.value
    eeg_channels = BoardShim.get_eeg_channels(board_id)
    eeg_names = BoardShim.get_eeg_names(board_id)
    sfreq = BoardShim.get_sampling_rate(board_id)
    try:
        ts_channel = BoardShim.get_timestamp_channel(board_id)
    except Exception:
        ts_channel = None             # sin reloj de la placa: se usa muestra/sfreq
    n_ch = len(eeg_channels)
    excluded = {i for i, name in enumerate(eeg_names) if name in EXCLUDED_CHANNELS}
    registry = ClientRegistry()

    b_notch, a_notch = iirnotch(NOTCH_FREQ, 30, sfreq)
    b_band, a_band = butter(4, [1 / (sfreq / 2), 40 / (sfreq / 2)], btype="band")
    notch_filter = StatefulFilter(b_notch, a_notch, n_ch)
    band_filter = StatefulFilter(b_band, a_band, n_ch)

    params = BrainFlowInputParams()
    params.timeout = 20
    board = BoardShim(board_id, params)
    board.prepare_session()
    board.start_stream()
    print("Adquisición iniciada. Dashboard en ws://localhost:8765")
    print(f"Canales excluidos del cálculo de bandas: {EXCLUDED_CHANNELS}")

    window_len = sfreq * 2
    band_buffer = np.zeros((n_ch, window_len))
    mask_buffer = np.zeros((n_ch, window_len), dtype=bool)
    spike_buffer = np.zeros((n_ch, window_len), dtype=bool)   # solo picos por muestra
    var_buffer = np.zeros((n_ch, window_len), dtype=bool)     # solo variabilidad alta
    std_window_samples = int(STD_WINDOW_MS / 1000 * sfreq)
    margin_samples = int(BLINK_MARGIN_MS / 1000 * sfreq)
    dilation_struct = np.ones(2 * margin_samples + 1, dtype=bool)

    baseline_std = None
    quality_history = [deque(maxlen=QUALITY_WINDOW) for _ in range(n_ch)]
    current_quality = ["excellent"] * n_ch
    last_good_bands = [{b: 0.0 for b in BAND_DEFS} for _ in range(n_ch)]
    delta_gates = [DeltaGate() for _ in range(n_ch)]
    smoothed = None
    bands_out = {b: 0.0 for b in BAND_DEFS}
    bands_seq = 0
    epoch_acc = []
    training = None
    warmup_left_s = FILTER_WARMUP_S   # los filtros se asientan: estos primeros segundos no se usan

    stream_ok = True
    last_data_time = time.monotonic()
    last_diag = time.monotonic()
    samples_since_diag = 0
    max_loop_ms = 0.0

    try:
        while True:
            loop_start = time.monotonic()

            while pending_commands:
                training = handle_command(pending_commands.popleft(), training, eeg_names, sfreq, registry)

            raw_chunk = board.get_board_data()

            if raw_chunk.shape[1] == 0:
                silent = time.monotonic() - last_data_time
                if silent > NO_DATA_WARN_S and stream_ok:
                    stream_ok = False
                    print(f"[ALERTA] Sin datos del Muse hace {silent:.0f} s")
                    broadcast({"type": "status", "stream_ok": False})
                if silent > NO_DATA_RECONNECT_S:
                    await reconnect(board)
                    notch_filter.reset()
                    band_filter.reset()
                    warmup_left_s = FILTER_WARMUP_S
                    last_data_time = time.monotonic()
                broadcast(feedback_message(training, "nosignal"), roles=("feedback",))
                await asyncio.sleep(0.1)
                continue

            last_data_time = time.monotonic()
            samples_since_diag += raw_chunk.shape[1]
            if not stream_ok:
                stream_ok = True
                print("[INFO] Señal del Muse recuperada")
                broadcast({"type": "status", "stream_ok": True})

            try:
                eeg_chunk = raw_chunk[eeg_channels, :]
                if training is not None and training.recorder.raw is not None:
                    phase = "pausa" if training.paused else ("calibracion" if training.phase == "calibrating" else "entrenamiento")
                    try:
                        ts = raw_chunk[ts_channel, :] if ts_channel is not None else None
                        training.recorder.raw.write(eeg_chunk, phase, ts)
                    except OSError as e:
                        print(f"[AVISO] Se dejó de guardar la señal cruda: {e}")
                        training.recorder.discard_raw()
                filtered = notch_filter.process(eeg_chunk)
                filtered = band_filter.process(filtered)

                n = min(filtered.shape[1], window_len)
                band_buffer = np.roll(band_buffer, -n, axis=1)
                band_buffer[:, -n:] = filtered[:, -n:]

                # Método 1: pico brusco por muestra
                sample_spike = np.abs(filtered[:, -n:]) > BLINK_SAMPLE_THRESHOLD_UV

                # Método 2: variabilidad vs línea base propia
                local_std = band_buffer[:, -std_window_samples:].std(axis=1)
                if baseline_std is None:
                    baseline_std = local_std.copy()
                spike_std = local_std > baseline_std * STD_SPIKE_FACTOR
                calm = ~spike_std
                baseline_std[calm] = (1 - BASELINE_EWMA_ALPHA) * baseline_std[calm] + BASELINE_EWMA_ALPHA * local_std[calm]
                # Si la línea base quedó muy baja (arranque, cambio de estado), antes nunca se corregía y la
                # señal quedaba marcada para siempre. Ahora sube lento incluso durante el "pico".
                baseline_std[spike_std] = ((1 - BASELINE_SLOW_ALPHA) * baseline_std[spike_std]
                                           + BASELINE_SLOW_ALPHA * local_std[spike_std])

                mask_buffer = np.roll(mask_buffer, -n, axis=1)
                mask_buffer[:, -n:] = sample_spike | spike_std[:, None]
                spike_buffer = np.roll(spike_buffer, -n, axis=1)
                spike_buffer[:, -n:] = sample_spike
                var_buffer = np.roll(var_buffer, -n, axis=1)
                var_buffer[:, -n:] = spike_std[:, None]

                # Una vez por segundo: calidad de electrodo + bandas (All EEG) + entrenamiento
                epoch_acc.append(filtered)
                if warmup_left_s > 0 and sum(c.shape[1] for c in epoch_acc) >= sfreq:
                    epoch_acc = []          # arranque de filtros: sin bandas, sin calidad, sin entrenamiento
                    warmup_left_s -= 1
                elif sum(c.shape[1] for c in epoch_acc) >= sfreq:
                    epoch = np.concatenate(epoch_acc, axis=1)[:, -sfreq:]
                    epoch_acc = []
                    ptp = epoch.max(axis=1) - epoch.min(axis=1)
                    is_bad = (ptp > ARTIFACT_THRESHOLD_UV) | (ptp < FLATLINE_THRESHOLD_UV)

                    for ch in range(n_ch):
                        quality_history[ch].append(bool(is_bad[ch]))
                        ratio = sum(quality_history[ch]) / len(quality_history[ch])
                        current_quality[ch] = "poor" if ratio >= QUALITY_BAD_RATIO else "excellent"

                        if ch in excluded:
                            continue
                        if binary_dilation(mask_buffer[ch], structure=dilation_struct).any():
                            continue  # artefacto reciente en la ventana: se conserva el último valor limpio
                        amps = band_amplitudes(band_buffer[ch], sfreq)
                        if not delta_gates[ch].accept(amps["delta"]):
                            continue  # delta fuera de su rango habitual: se descarta la ventana
                        last_good_bands[ch] = amps

                    raw_avg = average_bands(last_good_bands, current_quality, excluded, n_ch)
                    if raw_avg["delta"] > 0:
                        if smoothed is None:
                            smoothed = raw_avg
                        else:
                            smoothed = {b: SMOOTHING_ALPHA * raw_avg[b] + (1 - SMOOTHING_ALPHA) * smoothed[b]
                                        for b in BAND_DEFS}
                        bands_out = smoothed
                    bands_seq += 1

                    # En pausa no corre el reloj ni se graba nada
                    if training is not None and not training.paused:
                        a, r = training_channels(training, eeg_names)
                        signal = band_buffer[a].copy()
                        mask = mask_buffer[a].copy()
                        if r is not None:
                            signal -= band_buffer[r]
                            mask |= mask_buffer[r]
                        has_artifact = binary_dilation(mask, structure=dilation_struct).any()
                        # electrodo en REVISAR = segundo inválido (una señal plana no cuenta como éxito)
                        electrode_bad = not channels_ok(a, r, current_quality)
                        reason = "electrodo" if electrode_bad else artifact_reason(
                            [a] + ([r] if r is not None else []), spike_buffer, var_buffer, eeg_names, dilation_struct)
                        training.tick(signal, sfreq, has_artifact or electrode_bad, reason)

                payload = {"training": None, "train_raw_chunk": None, "train_quality": None}
                if training is not None:
                    a, r = training_channels(training, eeg_names)
                    derived = filtered[a].copy()
                    if r is not None:
                        derived -= filtered[r]
                    payload = {
                        "training": training.snapshot(),
                        "train_raw_chunk": derived[-sfreq * 5:].tolist(),
                        "train_quality": "excellent" if channels_ok(a, r, current_quality) else "poor",
                    }

                broadcast({
                    "type": "data",
                    "channel_names": eeg_names,
                    "excluded_channels": EXCLUDED_CHANNELS,
                    "clients": registry.aliases(),
                    "raw_chunk": filtered[:, -sfreq * 5:].tolist(),
                    "sfreq": sfreq,
                    "quality": current_quality,
                    "bands": bands_out,
                    "bands_seq": bands_seq,
                    "warming_up": warmup_left_s > 0,
                    **payload,
                })
                broadcast(feedback_message(training), roles=("feedback",))
            except Exception:
                traceback.print_exc()

            now = time.monotonic()
            max_loop_ms = max(max_loop_ms, (now - loop_start) * 1000)
            if now - last_diag >= DIAG_EVERY_S:
                print(f"[diag] {DIAG_EVERY_S}s | muestras: {samples_since_diag} "
                      f"(esperadas ≈ {sfreq * DIAG_EVERY_S}) | ciclo máx: {max_loop_ms:.0f} ms | "
                      f"clientes: {len(client_queues)}")
                last_diag, samples_since_diag, max_loop_ms = now, 0, 0.0

            await asyncio.sleep(0.1)

    finally:
        for step in (board.stop_stream, board.release_session):
            try:
                step()
            except Exception:
                pass


VIDEO_DIR = PROJECT_DIR / "videos"
VIDEO_TYPES = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}


def list_videos():
    """Videos descargados en la carpeta videos/ (solo extensiones permitidas, sin subcarpetas)."""
    if not VIDEO_DIR.is_dir():
        return []
    return sorted(f.name for f in VIDEO_DIR.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_TYPES)


def parse_range(header, size):
    """'bytes=a-b' -> (inicio, fin) inclusivos; None si no hay rango; ValueError si es invalido."""
    if not header:
        return None
    if not header.startswith("bytes=") or "," in header or size <= 0:
        raise ValueError(header)
    a, _, b = header[6:].strip().partition("-")
    try:
        if a == "":                      # sufijo: ultimos N bytes
            n = int(b)
            if n <= 0:
                raise ValueError(header)
            return max(0, size - n), size - 1
        start = int(a)
        end = int(b) if b else size - 1
    except ValueError:
        raise ValueError(header)
    end = min(end, size - 1)
    if start < 0 or start > end:
        raise ValueError(header)
    return start, end


class PageHandler(BaseHTTPRequestHandler):
    """Sirve dashboard.html, feedback.html y los videos de la carpeta videos/ (con soporte de Range,
    necesario para que iPad/Safari reproduzcan video)."""

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/videos.json":
            return self._send_bytes(json.dumps(list_videos()).encode("utf-8"), "application/json; charset=utf-8")
        if path.startswith("/videos/"):
            return self._send_video(path[len("/videos/"):])
        name = PAGES.get(path)
        file = PROJECT_DIR / name if name else None
        if file is None or not file.is_file():
            self.send_error(404)
            return
        self._send_bytes(file.read_bytes(), "text/html; charset=utf-8")

    def _send_bytes(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_video(self, quoted):
        from urllib.parse import unquote
        name = unquote(quoted)
        if name not in list_videos():          # solo nombres que existen en la lista (evita ../)
            self.send_error(404)
            return
        file = VIDEO_DIR / name
        size = file.stat().st_size
        try:
            rng = parse_range(self.headers.get("Range"), size)
        except ValueError:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        start, end = rng if rng else (0, size - 1)
        length = end - start + 1 if size else 0
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", VIDEO_TYPES[file.suffix.lower()])
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with open(file, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(256 * 1024, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass                                # el navegador cancela y reanuda: normal

    def log_message(self, *args):
        pass


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no envía nada: solo averigua qué interfaz usaría
            return s.getsockname()[0]
    except OSError:
        return "IP-DE-ESTA-COMPU"


def start_http(host):
    try:
        httpd = ThreadingHTTPServer((host, HTTP_PORT), PageHandler)
    except OSError as e:
        print(f"[AVISO] No se pudo abrir el servidor de páginas en el puerto {HTTP_PORT}: {e}")
        return None
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main(lan=False):
    host = "0.0.0.0" if lan else "localhost"
    httpd = start_http(host)
    if lan:
        ip = lan_ip()
        print(f"[LAN] Abierto a la red local. Pantalla del cliente (tablet): http://{ip}:{HTTP_PORT}/feedback.html")
        print(f"[LAN] Dashboard de la entrenadora: http://{ip}:{HTTP_PORT}/dashboard.html")
        print("[LAN] Sin contraseña: úsalo solo en una red de confianza (Windows puede pedir permitir el firewall).")
    else:
        print(f"Páginas: http://localhost:{HTTP_PORT}/dashboard.html  y  http://localhost:{HTTP_PORT}/feedback.html")
        print("(Para usar la tablet, corre con:  python src/live_server.py --lan)")
    try:
        async with websockets.serve(handle_client, host, WS_PORT, compression=None):
            await acquisition_loop()
    finally:
        if httpd:
            httpd.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Servidor de neurofeedback (Muse 2)")
    parser.add_argument("--lan", action="store_true", help="abrir a la red local (tablet de feedback)")
    asyncio.run(main(parser.parse_args().lan))
