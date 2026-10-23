# Neurofeedback con Muse 2

Pipeline para adquisición, grabación y análisis de señales EEG utilizando la diadema Muse 2 y BrainFlow.

## 🧠 Dashboard Post-Sesión (GitHub Pages)

El dashboard interactivo para el resumen post-sesión está disponible en la nube:

🔗 **[Abrir Dashboard en GitHub Pages](https://laroguee.github.io/neurofeedback-muse/)**

- **Carga de Datos Personalizada:** El dashboard no precarga datos simulados por defecto; el usuario arrastra o selecciona su propio archivo `.csv` generado por el pipeline.
- **100% Privado:** Los datos EEG se procesan en la memoria local del navegador (Client-Side con `FileReader`). Ningún dato biométrico se envía a servidores.
- **Sesión Demo:** Si deseas probar el dashboard sin un archivo a mano, incluye un botón para cargar una sesión de prueba simulada.

### Activación en el repositorio de GitHub
Para que el despliegue automático funcione vía GitHub Actions:
1. En GitHub, ve a **Settings** > **Pages**.
2. En **Build and deployment** > **Source**, selecciona **GitHub Actions**.
3. Cada vez que hagas `git push` a `main`, el workflow `.github/workflows/deploy.yml` desplegará la última versión automáticamente.

## 📊 Análisis en la nube (Colab)

Puedes abrir directamente el cuaderno de análisis en Google Colab haciendo clic en el siguiente botón:

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/Laroguee/neurofeedback-muse/blob/main/analisis_colab.ipynb)

