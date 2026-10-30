import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds, BrainFlowPresets
from brainflow.data_filter import DataFilter, FilterTypes, DetrendOperations

# 1. Configuración de BrainFlow para Muse S Athena
board_id = BoardIds.MUSE_S_ATHENA_BOARD.value
params = BrainFlowInputParams()
board = BoardShim(board_id, params)

board.prepare_session()
board.start_stream()

# 2. Definición de canales a graficar
SAMPLING_RATE = BoardShim.get_sampling_rate(board_id)  # 256 Hz
SEGUNDOS_A_MOSTRAR = 5
MAX_MUESTRAS = SAMPLING_RATE * SEGUNDOS_A_MOSTRAR       # 1280 muestras

# Mapeamos los 4 canales EEG nativos + tu 5° electrodo confirmado (fila 5)
CANALES_A_GRAFICAR = [1, 2, 3, 4, 5]
NOMBRES_CANALES = ['TP9 (Ch 1)', 'AF7 (Ch 2)', 'AF8 (Ch 3)', 'TP10 (Ch 4)', 'Auxiliar (Ch 5)']

# 3. Configuración de la Ventana de Matplotlib
fig, axs = plt.subplots(len(CANALES_A_GRAFICAR), 1, figsize=(10, 8), sharex=True)
fig.suptitle('Monitoreo en Tiempo Real - Muse S Athena (5 Canales)', fontsize=14, fontweight='bold')

# Crear las líneas de los gráficos vacías
lineas = []
x_vals = np.arange(MAX_MUESTRAS) / SAMPLING_RATE  # Eje X en segundos

for i, ax in enumerate(axs):
    line, = ax.plot(x_vals, np.zeros(MAX_MUESTRAS), label=NOMBRES_CANALES[i], color=f'C{i}')
    ax.legend(loc="upper left")
    ax.set_ylabel("uV")
    # Ajusta los límites de amplitud vertical (uV) según necesites
    ax.set_ylim(-150, 150)
    ax.grid(True, linestyle='--', alpha=0.5)
    lineas.append(line)

axs[-1].set_xlabel("Tiempo (Segundos)")

# 4. Función de actualización para la animación
def update(frame):
    # Obtener todos los datos acumulados en el buffer sin borrarlos
    data = board.get_current_board_data(MAX_MUESTRAS)
    
    # Si aún está arrancando y no hay suficientes datos, rellenamos con ceros
    if data.shape[1] < MAX_MUESTRAS:
        pad_width = MAX_MUESTRAS - data.shape[1]
        data = np.pad(data, ((0, 0), (pad_width, 0)), mode='constant')
    
    # Procesar y actualizar cada canal
    for i, ch_idx in enumerate(CANALES_A_GRAFICAR):
        # Extraer la señal de la fila correspondiente
        signal = data[ch_idx, -MAX_MUESTRAS:].copy()
        
        # Filtrado rápido en vivo para evitar saltos y ruido eléctrico
        DataFilter.detrend(signal, DetrendOperations.CONSTANT.value)
        # Filtro Notch a 60Hz (Ruido eléctrico). Cambiar a 50.0 si estás en Europa.
        #DataFilter.perform_bandstop(signal, SAMPLING_RATE, 60.0, 4.0, 2, FilterTypes.BUTTERWORTH.value, 0)
        # Filtro pasa bandas para limpiar frecuencias extremas
        DataFilter.perform_bandpass(signal, SAMPLING_RATE, 1.0, 45.0, 2, FilterTypes.BUTTERWORTH.value, 0)
        
        # Actualizar los datos del gráfico
        lineas[i].set_ydata(signal)
        
    return lineas

# 5. Lanzar la animación (Se actualiza cada 50ms)
ani = animation.FuncAnimation(fig, update, blit=True, interval=50, cache_frame_data=False)

try:
    plt.tight_layout()
    plt.show()
except KeyboardInterrupt:
    pass
finally:
    # Cerrar la sesión de forma segura al cerrar la ventana
    print("\n🛑 Deteniendo stream y liberando sesión...")
    board.stop_stream()
    board.release_session()
