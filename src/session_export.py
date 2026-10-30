"""Grabación y exportación de sesiones de entrenamiento.

No depende del hardware: recibe lo que calcula el servidor (valor por segundo, umbrales,
validez) y, al guardar, escribe:

  data/sesiones/sesion-001_usuario-001_<fecha>_<protocolo>/para_resumen/
        serie_por_segundo.csv + meta.json            -> compañero del gráfico resumen
  data/para_p4/
        sesion-001_usuario-001.json + .csv           -> P4 (contrato ADR 2: dos archivos, mismo nombre base)
"""
import csv
import json
import shutil
import re
import unicodedata
import numpy as np
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SESSIONS_DIR = DATA_DIR / "sesiones"
P4_DIR = DATA_DIR / "para_p4"
CLIENTS_FILE = DATA_DIR / "clientes.json"

LOCAL_TZ = timezone(timedelta(hours=-6))  # El Salvador (UTC-6)

DEVICE_CODE = "muse_2"
ACQUISITION_METHOD = "brainflow_ble"
FIRMWARE_VERSION = "1.0.27"

P4_INTERVAL_S = 5             # una fila para P4 cada 5 s activos (promedio de ese bloque)
P4_MAX_BANDS = 4              # el contrato tiene 4 ranuras por lado
P4_REQUIRE_THRESHOLDS = True  # el contrato exige umbral en todas las filas: no se escriben filas sin umbral
P4_VALID_BANDS = {"high_alpha", "low_alpha", "high_beta", "beta", "low_beta", "delta", "theta"}  # ADR 2

RAW_PHASES = {"calibracion": 0, "entrenamiento": 1, "pausa": 2}


class RawEegWriter:
    """Guarda la señal cruda (sin filtrar, µV) mientras dura la sesión, SOLO en local (nunca va a P4).

    CSV en data/sesiones/_en_curso/<id>_crudo.csv, escrito por trozos (si se cierra el programa queda lo grabado).
    Columnas: muestra, t_s (reloj de la placa si existe, si no muestra/sfreq), un canal por electrodo, fase
    (0 calibración, 1 entrenamiento, 2 pausa).
    """

    def __init__(self, session_id, channel_names, sfreq, base_dir=None):
        self.channel_names = list(channel_names)
        self.sfreq = sfreq
        self.n = 0                       # muestras escritas
        self.training_start_sample = None
        self.t0 = None
        self.path = Path(base_dir or SESSIONS_DIR) / "_en_curso" / f"{session_id}_crudo.csv"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._f = self.path.open("w", encoding="utf-8", newline="")
        self._f.write("muestra,t_s," + ",".join(self.channel_names) + ",fase\n")

    def write(self, chunk, phase, timestamps=None):
        """chunk: (canales, muestras) en µV. phase: clave de RAW_PHASES."""
        if self._f is None or chunk.shape[1] == 0:
            return
        m = chunk.shape[1]
        idx = np.arange(self.n, self.n + m)
        if timestamps is not None and len(timestamps) == m:
            if self.t0 is None:
                self.t0 = float(timestamps[0])
            t = np.asarray(timestamps, dtype=float) - self.t0
        else:
            t = idx / self.sfreq
        table = np.column_stack([idx, t, chunk.T, np.full(m, RAW_PHASES[phase])])
        fmt = ["%d", "%.4f"] + ["%.3f"] * chunk.shape[0] + ["%d"]
        np.savetxt(self._f, table, fmt=fmt, delimiter=",")
        self._f.flush()
        self.n += m

    def mark_training_start(self):
        self.training_start_sample = self.n

    def close(self):
        if self._f is not None:
            self._f.close()
            self._f = None

    def discard(self):
        self.close()
        try:
            self.path.unlink()
        except OSError:
            pass

    def move_to(self, folder):
        """Al guardar la sesión: el archivo pasa a <carpeta>/crudo/eeg_crudo.csv. Devuelve la info para meta.json."""
        self.close()
        dest_dir = Path(folder) / "crudo"
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(self.path), str(dest_dir / "eeg_crudo.csv"))
        return {
            "archivo": "crudo/eeg_crudo.csv",
            "canales": self.channel_names,
            "sample_rate_hz": self.sfreq,
            "muestras": self.n,
            "duracion_s": round(self.n / self.sfreq, 1),
            "entrenamiento_empieza_en_muestra": self.training_start_sample,
            "unidades": "uV, sin filtrar (tal como llega del Muse). fase: 0 calibracion, 1 entrenamiento, 2 pausa.",
            "privacidad": "Solo local. No se comparte con P4 (no esta en data/para_p4).",
        }


