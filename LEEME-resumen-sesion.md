# Resumen de sesión de entrenamiento: datos y qué construir

Datos **simulados** de una sesión de 5 min para que puedas armar el gráfico resumen sin esperar a las grabaciones reales. El servidor generará exactamente este formato.

## Archivos

- `sesion_simulada.csv`: la serie por segundo (formato largo: una fila por segundo y por banda).
- `sesion_simulada_meta.json`: protocolo, electrodos, bandas y reglas de la sesión.

## Columnas del CSV

| Columna | Qué es |
|---|---|
| `session_id` | Identificador de la sesión |
| `t_s` | Segundos desde el inicio del entrenamiento (0, 1, 2...). **Úsalo para el eje X (mm:ss)** |
| `timestamp` | Hora absoluta ISO 8601 con zona horaria (UTC-6) |
| `band` | `delta`, `theta`, `alpha`, `low_beta`, `beta` o `high_beta` |
| `role` | `reward` (a mejorar) o `inhibit` (a inhibir) |
| `value` | Valor de la banda en ese segundo (amplitud, ~µV/√Hz, ya suavizada). Vacío si `valid = 0` |
| `valid` | `1` = segundo bueno, `0` = descartado (parpadeo, movimiento o mal contacto) |
| `threshold` | Umbral vigente en ese segundo. Vacío durante la calibración inicial |
| `success` | `1` si estuvo en zona, `0` si no. Vacío si `valid = 0` o no hay umbral |

Regla de éxito: `reward` → `value > threshold`. `inhibit` → `value < threshold`.

## Casos borde (el ejemplo ya los incluye para que los pruebes)

1. **Calibración inicial.** El umbral se calcula solo con los primeros 30 s válidos, así que `threshold` y `success` vienen vacíos hasta `t_s = 31` en el ejemplo. En ese tramo no hay zonas ni líneas de umbral: dibuja la curva en neutral.
2. **Segundos inválidos.** El ejemplo tiene 29 (9 eventos de 2 a 8 s). Dibuja un hueco, sin interpolar sobre huecos largos, y no los cuentes en ningún porcentaje.
3. **El umbral cambia.** El entrenador puede modificarlo en plena sesión: en el ejemplo `low_beta` pasa de 0.948 a 1.02 en `t_s = 150`. Dibuja el umbral como una línea en escalón, no como una constante. `success` ya viene calculado con el umbral de ese momento.
4. **Reward vs. inhibit.** En `inhibit` la zona buena está por debajo del umbral. Invierte el eje Y (o colorea al revés) para que "arriba" siempre signifique "mejor".
5. **Varias bandas.** Un protocolo tiene hasta 4 bandas (2 reward + 2 inhibit). Haz un gráfico por banda o un selector. El gráfico de referencia corresponde a la banda a mejorar.

## Qué construir

Un gráfico como el de referencia, por banda:

- **Eje X:** tiempo `mm:ss` a partir de `t_s`. **Eje Y:** `value`.
- **Curva:** suavizado visual (spline monótono). Los datos ya vienen suavizados, es solo estética.
- **Zonas por color:** Neutral (gris), Zone (verde, `success = 1`) y Deep Zone (azul), con líneas punteadas en los límites.
- **Deep Zone (provisional):** `reward` → `value > threshold × 1.25`; `inhibit` → `value < threshold ÷ 1.25`. Déjalo como constante (`DEEP_ZONE_FACTOR = 1.25`) porque falta confirmarlo.
- **Resumen debajo del gráfico:**
  - % de tiempo en zona: segundos con `success = 1` entre segundos válidos con umbral.
  - Tendencia: media móvil de 30–60 s o regresión lineal.
  - Mejor y peor minuto.

## Notas

- Los valores son amplitudes y no son comparables entre personas sin normalizar. Compara siempre contra el `threshold` de esa misma sesión.
- Estos datos son inventados, pero respetan el formato y los casos borde de una sesión real.
