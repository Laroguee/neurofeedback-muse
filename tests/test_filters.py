import numpy as np
from scipy.signal import welch
from synthetic_eeg import generate_synthetic_eeg
from filters import apply_filter_chain


def test_notch_reduces_60hz_power():
    """El filtro debe reducir fuertemente la potencia en 60 Hz (ruido de línea)."""
    t, data, names, sfreq = generate_synthetic_eeg(duration_s=10, seed=1)
    filtered = apply_filter_chain(data, fs=sfreq)

    for ch in range(data.shape[0]):
        f_raw, psd_raw = welch(data[ch], fs=sfreq, nperseg=sfreq * 2)
        f_filt, psd_filt = welch(filtered[ch], fs=sfreq, nperseg=sfreq * 2)

        idx_60hz = np.argmin(np.abs(f_raw - 60))
        power_before = psd_raw[idx_60hz]
        power_after = psd_filt[idx_60hz]

        assert power_after < power_before * 0.1, (
            f"Canal {ch}: el notch no redujo suficiente la potencia en 60 Hz"
        )


def test_bandpass_preserves_alpha_band():
    """El pasa banda no debe eliminar la actividad alpha (10-13 Hz), que sí nos interesa."""
    t, data, names, sfreq = generate_synthetic_eeg(duration_s=10, seed=2)
    filtered = apply_filter_chain(data, fs=sfreq)

    for ch in range(data.shape[0]):
        f_filt, psd_filt = welch(filtered[ch], fs=sfreq, nperseg=sfreq * 2)
        idx_alpha = (f_filt >= 10) & (f_filt <= 13)
        assert psd_filt[idx_alpha].sum() > 0, f"Canal {ch}: se perdió la banda alpha"