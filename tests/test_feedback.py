import numpy as np
import pytest

import live_server
from live_server import TrainingSession, feedback_message, parse_thresholds

PROTO = {"name": "Demo", "active": "AF8", "reference": "TP9", "reward": ["low_beta"], "inhibit": ["theta"]}
SFREQ = 256


def signal(seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(SFREQ * 2) / SFREQ
    return 10 * np.sin(2 * np.pi * 10 * t) + rng.normal(0, 3, t.size)


def session(thresholds=None, calibrate=False):
    """Por defecto ya en fase de entrenamiento (sin calibración), para probar la lógica del feedback."""
    return TrainingSession(PROTO, "001", 600, SFREQ, ["TP9", "AF7", "AF8", "TP10"], thresholds, calibrate=calibrate)


def test_success_when_all_conditions_met():
    s = session({"low_beta": 0.0, "theta": 1e9})      # subir > 0 y bajar < 1e9: siempre se cumple
    s.tick(signal(), SFREQ, invalid=False)
    assert s.feedback == {"state": "success", "met": 2, "total": 2}


def test_fail_when_one_condition_missing():
    s = session({"low_beta": 0.0, "theta": 0.0})      # theta < 0 es imposible
    s.tick(signal(), SFREQ, invalid=False)
    assert s.feedback == {"state": "fail", "met": 1, "total": 2}
    s = session({"low_beta": 1e9, "theta": 1e9})      # low_beta > 1e9 es imposible
    s.tick(signal(), SFREQ, invalid=False)
    assert s.feedback["state"] == "fail" and s.feedback["met"] == 1


def test_invalid_second_is_neither_reward_nor_punishment():
    s = session({"low_beta": 0.0, "theta": 1e9})
    s.tick(signal(), SFREQ, invalid=True)
    assert s.feedback["state"] == "invalid"


def test_calibrating_phase_gives_neutral_feedback_and_records_nothing():
    s = session(calibrate=True)
    s.tick(signal(), SFREQ, invalid=False)
    assert s.phase == "calibrating" and s.feedback["state"] == "calibrating"
    assert s.recorder.t_s == 0 and s.recorder.rows == []


def test_calibration_finishes_after_n_valid_seconds_and_resets_the_clock(monkeypatch):
    monkeypatch.setattr(live_server, "CALIBRATION_S", 5)
    s = session(calibrate=True)
    for i in range(3):
        s.tick(signal(i), SFREQ, invalid=False)
    s.tick(signal(), SFREQ, invalid=True)            # los inválidos no cuentan para la calibración
    assert s.phase == "calibrating" and s.calib_valid == 3
    for i in range(2):
        s.tick(signal(10 + i), SFREQ, invalid=False)
    assert s.phase == "training" and s.calib_valid == 5
    assert all(t is not None for t in s.threshold.values())      # umbrales automáticos (mediana)
    assert s.recorder.t_s == 0 and s.invalid_reasons == {}       # el entrenamiento arranca en 00:00
    s.tick(signal(20), SFREQ, invalid=False)
    assert s.recorder.t_s == 1 and s.feedback["state"] in ("success", "fail")


def test_manual_thresholds_are_kept_after_calibration(monkeypatch):
    monkeypatch.setattr(live_server, "CALIBRATION_S", 3)
    s = session({"low_beta": 123.0}, calibrate=True)              # solo uno manual
    for i in range(3):
        s.tick(signal(i), SFREQ, invalid=False)
    assert s.threshold["low_beta"] == 123.0 and s.threshold["theta"] is not None


def test_calibration_threshold_is_median_of_valid_values(monkeypatch):
    monkeypatch.setattr(live_server, "CALIBRATION_S", 3)
    s = session(calibrate=True)
    values = []
    for i in range(3):
        s.tick(signal(i), SFREQ, invalid=False)
        values.append(s.smoothed["theta"])
    assert s.threshold["theta"] == pytest.approx(float(np.median(values)))


def test_snapshot_reports_calibration_progress(monkeypatch):
    monkeypatch.setattr(live_server, "CALIBRATION_S", 10)
    s = session(calibrate=True)
    s.tick(signal(), SFREQ, invalid=False)
    snap = s.snapshot()
    assert snap["phase"] == "calibrating" and snap["calib_valid"] == 1 and snap["calib_target"] == 10
    assert all(b["success"] is None for b in snap["bands"].values())


def test_restart_during_training_skips_calibration_and_keeps_thresholds():
    s = session({"low_beta": 0.7, "theta": 0.3})                  # ya en entrenamiento
    new = s.restarted()
    assert new.phase == "training" and new.threshold == {"low_beta": 0.7, "theta": 0.3}


def test_restart_during_calibration_calibrates_again():
    assert session(calibrate=True).restarted().phase == "calibrating"


def test_band_edges_never_count_a_bin_twice():
    f = np.arange(0, 128.01, 0.5)
    counts = np.zeros_like(f)
    for low, high in live_server.BAND_DEFS.values():
        counts += (f >= low) & (f < high)
    assert counts.max() == 1


def test_tone_exactly_on_a_band_edge_belongs_to_the_upper_band():
    t = np.arange(SFREQ * 2) / SFREQ
    for freq, expected in ((10, "high_alpha"), (12, "low_beta")):   # 10 Hz: borde alpha bajo/alto; 12 Hz: borde alpha/beta
        amps = live_server.band_amplitudes(10 * np.sin(2 * np.pi * freq * t), SFREQ)
        assert max(amps, key=amps.get) == expected


def test_manual_thresholds_give_p4_rows_from_second_5():
    s = session({"low_beta": 0.5, "theta": 0.5})
    for i in range(10):
        s.tick(signal(i), SFREQ, invalid=False)
    assert [r["timestamp_s"] for r in s.recorder.p4_rows] == [5, 10]


def test_feedback_message_is_minimal_and_has_no_numbers_or_alias():
    s = session({"low_beta": 0.0, "theta": 1e9})
    s.tick(signal(), SFREQ, invalid=False)
    msg = feedback_message(s)
    assert set(msg) == {"type", "state", "met", "total", "seq"}
    assert feedback_message(None)["state"] == "idle"
    s.paused = True
    assert feedback_message(s)["state"] == "paused"
    assert feedback_message(s, "nosignal")["state"] == "nosignal"


def test_snapshot_includes_feedback():
    s = session({"low_beta": 0.0, "theta": 1e9})
    s.tick(signal(), SFREQ, invalid=False)
    assert s.snapshot()["feedback"]["state"] == "success"


def test_parse_thresholds():
    assert parse_thresholds(None, PROTO) == ({}, None)
    assert parse_thresholds({"theta": 1.5}, PROTO) == ({"theta": 1.5}, None)
    assert parse_thresholds({"alpha": 1}, PROTO)[1]            # banda que no está en el protocolo
    assert parse_thresholds({"theta": -1}, PROTO)[1]
    assert parse_thresholds({"theta": "x"}, PROTO)[1]
    assert parse_thresholds({"theta": True}, PROTO)[1]
    assert parse_thresholds([1], PROTO)[1]


def test_restart_keeps_manual_thresholds():
    s = session({"low_beta": 0.7, "theta": 0.3})
    assert s.restarted().threshold == {"low_beta": 0.7, "theta": 0.3}