QUALITY_OK_MIN = 0.80         # % de segundos válidos para el flag "ok"
QUALITY_WARNING_MIN = 0.50    # por debajo de esto, "bad" (P4 rechaza las sesiones "bad")

SUPPORT_COLUMNS = ["session_id", "t_s", "timestamp", "band", "role", "value", "valid", "threshold", "success"]


def p4_columns(n_reward, n_inhibit):
    """Columnas del CSV de P4 (ADR 2): solo las ranuras de las bandas declaradas."""
    return (["timestamp_s"]
            + [f"enhanced_{i}" for i in range(1, n_reward + 1)]
            + [f"inhibited_{i}" for i in range(1, n_inhibit + 1)]
            + [f"enhanced_threshold_{i}" for i in range(1, n_reward + 1)]
            + [f"inhibited_threshold_{i}" for i in range(1, n_inhibit + 1)]
            + ["electrodo_activo", "electrodo_referencia"])


def now_local():
    return datetime.now(LOCAL_TZ)


def slugify(text):
    """'Monastra Alfa-Beta' -> 'monastra_alfa_beta' (código estable del protocolo)."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "protocolo"


def quality_flag(valid_ratio):
    if valid_ratio >= QUALITY_OK_MIN:
        return "ok"
    if valid_ratio >= QUALITY_WARNING_MIN:
        return "warning"
    return "bad"


def next_session_id(data_dir):
    """Siguiente id de sesión corto y secuencial ('001'): mira lo ya guardado en data/."""
    used = [0]
    for folder in (Path(data_dir) / "sesiones", Path(data_dir) / "para_p4"):
        if folder.exists():
            for item in folder.iterdir():
                m = re.match(r"sesion-(\d+)", item.name)
                if m:
                    used.append(int(m.group(1)))
    return f"{max(used) + 1:03d}"


class ClientRegistry:
    """alias -> id anónimo corto y secuencial (001, 002...). El alias nunca sale en los archivos exportados."""

    def __init__(self, path=CLIENTS_FILE):
        self.path = Path(path)
        self.data = {}
        if self.path.exists():
            try:
                self.data = json.loads(self.path.read_text(encoding="utf-8"))
            except ValueError:
                self.data = {}

    def aliases(self):
        return sorted(self.data)

    def get_or_create(self, alias):
        alias = alias.strip()
        for known in self.data:
            if known.lower() == alias.lower():
                return self.data[known]
        numeric = [int(v["id"]) for v in self.data.values() if str(v.get("id", "")).isdigit()]
        self.data[alias] = {"id": f"{max(numeric, default=0) + 1:03d}", "creado_en": now_local().isoformat(timespec="seconds")}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        return self.data[alias]


class SessionRecorder:
    """Acumula lo que pasa en una sesión de entrenamiento y la exporta al guardar.

    t_s cuenta solo el tiempo ACTIVO (las pausas no cuentan): el servidor llama a add_second()
    una vez por cada segundo de entrenamiento.
    """

    def __init__(self, protocol, client_id, sfreq, target_duration_s, backup=True, eeg_channels=None):
        self.session_id = str(uuid.uuid4())
        self.protocol = protocol  # name, active, reference, reward, inhibit
        self.client_id = client_id
        self.sfreq = sfreq
        self.eeg_channels = list(eeg_channels) if eeg_channels else [c for c in (protocol['active'], protocol['reference']) if c]
        self.target_duration_s = target_duration_s
        self.started_at = now_local()
        self.t_s = 0
        self.valid_s = 0
        self.invalid_reasons = {}   # lo llena el servidor: segundos inválidos por causa
        self.band_ranges = {}       # lo llena el servidor: {banda: [bajo, alto)} en Hz
        self.rows = []      # una fila por segundo y por banda (para el compañero)
        self.p4_rows = []   # una fila cada P4_INTERVAL_S segundos (para P4)
        self.bands = protocol["reward"] + protocol["inhibit"]
        self._block = {b: [] for b in self.bands}
        self._block_valid = 0
        self._backup_path = None
        self.raw = None   # RawEegWriter opcional (lo activa el servidor)
        if backup:
            self._backup_path = SESSIONS_DIR / "_en_curso" / f"{self.session_id}.csv"

    def restart(self):
        """Empieza a contar desde cero (fin de la calibración): se borra lo acumulado y ts_inicio es ahora."""
        self.started_at = now_local()
        self.t_s = 0
        self.valid_s = 0
        self.rows = []
        self.p4_rows = []
        self.invalid_reasons = {}
        self._block = {b: [] for b in self.bands}
        self._block_valid = 0
        self.discard()   # el respaldo anterior ya no corresponde

    # ---------------- registro segundo a segundo ----------------
    def add_second(self, bands, valid):
        """bands: {banda: {"role": "reward"|"inhibit", "value": float|None, "threshold": float|None}}"""
        self.t_s += 1
        ts = now_local().isoformat(timespec="seconds")
        if valid:
            self.valid_s += 1
            self._block_valid += 1

        new_rows = []
        for band, info in bands.items():
            raw_value = info["value"] if valid else None
            thr = info["threshold"]
            value = None if raw_value is None else round(raw_value, 3)
            thr = None if thr is None else round(thr, 3)
            success = None
            if value is not None and thr is not None:
                success = int(value > thr) if info["role"] == "reward" else int(value < thr)
            new_rows.append({
                "session_id": self.session_id, "t_s": self.t_s, "timestamp": ts, "band": band,
                "role": info["role"], "value": value, "valid": int(bool(valid)),
                "threshold": thr, "success": success,
            })
            if raw_value is not None:
                self._block[band].append(raw_value)
        self.rows.extend(new_rows)
        self._append_backup(new_rows)

        if self.t_s % P4_INTERVAL_S == 0:
            self._close_block({b: info["threshold"] for b, info in bands.items()})

    def _close_block(self, thresholds):
        averages = {b: (sum(v) / len(v) if v else None) for b, v in self._block.items()}
        valid_in_block = self._block_valid
        self._block = {b: [] for b in self.bands}
        self._block_valid = 0

        if valid_in_block == 0:
            return  # sin segundos válidos no hay promedio (enhanced_1 es NOT NULL en P4)
        if P4_REQUIRE_THRESHOLDS and any(thresholds[b] is None for b in self.bands):
            return  # calibrando: el esquema de P4 exige umbral

        row = {
            "timestamp_s": self.t_s,
            "electrodo_activo": self.protocol["active"],
            "electrodo_referencia": self.protocol["reference"],
        }
        for prefix, side in (("enhanced", self.protocol["reward"]), ("inhibited", self.protocol["inhibit"])):
            for i in range(1, P4_MAX_BANDS + 1):
                band = side[i - 1] if i <= len(side) else None
                row[f"{prefix}_{i}"] = None if band is None else averages[band]
                row[f"{prefix}_threshold_{i}"] = None if band is None else thresholds[band]
        self.p4_rows.append(row)

    # ---------------- respaldo por si se cierra el programa ----------------
    def _append_backup(self, rows):
        if self._backup_path is None:
            return
        try:
            self._backup_path.parent.mkdir(parents=True, exist_ok=True)
            is_new = not self._backup_path.exists()
            with self._backup_path.open("a", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=SUPPORT_COLUMNS)
                if is_new:
                    writer.writeheader()
                writer.writerows(rows)
        except OSError:
            pass  # el respaldo nunca debe tumbar la sesión

    def discard(self):
        if self._backup_path is not None:
            try:
                self._backup_path.unlink()
            except OSError:
                pass

    def discard_raw(self):
        """Descarte total (reiniciar/descartar): borra también la señal cruda. restart() NO la borra."""
        if self.raw is not None:
            self.raw.discard()
            self.raw = None

    # ---------------- guardar ----------------
    def save(self, base_dir=None):
        """base_dir = carpeta data/ (por defecto la del proyecto)."""
        if self.t_s == 0:
            raise ValueError("La sesión no tiene datos")

        data_dir = Path(base_dir or DATA_DIR)
        id_sesion = next_session_id(data_dir)
        base_name = f"sesion-{id_sesion}_usuario-{self.client_id}"   # patrón del ADR 2
        slug = slugify(self.protocol["name"])
        ts_inicio = self.started_at
        ts_fin = ts_inicio + timedelta(seconds=self.t_s)   # tiempo activo: timestamp_s es relativo a ts_inicio

        folder = data_dir / "sesiones" / f"{base_name}_{ts_inicio:%Y-%m-%d_%H%M%S}_{slug}"
        support_dir = folder / "para_resumen"
        support_dir.mkdir(parents=True, exist_ok=True)

        valid_ratio = self.valid_s / self.t_s
        flag = quality_flag(valid_ratio)
        warnings = []
        if self.valid_s == 0:
            warnings.append("La sesión no tiene ningún segundo válido.")

        # --- para el compañero del gráfico resumen ---
        with (support_dir / "serie_por_segundo.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=SUPPORT_COLUMNS)
            writer.writeheader()
            writer.writerows({**r, "session_id": id_sesion} for r in self.rows)

        meta = {
            "session_id": id_sesion,
            "usuario_id": self.client_id,
            "simulated": False,
            "protocol_name": self.protocol["name"],
            "protocolo_codigo": slug,
            "device": DEVICE_CODE,
            "firmware_version": FIRMWARE_VERSION,
            "active_electrode": self.protocol["active"],
            "reference_electrode": self.protocol["reference"],
            "bands": [{"band": b, "role": "reward" if b in self.protocol["reward"] else "inhibit"}
                      for b in self.bands],
            "start_time": ts_inicio.isoformat(timespec="seconds"),
            "end_time": ts_fin.isoformat(timespec="seconds"),
            "target_duration_s": self.target_duration_s,
            "duration_s": self.t_s,
            "valid_s": self.valid_s,
            "valid_pct": round(100 * valid_ratio, 1),
            "signal_quality_flag": flag,
            "invalid_seconds_by_reason": self.invalid_reasons,
            "band_ranges_hz": self.band_ranges,          # intervalos [bajo, alto)
            "calibration_note": "Antes de esta sesión hubo una calibración (no incluida en estos datos); t_s=0 es el inicio del entrenamiento.",
            "sample_rate_hz": 1,
            "value_description": "Amplitud de la banda (raiz de la PSD promedio, ~uV/sqrt(Hz)), suavizada con EMA alpha=0.5. No comparable entre personas sin normalizar.",
            "success_rule": {"reward": "value > threshold", "inhibit": "value < threshold"},
            "time_note": "t_s cuenta solo el tiempo activo (sin pausas); timestamp es la hora real.",
            "threshold_note": "Vacio durante la calibracion inicial (mediana de los primeros 30 s validos). El entrenador puede cambiarlo en cualquier momento.",
        }
        if self.raw is not None:
            try:
                meta["raw_eeg"] = self.raw.move_to(folder)
            except OSError as e:
                warnings.append(f"No se pudo guardar la señal cruda: {e}")
        (support_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        # --- para P4 (contrato ADR 2) ---
        p4_files = []
        if flag == "bad":
            warnings.append("Calidad de señal 'bad' (menos de 50% de segundos válidos): P4 rechaza estas sesiones, "
                            "así que no se generaron archivos para P4.")
        elif not self.p4_rows:
            warnings.append("No se generaron archivos para P4: la sesión fue muy corta "
                            "(hacen falta ~30 s válidos de calibración y al menos un bloque de 5 s con umbral).")
        else:
            p4_dir = data_dir / "para_p4"
            p4_dir.mkdir(parents=True, exist_ok=True)
            reward, inhibit = self.protocol["reward"], self.protocol["inhibit"]
            sesion = {
                "protocolo_codigo": slug,
                "dispositivo_codigo": DEVICE_CODE,
                "acquisition_method": ACQUISITION_METHOD,
                "firmware_version": FIRMWARE_VERSION,
                "sampling_rate": self.sfreq,
                "eeg_channels": self.eeg_channels,
                "ts_inicio": ts_inicio.isoformat(timespec="seconds"),
                "ts_fin": ts_fin.isoformat(timespec="seconds"),
                "signal_quality_flag": flag,
            }
            for prefix, side in (("banda_reforzada", reward), ("banda_inhibida", inhibit)):
                for i, band in enumerate(side[:P4_MAX_BANDS], start=1):
                    sesion[f"{prefix}_{i}"] = band
            json_path, csv_path = p4_dir / f"{base_name}.json", p4_dir / f"{base_name}.csv"
            json_path.write_text(json.dumps(sesion, ensure_ascii=False, indent=2), encoding="utf-8")

            columns = p4_columns(len(reward), len(inhibit))
            with csv_path.open("w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
                writer.writeheader()
                for row in self.p4_rows:
                    writer.writerow({k: ("" if v is None else (round(v, 4) if isinstance(v, float) else v))
                                     for k, v in row.items()})
            p4_files = [str(json_path), str(csv_path)]

        self.discard()  # ya está guardada: se borra el respaldo
        return {
            "id_sesion": id_sesion,
            "id_usuario": self.client_id,
            "folder": str(folder),
            "p4_files": p4_files,
            "duration_s": self.t_s,
            "support_rows": len(self.rows),
            "p4_rows": len(self.p4_rows) if p4_files else 0,
            "valid_pct": round(100 * valid_ratio, 1),
            "flag": flag,
            "warnings": warnings,
            "raw": meta.get("raw_eeg"),
        }