import csv
import json
import re
from datetime import datetime

import pytest

from session_export import (
    P4_VALID_BANDS, ClientRegistry, SessionRecorder, next_session_id, p4_columns, quality_flag, slugify,
)

PROTOCOL = {"name": "Monastra", "active": "AF8", "reference": "TP9",
            "reward": ["low_beta"], "inhibit": ["theta", "high_beta"]}
CHANNELS = ["TP9", "AF7", "AF8", "TP10"]


def new_recorder(client_id="001", protocol=PROTOCOL):
    return SessionRecorder(protocol, client_id=client_id, sfreq=256, target_duration_s=600,
                           backup=False, eeg_channels=CHANNELS)


def feed(rec, seconds, valid=lambda t: True, thr=lambda t: 1.0):
    """low_beta=1.2 (sube), theta=0.8 y high_beta=0.9 (bajan)."""
    for t in range(seconds):
        rec.add_second({
            "low_beta": {"role": "reward", "value": 1.2, "threshold": thr(t)},
            "theta": {"role": "inhibit", "value": 0.8, "threshold": thr(t)},
            "high_beta": {"role": "inhibit", "value": 0.9, "threshold": thr(t)},
        }, valid=valid(t))


def validate_p4_pair(json_path, csv_path):
    """Reglas del ADR 2 (sección 4) que puedo comprobar sin el ingestor real. Devuelve los errores."""
    errors = []
    m = re.fullmatch(r"sesion-([A-Za-z0-9-]+)_usuario-([A-Za-z0-9-]+)\.json", json_path.name)
    if not m:
        errors.append("nombre de archivo fuera del patrón")
    if json_path.stem != csv_path.stem:
        errors.append("json y csv no comparten nombre base")
    meta = json.loads(json_path.read_text(encoding="utf-8"))
    for k in ("protocolo_codigo", "dispositivo_codigo", "acquisition_method", "ts_inicio", "ts_fin",
              "signal_quality_flag", "banda_reforzada_1", "banda_inhibida_1"):
        if not meta.get(k):
            errors.append(f"falta {k}")
    if meta["signal_quality_flag"] not in ("ok", "warning"):
        errors.append("signal_quality_flag no aceptado")
    for k in ("id", "usuario_id", "creado_en"):
        if k in meta:
            errors.append(f"{k} no va en el JSON")
    t0, t1 = datetime.fromisoformat(meta["ts_inicio"]), datetime.fromisoformat(meta["ts_fin"])
    if t0.tzinfo is None or t1 <= t0:
        errors.append("fechas inválidas")
    groups = {}
    for prefix in ("banda_reforzada", "banda_inhibida"):
        slots = [meta.get(f"{prefix}_{i}") for i in range(1, 5)]
        filled = [s for s in slots if s]
        if slots[:len(filled)] != filled:
            errors.append(f"{prefix}: ranuras fuera de orden")
        if len(set(filled)) != len(filled) or not set(filled) <= P4_VALID_BANDS:
            errors.append(f"{prefix}: bandas repetidas o inválidas")
        groups[prefix] = filled
    if set(groups["banda_reforzada"]) & set(groups["banda_inhibida"]):
        errors.append("banda en ambos grupos")

    with csv_path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        header = reader.fieldnames
    if "training_score" in header or "sesion_id" in header:
        errors.append("columnas que no se entregan")
    nr, ni = len(groups["banda_reforzada"]), len(groups["banda_inhibida"])
    if header != p4_columns(nr, ni):
        errors.append("columnas incoherentes con las bandas declaradas")
    prev = 0
    duration = (t1 - t0).total_seconds()
    for r in rows:
        ts = float(r["timestamp_s"])
        if ts % 5 or ts <= prev or ts > duration + 5:
            errors.append(f"timestamp_s inválido: {ts}")
        prev = ts
        for col in header:
            if col.startswith(("enhanced", "inhibited")):
                float(r[col])  # debe ser numérico y venir lleno
    return errors


def test_p4_row_every_5_seconds():
    rec = new_recorder()
    feed(rec, 20)
    assert [r["timestamp_s"] for r in rec.p4_rows] == [5, 10, 15, 20]
    row = rec.p4_rows[0]
    assert row["enhanced_1"] == pytest.approx(1.2)
    assert row["inhibited_1"] == pytest.approx(0.8)
    assert row["inhibited_2"] == pytest.approx(0.9)
    assert row["enhanced_2"] is None and row["inhibited_4"] is None
    assert "training_score" not in row and "sesion_id" not in row


def test_block_without_valid_seconds_is_skipped():
    rec = new_recorder()
    feed(rec, 15, valid=lambda t: not (5 <= t < 10))
    assert [r["timestamp_s"] for r in rec.p4_rows] == [5, 15]


def test_block_average_ignores_invalid_seconds():
    rec = new_recorder()
    for t in range(5):
        rec.add_second({
            "low_beta": {"role": "reward", "value": 2.0 if t < 2 else 9.9, "threshold": 1.0},
            "theta": {"role": "inhibit", "value": 1.0, "threshold": 1.0},
            "high_beta": {"role": "inhibit", "value": 1.0, "threshold": 1.0},
        }, valid=t < 2)
    assert rec.p4_rows[0]["enhanced_1"] == pytest.approx(2.0)


def test_rows_skipped_while_threshold_is_calibrating():
    rec = new_recorder()
    feed(rec, 20, thr=lambda t: None if t < 12 else 1.0)
    assert [r["timestamp_s"] for r in rec.p4_rows] == [15, 20]


def test_success_flag_per_second():
    rec = new_recorder()
    feed(rec, 2, valid=lambda t: t == 0)
    first = {r["band"]: r["success"] for r in rec.rows if r["t_s"] == 1}
    assert first == {"low_beta": 1, "theta": 1, "high_beta": 1}
    second = [r for r in rec.rows if r["t_s"] == 2]
    assert all(r["success"] is None and r["value"] is None and r["valid"] == 0 for r in second)


