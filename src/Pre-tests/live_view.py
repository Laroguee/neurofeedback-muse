import numpy as np
import matplotlib.pyplot as plt
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds

BoardShim.enable_dev_board_logger()

board_id = BoardIds.MUSE_2_BOARD.value
eeg_channels = BoardShim.get_eeg_channels(board_id)
eeg_names = BoardShim.get_eeg_names(board_id)
sfreq = BoardShim.get_sampling_rate(board_id)

params = BrainFlowInputParams()
params.timeout = 20
board = BoardShim(board_id, params)

print("Preparando sesión...")
board.prepare_session()
board.start_stream()
print("Streaming iniciado. Cierra la ventana de la gráfica para terminar.")

window_seconds = 5
n_samples_window = window_seconds * sfreq

plt.ion()
fig, axes = plt.subplots(len(eeg_channels), 1, figsize=(10, 6), sharex=True)
lines = []
for ax, name in zip(axes, eeg_names):
    line, = ax.plot([], [])
    ax.set_ylabel(name)
    ax.set_ylim(-200, 200)  # ajusta si se ve saturado o muy chico
    lines.append(line)
axes[-1].set_xlabel("Muestras (últimos 5 s)")
fig.suptitle("EEG en tiempo real - Muse 2")

try:
    while plt.fignum_exists(fig.number):
        data = board.get_current_board_data(n_samples_window)
        if data.shape[1] > 0:
            x = np.arange(data.shape[1])
            for i, ch in enumerate(eeg_channels):
                lines[i].set_data(x, data[ch])
                axes[i].set_xlim(0, n_samples_window)
        plt.pause(0.1)
except KeyboardInterrupt:
    pass
finally:
    board.stop_stream()
    board.release_session()
    print("Sesión cerrada.")