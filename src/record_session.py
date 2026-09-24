import sys
import json
import numpy as np
from datetime import datetime
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds

DURATION_SEC = 30  # 30 segundos de grabación
OUTPUT_DIR = "data"

def record_session(session_name):
    board_id = BoardIds.MUSE_2_BOARD.value
    eeg_channels = BoardShim.get_eeg_channels(board_id)
    eeg_names = BoardShim.get_eeg_names(board_id)
    sfreq = BoardShim.get_sampling_rate(board_id)

    params = BrainFlowInputParams()
    params.timeout = 20
    board = BoardShim(board_id, params)

    board.prepare_session()
    board.start_stream()
    print(f"Grabando '{session_name}' por {DURATION_SEC}s...")
    BoardShim.log_message(2, f"Inicio sesion {session_name}")

    import time
    time.sleep(DURATION_SEC)

    data = board.get_board_data()
    board.stop_stream()
    board.release_session()

    raw_path = f"{OUTPUT_DIR}/{session_name}_raw.npy"
    meta_path = f"{OUTPUT_DIR}/{session_name}_meta.json"

    np.save(raw_path, data)
    metadata = {
        "session_name": session_name,
        "timestamp": datetime.now().isoformat(),
        "device": "Muse 2",
        "source": "BrainFlow BLE directo",
        "firmware_version": "1.0.27",
        "sampling_rate": sfreq,
        "eeg_channel_indices": eeg_channels,
        "eeg_channel_names": eeg_names,
        "duration_sec": DURATION_SEC,
        "data_shape": list(data.shape),
    }
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"Guardado: {raw_path} y {meta_path}")

if __name__ == "__main__":
    session_name = sys.argv[1] if len(sys.argv) > 1 else "session"
    record_session(session_name)