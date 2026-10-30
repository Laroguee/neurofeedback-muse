import sys
import json
import numpy as np
import matplotlib.pyplot as plt

def plot_session(session_name):
    data = np.load(f"data/{session_name}_raw.npy")
    with open(f"data/{session_name}_meta.json") as f:
        meta = json.load(f)

    eeg_indices = meta["eeg_channel_indices"]
    eeg_names = meta["eeg_channel_names"]
    sfreq = meta["sampling_rate"]

    fig, axes = plt.subplots(len(eeg_indices), 1, figsize=(10, 6), sharex=True)
    time_axis = np.arange(data.shape[1]) / sfreq

    for ax, ch, name in zip(axes, eeg_indices, eeg_names):
        channel_data = data[ch]
        ax.plot(time_axis, channel_data)
        ax.set_ylabel(name)
        # Escala basada en percentiles para no dejar que los picos aplasten la vista
        lo, hi = np.percentile(channel_data, [1, 99])
        margin = (hi - lo) * 0.3
        ax.set_ylim(lo - margin, hi + margin)

    axes[-1].set_xlabel("Tiempo (s)")
    fig.suptitle(f"EEG - {session_name} ({data.shape[1]} muestras, {sfreq} Hz)")
    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    session_name = sys.argv[1] if len(sys.argv) > 1 else "session"
    plot_session(session_name)