import numpy as np
from synthetic_eeg import generate_synthetic_eeg
from filters import apply_filter_chain
from artifact_detection import inject_test_artifacts, make_epochs, reject_by_amplitude


def test_amplitude_rejection_detects_known_artifacts():
    """Toda época que se solapa con un artefacto inyectado debe quedar marcada como mala."""
    t, data, names, sfreq = generate_synthetic_eeg(duration_s=30, seed=7, add_blink_artifact=False)
    artifact_times = [10, 20]
    data = inject_test_artifacts(data, sfreq, artifact_times)
    filtered = apply_filter_chain(data, fs=sfreq)

    epochs, epoch_starts = make_epochs(filtered, sfreq, epoch_len_s=1.0, overlap=0.5)
    bad = reject_by_amplitude(epochs, threshold_uv=150)

    for t_art in artifact_times:
        overlapping = (epoch_starts <= t_art) & (t_art < epoch_starts + 1.0)
        assert bad[overlapping].any(), f"No se detectó el artefacto en t={t_art}"


def test_amplitude_rejection_no_false_positives_on_clean_signal():
    """Sobre señal limpia (sin artefactos), no debería rechazar casi nada."""
    t, data, names, sfreq = generate_synthetic_eeg(duration_s=20, seed=3, add_blink_artifact=False)
    filtered = apply_filter_chain(data, fs=sfreq)

    epochs, epoch_starts = make_epochs(filtered, sfreq, epoch_len_s=1.0, overlap=0.5)
    bad = reject_by_amplitude(epochs, threshold_uv=150)

    pct_rejected = bad.sum() / len(bad) * 100
    assert pct_rejected < 10, f"Se rechazó {pct_rejected:.1f}% de señal limpia — umbral demasiado estricto"