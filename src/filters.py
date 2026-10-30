import numpy as np
from scipy.signal import iirnotch, butter, filtfilt, welch


def design_notch_filter(freq=60, fs=256, quality=30):
    """Filtro notch para eliminar el ruido de línea eléctrica (60 Hz en El Salvador)."""
    b, a = iirnotch(freq, quality, fs)
    return b, a


def design_bandpass_filter(low=1, high=40, fs=256, order=4):
    """Pasa banda 1-40 Hz: cubre las bandas EEG relevantes (theta/alpha/beta)
    y descarta deriva de baja frecuencia + ruido de alta frecuencia."""
    nyquist = fs / 2
    b, a = butter(order, [low / nyquist, high / nyquist], btype="band")
    return b, a


def apply_filter_chain(data, fs=256, notch_freq=60, band=(1, 40)):
    """Aplica notch + pasa banda a cada canal. data: shape (n_channels, n_samples)."""
    b_notch, a_notch = design_notch_filter(notch_freq, fs)
    b_band, a_band = design_bandpass_filter(*band, fs=fs)

    filtered = np.zeros_like(data)
    for ch in range(data.shape[0]):
        step1 = filtfilt(b_notch, a_notch, data[ch])
        step2 = filtfilt(b_band, a_band, step1)
        filtered[ch] = step2
    return filtered


if __name__ == "__main__":
    import matplotlib.pyplot as plt
    from synthetic_eeg import generate_synthetic_eeg

    t, data, names, sfreq = generate_synthetic_eeg(duration_s=10, seed=42)
    filtered = apply_filter_chain(data, fs=sfreq)

    # Comparación en el dominio del tiempo (antes/después)
    fig_t, axes_t = plt.subplots(len(names), 1, figsize=(10, 7), sharex=True)
    for i, name in enumerate(names):
        axes_t[i].plot(t, data[i], label="antes", alpha=0.6)
        axes_t[i].plot(t, filtered[i], label="después", linewidth=1.5)
        axes_t[i].set_ylabel(name)
    axes_t[0].legend(loc="upper right")
    axes_t[-1].set_xlabel("Tiempo (s)")
    fig_t.suptitle("Señal en el tiempo: antes vs. después del filtro")
    plt.tight_layout()
    plt.show()

    # Validación: comparar espectro de potencia antes/después (¿desapareció el pico de 60 Hz?)
    fig, axes = plt.subplots(len(names), 2, figsize=(11, 7))
    for i, name in enumerate(names):
        f_raw, psd_raw = welch(data[i], fs=sfreq, nperseg=sfreq * 2)
        f_filt, psd_filt = welch(filtered[i], fs=sfreq, nperseg=sfreq * 2)

        axes[i, 0].plot(f_raw, psd_raw)
        axes[i, 0].set_title(f"{name} - antes")
        axes[i, 0].set_xlim(0, 80)
        axes[i, 0].axvline(60, color="r", linestyle="--", alpha=0.5)

        axes[i, 1].plot(f_filt, psd_filt)
        axes[i, 1].set_title(f"{name} - después")
        axes[i, 1].set_xlim(0, 80)
        axes[i, 1].axvline(60, color="r", linestyle="--", alpha=0.5)

    fig.suptitle("Espectro de potencia antes/después del filtro (línea roja = 60 Hz)")
    plt.tight_layout()
    plt.show()