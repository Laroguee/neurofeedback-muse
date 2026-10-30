import numpy as np

def generate_synthetic_eeg(duration_s=10, sfreq=256, n_channels=4,
                             channel_names=None, seed=None,
                             line_noise_hz=60, add_blink_artifact=True):
    """
    Genera EEG sintético: mezcla de bandas (alpha/beta/theta) + ruido de línea
    (60 Hz) + ruido blanco + opcionalmente un artefacto de parpadeo simulado.
    Sirve para probar filtros y detección de artefactos sin hardware.
    """
    rng = np.random.default_rng(seed)
    if channel_names is None:
        channel_names = ["TP9", "AF7", "AF8", "TP10"]
    n_channels = len(channel_names)

    n_samples = int(duration_s * sfreq)
    t = np.arange(n_samples) / sfreq

    data = np.zeros((n_channels, n_samples))

    bands = {"theta": (5, 15), "alpha": (10, 25), "beta": (3, 8)}  # (freq_hz, amplitud_uV aprox)
    for ch in range(n_channels):
        signal = np.zeros(n_samples)
        # Actividad EEG "real" simulada como suma de bandas
        signal += bands["theta"][1] * np.sin(2 * np.pi * bands["theta"][0] * t + rng.uniform(0, 2*np.pi))
        signal += bands["alpha"][1] * np.sin(2 * np.pi * bands["alpha"][0] * t + rng.uniform(0, 2*np.pi))
        signal += bands["beta"][1] * np.sin(2 * np.pi * bands["beta"][0] * t + rng.uniform(0, 2*np.pi))
        # Ruido blanco de fondo
        signal += rng.normal(0, 5, n_samples)
        # Ruido de línea eléctrica (60 Hz en El Salvador)
        signal += 15 * np.sin(2 * np.pi * line_noise_hz * t)
        data[ch] = signal

    # Artefacto de parpadeo simulado: pico grande, más fuerte en canales frontales (AF7/AF8)
    if add_blink_artifact:
        blink_time_s = duration_s / 2
        blink_sample = int(blink_time_s * sfreq)
        blink_width = int(0.15 * sfreq)  # ~150 ms
        blink_shape = np.hanning(blink_width) * 150
        for ch, name in enumerate(channel_names):
            weight = 1.0 if "AF" in name else 0.3  # frontal se ve más afectado
            start = max(0, blink_sample - blink_width // 2)
            end = min(n_samples, start + blink_width)
            data[ch, start:end] += blink_shape[: end - start] * weight

    return t, data, channel_names, sfreq


if __name__ == "__main__":
    import matplotlib.pyplot as plt

    t, data, names, sfreq = generate_synthetic_eeg(duration_s=10, seed=42)

    fig, axes = plt.subplots(len(names), 1, figsize=(10, 6), sharex=True)
    for ax, ch_data, name in zip(axes, data, names):
        ax.plot(t, ch_data)
        ax.set_ylabel(name)
    axes[-1].set_xlabel("Tiempo (s)")
    fig.suptitle("EEG sintético (con ruido de línea 60 Hz y artefacto de parpadeo simulado)")
    plt.tight_layout()
    plt.show()