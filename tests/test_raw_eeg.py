import csv
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from session_export import RawEegWriter, SessionRecorder  # noqa: E402

PROTO = {"name": "Prueba", "active": "AF8", "reference": "TP9", "reward": ["low_beta"], "inhibit": ["theta"]}
CH = ["TP9", "AF7", "AF8", "TP10"]


def test_escritura_y_formato(tmp_path):
    w = RawEegWriter("abc", CH, 256, base_dir=tmp_path)
    chunk = np.arange(4 * 256, dtype=float).reshape(4, 256) / 10
    w.write(chunk, "calibracion")
    w.mark_training_start()
    w.write(chunk, "entrenamiento")
    w.write(chunk[:, :10], "pausa", timestamps=np.arange(10) / 256 + 1000)
    w.close()
    rows = list(csv.reader(w.path.open()))
    assert rows[0] == ["muestra", "t_s", *CH, "fase"]
    assert len(rows) == 1 + 256 + 256 + 10
    assert rows[1][0] == "0" and rows[257][0] == "256" and rows[-1][-1] == "2"
    assert rows[257][-1] == "1" and w.training_start_sample == 256
    assert abs(float(rows[1][2]) - chunk[0, 0]) < 1e-3


def test_guardar_sesion_mueve_el_crudo(tmp_path):
    rec = SessionRecorder(PROTO, "001", 256, 600, backup=False, eeg_channels=CH)
    rec.raw = RawEegWriter(rec.session_id, CH, 256, base_dir=tmp_path / "sesiones")
    rec.raw.write(np.zeros((4, 512)), "calibracion")
    rec.restart()                                   # fin de calibración: NO borra el crudo
    assert rec.raw is not None and rec.raw.path.exists()
    rec.raw.mark_training_start()
    for _ in range(40):
        rec.add_second({"low_beta": {"role": "reward", "value": 1.0, "threshold": 0.5},
                        "theta": {"role": "inhibit", "value": 1.0, "threshold": 2.0}}, True)
    result = rec.save(base_dir=tmp_path)
    folder = Path(result["folder"])
    assert (folder / "crudo" / "eeg_crudo.csv").exists()
    meta = json.loads((folder / "para_resumen" / "meta.json").read_text(encoding="utf-8"))
    assert meta["raw_eeg"]["muestras"] == 512 and meta["raw_eeg"]["entrenamiento_empieza_en_muestra"] == 512
    assert result["raw"]["archivo"] == "crudo/eeg_crudo.csv"
    # nada del crudo en lo que va a P4
    for f in (tmp_path / "para_p4").iterdir():
        assert "crudo" not in f.read_text(encoding="utf-8").lower()


def test_descartar_borra_el_crudo(tmp_path):
    rec = SessionRecorder(PROTO, "001", 256, 600, backup=False, eeg_channels=CH)
    rec.raw = RawEegWriter(rec.session_id, CH, 256, base_dir=tmp_path)
    rec.raw.write(np.zeros((4, 10)), "calibracion")
    path = rec.raw.path
    rec.discard_raw()
    assert not path.exists() and rec.raw is None


def test_sin_crudo_por_defecto(tmp_path):
    rec = SessionRecorder(PROTO, "001", 256, 600, backup=False, eeg_channels=CH)
    assert rec.raw is None
