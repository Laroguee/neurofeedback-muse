# ADR 002 · Estrategia de limpieza de artefactos

**Estado:** Aceptado
**Fecha:** 2026-09-24
**Autor:** Roberto (líder de proyecto)

## Contexto

El pipeline necesita descartar épocas contaminadas por artefactos (parpadeos, movimiento) antes de calcular métricas de entrenamiento. Se compararon 2 estrategias sobre EEG sintético (30 s, 4 artefactos inyectados en tiempos conocidos: t=5, 12, 18, 25; épocas de 1 s con 50% de solapamiento, 59 épocas totales).

## Comparación

| Estrategia | % épocas válidas | Artefactos reales detectados (de 4) |
|---|---|---|
| A — Umbral de amplitud pico-a-pico (150 µV) | 79.7% | 4/4 |
| B — Z-score de varianza (threshold 2.0) | 93.2% | 4/4, pero solo 1 época por artefacto (vs. 3 en A) |
| B — Z-score de varianza (threshold 3.0) | 98.3% | 1/4 |

## Decisión

Se adopta la **Estrategia A (umbral de amplitud pico-a-pico)** como método principal de rechazo de épocas.

**Razón:** con solapamiento de épocas al 50%, un artefacto real contamina parcialmente 3 épocas consecutivas. A las marca las 3, minimizando el riesgo de que una época "válida" conserve un remanente de artefacto. B, incluso ajustada, solo marca la época central — más eficiente en volumen de datos, pero deja pasar contaminación parcial en las vecinas. Para las métricas de entrenamiento (H3), priorizar señal limpia sobre volumen de épocas.

## Alternativas consideradas

- **B con threshold 2.0** como estrategia única: descartada por dejar pasar contaminación parcial en épocas vecinas al artefacto.
- **Híbrida (B + rechazo de épocas adyacentes):** no implementada aún; queda como opción a revisar si en H3 se observa que A descarta demasiados datos en sesiones reales.

## Consecuencias

- El pipeline descarta más épocas que con B (79.7% válidas vs. 93-98%), lo cual reduce el volumen de datos limpios disponible por sesión — a vigilar en el pilotaje (H5) si esto se vuelve un problema práctico.
- La detección queda validada con tests automatizados (`tests/test_artifact_detection.py`) sobre señal sintética con artefactos en tiempos conocidos.