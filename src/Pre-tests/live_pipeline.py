import time
import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import iirnotch, butter, lfilter, lfilter_zi, welch
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
from artifact_detection import reject_by_amplitude

ARTIFACT_THRESHOLD_UV = 130 

class StatefulFilter:
    """Filtra en tiempo real manteniendo el estado (zi) entre bloques consecutivos,
    para que no haya discontinuidades en los bordes (a diferencia de filtfilt)."""
    def __init__(self, b, a, n_channels):
        self.b, self.a = b, a
        self.n_channels = n_channels
        self.zi = None

    def process(self, data):
        if self.zi is None:
            self.zi = [lfilter_zi(self.b, self.a) * data[ch, 0] for ch in range(self.n_channels)]
        out = np.zeros_like(data)
        for ch in range(self.n_channels):
            out[ch], self.zi[ch] = lfilter(self.b, self.a, data[ch], zi=self.zi[ch])
        return out


def run_live_pipeline(duration_min=10, notch_freq=60, band=(1, 30)):
    board_id = BoardIds.MUSE_2_BOARD.value
    eeg_channels = BoardShim.get_eeg_channels(board_id)
    eeg_names = BoardShim.get_eeg_names(board_id)
    sfreq = BoardShim.get_sampling_rate(board_id)
    n_ch = len(eeg_channels)

    b_notch, a_notch = iirnotch(notch_freq, 30, sfreq)
    b_band, a_band = butter(4, [band[0] / (sfreq / 2), band[1] / (sfreq / 2)], btype="band")
    notch_filter = StatefulFilter(b_notch, a_notch, n_ch)
    band_filter = StatefulFilter(b_band, a_band, n_ch)

    params = BrainFlowInputParams()
    params.timeout = 20
    board = BoardShim(board_id, params)
    board.prepare_session()
    board.start_stream()
    print(f"Pipeline en vivo iniciado. Duración objetivo: {duration_min} min. Cierra la gráfica para terminar antes.")

    window_seconds = 5
    buffer = np.zeros((n_ch, window_seconds * sfreq))
    epoch_buffer = []  # para chequeo de artefactos por época de 1s

    plt.ion()
    fig, axes = plt.subplots(n_ch, 1, figsize=(10, 6), sharex=True)
    lines = [ax.plot([], [])[0] for ax in axes]
    for ax, name in zip(axes, eeg_names):
        ax.set_ylabel(name)
        ax.set_ylim(-100, 100)
    axes[-1].set_xlabel("Muestras (últimos 5 s, filtrado)")
    fig.suptitle("Pipeline en vivo: filtrado + detección de artefactos")

    start_time = time.time()
    n_good, n_bad = 0, 0
    n_bad_per_channel = np.zeros(n_ch, dtype=int)
    last_check = start_time

    try:
        while plt.fignum_exists(fig.number):
            elapsed = time.time() - start_time
            if elapsed > duration_min * 60:
                print(f"Duración objetivo de {duration_min} min alcanzada. Terminando.")
                break

            raw_chunk = board.get_board_data()
            if raw_chunk.shape[1] == 0:
                plt.pause(0.05)
                continue

            eeg_chunk = raw_chunk[eeg_channels, :]
            filtered_chunk = notch_filter.process(eeg_chunk)
            filtered_chunk = band_filter.process(filtered_chunk)

            # actualizar buffer de graficado
            buffer = np.roll(buffer, -filtered_chunk.shape[1], axis=1)
            n = min(filtered_chunk.shape[1], buffer.shape[1])
            buffer[:, -n:] = filtered_chunk[:, -n:]

            # acumular para chequeo de épocas de 1s
            epoch_buffer.append(filtered_chunk)
            total_samples = sum(c.shape[1] for c in epoch_buffer)
            if total_samples >= sfreq:
                epoch = np.concatenate(epoch_buffer, axis=1)[:, -sfreq:]
                ptp = epoch.max(axis=1) - epoch.min(axis=1)
                bad_channels = ptp > ARTIFACT_THRESHOLD_UV
                is_bad = bad_channels.any()

                n_bad += int(is_bad)
                n_good += int(not is_bad)
                n_bad_per_channel += bad_channels.astype(int)
                epoch_buffer = []

            for i in range(n_ch):
                lines[i].set_data(np.arange(buffer.shape[1]), buffer[i])
                axes[i].set_xlim(0, buffer.shape[1])
            plt.pause(0.05)

            # chequeo numérico periódico (cada ~15 s)
            if time.time() - last_check > 15:
                for ch in range(n_ch):
                    f, psd = welch(buffer[ch], fs=sfreq, nperseg=min(sfreq * 2, buffer.shape[1]))
                    idx_60 = np.argmin(np.abs(f - notch_freq))
                    power_60 = psd[idx_60]
                pct_valid = 100 * n_good / max(n_good + n_bad, 1)
                total_epochs = n_good + n_bad
                per_channel_str = " | ".join(
                    f"{name}: {100*n_bad_per_channel[i]/max(total_epochs,1):.0f}% rechazo"
                    for i, name in enumerate(eeg_names)
                )
                print(f"[{elapsed:5.0f}s] 60Hz TP9: {power_60:.2f} | válidas: {pct_valid:.1f}% ({n_good}/{total_epochs})")
                print(f"          {per_channel_str}")
                last_check = time.time()

    except Exception as e:
        print(f"ERROR durante el streaming: {e}")
    finally:
        board.stop_stream()
        board.release_session()
        total_epochs = n_good + n_bad
        print(f"Sesión terminada. Duración real: {elapsed:.0f}s. "
              f"Épocas válidas: {n_good}/{total_epochs} ({100*n_good/max(total_epochs,1):.1f}%)")


if __name__ == "__main__":
    run_live_pipeline(duration_min=10)