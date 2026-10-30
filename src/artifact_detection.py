import numpy as np
from synthetic_eeg import generate_synthetic_eeg
from filters import apply_filter_chain
from matplotlib.patches import Patch


def inject_test_artifacts(data, sfreq, artifact_times_s, amplitude=200, width_s=0.2):
    """Inyecta artefactos grandes en tiempos conocidos, para tener un 'ground truth'
    contra el cual comparar las estrategias de detección."""
    data = data.copy()
    width = int(width_s * sfreq)
    shape = np.hanning(width) * amplitude
    for t_art in artifact_times_s:
        center = int(t_art * sfreq)
        start = max(0, center - width // 2)
        end = min(data.shape[1], start + width)
        for ch in range(data.shape[0]):
            data[ch, start:end] += shape[: end - start]
    return data


def make_epochs(data, sfreq, epoch_len_s=1.0, overlap=0.5):
    """Divide en ventanas deslizantes. Retorna (n_epochs, n_channels, n_samples_epoch) y sus tiempos de inicio."""
    epoch_len = int(epoch_len_s * sfreq)
    step = int(epoch_len * (1 - overlap))
    n_samples = data.shape[1]

    epochs, starts = [], []
    start = 0
    while start + epoch_len <= n_samples:
        epochs.append(data[:, start:start + epoch_len])
        starts.append(start / sfreq)
        start += step

    return np.array(epochs), np.array(starts)


def reject_by_amplitude(epochs, threshold_uv=150):
    """Estrategia A: rechaza épocas donde el pico-a-pico de cualquier canal excede el umbral."""
    bad = np.zeros(len(epochs), dtype=bool)
    for i, epoch in enumerate(epochs):
        ptp = epoch.max(axis=1) - epoch.min(axis=1)
        if np.any(ptp > threshold_uv):
            bad[i] = True
    return bad


def reject_by_variance_zscore(epochs, z_threshold=2.0):
    """Estrategia B: rechaza épocas cuya varianza sea un outlier estadístico
    respecto al resto de la sesión."""
    variances = np.array([epoch.var() for epoch in epochs])
    z_scores = (variances - variances.mean()) / variances.std()
    return np.abs(z_scores) > z_threshold


if __name__ == "__main__":
    import matplotlib.pyplot as plt

    t, data, names, sfreq = generate_synthetic_eeg(duration_s=30, seed=7, add_blink_artifact=False)
    artifact_times = [5, 12, 18, 25]  # ground truth
    data = inject_test_artifacts(data, sfreq, artifact_times)

    filtered = apply_filter_chain(data, fs=sfreq)
    epochs, epoch_starts = make_epochs(filtered, sfreq, epoch_len_s=1.0, overlap=0.5)

    bad_amplitude = reject_by_amplitude(epochs, threshold_uv=150)
    bad_variance = reject_by_variance_zscore(epochs, z_threshold=2.0)

    pct_valid_amp = 100 * (~bad_amplitude).sum() / len(epochs)
    pct_valid_var = 100 * (~bad_variance).sum() / len(epochs)

    print(f"Épocas totales: {len(epochs)}")
    print(f"Estrategia A (umbral amplitud): {pct_valid_amp:.1f}% válidas — rechazadas en t={epoch_starts[bad_amplitude].round(2).tolist()}")
    print(f"Estrategia B (z-score varianza): {pct_valid_var:.1f}% válidas — rechazadas en t={epoch_starts[bad_variance].round(2).tolist()}")
    print(f"Artefactos reales inyectados en: {artifact_times}")

    fig, axes = plt.subplots(len(names), 1, figsize=(11, 7), sharex=True)
    for i, name in enumerate(names):
        axes[i].plot(t, filtered[i], linewidth=0.8, color="black")
        for start, is_bad in zip(epoch_starts, bad_amplitude):
            if is_bad:
                axes[i].axvspan(start, start + 1.0, color="red", alpha=0.2)
        for start, is_bad in zip(epoch_starts, bad_variance):
            if is_bad:
                axes[i].axvspan(start, start + 1.0, color="blue", alpha=0.2)
        axes[i].set_ylabel(name)
    axes[-1].set_xlabel("Tiempo (s)")
    fig.suptitle("Épocas rechazadas: rojo = Estrategia A · azul = Estrategia B")
    fig.legend(handles=[Patch(color="red", alpha=0.4, label="Estrategia A"),
                         Patch(color="blue", alpha=0.4, label="Estrategia B")],
               loc="upper right")
    plt.tight_layout()
    plt.show()