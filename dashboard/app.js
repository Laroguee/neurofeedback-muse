/**
 * Neurofeedback Session Summary Engine (Responsive + Draft Pie Summary Edition)
 * Soporta Vista Resumen Pastel (Sol / Nube / Tormenta), Vista Clínica por Bandas,
 * carga combinada de CSV + meta.json y todos los casos de nuevos_entrenamientos.
 */

(function () {
  const DEEP_ZONE_FACTOR = 1.25;
  const TOTAL_PROGRAM_SESSIONS = 20;

  let rawData = [];
  let availableBands = [];
  let currentBand = 'low_beta';
  let invertAxisForInhibit = true;
  let currentMetrics = null;
  let allBandsMetrics = {};

  // Estado del Resumen Pastel (Draft)
  let currentSectionView = 'both'; // 'both' | 'draft' | 'clinical'
  let pieScope = 'all';            // 'all' o nombre de banda individual
  let pieCalcMode = 'zones';       // 'zones' (Promedio Zonas) | 'synergy' (Sinergia Bandas)
  let piePalette = 'traffic';      // 'traffic' (Verde/Amarillo/Rojo) | 'weather' (Amarillo/Celeste/Gris)
  let hoveredPieSlice = null;
  let lastPieSlices = [];

  let metadata = window.DEFAULT_METADATA || {
    session_id: 'sim-001',
    protocol_name: 'Foco Clínico · SMR',
    device: 'Muse 2',
    channels: ['TP9', 'AF7', 'AF8', 'TP10'],
    sampling_rate: 256
  };

  const BAND_CONFIG = {
    low_beta: {
      displayName: 'Beta Baja (SMR)',
      freq: '12-15 Hz',
      descReward: 'Foco sostenido y tranquilidad motora',
      descInhibit: 'Reducir hipervigilancia en SMR',
      role: 'reward'
    },
    low_alpha: {
      displayName: 'Alfa Baja',
      freq: '8-10 Hz',
      descReward: 'Relajación interna y calma atenta',
      descInhibit: 'Evitar desconexión por alfa lenta',
      role: 'reward'
    },
    alpha: {
      displayName: 'Alfa',
      freq: '8-12 Hz',
      descReward: 'Relajación consciente y calma alerta',
      descInhibit: 'Disminuir dispersión alfa',
      role: 'reward'
    },
    theta: {
      displayName: 'Theta',
      freq: '4-8 Hz',
      descReward: 'Creatividad, internalización y calma profunda',
      descInhibit: 'Inhibir somnolencia y mente errante',
      role: 'inhibit'
    },
    high_beta: {
      displayName: 'Beta Alta',
      freq: '20-30 Hz',
      descReward: 'Activación cognitiva rápida',
      descInhibit: 'Inhibir tensión muscular, estrés y rumiación',
      role: 'inhibit'
    },
    beta: {
      displayName: 'Beta',
      freq: '15-20 Hz',
      descReward: 'Atención activa y procesamiento cognitivo',
      descInhibit: 'Reducir sobrecarga cognitiva',
      role: 'reward'
    },
    delta: {
      displayName: 'Delta',
      freq: '0.5-4 Hz',
      descReward: 'Recuperación profunda',
      descInhibit: 'Inhibir desconexión o artefacto de movimiento',
      role: 'inhibit'
    }
  };

  const PALETTES = {
    traffic: {
      sun: { main: '#10B981', light: '#34D399', bg: 'rgba(16, 185, 129, 0.16)', border: 'rgba(16, 185, 129, 0.4)' },
      cloud: { main: '#F59E0B', light: '#FBBF24', bg: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.4)' },
      storm: { main: '#EF4444', light: '#F87171', bg: 'rgba(239, 68, 68, 0.16)', border: 'rgba(239, 68, 68, 0.4)' }
    },
    weather: {
      sun: { main: '#FACC15', light: '#FDE047', bg: 'rgba(250, 204, 21, 0.16)', border: 'rgba(250, 204, 21, 0.4)' },
      cloud: { main: '#38BDF8', light: '#7DD3FC', bg: 'rgba(56, 189, 248, 0.16)', border: 'rgba(56, 189, 248, 0.4)' },
      storm: { main: '#64748B', light: '#94A3B8', bg: 'rgba(100, 116, 139, 0.2)', border: 'rgba(148, 163, 184, 0.4)' }
    }
  };

  // Elementos DOM principales
  const canvas = document.getElementById('neuro-canvas');
  const ctx = canvas.getContext('2d');
  const canvasContainer = document.getElementById('canvas-container');
  const pieCanvas = document.getElementById('pie-canvas');
  const pieCtx = pieCanvas ? pieCanvas.getContext('2d') : null;
  const pieWrapper = document.getElementById('pie-canvas-wrapper');
  const pieTooltip = document.getElementById('pie-tooltip');

  const bandNav = document.getElementById('band-nav');
  const bandRoleIndicator = document.getElementById('band-role-indicator');
  const bandDescriptionText = document.getElementById('band-description-text');
  const invertAxisToggle = document.getElementById('invert-axis-toggle');
  const threshValBadge = document.getElementById('thresh-val');
  const canvasTooltip = document.getElementById('canvas-tooltip');
  const tooltipTime = document.getElementById('tooltip-time');
  const tooltipVal = document.getElementById('tooltip-val');
  const tooltipThresh = document.getElementById('tooltip-thresh');
  const tooltipState = document.getElementById('tooltip-state');
  const minutesGrid = document.getElementById('minutes-progress-grid');

  function init() {
    setupViewModeSwitcher();
    setupSectionViewSwitcher();
    setupDraftControls();
    setupEventListeners();
    setupDragAndDrop();
    setupResizeObserver();
    showEmptyState();
  }

  // Selector de Modo de Pantalla (Desktop, Tablet, Mobile, Auto)
  function setupViewModeSwitcher() {
    const toggleBtns = document.querySelectorAll('.view-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        document.body.className = `mode-${mode}`;
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        setTimeout(() => {
          if (rawData.length > 0) {
            resizeCanvas();
            renderCurrentBand();
            renderDraftSummary();
          }
        }, 150);
      });
    });
  }

  // Conmutador entre Vista Completa, Resumen Pastel (Draft) y Ondas por Banda (Clínico)
  function setupSectionViewSwitcher() {
    const switchBtns = document.querySelectorAll('.section-switch-btn');
    switchBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        currentSectionView = btn.getAttribute('data-section') || 'both';
        switchBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applySectionVisibility();
      });
    });
  }

  function applySectionVisibility() {
    if (!rawData.length) return;
    const draftSec = document.getElementById('draft-summary-section');
    const clinicalSec = document.getElementById('clinical-section-wrapper');

    if (currentSectionView === 'draft') {
      if (draftSec) draftSec.style.display = 'block';
      if (clinicalSec) clinicalSec.style.display = 'none';
    } else if (currentSectionView === 'clinical') {
      if (draftSec) draftSec.style.display = 'none';
      if (clinicalSec) clinicalSec.style.display = 'flex';
    } else {
      if (draftSec) draftSec.style.display = 'block';
      if (clinicalSec) clinicalSec.style.display = 'flex';
    }

    setTimeout(() => {
      resizeCanvas();
      renderCurrentBand();
      renderDraftSummary();
    }, 50);
  }

  function setupDraftControls() {
    const calcModeSelect = document.getElementById('pie-calc-mode');
    if (calcModeSelect) {
      calcModeSelect.addEventListener('change', (e) => {
        pieCalcMode = e.target.value;
        if (rawData.length > 0) renderDraftSummary();
      });
    }

    const paletteBtns = document.querySelectorAll('.palette-btn');
    paletteBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        piePalette = btn.getAttribute('data-palette') || 'traffic';
        paletteBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (rawData.length > 0) renderDraftSummary();
      });
    });

    // Interacción con el canvas del pastel
    if (pieCanvas) {
      pieCanvas.addEventListener('mousemove', (e) => {
        if (!rawData.length || !lastPieSlices.length) return;
        handlePieHover(e.clientX, e.clientY);
      });
      pieCanvas.addEventListener('mouseleave', () => {
        hoveredPieSlice = null;
        if (pieTooltip) pieTooltip.style.display = 'none';
        if (rawData.length > 0) drawPieChart(lastPieSlices);
      });
    }

    // Botón Check Verde [✓] del Draft
    const draftCheckBtn = document.getElementById('btn-draft-check');
    if (draftCheckBtn) {
      draftCheckBtn.addEventListener('click', () => {
        if (!rawData.length) return;
        alert(`✅ Resumen de la Sesión #${metadata.session_id} confirmado.\nTiempo enfocado (☀️ + ☁️): ${document.getElementById('pie-total-focus-val')?.textContent || '--'}`);
      });
    }
  }

  function setupEventListeners() {
    invertAxisToggle.addEventListener('change', (e) => {
      invertAxisForInhibit = e.target.checked;
      if (rawData.length > 0) renderCurrentBand();
    });

    // Puntero ratón en canvas de ondas
    canvas.addEventListener('mousemove', (e) => {
      if (rawData.length > 0) handlePointer(e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', () => {
      canvasTooltip.style.display = 'none';
      if (rawData.length > 0) renderCurrentBand();
    });

    // Soporte táctil para móviles y tabletas
    canvas.addEventListener('touchstart', (e) => {
      if (rawData.length > 0 && e.touches.length > 0) {
        handlePointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (rawData.length > 0 && e.touches.length > 0) {
        handlePointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      canvasTooltip.style.display = 'none';
      if (rawData.length > 0) renderCurrentBand();
    });

    // Carga de archivos (.csv y/o .json) desde múltiples orígenes
    const fileInputs = [
      document.getElementById('csv-file-input'),
      document.getElementById('hero-csv-input'),
      document.getElementById('header-csv-file-input')
    ];
    fileInputs.forEach(input => {
      if (input) input.addEventListener('change', handleFileUpload);
    });

    // Botones de sesiones pre-cargadas (005, 004, sim-001)
    const presetBtns = document.querySelectorAll('[data-preset]');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const presetId = btn.getAttribute('data-preset');
        loadPresetSession(presetId);
      });
    });

    // Modal
    const infoModal = document.getElementById('info-modal');
    document.getElementById('open-info-modal').addEventListener('click', () => {
      infoModal.style.display = 'flex';
    });
    document.getElementById('close-info-modal').addEventListener('click', () => {
      infoModal.style.display = 'none';
    });
    infoModal.addEventListener('click', (e) => {
      if (e.target === infoModal) infoModal.style.display = 'none';
    });

    // Acciones
    document.getElementById('btn-complete-session').addEventListener('click', () => {
      if (!rawData.length) {
        alert('Por favor carga un archivo CSV de sesión primero.');
        return;
      }
      alert(`✅ Sesión ${metadata.session_id} archivada correctamente.\nMétricas y tendencias sincronizadas.`);
    });
    document.getElementById('btn-export-summary').addEventListener('click', exportSummaryJSON);
  }

  function setupDragAndDrop() {
    const dropzoneBox = document.getElementById('dropzone-box');

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.body.classList.add('drag-active');
      if (dropzoneBox) dropzoneBox.classList.add('drag-hover');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.clientX === 0 || e.clientY === 0) {
        document.body.classList.remove('drag-active');
        if (dropzoneBox) dropzoneBox.classList.remove('drag-hover');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      document.body.classList.remove('drag-active');
      if (dropzoneBox) dropzoneBox.classList.remove('drag-hover');

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        processUploadedFiles(Array.from(e.dataTransfer.files));
      }
    });
  }

  function setupResizeObserver() {
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (rawData.length > 0) {
          resizeCanvas();
          renderCurrentBand();
          renderDraftSummary();
        }
      });
      if (canvasContainer) ro.observe(canvasContainer);
      if (pieWrapper) ro.observe(pieWrapper);
    } else {
      window.addEventListener('resize', () => {
        if (rawData.length > 0) {
          resizeCanvas();
          renderCurrentBand();
          renderDraftSummary();
        }
      });
    }
  }

  function showEmptyState() {
    rawData = [];
    availableBands = [];
    currentMetrics = null;
    allBandsMetrics = {};

    const emptyState = document.getElementById('empty-state-view');
    const draftSection = document.getElementById('draft-summary-section');
    const clinicalWrapper = document.getElementById('clinical-section-wrapper');
    const headerUploadLabel = document.getElementById('header-upload-label');
    const sectionSwitcher = document.getElementById('dashboard-section-switcher');
    const progressWidget = document.getElementById('session-progress-widget');

    if (emptyState) emptyState.style.display = 'flex';
    if (draftSection) draftSection.style.display = 'none';
    if (clinicalWrapper) clinicalWrapper.style.display = 'none';
    if (headerUploadLabel) headerUploadLabel.style.display = 'none';
    if (sectionSwitcher) sectionSwitcher.style.display = 'none';
    if (progressWidget) progressWidget.style.display = 'none';

    document.getElementById('header-time').textContent = 'Esperando archivo .csv';
    const statusBadge = document.getElementById('header-status-badge');
    if (statusBadge) {
      statusBadge.className = 'badge waiting-badge';
      statusBadge.innerHTML = '<span class="pulse-dot amber"></span> Esperando datos';
    }
    document.getElementById('protocol-badge').textContent = 'Dashboard de Análisis Clínico';
    document.getElementById('session-id-display').textContent = 'Carga de Sesión';
    const durationEl = document.getElementById('quick-duration');
    if (durationEl) durationEl.textContent = '--';
  }

  function hideEmptyState() {
    const emptyState = document.getElementById('empty-state-view');
    const headerUploadLabel = document.getElementById('header-upload-label');
    const sectionSwitcher = document.getElementById('dashboard-section-switcher');
    const progressWidget = document.getElementById('session-progress-widget');

    if (emptyState) emptyState.style.display = 'none';
    if (headerUploadLabel) headerUploadLabel.style.display = 'inline-flex';
    if (sectionSwitcher) sectionSwitcher.style.display = 'inline-flex';
    if (progressWidget) progressWidget.style.display = 'flex';

    const statusBadge = document.getElementById('header-status-badge');
    if (statusBadge) {
      statusBadge.className = 'badge completed-badge';
      statusBadge.innerHTML = '<span class="pulse-dot"></span> Sesión Finalizada';
    }

    applySectionVisibility();
  }

  function loadPresetSession(presetId) {
    // Resaltar pill activo en la barra superior
    document.querySelectorAll('.preset-pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-preset') === presetId);
    });

    if (window.SESSION_PRESETS && window.SESSION_PRESETS[presetId]) {
      const preset = window.SESSION_PRESETS[presetId];
      metadata = JSON.parse(JSON.stringify(preset.meta));
      parseCSV(preset.csv, metadata);
      return;
    }

    // Fallback a sesión simulada por defecto
    if (window.DEFAULT_CSV_RAW) {
      metadata = JSON.parse(JSON.stringify(window.DEFAULT_METADATA || {}));
      parseCSV(window.DEFAULT_CSV_RAW, metadata);
    }
  }

  function handleFileUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    processUploadedFiles(files);
    e.target.value = '';
  }

  function processUploadedFiles(files) {
    const jsonFile = files.find(f => f.name.toLowerCase().endsWith('.json'));
    const csvFile = files.find(f => f.name.toLowerCase().endsWith('.csv'));

    if (!csvFile && !jsonFile) {
      alert('Por favor selecciona un archivo .csv (y opcionalmente su archivo meta.json).');
      return;
    }

    // Si solo subió un meta.json y ya hay datos cargados, aplicamos los metadatos
    if (jsonFile && !csvFile) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsedMeta = JSON.parse(ev.target.result);
          metadata = { ...metadata, ...parsedMeta };
          if (rawData.length > 0) {
            updateHeaderFromMetadata();
            renderCurrentBand();
            renderDraftSummary();
          } else {
            alert('✅ Metadatos (meta.json) cargados. Ahora selecciona el archivo .csv de la sesión.');
          }
        } catch (err) {
          alert('No se pudo leer el archivo JSON: ' + err.message);
        }
      };
      reader.readAsText(jsonFile);
      return;
    }

    // Si subió ambos (.csv + .json) o solo .csv
    if (jsonFile && csvFile) {
      const jsonReader = new FileReader();
      jsonReader.onload = (jEv) => {
        let customMeta = null;
        try {
          customMeta = JSON.parse(jEv.target.result);
        } catch (e) {
          console.warn('JSON inválido:', e);
        }
        const csvReader = new FileReader();
        csvReader.onload = (cEv) => parseCSV(cEv.target.result, customMeta);
        csvReader.readAsText(csvFile);
      };
      jsonReader.readAsText(jsonFile);
    } else if (csvFile) {
      const csvReader = new FileReader();
      csvReader.onload = (cEv) => parseCSV(cEv.target.result, null);
      csvReader.readAsText(csvFile);
    }
  }

  function getBandConfig(bandKey, actualRole) {
    const base = BAND_CONFIG[bandKey] || {
      displayName: bandKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      freq: '',
      descReward: 'Aumentar amplitud en banda objetivo',
      descInhibit: 'Reducir actividad en banda objetivo',
      role: actualRole || 'reward'
    };
    const role = actualRole || base.role || 'reward';

    // Si meta.json trae band_ranges_hz personalizados (ej. theta: [4, 7]), usarlos
    let freqStr = base.freq;
    if (metadata && metadata.band_ranges_hz && metadata.band_ranges_hz[bandKey]) {
      const [lo, hi] = metadata.band_ranges_hz[bandKey];
      freqStr = `${lo}-${hi} Hz`;
    }

    const desc = role === 'reward' ? base.descReward : base.descInhibit;
    return {
      displayName: base.displayName,
      freq: freqStr,
      desc: freqStr ? `${freqStr} · ${desc}` : desc,
      role
    };
  }

  function parseCSV(csvText, customMeta = null) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {
      alert('El archivo CSV no contiene suficientes datos.');
      return;
    }

    const firstLine = lines[0];
    let delimiter = ',';
    if (firstLine.includes(';') && !firstLine.includes(',')) {
      delimiter = ';';
    } else if (firstLine.includes('\t') && !firstLine.includes(',')) {
      delimiter = '\t';
    }

    const rawHeaders = firstLine.split(delimiter).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const col = {};
    rawHeaders.forEach((h, idx) => {
      col[h] = idx;
    });

    const hasRequired = ['t_s', 'band', 'value'].every(key => key in col);
    if (!hasRequired) {
      alert('El CSV debe incluir al menos las columnas obligatorias: t_s, band, value\nColumnas detectadas: ' + rawHeaders.join(', '));
      return;
    }

    const parsed = [];

    for (let i = 1; i < lines.length; i++) {
      const lineStr = lines[i].trim();
      if (!lineStr) continue;

      const parts = lineStr.split(delimiter);
      if (parts.length < rawHeaders.length) continue;

      const tsRaw = parts[col['t_s']] !== undefined ? parts[col['t_s']].trim().replace(/['"]/g, '') : '';
      const tsVal = tsRaw !== '' ? parseInt(tsRaw, 10) : i - 1;
      const bandVal = parts[col['band']]?.trim().replace(/['"]/g, '');
      if (!bandVal || isNaN(tsVal)) continue;

      const rawVal = parts[col['value']]?.trim().replace(/['"]/g, '');
      const rawThresh = col['threshold'] !== undefined ? parts[col['threshold']]?.trim().replace(/['"]/g, '') : '';
      const rawSuccess = col['success'] !== undefined ? parts[col['success']]?.trim().replace(/['"]/g, '') : '';
      const rawValid = col['valid'] !== undefined ? parts[col['valid']]?.trim().replace(/['"]/g, '') : '1';
      const rawRole = col['role'] !== undefined ? parts[col['role']]?.trim().toLowerCase().replace(/['"]/g, '') : null;

      parsed.push({
        session_id: (col['session_id'] !== undefined ? parts[col['session_id']]?.trim().replace(/['"]/g, '') : '') || 'sesion',
        t_s: tsVal,
        timestamp: (col['timestamp'] !== undefined ? parts[col['timestamp']]?.trim().replace(/['"]/g, '') : '') || '',
        band: bandVal,
        role: rawRole || (BAND_CONFIG[bandVal]?.role || 'reward'),
        value: rawVal !== '' && rawVal !== undefined ? parseFloat(rawVal) : null,
        valid: rawValid !== '' && rawValid !== undefined ? parseInt(rawValid, 10) : 1,
        threshold: rawThresh !== '' && rawThresh !== undefined ? parseFloat(rawThresh) : null,
        success: rawSuccess !== '' && rawSuccess !== undefined ? parseInt(rawSuccess, 10) : null
      });
    }

    if (!parsed.length) {
      alert('No se pudieron extraer filas válidas del CSV.');
      return;
    }

    rawData = parsed;
    availableBands = [...new Set(parsed.map(r => r.band))];

    // Autodetectar si el session_id corresponde a uno de los presets con meta.json conocido
    const detectedId = parsed[0]?.session_id;
    if (customMeta) {
      metadata = customMeta;
    } else if (detectedId && window.SESSION_PRESETS && window.SESSION_PRESETS[detectedId]?.meta) {
      metadata = JSON.parse(JSON.stringify(window.SESSION_PRESETS[detectedId].meta));
    } else {
      metadata = {
        session_id: detectedId || '001',
        protocol_name: inferProtocolName(availableBands),
        device: 'Muse 2',
        sampling_rate: 256
      };
    }

    // Calcular métricas de todas las bandas de inmediato
    allBandsMetrics = {};
    availableBands.forEach(bKey => {
      const bRows = rawData.filter(r => r.band === bKey);
      const bRole = bRows[0]?.role || 'reward';
      allBandsMetrics[bKey] = computeMetrics(bRows, bRole);
    });

    if (!availableBands.includes(currentBand)) {
      currentBand = availableBands[0];
    }
    pieScope = 'all';

    updateHeaderFromMetadata();
    hideEmptyState();

    const allTs = rawData.map(r => r.t_s);
    const maxT = Math.max(...allTs);
    renderTimeAxisMarkers(maxT);
    renderBandTabs();
    resizeCanvas();
    renderCurrentBand();
    renderDraftSummary();
  }

  function inferProtocolName(bands) {
    if (bands.includes('theta') && bands.includes('low_alpha')) {
      return 'Protocolo Rob-Train · Theta + Alfa Baja';
    }
    if (bands.includes('low_beta')) {
      return 'Protocolo de Foco Clínico · SMR';
    }
    if (bands.includes('low_alpha') || bands.includes('alpha')) {
      return 'Protocolo Alfa · Calma Alerta';
    }
    return 'Protocolo EEG Muse 2';
  }

  function updateHeaderFromMetadata() {
    const firstRow = rawData[0] || {};
    const sessId = metadata.session_id || firstRow.session_id || '001';
    document.getElementById('session-id-display').textContent = `Sesión #${sessId}`;

    // Barra de progreso de sesiones (ej. 5 / 20)
    const numMatch = String(sessId).match(/\d+/);
    let sessNum = numMatch ? parseInt(numMatch[0], 10) : 3;
    if (String(sessId) === 'sim-001') sessNum = 3; // Como en el boceto "Sesión #003"
    const pctProgress = Math.min(100, Math.max(5, (sessNum / TOTAL_PROGRAM_SESSIONS) * 100));
    const fillEl = document.getElementById('session-progress-fill');
    const curEl = document.getElementById('session-progress-current');
    if (fillEl) fillEl.style.width = `${pctProgress}%`;
    if (curEl) curEl.textContent = String(sessNum);

    // Duración de la sesión real
    const uniqueSeconds = new Set(rawData.map(r => r.t_s)).size;
    const durationSec = metadata.duration_s || uniqueSeconds;
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationFormatted = mins > 0
      ? `${mins} min ${secs > 0 ? secs + ' s' : ''} (${durationSec} s)`
      : `${durationSec} s`;
    const durationEl = document.getElementById('quick-duration');
    if (durationEl) durationEl.textContent = durationFormatted;

    // Porcentaje de señal válida en el header
    const samplingEl = document.getElementById('quick-sampling');
    if (samplingEl) {
      const sampleMetric = allBandsMetrics[availableBands[0]];
      if (sampleMetric) {
        const totalRows = sampleMetric.totalRows || durationSec;
        const validPct = metadata.valid_pct !== undefined
          ? metadata.valid_pct
          : Number((((totalRows - sampleMetric.artifacts) / totalRows) * 100).toFixed(1));
        samplingEl.textContent = `${validPct}% válida (1 Hz)`;
      }
    }

    // Fecha/hora
    const tsSource = metadata.start_time || firstRow.timestamp;
    if (tsSource) {
      try {
        const d = new Date(tsSource);
        if (!isNaN(d.getTime())) {
          const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dateStr = d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
          document.getElementById('header-time').textContent = `${timeStr} · ${dateStr}`;
        } else {
          document.getElementById('header-time').textContent = tsSource;
        }
      } catch (e) {
        document.getElementById('header-time').textContent = tsSource;
      }
    }

    // Protocolo y Usuario
    const protocolBadge = document.getElementById('protocol-badge');
    if (protocolBadge) {
      const protoName = metadata.protocol_name || inferProtocolName(availableBands);
      const userTag = metadata.usuario_id ? ` · Usuario #${metadata.usuario_id}` : '';
      protocolBadge.textContent = `Protocolo: ${protoName}${userTag}`;
    }

    // Electrodos activos/referencia desde meta.json
    const electrodesText = document.getElementById('device-electrodes-text');
    if (electrodesText) {
      if (metadata.active_electrode && metadata.reference_electrode) {
        electrodesText.textContent = `Muse 2 · Activo: ${metadata.active_electrode} · Ref: ${metadata.reference_electrode}`;
      } else if (metadata.channels) {
        electrodesText.textContent = `Muse 2 · 256 Hz · ${metadata.channels.join(', ')}`;
      } else {
        electrodesText.textContent = 'Muse 2 · EEG 1 Hz';
      }
    }

    // Semáforo de calidad de señal de meta.json
    const qualityBadge = document.getElementById('header-quality-badge');
    if (qualityBadge) {
      if (metadata.signal_quality_flag) {
        qualityBadge.style.display = 'inline-flex';
        const isOk = metadata.signal_quality_flag === 'ok';
        qualityBadge.className = `badge quality-badge ${isOk ? 'ok' : 'warning'}`;
        qualityBadge.textContent = isOk ? '✓ Señal OK' : '⚠️ Ruido Moderado';
      } else {
        qualityBadge.style.display = 'none';
      }
    }

    // Desglose de segundos inválidos por razón (meta.json)
    const reasonsBox = document.getElementById('artifact-reasons-box');
    const reasonsPills = document.getElementById('artifact-reasons-pills');
    if (reasonsBox && reasonsPills) {
      if (metadata.invalid_seconds_by_reason && Object.keys(metadata.invalid_seconds_by_reason).length > 0) {
        reasonsBox.style.display = 'flex';
        reasonsPills.innerHTML = '';
        Object.entries(metadata.invalid_seconds_by_reason).forEach(([reason, secs]) => {
          const span = document.createElement('span');
          span.className = 'artifact-reason-chip';
          span.textContent = `${reason}: ${secs}s`;
          reasonsPills.appendChild(span);
        });
      } else {
        reasonsBox.style.display = 'none';
      }
    }
  }

  function evaluateRowSuccess(row, role) {
    if (row.success !== null && !isNaN(row.success)) {
      return row.success === 1;
    }
    return role === 'reward' ? (row.value > row.threshold) : (row.value < row.threshold);
  }

  function evaluateRowDeep(row, role) {
    if (row.value === null || row.threshold === null || isNaN(row.threshold)) return false;
    return role === 'reward'
      ? (row.value >= row.threshold * DEEP_ZONE_FACTOR)
      : (row.value <= row.threshold / DEEP_ZONE_FACTOR);
  }

  // =========================================================================
  // MOTOR DE RESUMEN DE PASTEL ("DRAFT" DEL BOCETO)
  // =========================================================================
  function renderDraftSummary() {
    if (!rawData.length) return;

    renderPieScopePills();
    const dist = computePieDistribution();
    lastPieSlices = dist.slices;

    // Actualizar colores y textos de los 3 íconos climáticos superiores
    const pal = PALETTES[piePalette] || PALETTES.traffic;
    const sunCard = document.getElementById('weather-card-sun');
    const cloudCard = document.getElementById('weather-card-cloud');
    const stormCard = document.getElementById('weather-card-storm');

    if (sunCard) {
      sunCard.style.borderColor = pal.sun.border;
      sunCard.style.background = pal.sun.bg;
      sunCard.querySelector('.weather-svg-wrap').style.color = pal.sun.light;
    }
    if (cloudCard) {
      cloudCard.style.borderColor = pal.cloud.border;
      cloudCard.style.background = pal.cloud.bg;
      cloudCard.querySelector('.weather-svg-wrap').style.color = pal.cloud.light;
    }
    if (stormCard) {
      stormCard.style.borderColor = pal.storm.border;
      stormCard.style.background = pal.storm.bg;
      stormCard.querySelector('.weather-svg-wrap').style.color = pal.storm.light;
    }

    const sunPctEl = document.getElementById('weather-sun-pct');
    const cloudPctEl = document.getElementById('weather-cloud-pct');
    const stormPctEl = document.getElementById('weather-storm-pct');

    if (sunPctEl) {
      sunPctEl.textContent = `${dist.sunPct}%`;
      sunPctEl.style.color = pal.sun.light;
    }
    if (cloudPctEl) {
      cloudPctEl.textContent = `${dist.cloudPct}%`;
      cloudPctEl.style.color = pal.cloud.light;
    }
    if (stormPctEl) {
      stormPctEl.textContent = `${dist.stormPct}%`;
      stormPctEl.style.color = pal.storm.light;
    }

    // Subtítulos según modo de cálculo
    const sunSub = document.getElementById('weather-sun-sub');
    const cloudSub = document.getElementById('weather-cloud-sub');
    const stormSub = document.getElementById('weather-storm-sub');
    if (pieCalcMode === 'synergy' && pieScope === 'all') {
      if (sunSub) sunSub.textContent = `Todas las bandas (${availableBands.length}/${availableBands.length}) en meta`;
      if (cloudSub) cloudSub.textContent = 'Éxito parcial (algunas bandas en meta)';
      if (stormSub) stormSub.textContent = 'Ninguna banda en meta simultáneamente';
    } else {
      if (sunSub) sunSub.textContent = 'Zona profunda / Óptimo (≥1.25×)';
      if (cloudSub) cloudSub.textContent = 'Dentro del umbral objetivo';
      if (stormSub) stormSub.textContent = 'Por fuera del umbral objetivo';
    }

    // Total enfocado (Sol + Nube)
    const focusedPct = dist.sunPct + dist.cloudPct;
    const focusValEl = document.getElementById('pie-total-focus-val');
    if (focusValEl) focusValEl.textContent = `${focusedPct}%`;

    // Score sesión (0-100) y Sesión pasada
    const sessionScore = dist.sessionScore;
    const pastInfo = computePastSessionScore(sessionScore);
    const curScoreEl = document.getElementById('draft-score-current');
    const pastScoreEl = document.getElementById('draft-score-past');
    const pastLabelEl = document.getElementById('draft-score-past-label');
    const deltaEl = document.getElementById('draft-score-delta');

    if (curScoreEl) curScoreEl.textContent = String(sessionScore);
    if (pastScoreEl) pastScoreEl.textContent = String(pastInfo.score);
    if (pastLabelEl) pastLabelEl.textContent = pastInfo.label;
    if (deltaEl) {
      const diff = sessionScore - pastInfo.score;
      deltaEl.textContent = `${diff >= 0 ? '+' : ''}${diff} pts`;
      deltaEl.className = `score-delta-pill ${diff >= 0 ? 'positive' : 'negative'}`;
    }

    // Desglose por banda individual en la columna izquierda
    renderBandContributionList(pal);

    // Actualizar insignia "Thriving" de la derecha
    updateThrivingBadge(focusedPct, sessionScore);

    // Actualizar frase narrativa inferior
    updateNarrativeBanner(dist, focusedPct);

    // Dibujar el gráfico de pastel
    drawPieChart(dist.slices);
  }

  function renderPieScopePills() {
    const container = document.getElementById('pie-scope-pills');
    if (!container) return;
    container.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `scope-pill-btn ${pieScope === 'all' ? 'active' : ''}`;
    allBtn.textContent = `Promedio (${availableBands.length} bandas)`;
    allBtn.addEventListener('click', () => {
      pieScope = 'all';
      renderDraftSummary();
    });
    container.appendChild(allBtn);

    availableBands.forEach(bKey => {
      const bRole = rawData.find(r => r.band === bKey)?.role || 'reward';
      const cfg = getBandConfig(bKey, bRole);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `scope-pill-btn ${pieScope === bKey ? 'active' : ''}`;
      btn.textContent = `${cfg.displayName} (${bRole === 'reward' ? '↑' : '↓'})`;
      btn.addEventListener('click', () => {
        pieScope = bKey;
        currentBand = bKey;
        renderBandTabs();
        renderCurrentBand();
        renderDraftSummary();
      });
      container.appendChild(btn);
    });
  }

  function computePieDistribution() {
    const pal = PALETTES[piePalette] || PALETTES.traffic;
    let rawSun = 0;
    let rawCloud = 0;
    let rawStorm = 0;
    let totalCount = 0;

    if (pieScope !== 'all') {
      // Pastel de una sola banda específica
      const m = allBandsMetrics[pieScope];
      if (m && m.totalValid > 0) {
        const sunSec = m.deepZoneSeconds;
        const cloudSec = Math.max(0, m.zoneSeconds - m.deepZoneSeconds);
        const stormSec = Math.max(0, m.totalValid - m.zoneSeconds);
        rawSun = (sunSec / m.totalValid) * 100;
        rawCloud = (cloudSec / m.totalValid) * 100;
        rawStorm = (stormSec / m.totalValid) * 100;
        totalCount = m.totalValid;
      }
    } else if (pieCalcMode === 'synergy') {
      // Modo Sinergia Simultánea: evalúa segundo a segundo cuántas bandas cumplen la meta a la vez
      const validSeconds = [...new Set(rawData.filter(r => r.valid === 1 && r.threshold !== null).map(r => r.t_s))];
      let sunSec = 0;
      let cloudSec = 0;
      let stormSec = 0;

      validSeconds.forEach(t => {
        const rowsAtT = rawData.filter(r => r.t_s === t && r.valid === 1 && r.threshold !== null);
        if (!rowsAtT.length) return;
        const succCount = rowsAtT.filter(r => evaluateRowSuccess(r, r.role)).length;
        if (succCount === rowsAtT.length) {
          sunSec++;
        } else if (succCount > 0) {
          cloudSec++;
        } else {
          stormSec++;
        }
      });

      totalCount = validSeconds.length || 1;
      rawSun = (sunSec / totalCount) * 100;
      rawCloud = (cloudSec / totalCount) * 100;
      rawStorm = (stormSec / totalCount) * 100;
    } else {
      // Modo Zonas Promedio: promedia el desempeño de todas las bandas entrenadas
      let sumSun = 0;
      let sumCloud = 0;
      let sumStorm = 0;
      let validBands = 0;

      availableBands.forEach(bKey => {
        const m = allBandsMetrics[bKey];
        if (m && m.totalValid > 0) {
          const bSun = (m.deepZoneSeconds / m.totalValid) * 100;
          const bCloud = (Math.max(0, m.zoneSeconds - m.deepZoneSeconds) / m.totalValid) * 100;
          const bStorm = (Math.max(0, m.totalValid - m.zoneSeconds) / m.totalValid) * 100;
          sumSun += bSun;
          sumCloud += bCloud;
          sumStorm += bStorm;
          totalCount += m.totalValid;
          validBands++;
        }
      });

      if (validBands > 0) {
        rawSun = sumSun / validBands;
        rawCloud = sumCloud / validBands;
        rawStorm = sumStorm / validBands;
      }
    }

    // Redondear asegurando que sumen exactamente 100%
    let sunPct = Math.round(rawSun);
    let cloudPct = Math.round(rawCloud);
    let stormPct = Math.max(0, 100 - sunPct - cloudPct);

    // Calcular Score de la sesión (0 - 100) coherente con el rendimiento
    const avgZonePct = availableBands.reduce((acc, b) => acc + (allBandsMetrics[b]?.totalZonePct || 0), 0) / (availableBands.length || 1);
    const avgDeepPct = availableBands.reduce((acc, b) => acc + (allBandsMetrics[b]?.deepZonePct || 0), 0) / (availableBands.length || 1);
    const avgMaxStreak = availableBands.reduce((acc, b) => acc + (allBandsMetrics[b]?.maxStreak || 0), 0) / (availableBands.length || 1);

    const rawScore = Math.min(99, Math.round(28 + (avgZonePct * 0.65) + (avgDeepPct * 0.45) + Math.min(12, avgMaxStreak * 0.4)));

    const slices = [
      {
        id: 'sun',
        label: '☀️ Solecito (Muy Bien)',
        shortLabel: '☀️',
        pct: sunPct,
        color: pal.sun.main,
        lightColor: pal.sun.light,
        desc: pieCalcMode === 'synergy' && pieScope === 'all'
          ? 'Todas las bandas en meta al mismo tiempo'
          : 'Tiempo en Deep Zone (rendimiento óptimo)'
      },
      {
        id: 'cloud',
        label: '☁️ Nubecita (Bien)',
        shortLabel: '☁️',
        pct: cloudPct,
        color: pal.cloud.main,
        lightColor: pal.cloud.light,
        desc: pieCalcMode === 'synergy' && pieScope === 'all'
          ? 'Éxito parcial entre las bandas entrenadas'
          : 'Dentro de la zona umbral de entrenamiento'
      },
      {
        id: 'storm',
        label: '⛈️ Tormenta (Fuera de Zona)',
        shortLabel: '⛈️',
        pct: stormPct,
        color: pal.storm.main,
        lightColor: pal.storm.light,
        desc: 'Actividad fuera del umbral o sobre-activación'
      }
    ];

    return {
      sunPct,
      cloudPct,
      stormPct,
      sessionScore: rawScore,
      totalCount,
      slices
    };
  }

  function computePastSessionScore(currentScore) {
    const sessId = String(metadata.session_id || '');
    if (sessId === '005') {
      return { score: 56, label: 'Sesión #004 previa' };
    }
    if (sessId === '004') {
      return { score: 52, label: 'Sesión #003 previa' };
    }
    if (sessId === 'sim-001') {
      return { score: 72, label: 'Sesión #002 previa' };
    }
    return { score: Math.max(40, currentScore - 7), label: 'Sesión anterior' };
  }

  function renderBandContributionList(pal) {
    const listEl = document.getElementById('band-contrib-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    availableBands.forEach(bKey => {
      const m = allBandsMetrics[bKey];
      if (!m) return;
      const bRole = rawData.find(r => r.band === bKey)?.role || 'reward';
      const cfg = getBandConfig(bKey, bRole);

      const bSun = m.totalValid > 0 ? Math.round((m.deepZoneSeconds / m.totalValid) * 100) : 0;
      const bCloud = m.totalValid > 0 ? Math.max(0, Math.round(m.totalZonePct) - bSun) : 0;
      const bStorm = Math.max(0, 100 - bSun - bCloud);

      const row = document.createElement('div');
      row.className = 'band-contrib-row';
      row.title = `Clic para ver el pastel y curva de ${cfg.displayName}`;
      row.innerHTML = `
        <div class="band-contrib-top">
          <span>${cfg.displayName} <span class="role-mini">(${bRole === 'reward' ? 'Reforzar' : 'Inhibir'})</span></span>
          <strong style="color:${pal.sun.light}">${Math.round(m.totalZonePct)}% en zona</strong>
        </div>
        <div class="band-contrib-bar">
          <div class="band-contrib-seg" style="width:${bSun}%; background:${pal.sun.main}"></div>
          <div class="band-contrib-seg" style="width:${bCloud}%; background:${pal.cloud.main}"></div>
          <div class="band-contrib-seg" style="width:${bStorm}%; background:${pal.storm.main}; opacity:0.45"></div>
        </div>
      `;
      row.addEventListener('click', () => {
        pieScope = bKey;
        currentBand = bKey;
        renderBandTabs();
        renderCurrentBand();
        renderDraftSummary();
      });
      listEl.appendChild(row);
    });
  }

  function updateThrivingBadge(focusedPct, sessionScore) {
    const titleEl = document.getElementById('thriving-status-title');
    const descEl = document.getElementById('thriving-status-desc');
    const badgeCard = document.getElementById('thriving-badge-card');
    if (!titleEl || !descEl) return;

    if (focusedPct >= 60 || sessionScore >= 75) {
      titleEl.textContent = 'Thriving!';
      titleEl.style.color = '#34D399';
      descEl.textContent = '¡Gran dominio! Tu cerebro sostuvo el foco y la autorregulación de forma sobresaliente.';
      if (badgeCard) badgeCard.style.borderColor = 'rgba(52, 211, 153, 0.45)';
    } else if (focusedPct >= 38 || sessionScore >= 58) {
      titleEl.textContent = 'Focused!';
      titleEl.style.color = '#38BDF8';
      descEl.textContent = 'Buen entrenamiento: lograste conectar con la zona objetivo de forma consistente.';
      if (badgeCard) badgeCard.style.borderColor = 'rgba(56, 189, 248, 0.45)';
    } else {
      titleEl.textContent = 'En Progreso';
      titleEl.style.color = '#FBBF24';
      descEl.textContent = 'Sesión de adaptación: cada entrenamiento fortalece tu capacidad de entrar en zona.';
      if (badgeCard) badgeCard.style.borderColor = 'rgba(251, 191, 36, 0.4)';
    }
  }

  function countOverActivationEpisodes() {
    // Cuenta episodios donde high_beta (u otra banda inhibit) superó su umbral con fuerza (>= 1.15x) por al menos 2s seguidos
    const inhibitBand = availableBands.find(b => b === 'high_beta') || availableBands.find(b => (rawData.find(r => r.band === b)?.role) === 'inhibit');
    if (!inhibitBand) return 0;

    const rows = rawData.filter(r => r.band === inhibitBand);
    let episodes = 0;
    let curRun = 0;

    rows.forEach(r => {
      if (r.valid === 1 && r.value !== null && r.threshold !== null) {
        const isSpike = r.value > r.threshold * 1.15;
        if (isSpike) {
          curRun++;
        } else {
          if (curRun >= 2) episodes++;
          curRun = 0;
        }
      } else {
        if (curRun >= 2) episodes++;
        curRun = 0;
      }
    });
    if (curRun >= 2) episodes++;
    return episodes;
  }

  function updateNarrativeBanner(dist, focusedPct) {
    const textEl = document.getElementById('draft-narrative-text');
    if (!textEl) return;

    const overActivations = countOverActivationEpisodes();
    const spikePhrase = overActivations === 0
      ? 'sin episodios fuertes de sobre-activación'
      : (overActivations === 1
          ? 'y solo se sobre-activó <em>1 vez</em>'
          : `y solo se sobre-activó <em>${overActivations} veces</em>`);

    // Identificar la mejor banda para enriquecer el mensaje
    let bestBandName = '';
    let bestBandPct = -1;
    availableBands.forEach(bKey => {
      const m = allBandsMetrics[bKey];
      const role = rawData.find(r => r.band === bKey)?.role || 'reward';
      if (m && m.totalZonePct > bestBandPct) {
        bestBandPct = m.totalZonePct;
        bestBandName = getBandConfig(bKey, role).displayName;
      }
    });

    const bestBandExtra = bestBandName
      ? ` Destacaste en <strong>${bestBandName} (${Math.round(bestBandPct)}% en meta)</strong>.`
      : '';

    textEl.innerHTML = `Hoy tu cerebro se mantuvo enfocado el <strong>${focusedPct}%</strong> del tiempo (${dist.sunPct}% ☀️ + ${dist.cloudPct}% ☁️) ${spikePhrase}.${bestBandExtra}`;
  }

  function drawPieChart(slices) {
    if (!pieCanvas || !pieCtx || !pieWrapper) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = pieWrapper.getBoundingClientRect();
    const w = rect.width || 340;
    const h = rect.height || 290;

    pieCanvas.width = w * dpr;
    pieCanvas.height = h * dpr;
    pieCtx.resetTransform?.();
    pieCtx.scale(dpr, dpr);
    pieCtx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.33;

    let startAngle = -Math.PI / 2; // Empezar arriba a las 12 en punto

    slices.forEach((slice, idx) => {
      if (slice.pct <= 0) return;
      const sliceAngle = (slice.pct / 100) * (Math.PI * 2);
      const endAngle = startAngle + sliceAngle;
      const midAngle = startAngle + sliceAngle / 2;

      slice.startAngle = startAngle;
      slice.endAngle = endAngle;
      slice.cx = cx;
      slice.cy = cy;
      slice.radius = radius;

      const isHovered = hoveredPieSlice === idx;
      const offset = isHovered ? 7 : 0;
      const ox = cx + Math.cos(midAngle) * offset;
      const oy = cy + Math.sin(midAngle) * offset;

      // Rebanada del pastel
      pieCtx.save();
      pieCtx.beginPath();
      pieCtx.moveTo(ox, oy);
      pieCtx.arc(ox, oy, radius, startAngle, endAngle);
      pieCtx.closePath();

      pieCtx.fillStyle = slice.color;
      pieCtx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      pieCtx.shadowBlur = isHovered ? 16 : 8;
      pieCtx.fill();

      // Borde nítido estilo boceto
      pieCtx.lineWidth = 2.5;
      pieCtx.strokeStyle = '#080D18';
      pieCtx.stroke();
      pieCtx.restore();

      // Etiqueta externa con porcentaje grande (estilo 42%, 26%, 32% del boceto)
      const labelDist = radius + 28;
      const lx = cx + Math.cos(midAngle) * labelDist;
      const ly = cy + Math.sin(midAngle) * labelDist;

      // Línea guía corta
      const lineStartR = radius + 4;
      const lineEndR = radius + 14;
      pieCtx.beginPath();
      pieCtx.moveTo(cx + Math.cos(midAngle) * lineStartR, cy + Math.sin(midAngle) * lineStartR);
      pieCtx.lineTo(cx + Math.cos(midAngle) * lineEndR, cy + Math.sin(midAngle) * lineEndR);
      pieCtx.strokeStyle = slice.lightColor;
      pieCtx.lineWidth = 1.6;
      pieCtx.stroke();

      pieCtx.font = '800 15px "Plus Jakarta Sans", sans-serif';
      pieCtx.fillStyle = slice.lightColor;
      pieCtx.textAlign = 'center';
      pieCtx.textBaseline = 'middle';
      pieCtx.fillText(`${slice.pct}%`, lx, ly - 6);

      pieCtx.font = '600 12px "Plus Jakarta Sans", sans-serif';
      pieCtx.fillStyle = '#E2E8F0';
      pieCtx.fillText(slice.shortLabel, lx, ly + 10);

      startAngle = endAngle;
    });

    // Círculo exterior sutil para dar acabado de medalla/reloj como el boceto
    pieCtx.beginPath();
    pieCtx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
    pieCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    pieCtx.lineWidth = 1.5;
    pieCtx.stroke();
  }

  function handlePieHover(clientX, clientY) {
    if (!pieCanvas || !lastPieSlices.length) return;
    const rect = pieCanvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = mx - cx;
    const dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = Math.min(rect.width, rect.height) * 0.33;

    if (dist > radius + 12) {
      if (hoveredPieSlice !== null) {
        hoveredPieSlice = null;
        if (pieTooltip) pieTooltip.style.display = 'none';
        drawPieChart(lastPieSlices);
      }
      return;
    }

    let angle = Math.atan2(dy, dx);
    if (angle < -Math.PI / 2) {
      angle += Math.PI * 2;
    }

    let foundIdx = null;
    lastPieSlices.forEach((s, idx) => {
      if (s.pct > 0 && angle >= s.startAngle && angle <= s.endAngle) {
        foundIdx = idx;
      }
    });

    if (foundIdx !== hoveredPieSlice) {
      hoveredPieSlice = foundIdx;
      drawPieChart(lastPieSlices);
    }

    if (foundIdx !== null && pieTooltip) {
      const s = lastPieSlices[foundIdx];
      pieTooltip.innerHTML = `
        <strong style="color:${s.lightColor}">${s.label}: ${s.pct}%</strong>
        <div style="margin-top:3px; color:#94A3B8; font-size:0.68rem;">${s.desc}</div>
      `;
      let left = mx + 14;
      if (left + 190 > rect.width) left = mx - 195;
      let top = my - 30;
      if (top < 6) top = 8;
      pieTooltip.style.left = `${left}px`;
      pieTooltip.style.top = `${top}px`;
      pieTooltip.style.display = 'block';
    }
  }

  // =========================================================================
  // MOTOR DE GRÁFICO TEMPORAL Y MÉTRICAS CLÍNICAS POR BANDA
  // =========================================================================
  function renderTimeAxisMarkers(durationSec) {
    const container = document.getElementById('time-axis-container');
    if (!container) return;
    container.innerHTML = '';

    let step = 60;
    if (durationSec <= 45) step = 10;
    else if (durationSec <= 120) step = 20;
    else if (durationSec <= 360) step = 60;
    else step = 120;

    for (let t = 0; t <= durationSec; t += step) {
      const m = Math.floor(t / 60);
      const s = t % 60;
      const span = document.createElement('span');
      span.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      container.appendChild(span);
    }

    // Si el último segundo supera por más de 15s la última marca de minuto (ej. 343s -> 05:43), mostrar la marca final
    if (durationSec % step >= 15) {
      const m = Math.floor(durationSec / 60);
      const s = durationSec % 60;
      const span = document.createElement('span');
      span.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      container.appendChild(span);
    }
  }

  function renderBandTabs() {
    bandNav.innerHTML = '';
    availableBands.forEach(bandKey => {
      const bandRow = rawData.find(r => r.band === bandKey);
      const actualRole = bandRow ? bandRow.role : 'reward';
      const cfg = getBandConfig(bandKey, actualRole);

      const btn = document.createElement('button');
      btn.className = `band-tab ${cfg.role} ${bandKey === currentBand ? 'active' : ''}`;
      btn.innerHTML = `
        <span>${cfg.displayName}</span>
        <span class="role-badge">${cfg.role === 'reward' ? 'Reforzar ↑' : 'Inhibir ↓'}</span>
      `;
      btn.addEventListener('click', () => {
        currentBand = bandKey;
        renderBandTabs();
        renderCurrentBand();
      });
      bandNav.appendChild(btn);
    });
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.resetTransform?.();
    ctx.scale(dpr, dpr);
  }

  function renderCurrentBand(hoverSecond = null) {
    const bandRows = rawData.filter(r => r.band === currentBand);
    if (!bandRows.length) return;

    const actualRole = bandRows[0].role || 'reward';
    const cfg = getBandConfig(currentBand, actualRole);

    bandRoleIndicator.textContent = actualRole === 'reward' ? 'REWARD (AUMENTAR)' : 'INHIBIT (REDUCIR)';
    bandRoleIndicator.className = `role-pill ${actualRole}`;
    bandDescriptionText.textContent = `${cfg.displayName} · ${cfg.desc}`;

    currentMetrics = computeMetrics(bandRows, actualRole);
    allBandsMetrics[currentBand] = currentMetrics;
    updateMetricsUI(currentMetrics, cfg);
    renderMinutesBreakdown(currentMetrics.minutes);

    drawChart(bandRows, actualRole, currentMetrics, hoverSecond);
  }

  function computeMetrics(rows, role) {
    const validWithThresh = rows.filter(r => r.valid === 1 && r.threshold !== null && !isNaN(r.threshold));
    const totalValid = validWithThresh.length;
    const totalRows = rows.length;
    const artifacts = rows.filter(r => r.valid === 0).length;
    const calibrationSeconds = rows.filter(r => r.threshold === null || isNaN(r.threshold)).length;

    let zoneSeconds = 0;
    let deepZoneSeconds = 0;

    validWithThresh.forEach(r => {
      const isSuccess = evaluateRowSuccess(r, role);
      if (isSuccess) zoneSeconds++;

      const isDeep = evaluateRowDeep(r, role);
      if (isDeep) deepZoneSeconds++;
    });

    const totalZonePct = totalValid > 0 ? (zoneSeconds / totalValid) * 100 : 0;
    const deepZonePct = totalValid > 0 ? (deepZoneSeconds / totalValid) * 100 : 0;

    // Rachas continuas
    const streaks = [];
    let currentStreak = 0;
    const sortedRows = [...rows].sort((a, b) => a.t_s - b.t_s);
    sortedRows.forEach(row => {
      if (row.valid === 1 && row.threshold !== null && !isNaN(row.threshold)) {
        const isSuccess = evaluateRowSuccess(row, role);
        if (isSuccess) {
          currentStreak++;
        } else {
          if (currentStreak > 0) streaks.push(currentStreak);
          currentStreak = 0;
        }
      } else {
        if (currentStreak > 0) streaks.push(currentStreak);
        currentStreak = 0;
      }
    });
    if (currentStreak > 0) streaks.push(currentStreak);

    const avgStreak = streaks.length > 0 ? (streaks.reduce((a, b) => a + b, 0) / streaks.length) : 0;
    const maxStreak = streaks.length > 0 ? Math.max(...streaks) : 0;

    let feedbackScore = (zoneSeconds * 1) + (deepZoneSeconds * 2);
    streaks.forEach(s => {
      if (s >= 10) feedbackScore += Math.floor(s * 1.5);
    });
    const xp = Math.round(feedbackScore * 0.45);

    // Desglose Minuto a Minuto dinámico según la duración real de la sesión
    const maxT = Math.max(...rows.map(r => r.t_s), 60);
    const totalMinutesCount = Math.max(1, Math.ceil(maxT / 60));
    const minutes = [];

    for (let minIdx = 0; minIdx < totalMinutesCount; minIdx++) {
      const minStart = minIdx * 60;
      const minEnd = minStart + 59;
      const minRows = validWithThresh.filter(r => r.t_s >= minStart && r.t_s <= minEnd);
      const minSuccess = minRows.filter(r => evaluateRowSuccess(r, role)).length;
      const pct = minRows.length > 0 ? (minSuccess / minRows.length) * 100 : 0;
      minutes.push({ minute: minIdx + 1, pct: Math.round(pct), count: minRows.length });
    }

    const activeMinutes = minutes.filter(m => m.count >= 5);
    let bestMin = activeMinutes[0] || minutes[0];
    let worstMin = activeMinutes[0] || minutes[0];
    activeMinutes.forEach(m => {
      if (m.pct > bestMin.pct) bestMin = m;
      if (m.pct < worstMin.pct) worstMin = m;
    });

    let slope = 0;
    if (validWithThresh.length > 1) {
      const n = validWithThresh.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      validWithThresh.forEach((r, idx) => {
        sumX += idx;
        sumY += r.value;
        sumXY += idx * r.value;
        sumXX += idx * idx;
      });
      slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    }

    return {
      totalZonePct,
      deepZonePct,
      zoneSeconds,
      deepZoneSeconds,
      totalValid,
      totalRows,
      artifacts,
      calibrationSeconds,
      avgStreak,
      maxStreak,
      streaksCount: streaks.length,
      feedbackScore,
      xp,
      minutes,
      bestMin,
      worstMin,
      slope
    };
  }

  function updateMetricsUI(m, cfg) {
    document.getElementById('metric-total-zone').textContent = `${Math.round(m.totalZonePct)}%`;
    document.getElementById('metric-total-zone-sub').textContent = `${m.zoneSeconds}s en zona (${m.totalValid}s válidos)`;

    document.getElementById('metric-deep-zone').textContent = `${Math.round(m.deepZonePct)}%`;
    document.getElementById('metric-deep-zone-sub').textContent = `${m.deepZoneSeconds}s en zona profunda`;

    document.getElementById('metric-feedback-score').textContent = `${m.feedbackScore} pts`;
    document.getElementById('metric-feedback-score-sub').textContent = 'Estabilidad sostenida';

    document.getElementById('metric-avg-streaks').textContent = `${m.avgStreak.toFixed(1)} sec`;
    document.getElementById('metric-avg-streaks-sub').textContent = `${m.streaksCount} rachas continuas`;

    document.getElementById('metric-max-streaks').textContent = `${m.maxStreak} sec`;
    document.getElementById('metric-max-streaks-sub').textContent = 'Concentración continua';

    document.getElementById('metric-xp').textContent = `${m.xp}`;
    document.getElementById('metric-xp-sub').textContent = 'Gamificación';

    const trendText = m.slope > 0.0003
      ? (cfg.role === 'reward' ? '📈 Ascenso (+Potencia)' : '⚠️ Subida (Tensión)')
      : (m.slope < -0.0003
          ? (cfg.role === 'inhibit' ? '📉 Inhibición Exitosa' : '📉 Descenso Gradual')
          : '➡️ Estable');
    document.getElementById('clinical-trend').textContent = trendText;

    if (m.bestMin) {
      document.getElementById('clinical-best-min').textContent = `Min ${m.bestMin.minute} (${m.bestMin.pct}%)`;
    }

    const denom = m.totalRows || 300;
    const artPct = ((m.artifacts / denom) * 100).toFixed(1);
    document.getElementById('clinical-artifacts').textContent = `${m.artifacts}s (${artPct}%)`;

    const thresholds = [...new Set(rawData.filter(r => r.band === currentBand && r.threshold !== null && !isNaN(r.threshold)).map(r => r.threshold))];
    if (thresholds.length === 1) {
      threshValBadge.textContent = `${thresholds[0].toFixed(3)} µV`;
    } else if (thresholds.length > 1) {
      threshValBadge.textContent = `${thresholds[0].toFixed(3)} → ${thresholds[thresholds.length - 1].toFixed(3)} µV`;
    } else {
      threshValBadge.textContent = '--';
    }
  }

  function renderMinutesBreakdown(minutes) {
    if (!minutesGrid) return;
    minutesGrid.innerHTML = '';
    minutesGrid.style.gridTemplateColumns = `repeat(${minutes.length}, 1fr)`;

    minutes.forEach(m => {
      const item = document.createElement('div');
      item.className = 'minute-bar-item';
      item.innerHTML = `
        <div class="minute-bar-track">
          <div class="minute-bar-fill" style="width: ${m.pct}%"></div>
        </div>
        <div class="minute-bar-label">
          <span>Min ${m.minute}</span>
          <strong>${m.pct}%</strong>
        </div>
      `;
      minutesGrid.appendChild(item);
    });
  }

  function drawChart(rows, role, metrics, hoverSecond) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 25, right: 20, bottom: 25, left: 10 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const minT = Math.min(...rows.map(r => r.t_s), 0);
    const maxT = Math.max(...rows.map(r => r.t_s), 60);
    const spanT = Math.max(1, maxT - minT);

    const validValues = rows.filter(r => r.valid === 1 && r.value !== null).map(r => r.value);
    const validThresh = rows.filter(r => r.threshold !== null && !isNaN(r.threshold)).map(r => r.threshold);
    const allKeyValues = [...validValues, ...validThresh];

    let rawMinY = Math.min(...allKeyValues);
    let rawMaxY = Math.max(...allKeyValues);
    const yMargin = (rawMaxY - rawMinY) * 0.18 || 0.2;
    rawMinY = Math.max(0, rawMinY - yMargin);
    rawMaxY = rawMaxY + yMargin;

    const shouldInvert = (role === 'inhibit' && invertAxisForInhibit);

    function getX(t) {
      return padding.left + ((t - minT) / spanT) * chartW;
    }

    function getY(val) {
      if (val === null || isNaN(val)) return null;
      let norm = (val - rawMinY) / (rawMaxY - rawMinY);
      norm = Math.max(0, Math.min(1, norm));
      if (!shouldInvert) {
        return padding.top + chartH - (norm * chartH);
      } else {
        return padding.top + (norm * chartH);
      }
    }

    // 1. Calibración (SOLO si la sesión realmente incluye segundos sin umbral al inicio)
    const calibT = metrics.calibrationSeconds ?? 0;
    if (calibT > 0) {
      const calibX = getX(minT + calibT);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.fillRect(padding.left, padding.top, calibX - padding.left, chartH);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(calibX, padding.top);
      ctx.lineTo(calibX, padding.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.font = '10px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Calibración (${calibT}s)`, padding.left + 6, padding.top + 14);
    }

    // 2. Umbrales dinámicos escalonados
    const threshSegments = [];
    let curThresh = null;
    let segStart = minT;

    const sortedRows = [...rows].sort((a, b) => a.t_s - b.t_s);
    sortedRows.forEach(r => {
      const th = (r.threshold !== null && !isNaN(r.threshold)) ? r.threshold : null;
      if (th !== curThresh) {
        if (curThresh !== null) {
          threshSegments.push({ startT: segStart, endT: r.t_s, threshold: curThresh });
        }
        curThresh = th;
        segStart = r.t_s;
      }
    });
    if (curThresh !== null) {
      threshSegments.push({ startT: segStart, endT: maxT, threshold: curThresh });
    }

    threshSegments.forEach((seg, segIdx) => {
      const x1 = getX(seg.startT);
      const x2 = getX(seg.endT);
      const yZone = getY(seg.threshold);

      const deepVal = role === 'reward' ? seg.threshold * DEEP_ZONE_FACTOR : seg.threshold / DEEP_ZONE_FACTOR;
      const yDeep = getY(deepVal);

      // Línea vertical de escalón cuando cambia el umbral en plena sesión
      if (segIdx > 0) {
        const prevSeg = threshSegments[segIdx - 1];
        const prevY = getY(prevSeg.threshold);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x1, prevY);
        ctx.lineTo(x1, yZone);
        ctx.stroke();
      }

      // Deep Zone
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, yDeep);
      ctx.lineTo(x2, yDeep);
      ctx.stroke();

      // Zone
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, yZone);
      ctx.lineTo(x2, yZone);
      ctx.stroke();

      if (seg.endT >= maxT - 5) {
        ctx.fillStyle = 'rgba(129, 140, 248, 0.9)';
        ctx.font = '10px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('☀️ Deep Zone', w - padding.right - 2, yDeep - 4);

        ctx.fillStyle = 'rgba(52, 211, 153, 0.9)';
        ctx.fillText('☁️ Zone', w - padding.right - 2, yZone - 4);
        ctx.textAlign = 'left';
      }
    });
    ctx.setLineDash([]);

    // 3. Artefactos
    sortedRows.forEach(r => {
      if (r.valid === 0) {
        const x = getX(r.t_s);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
        ctx.fillRect(x - 1, padding.top, 2, chartH);
      }
    });

    // 4. Cadenas válidas
    const validChains = [];
    let currentChain = [];

    sortedRows.forEach(r => {
      if (r.valid === 1 && r.value !== null) {
        currentChain.push(r);
      } else {
        if (currentChain.length > 0) {
          validChains.push(currentChain);
          currentChain = [];
        }
      }
    });
    if (currentChain.length > 0) {
      validChains.push(currentChain);
    }

    // 5. Curva Spline
    validChains.forEach(chain => {
      if (chain.length === 1) {
        // Dibujar punto aislado si solo hay 1 segundo válido entre huecos de ruido
        const pt = chain[0];
        const px = getX(pt.t_s);
        const py = getY(pt.value);
        const isSucc = evaluateRowSuccess(pt, role);
        const isDp = evaluateRowDeep(pt, role);
        ctx.fillStyle = isDp ? '#818CF8' : (isSucc ? '#34D399' : '#94A3B8');
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      const points = chain.map(r => ({
        x: getX(r.t_s),
        y: getY(r.value),
        t: r.t_s,
        val: r.value,
        thresh: r.threshold,
        success: r.success,
        row: r
      }));

      const baselineY = shouldInvert ? padding.top : padding.top + chartH;
      ctx.beginPath();
      ctx.moveTo(points[0].x, baselineY);
      ctx.lineTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const midX = (p0.x + p1.x) / 2;
        ctx.bezierCurveTo(midX, p0.y, midX, p1.y, p1.x, p1.y);
      }
      ctx.lineTo(points[points.length - 1].x, baselineY);
      ctx.closePath();

      const fillGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
      if (role === 'reward') {
        fillGrad.addColorStop(0, 'rgba(99, 102, 241, 0.12)');
        fillGrad.addColorStop(0.4, 'rgba(16, 185, 129, 0.08)');
        fillGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
      } else {
        fillGrad.addColorStop(0, 'rgba(16, 185, 129, 0.12)');
        fillGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.06)');
        fillGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // Trazo coloreado por estado
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];

        let strokeColor = '#94A3B8';
        if (p0.thresh !== null && !isNaN(p0.thresh)) {
          const isSuccess = evaluateRowSuccess(p0.row, role);
          const isDeep = evaluateRowDeep(p0.row, role);

          if (isDeep) strokeColor = '#818CF8';
          else if (isSuccess) strokeColor = '#34D399';
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = w < 480 ? 1.8 : 2.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        const midX = (p0.x + p1.x) / 2;
        ctx.bezierCurveTo(midX, p0.y, midX, p1.y, p1.x, p1.y);
        ctx.stroke();
      }
    });

    // 6. Cursor Hover / Touch
    if (hoverSecond !== null) {
      const hX = getX(hoverSecond);
      const hRow = rows.find(r => r.t_s === hoverSecond);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hX, padding.top);
      ctx.lineTo(hX, padding.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      if (hRow && hRow.valid === 1 && hRow.value !== null) {
        const hY = getY(hRow.value);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(hX, hY, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hX, hY, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function handlePointer(clientX, clientY) {
    if (!rawData.length) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const padding = { top: 25, right: 20, bottom: 25, left: 10 };
    const chartW = rect.width - padding.left - padding.right;

    const bandRows = rawData.filter(r => r.band === currentBand);
    if (!bandRows.length) return;

    const minT = Math.min(...bandRows.map(r => r.t_s), 0);
    const maxT = Math.max(...bandRows.map(r => r.t_s), 60);
    const spanT = Math.max(1, maxT - minT);

    const relX = Math.max(0, Math.min(chartW, mouseX - padding.left));
    const targetSecond = Math.round(minT + (relX / chartW) * spanT);

    const row = bandRows.find(r => r.t_s === targetSecond);
    if (!row) return;

    renderCurrentBand(targetSecond);

    const mm = Math.floor(targetSecond / 60).toString().padStart(2, '0');
    const ss = (targetSecond % 60).toString().padStart(2, '0');
    tooltipTime.textContent = `${mm}:${ss} (${targetSecond}s)`;

    if (row.valid === 0) {
      tooltipVal.textContent = 'Inválido';
      tooltipThresh.textContent = row.threshold !== null ? `${row.threshold.toFixed(3)} µV` : '--';
      tooltipState.textContent = 'Artefacto / Ruido';
      tooltipState.className = 'tooltip-badge artifact';
    } else {
      tooltipVal.textContent = row.value !== null ? `${row.value.toFixed(3)} µV` : '--';
      tooltipThresh.textContent = row.threshold !== null ? `${row.threshold.toFixed(3)} µV` : 'En Calibración';

      if (row.threshold === null || isNaN(row.threshold)) {
        tooltipState.textContent = 'Calibrando';
        tooltipState.className = 'tooltip-badge neutral';
      } else {
        const isSuccess = evaluateRowSuccess(row, row.role);
        const isDeep = evaluateRowDeep(row, row.role);

        if (isDeep) {
          tooltipState.textContent = '☀️ Deep Zone';
          tooltipState.className = 'tooltip-badge deep';
        } else if (isSuccess) {
          tooltipState.textContent = '☁️ In Zone';
          tooltipState.className = 'tooltip-badge zone';
        } else {
          tooltipState.textContent = '⛈️ Fuera de Zona';
          tooltipState.className = 'tooltip-badge neutral';
        }
      }
    }

    let tipLeft = mouseX + 15;
    if (tipLeft + 165 > rect.width) tipLeft = mouseX - 170;
    let tipTop = mouseY - 45;
    if (tipTop < 5) tipTop = 10;

    canvasTooltip.style.left = `${tipLeft}px`;
    canvasTooltip.style.top = `${tipTop}px`;
    canvasTooltip.style.display = 'flex';
  }

  function exportSummaryJSON() {
    if (!rawData.length) {
      alert('Por favor carga un archivo CSV de sesión antes de exportar.');
      return;
    }

    const pieDist = computePieDistribution();
    const summary = {
      exported_at: new Date().toISOString(),
      metadata,
      global_pie_summary: {
        calc_mode: pieCalcMode,
        scope: pieScope,
        sun_pct: pieDist.sunPct,
        cloud_pct: pieDist.cloudPct,
        storm_pct: pieDist.stormPct,
        total_focused_pct: pieDist.sunPct + pieDist.cloudPct,
        session_score: pieDist.sessionScore
      },
      bands: {}
    };

    availableBands.forEach(b => {
      const bRows = rawData.filter(r => r.band === b);
      const role = bRows[0]?.role || 'reward';
      summary.bands[b] = {
        role,
        metrics: computeMetrics(bRows, role)
      };
    });

    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resumen_${metadata.session_id || 'sesion'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  init();
})();
