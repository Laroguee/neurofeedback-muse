# ADR 001 · Capa de abstracción de fuentes de señal

**Estado:** Aceptado
**Fecha:** 2026-09-17
**Autor:** Roberto (líder de proyecto)

## Contexto

El pipeline de neurofeedback necesita adquirir señal de al menos un dispositivo, sin que el resto del sistema (DSP, métricas, feedback) dependa de los detalles de conexión de ese dispositivo. Evaluamos las rutas disponibles para el Muse 2 y el rol de Mendi.

## Decisión

Se define una interfaz única de "fuente de señal" con las siguientes implementaciones:

- **Principal — Muse 2 vía BrainFlow (BLE directo).** BrainFlow se conecta al Muse por Bluetooth Low Energy sin necesidad de emparejamiento manual en el sistema operativo, y entrega los datos crudos directamente como array de numpy. Es la fuente sobre la que corre el DSP y las métricas de entrenamiento.
- **Secundaria / validación — Mind Monitor (OSC vía WiFi).** El Muse se conecta al teléfono, que retransmite por OSC a la PC. No depende del stack BLE de Windows, por lo que sirve como gold standard de validación cruzada y como plan B si BrainFlow falla.
- **Exploratoria condicionada — Mendi (fNIRS).** Solo se integra si se obtiene acceso a la plataforma de investigación Neurosight. No se apuesta ninguna parte del pipeline principal a esta fuente.

Firmware del Muse 2 congelado en versión **1.0.27** durante todo el proyecto, para evitar que una actualización rompa el protocolo BLE no oficial que usa BrainFlow.

## Alternativas consideradas

- **muse-lsl + BlueMuse:** también viable (BLE directo publicado como stream LSL), pero se descarta como ruta principal porque agrega una capa extra (LSL) sin necesidad, y el backend BLE de muse-lsl es menos estable en Windows que el de BrainFlow.
- **Emparejamiento manual del Muse desde Bluetooth de Windows:** descartado — no es necesario (BrainFlow escanea y conecta directo) y puede generar conflictos de conexión BLE a medias.

## Consecuencias

- El resto del pipeline solo conoce la interfaz de "fuente de señal", no si detrás hay BrainFlow, Mind Monitor o Mendi.
- Cualquier fragilidad del bypass BLE en Windows queda aislada a la implementación de BrainFlow; Mind Monitor sirve de respaldo sin tocar el resto del sistema.
- Validado empíricamente: parpadeos y movimientos de cabeza se reflejan de forma consistente tanto en BrainFlow como en Mind Monitor.