def test_save_follows_adr2_contract(tmp_path):
    rec = new_recorder(client_id="007")
    feed(rec, 20)
    result = rec.save(base_dir=tmp_path)

    assert result["id_sesion"] == "001" and result["id_usuario"] == "007"
    assert result["p4_rows"] == 4 and result["support_rows"] == 60 and result["flag"] == "ok"
    json_path = tmp_path / "para_p4" / "sesion-001_usuario-007.json"
    csv_path = tmp_path / "para_p4" / "sesion-001_usuario-007.csv"
    assert sorted(result["p4_files"]) == sorted([str(json_path), str(csv_path)])
    assert validate_p4_pair(json_path, csv_path) == []

    meta = json.loads(json_path.read_text(encoding="utf-8"))
    assert meta["protocolo_codigo"] == "monastra"
    assert meta["eeg_channels"] == CHANNELS            # canales de la adquisición, no solo el par usado
    assert meta["banda_reforzada_1"] == "low_beta" and "banda_reforzada_2" not in meta
    assert meta["banda_inhibida_2"] == "high_beta"
    assert (datetime.fromisoformat(meta["ts_fin"]) - datetime.fromisoformat(meta["ts_inicio"])).total_seconds() == 20

    with csv_path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert rows[0]["electrodo_activo"] == "AF8" and rows[0]["electrodo_referencia"] == "TP9"
    assert "enhanced_2" not in rows[0]

    summary = next((tmp_path / "sesiones").iterdir())
    assert summary.name.startswith("sesion-001_usuario-007_") and "monastra" in summary.name
    with (summary / "para_resumen" / "serie_por_segundo.csv").open(encoding="utf-8") as f:
        support = list(csv.DictReader(f))
    assert len(support) == 60 and {r["session_id"] for r in support} == {"001"}
    assert (summary / "para_resumen" / "meta.json").exists()


def test_session_ids_are_sequential(tmp_path):
    for expected in ("001", "002", "003"):
        rec = new_recorder()
        feed(rec, 10)
        assert rec.save(base_dir=tmp_path)["id_sesion"] == expected
    assert next_session_id(tmp_path) == "004"


def test_no_reference_electrode_leaves_column_empty(tmp_path):
    proto = dict(PROTOCOL, reference=None)
    rec = new_recorder(protocol=proto)
    feed(rec, 10)
    rec.save(base_dir=tmp_path)
    files = list((tmp_path / "para_p4").glob("*.csv"))
    with files[0].open(encoding="utf-8") as f:
        assert next(csv.DictReader(f))["electrodo_referencia"] == ""


def test_short_session_skips_p4_files_with_warning(tmp_path):
    rec = new_recorder()
    feed(rec, 8, thr=lambda t: None)
    result = rec.save(base_dir=tmp_path)
    assert not (tmp_path / "para_p4").exists() and result["p4_files"] == []
    assert next((tmp_path / "sesiones").iterdir()).joinpath("para_resumen", "serie_por_segundo.csv").exists()
    assert result["warnings"]


def test_bad_quality_session_is_not_delivered_to_p4(tmp_path):
    rec = new_recorder()
    feed(rec, 20, valid=lambda t: t >= 12)  # 40% válidos -> "bad"; P4 lo rechazaría
    result = rec.save(base_dir=tmp_path)
    assert result["flag"] == "bad" and result["p4_files"] == []
    assert any("bad" in w for w in result["warnings"])


def test_save_without_data_raises(tmp_path):
    with pytest.raises(ValueError):
        new_recorder().save(base_dir=tmp_path)


def test_quality_flag_thresholds():
    assert quality_flag(0.95) == "ok" and quality_flag(0.80) == "ok"
    assert quality_flag(0.79) == "warning" and quality_flag(0.50) == "warning"
    assert quality_flag(0.49) == "bad"


def test_band_definitions_match_p4_list():
    import live_server  # el assert de importación ya lo comprueba; aquí queda explícito
    assert set(live_server.BAND_DEFS) <= P4_VALID_BANDS


def test_slugify():
    assert slugify("Monastra Alfa-Beta") == "monastra_alfa_beta"
    assert slugify("Protocolo Ñandú") == "protocolo_nandu"
    assert slugify("!!!") == "protocolo"


def test_client_registry_short_sequential_ids(tmp_path):
    path = tmp_path / "clientes.json"
    a = ClientRegistry(path).get_or_create("Cliente 1")
    again = ClientRegistry(path)
    assert a["id"] == "001"
    assert again.get_or_create("cliente 1")["id"] == "001"
    assert again.get_or_create("Cliente 2")["id"] == "002"
    assert again.aliases() == ["Cliente 1", "Cliente 2"]


def test_restart_clears_everything_and_resets_start(tmp_path):
    rec = new_recorder()
    feed(rec, 12)
    rec.invalid_reasons = {"artefacto": 3}
    before = rec.started_at
    rec.restart()
    assert rec.t_s == 0 and rec.rows == [] and rec.p4_rows == [] and rec.invalid_reasons == {}
    assert rec.started_at >= before
    feed(rec, 10)
    assert [r["timestamp_s"] for r in rec.p4_rows] == [5, 10]          # el reloj cuenta desde el reinicio
    rec.band_ranges = {"theta": [4, 7]}
    result = rec.save(base_dir=tmp_path)
    meta = json.loads(next((tmp_path / "sesiones").iterdir()).joinpath("para_resumen", "meta.json").read_text(encoding="utf-8"))
    assert meta["band_ranges_hz"] == {"theta": [4, 7]} and result["duration_s"] == 10
