/**
 * Neurofeedback Session Summary Engine (Client-Friendly Edition)
 * Incorpora la paleta Boceto por defecto, etiquetas "Muy bien / Bien / Fuera de zona",
 * explicación transparente de Score e insignia, resumen narrativo en lenguaje común,
 * curva continua sin cortes y métricas explicadas paso a paso para el cliente.
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

  // Estado del Resumen Pastel (Boceto)
  let currentSectionView = 'draft'; // 'draft' (Resumen General) | 'advanced' (Análisis Avanzado bajo demanda)
  let pieScope = 'all';            // 'all' o nombre de banda individual
  let pieCalcMode = 'zones';       // 'zones' (Promedio por nivel) | 'synergy' (Equilibrio simultáneo)
  let piePalette = 'weather';      // Paleta del Boceto fija como predeterminada
  let hoveredPieSlice = null;
  let lastPieSlices = [];

  let metadata = window.DEFAULT_METADATA || {
    session_id: 'sim-001',
    protocol_name: 'Foco y Calma',
    device: 'Muse 2',
    channels: ['TP9', 'AF7', 'AF8', 'TP10'],
    sampling_rate: 256
  };

  // Nomenclatura Electroencefalográfica Estándar (Bandas EEG y Rangos en Hz)
  const BAND_CONFIG = {
    high_alpha: {
      displayName: 'High Alpha (10–12 Hz)',
      shortName: 'High Alpha',
      rangeHz: '10–12 Hz',
      descReward: 'Refuerzo de amplitud en High Alpha (Meta: Mantener sobre el umbral)',
      descInhibit: 'Inhibición de amplitud en High Alpha (Meta: Mantener bajo el umbral)',
      role: 'reward'
    },
    low_alpha: {
      displayName: 'Low Alpha (8–10 Hz)',
      shortName: 'Low Alpha',
      rangeHz: '8–10 Hz',
      descReward: 'Refuerzo de amplitud en Low Alpha (Meta: Mantener sobre el umbral)',
      descInhibit: 'Inhibición de amplitud en Low Alpha (Meta: Mantener bajo el umbral)',
      role: 'reward'
    },
    alpha: {
      displayName: 'Alpha (8–12 Hz)',
      shortName: 'Alpha',
      rangeHz: '8–12 Hz',
      descReward: 'Refuerzo de amplitud en Alpha (Meta: Mantener sobre el umbral)',
      descInhibit: 'Inhibición de amplitud en Alpha (Meta: Mantener bajo el umbral)',
      role: 'reward'
    },
    high_beta: {
      displayName: 'High Beta (21–30 Hz)',
      shortName: 'High Beta',
      rangeHz: '21–30 Hz',
      descReward: 'Refuerzo de amplitud en High Beta (Meta: Mantener sobre el umbral)',
      descInhibit: 'Inhibición de amplitud en High Beta (Meta: Mantener bajo el umbral)',
      role: 'inhibit'
    },
    beta: {
      displayName: 'Beta (15–20 Hz)',
      shortName: 'Beta',
      rangeHz: '15–20 Hz',
      descReward: 'Refuerzo de amplitud en Beta (Meta: Mantener sobre el umbral)',
      descInhibit: 'Inhibición de amplitud en Beta (Meta: Mantener bajo el umbral)',
      role: 'reward'
    },
    low_beta: {
      displayName: 'Low Beta / SMR (12–15 Hz)',
      shortName: 'Low Beta (SMR)',
      rangeHz: '12–15 Hz',
      descReward: 'Refuerzo de amplitud en Low Beta / SMR (Meta: Mantener sobre el umbral)',
      descInhibit: 'Inhibición de amplitud en Low Beta / SMR (Meta: Mantener bajo el umbral)',
      role: 'reward'
    },
    theta: {
      displayName: 'Theta (4–8 Hz)',
      shortName: 'Theta',
      rangeHz: '4–8 Hz',
      descReward: 'Refuerzo de amplitud en Theta (Meta: Mantener sobre el umbral)',
      descInhibit: 'Inhibición de amplitud en Theta (Meta: Mantener bajo el umbral)',
      role: 'reward'
    },
    delta: {
      displayName: 'Delta (1–4 Hz)',
      shortName: 'Delta',
      rangeHz: '1–4 Hz',
      descReward: 'Refuerzo de amplitud en Delta (Meta: Mantener sobre el umbral)',
      descInhibit: 'Inhibición de amplitud en Delta (Meta: Mantener bajo el umbral)',
      role: 'inhibit'
    }
  };

  // Paleta del Boceto (Preferida por la supervisora)
  const PALETTES = {
    weather: {
      sun: { main: '#FACC15', light: '#FDE047', bg: 'rgba(250, 204, 21, 0.15)', border: 'rgba(250, 204, 21, 0.42)' },
      cloud: { main: '#38BDF8', light: '#7DD3FC', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.42)' },
      storm: { main: '#64748B', light: '#94A3B8', bg: 'rgba(100, 116, 139, 0.18)', border: 'rgba(148, 163, 184, 0.38)' }
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

  // Conmutador entre Resumen General y Análisis Avanzado (Bajo Demanda)
  function setupSectionViewSwitcher() {
    const switchBtns = document.querySelectorAll('.section-switch-btn');
    switchBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = btn.getAttribute('data-section') || 'draft';
        setSectionView(sec);
      });
    });

    const bottomToggleBtn = document.getElementById('btn-toggle-advanced-analysis');
    if (bottomToggleBtn) {
      bottomToggleBtn.addEventListener('click', () => {
        const nextView = currentSectionView === 'advanced' ? 'draft' : 'advanced';
        setSectionView(nextView);
      });
    }
  }

  function setSectionView(viewMode) {
    currentSectionView = viewMode;
    const switchBtns = document.querySelectorAll('.section-switch-btn');
    switchBtns.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-section') === viewMode);
    });
    applySectionVisibility();
  }

  function applySectionVisibility() {
    if (!rawData.length) return;
    const draftSec = document.getElementById('draft-summary-section');
    const advancedSec = document.getElementById('clinical-section-wrapper');
    const bottomBtnText = document.getElementById('advanced-btn-toggle-text');
    const bottomBtnChevron = document.querySelector('.advanced-btn-chevron');

    if (currentSectionView === 'advanced') {
      if (draftSec) draftSec.style.display = 'none';
      if (advancedSec) advancedSec.style.display = 'flex';
      if (bottomBtnText) bottomBtnText.textContent = 'Ocultar Análisis Técnico (Volver al Resumen)';
      if (bottomBtnChevron) bottomBtnChevron.style.transform = 'rotate(180deg)';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Por defecto: solo Resumen General habilitado
      if (draftSec) draftSec.style.display = 'block';
      if (advancedSec) advancedSec.style.display = 'none';
      if (bottomBtnText) bottomBtnText.textContent = 'Ver Análisis Técnico Avanzado (Curvas por banda y umbrales)';
      if (bottomBtnChevron) bottomBtnChevron.style.transform = 'rotate(0deg)';
    }

    setTimeout(() => {
      resizeCanvas();
      renderCurrentBand();
      renderDraftSummary();
    }, 50);
  }

  function setupDraftControls() {
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
        alert(`✅ Resumen de la Sesión #${metadata.session_id} confirmado.\nTiempo en tu Zona Objetivo (Muy bien + Bien): ${document.getElementById('pie-total-focus-val')?.textContent || '--'}`);
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
        alert('Por favor selecciona o carga una sesión primero.');
        return;
      }
      alert(`✅ ¡Felicidades por completar la revisión de tu Sesión #${metadata.session_id}!`);
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
    document.getElementById('protocol-badge').textContent = 'Resumen de tu Entrenamiento';
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
      statusBadge.innerHTML = '<span class="pulse-dot"></span> Sesión Completada';
    }

    applySectionVisibility();
  }

  function loadPresetSession(presetId) {
    document.querySelectorAll('.preset-pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-preset') === presetId);
    });

    if (window.SESSION_PRESETS && window.SESSION_PRESETS[presetId]) {
      const preset = window.SESSION_PRESETS[presetId];
      metadata = JSON.parse(JSON.stringify(preset.meta));
      parseCSV(preset.csv, metadata);
      return;
    }

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
            alert('✅ Información de sesión cargada. Ahora selecciona el archivo .csv.');
          }
        } catch (err) {
          alert('No se pudo leer el archivo JSON: ' + err.message);
        }
      };
      reader.readAsText(jsonFile);
      return;
    }

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
      shortName: bandKey,
      rangeHz: '',
      descReward: `Refuerzo de amplitud en ${bandKey} (Meta: Mantener sobre el umbral)`,
      descInhibit: `Inhibición de amplitud en ${bandKey} (Meta: Mantener bajo el umbral)`,
      role: actualRole || 'reward'
    };
    const role = actualRole || base.role || 'reward';
    const desc = role === 'reward' ? base.descReward : base.descInhibit;
    const humanSkill = `la modulación de ${base.shortName || base.displayName}`;

    return {
      displayName: base.displayName,
      shortName: base.shortName || base.displayName,
      rangeHz: base.rangeHz || '',
      humanSkill,
      desc,
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
      alert('El CSV debe incluir al menos las columnas: t_s, band, value');
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
      return 'Protocolo Theta / Low Alpha';
    }
    if (bands.includes('low_beta')) {
      return 'Protocolo SMR / Beta';
    }
    if (bands.includes('high_alpha') && bands.includes('low_alpha')) {
      return 'Protocolo Alpha Dual (Low & High)';
    }
    if (bands.includes('low_alpha') || bands.includes('alpha')) {
      return 'Protocolo Alpha Feedback';
    }
    return 'Protocolo EEG Multibanda';
  }

  function updateHeaderFromMetadata() {
    const firstRow = rawData[0] || {};
    const sessId = metadata.session_id || firstRow.session_id || '001';
    const displayId = String(sessId) === 'sim-001' ? '003' : sessId;
    const userSuffix = metadata.usuario_id
      ? ` · Usuario ${metadata.usuario_id}`
      : (String(sessId) === 'sim-001' ? ' · Demo Boceto' : '');
    document.getElementById('session-id-display').textContent = `Sesión #${displayId}${userSuffix}`;

    const protocolBadge = document.getElementById('protocol-badge');
    if (protocolBadge) {
      const pName = metadata.protocol_name || inferProtocolName(availableBands);
      protocolBadge.textContent = `Protocolo: ${pName}`;
    }

    // Barra de progreso de sesiones (ej. 5 / 20)
    const numMatch = String(displayId).match(/\d+/);
    const sessNum = numMatch ? parseInt(numMatch[0], 10) : 3;
    const pctProgress = Math.min(100, Math.max(5, (sessNum / TOTAL_PROGRAM_SESSIONS) * 100));
    const fillEl = document.getElementById('session-progress-fill');
    const curEl = document.getElementById('session-progress-current');
    if (fillEl) fillEl.style.width = `${pctProgress}%`;
    if (curEl) curEl.textContent = String(sessNum);

    // Duración de la sesión
    const uniqueSeconds = new Set(rawData.map(r => r.t_s)).size;
    const durationSec = metadata.duration_s || uniqueSeconds;
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationFormatted = mins > 0
      ? `${mins} min ${secs > 0 ? secs + ' s' : ''}`
      : `${durationSec} s`;
    const durationEl = document.getElementById('quick-duration');
    if (durationEl) durationEl.textContent = durationFormatted;

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

    // Protocolo amigable
    if (protocolBadge) {
      const protoName = metadata.protocol_name || inferProtocolName(availableBands);
      protocolBadge.textContent = `Entrenamiento: ${protoName}`;
    }

    const electrodesText = document.getElementById('device-electrodes-text');
    if (electrodesText) {
      electrodesText.textContent = 'Diadema Muse 2 · Resumen del Cliente';
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
  // MOTOR DE RESUMEN DE PASTEL (BOCETO CON "MUY BIEN / BIEN / FUERA DE ZONA")
  // =========================================================================
  function renderDraftSummary() {
    if (!rawData.length) return;

    const dist = computePieDistribution();
    lastPieSlices = dist.slices;

    const pal = PALETTES.weather;
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

    // Subtítulos claros sin jerga
    const sunSub = document.getElementById('weather-sun-sub');
    const cloudSub = document.getElementById('weather-cloud-sub');
    const stormSub = document.getElementById('weather-storm-sub');
    if (pieCalcMode === 'synergy' && pieScope === 'all') {
      if (sunSub) sunSub.textContent = 'Todas las habilidades en meta al mismo tiempo';
      if (cloudSub) cloudSub.textContent = 'Al menos una habilidad dentro de la meta';
      if (stormSub) stormSub.textContent = 'Momentos fuera de la zona objetivo';
    } else {
      if (sunSub) sunSub.textContent = 'Superaste tu zona objetivo con holgura';
      if (cloudSub) cloudSub.textContent = 'Te mantuviste dentro de tu zona objetivo';
      if (stormSub) stormSub.textContent = 'Momentos de distracción o tensión';
    }

    // Tiempo total en Zona Objetivo (Muy bien + Bien)
    const focusedPct = dist.sunPct + dist.cloudPct;
    const focusValEl = document.getElementById('pie-total-focus-val');
    if (focusValEl) focusValEl.textContent = `${focusedPct}%`;

    // Score de sesión (0-100) y su explicación paso a paso
    const sessionScore = dist.sessionScore;
    const pastInfo = computePastSessionScore(sessionScore);
    const curScoreEl = document.getElementById('draft-score-current');
    const pastScoreEl = document.getElementById('draft-score-past');
    const pastLabelEl = document.getElementById('draft-score-past-label');
    const deltaEl = document.getElementById('draft-score-delta');
    const formulaTextEl = document.getElementById('score-formula-text');

    if (curScoreEl) curScoreEl.textContent = String(sessionScore);
    if (pastScoreEl) {
      pastScoreEl.textContent = pastInfo.hasPrev && pastInfo.score !== null ? String(pastInfo.score) : '--';
    }
    if (pastLabelEl) pastLabelEl.textContent = pastInfo.label;
    if (deltaEl) {
      if (pastInfo.hasPrev && pastInfo.score !== null) {
        const diff = sessionScore - pastInfo.score;
        deltaEl.textContent = `${diff >= 0 ? '+' : ''}${diff} pts vs anterior`;
        deltaEl.className = `score-delta-pill ${diff >= 0 ? 'positive' : 'negative'}`;
      } else {
        deltaEl.textContent = 'Línea base inicial';
        deltaEl.className = 'score-delta-pill neutral';
      }
    }
    if (formulaTextEl) {
      const compNote = pastInfo.hasPrev && pastInfo.score !== null
        ? ` Comparado con la anterior (${pastInfo.score} pts), tuviste un cambio de <strong>${sessionScore - pastInfo.score >= 0 ? '+' : ''}${sessionScore - pastInfo.score} pts</strong>.`
        : ' Esta es la sesión de referencia inicial para medir tus próximos progresos.';
      formulaTextEl.innerHTML = `<strong>¿De dónde sale tu ${sessionScore}/100?</strong> Combina tu tiempo en Zona Objetivo (<strong>${focusedPct}% en Muy bien + Bien</strong>) con puntos por constancia mental.${compNote}`;
    }

    renderBandContributionList(pal);
    updateThrivingBadge(focusedPct, sessionScore, dist);
    updateNarrativeBanner(dist, focusedPct);
    drawPieChart(dist.slices);
  }

  function computePieDistribution() {
    const pal = PALETTES.weather;
    let rawSun = 0;
    let rawCloud = 0;
    let rawStorm = 0;
    let totalCount = 0;

    if (pieScope !== 'all') {
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

    let sunPct = Math.round(rawSun);
    let cloudPct = Math.round(rawCloud);
    let stormPct = Math.max(0, 100 - sunPct - cloudPct);

    const avgZonePct = availableBands.reduce((acc, b) => acc + (allBandsMetrics[b]?.totalZonePct || 0), 0) / (availableBands.length || 1);
    const avgDeepPct = availableBands.reduce((acc, b) => acc + (allBandsMetrics[b]?.deepZonePct || 0), 0) / (availableBands.length || 1);
    const avgMaxStreak = availableBands.reduce((acc, b) => acc + (allBandsMetrics[b]?.maxStreak || 0), 0) / (availableBands.length || 1);

    const rawScore = Math.min(99, Math.round(28 + (avgZonePct * 0.65) + (avgDeepPct * 0.45) + Math.min(12, avgMaxStreak * 0.4)));

    const slices = [
      {
        id: 'sun',
        label: 'Muy bien',
        shortLabel: 'Muy bien',
        pct: sunPct,
        color: pal.sun.main,
        lightColor: pal.sun.light,
        desc: 'Superaste tu zona objetivo con holgura (estado óptimo)'
      },
      {
        id: 'cloud',
        label: 'Bien',
        shortLabel: 'Bien',
        pct: cloudPct,
        color: pal.cloud.main,
        lightColor: pal.cloud.light,
        desc: 'Lograste mantenerte dentro de tu zona objetivo'
      },
      {
        id: 'storm',
        label: 'Fuera de zona',
        shortLabel: 'Fuera de zona',
        pct: stormPct,
        color: pal.storm.main,
        lightColor: pal.storm.light,
        desc: 'Momentos en que tu mente salió de la zona meta'
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

  // Historial dinámico de scores calculados para que las comparativas siempre coincidan
  const sessionScoreHistory = {};

  function getCalculatedScoreForPreset(presetKey) {
    if (sessionScoreHistory[presetKey] !== undefined) {
      return sessionScoreHistory[presetKey];
    }
    if (!window.SESSION_PRESETS || !window.SESSION_PRESETS[presetKey]) {
      return null;
    }
    try {
      const preset = window.SESSION_PRESETS[presetKey];
      const lines = preset.csv.trim().split(/\r?\n/);
      const rawHeaders = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const col = {};
      rawHeaders.forEach((h, idx) => { col[h] = idx; });

      const parsedRows = [];
      for (let i = 1; i < lines.length; i++) {
        const lineStr = lines[i].trim();
        if (!lineStr) continue;
        const parts = lineStr.split(',');
        if (parts.length < rawHeaders.length) continue;
        const tsRaw = parts[col['t_s']] !== undefined ? parts[col['t_s']].trim().replace(/['"]/g, '') : '';
        const tsVal = tsRaw !== '' ? parseInt(tsRaw, 10) : i - 1;
        const bandVal = parts[col['band']]?.trim().replace(/['"]/g, '');
        if (!bandVal || isNaN(tsVal)) continue;

        const rawVal = parts[col['value']]?.trim().replace(/['"]/g, '');
        const rawThresh = col['threshold'] !== undefined ? parts[col['threshold']]?.trim().replace(/['"]/g, '') : '';
        const rawValid = col['valid'] !== undefined ? parts[col['valid']]?.trim().replace(/['"]/g, '') : '1';
        const rawRole = col['role'] !== undefined ? parts[col['role']]?.trim().toLowerCase().replace(/['"]/g, '') : null;

        parsedRows.push({
          t_s: tsVal,
          band: bandVal,
          role: rawRole || (BAND_CONFIG[bandVal]?.role || 'reward'),
          value: rawVal !== '' && rawVal !== undefined ? parseFloat(rawVal) : null,
          valid: rawValid !== '' && rawValid !== undefined ? parseInt(rawValid, 10) : 1,
          threshold: rawThresh !== '' && rawThresh !== undefined ? parseFloat(rawThresh) : null
        });
      }

      const bands = [...new Set(parsedRows.map(r => r.band))];
      const bMetrics = {};
      bands.forEach(b => {
        const bRows = parsedRows.filter(r => r.band === b);
        const role = bRows[0]?.role || 'reward';
        bMetrics[b] = computeMetrics(bRows, role);
      });

      const avgZone = bands.reduce((acc, b) => acc + (bMetrics[b]?.totalZonePct || 0), 0) / (bands.length || 1);
      const avgDeep = bands.reduce((acc, b) => acc + (bMetrics[b]?.deepZonePct || 0), 0) / (bands.length || 1);
      const avgStreak = bands.reduce((acc, b) => acc + (bMetrics[b]?.maxStreak || 0), 0) / (bands.length || 1);
      const score = Math.min(99, Math.round(28 + (avgZone * 0.65) + (avgDeep * 0.45) + Math.min(12, avgStreak * 0.4)));

      sessionScoreHistory[presetKey] = score;
      return score;
    } catch (e) {
      console.warn('Error calculando score para preset', presetKey, e);
      return null;
    }
  }

  function computePastSessionScore(currentScore) {
    const sessId = String(metadata.session_id || '');
    const userId = String(metadata.usuario_id || '');

    // Registrar el score actual en memoria
    if (sessId) {
      sessionScoreHistory[sessId] = currentScore;
    }

    // Sesión #011: Pertenece al Usuario 003. Su sesión anterior real es la #005 (del mismo Usuario 003)
    if (sessId === '011') {
      const prevScore = getCalculatedScoreForPreset('005');
      return {
        score: prevScore !== null ? prevScore : 58,
        hasPrev: true,
        label: 'Sesión #005 previa (Usuario 003)'
      };
    }

    // Sesión #005: Pertenece al Usuario 003. Es la primera sesión registrada en este conjunto para Usuario 003
    if (sessId === '005') {
      return {
        score: null,
        hasPrev: false,
        label: 'Sesión inicial (Usuario 003)'
      };
    }

    // Sesión #004: Pertenece al Usuario 001 (distinto usuario). Es su sesión inicial registrada
    if (sessId === '004') {
      return {
        score: null,
        hasPrev: false,
        label: 'Sesión inicial (Usuario 001)'
      };
    }

    // Sesión demostrativa #003 (sim-001): Ilustrada en el boceto original
    if (sessId === 'sim-001') {
      return {
        score: 72,
        hasPrev: true,
        label: 'Sesión #002 previa (Boceto)'
      };
    }

    return {
      score: null,
      hasPrev: false,
      label: 'Sesión de referencia'
    };
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
      row.title = `Clic para ver el detalle de ${cfg.displayName}`;
      row.innerHTML = `
        <div class="band-contrib-top">
          <span>${cfg.displayName}</span>
          <strong style="color:${pal.cloud.light}">${Math.round(m.totalZonePct)}% en zona</strong>
        </div>
        <div class="band-contrib-bar">
          <div class="band-contrib-seg" style="width:${bSun}%; background:${pal.sun.main}"></div>
          <div class="band-contrib-seg" style="width:${bCloud}%; background:${pal.cloud.main}"></div>
          <div class="band-contrib-seg" style="width:${bStorm}%; background:${pal.storm.main}; opacity:0.45"></div>
        </div>
      `;
      row.addEventListener('click', () => {
        currentBand = bKey;
        renderBandTabs();
        renderCurrentBand();
      });
      listEl.appendChild(row);
    });
  }

  // =========================================================================
  // ARQUITECTURA DE INFERENCIA PREDICTIVA Y CONEXIÓN A BASE DE DATOS / API
  // =========================================================================
  const INFERENCE_CONFIG = {
    // Cuando el equipo de backend tenga el endpoint listo, colocar la URL aquí:
    // ej. 'https://api.tu-servidor.com/v1/neurofeedback/predict-state'
    endpoint: null,
    timeoutMs: 3000,
    modelName: 'EEG-State-Predictor v1.0',
    useLocalFallback: true
  };

  /**
   * Extrae el vector de características (Feature Vector) de la sesión procesada.
   * Este payload es el que se enviará a la base de datos y al modelo de ML.
   */
  function extractSessionFeatures(meta, rawRows, bandsMetrics, pieDist) {
    const validRows = rawRows.filter(r => r.valid === 1);
    const bandsPayload = {};
    
    Object.keys(bandsMetrics).forEach(bKey => {
      const m = bandsMetrics[bKey];
      const bRows = validRows.filter(r => r.band === bKey && r.value !== null);
      const vals = bRows.map(r => r.value);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      
      bandsPayload[bKey] = {
        role: m.role || 'reward',
        in_zone_pct: m.totalZonePct,
        deep_zone_pct: m.deepZonePct,
        max_streak_s: m.maxStreak,
        mean_uV: parseFloat(mean.toFixed(3)),
        total_valid_s: m.totalValid
      };
    });

    return {
      session_id: meta.session_id || 'unknown',
      usuario_id: meta.usuario_id || 'unknown',
      protocol_name: meta.protocol_name || 'unknown',
      duration_s: meta.duration_s || 0,
      valid_pct: meta.valid_pct || (rawRows.length ? (validRows.length / rawRows.length) * 100 : 0),
      session_score: pieDist ? pieDist.sessionScore : 0,
      in_zone_total_pct: pieDist ? (pieDist.sunPct + pieDist.cloudPct) : 0,
      muy_bien_pct: pieDist ? pieDist.sunPct : 0,
      bien_pct: pieDist ? pieDist.cloudPct : 0,
      fuera_zona_pct: pieDist ? pieDist.stormPct : 0,
      bands: bandsPayload,
      timestamp: new Date().toISOString()
    };
  }

  async function predictSessionState(featureVector) {
    // Si hay un endpoint remoto configurado en el backend
    if (INFERENCE_CONFIG.endpoint) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), INFERENCE_CONFIG.timeoutMs);
        
        const response = await fetch(INFERENCE_CONFIG.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(featureVector),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const result = await response.json();
          return {
            tier: result.tier || 'focused', // 'thriving' | 'focused' | 'building'
            label: result.label || 'Mente Enfocada',
            subtitle: result.subtitle || '¡Enfoque Óptimo!',
            description: result.description || 'Predicción generada por el modelo de ML.',
            confidence: result.confidence || 0.9,
            source: 'remote_ml_model',
            sourceLabel: `Modelo ML (${result.model_version || INFERENCE_CONFIG.modelName})`
          };
        }
      } catch (err) {
        console.warn('[Inferencia ML] Endpoint no disponible o tiempo agotado. Usando fallback heurístico.', err);
      }
    }

    // Fallback Heurístico Local (utilizado mientras se integra el endpoint o en modo offline)
    const inZone = featureVector.in_zone_total_pct;
    let tier = 'building';
    let label = 'En Práctica';
    let subtitle = 'Etapa de Adaptación';
    let desc = 'Tu actividad neuronal se encuentra en fase de adaptación neuroplástica con el protocolo.';

    if (inZone >= 60) {
      tier = 'thriving';
      label = 'Thriving!';
      subtitle = '¡Dominio Sobresaliente!';
      desc = 'Excelente autorregulación: mantuviste los parámetros en zona la mayor parte del entrenamiento.';
    } else if (inZone >= 35) {
      tier = 'focused';
      label = 'Focused!';
      subtitle = '¡Mente Enfocada!';
      desc = 'Modulación constante con capacidad comprobada para sostener los parámetros objetivo.';
    }

    return {
      tier,
      label,
      subtitle,
      description: desc,
      confidence: parseFloat((0.80 + (inZone * 0.0015)).toFixed(2)),
      source: 'local_heuristic_fallback',
      sourceLabel: 'Inferencia: Motor Heurístico Local (Listo para API/BD)'
    };
  }

  async function updateThrivingBadge(focusedPct, sessionScore, dist) {
    const titleEl = document.getElementById('thriving-status-title');
    const subTitleEl = document.getElementById('thriving-status-subtitle');
    const descEl = document.getElementById('thriving-status-desc');
    const originTextEl = document.getElementById('thriving-origin-text');
    const badgeCard = document.getElementById('thriving-badge-card');
    const sourceLabelEl = document.getElementById('inference-source-label');
    const sourcePill = document.getElementById('inference-source-pill');

    const tierThriving = document.getElementById('tier-thriving');
    const tierFocused = document.getElementById('tier-focused');
    const tierBuilding = document.getElementById('tier-building');

    [tierThriving, tierFocused, tierBuilding].forEach(el => {
      if (el) el.classList.remove('active-tier');
    });

    if (!titleEl || !descEl) return;

    // Extraer vector de características y consultar el servicio de inferencia
    const features = extractSessionFeatures(metadata, rawData, allBandsMetrics, dist);
    const prediction = await predictSessionState(features);

    titleEl.textContent = prediction.label;
    if (subTitleEl) subTitleEl.textContent = prediction.subtitle;
    descEl.textContent = prediction.description;

    if (sourceLabelEl) {
      sourceLabelEl.textContent = prediction.sourceLabel;
    }
    if (sourcePill) {
      sourcePill.classList.toggle('connected', prediction.source === 'remote_ml_model');
    }

    if (prediction.tier === 'thriving') {
      titleEl.style.color = '#FACC15';
      if (badgeCard) badgeCard.style.borderColor = 'rgba(250, 204, 21, 0.45)';
      if (tierThriving) tierThriving.classList.add('active-tier');
    } else if (prediction.tier === 'focused') {
      titleEl.style.color = '#38BDF8';
      if (badgeCard) badgeCard.style.borderColor = 'rgba(56, 189, 248, 0.45)';
      if (tierFocused) tierFocused.classList.add('active-tier');
    } else {
      titleEl.style.color = '#94A3B8';
      if (badgeCard) badgeCard.style.borderColor = 'rgba(148, 163, 184, 0.4)';
      if (tierBuilding) tierBuilding.classList.add('active-tier');
    }

    if (originTextEl) {
      originTextEl.innerHTML = `Clasificación según tiempo en <strong>Zona Objetivo (${focusedPct}%)</strong> y modulación rítmica:`;
    }
  }

  // Comentario narrativo en lenguaje claro para el cliente (sin tecnicismos de bandas)
  function updateNarrativeBanner(dist, focusedPct) {
    const textEl = document.getElementById('draft-narrative-text');
    if (!textEl) return;

    let opening = '';
    if (focusedPct >= 60) {
      opening = `Durante la sesión de hoy mantuviste un nivel de enfoque y autorregulación muy sólido, permaneciendo el <strong>${focusedPct}%</strong> del tiempo dentro de tu zona objetivo.`;
    } else if (focusedPct >= 35) {
      opening = `Durante la sesión de hoy lograste conectar de manera constante con tu zona objetivo el <strong>${focusedPct}%</strong> del tiempo, respondiendo positivamente al entrenamiento.`;
    } else {
      opening = `En la sesión de hoy estuviste el <strong>${focusedPct}%</strong> del tiempo en zona objetivo, transitando una etapa natural de aprendizaje y adaptación.`;
    }

    let quality = '';
    if (dist.sunPct >= 12) {
      quality = ` Destacaste con un <strong>${dist.sunPct}%</strong> de tiempo en nivel óptimo (Muy bien), superando ampliamente los objetivos de la sesión.`;
    } else {
      quality = ` Mantuviste una respuesta estable y equilibrada a lo largo del ejercicio.`;
    }

    let closing = ' Cada sesión fortalece tu capacidad para entrar en zona con mayor facilidad.';

    textEl.innerHTML = `${opening}${quality}${closing}`;
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
    const radius = Math.min(w, h) * 0.32;

    let startAngle = -Math.PI / 2;

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

      pieCtx.save();
      pieCtx.beginPath();
      pieCtx.moveTo(ox, oy);
      pieCtx.arc(ox, oy, radius, startAngle, endAngle);
      pieCtx.closePath();

      pieCtx.fillStyle = slice.color;
      pieCtx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      pieCtx.shadowBlur = isHovered ? 16 : 8;
      pieCtx.fill();

      pieCtx.lineWidth = 2.5;
      pieCtx.strokeStyle = '#080D18';
      pieCtx.stroke();
      pieCtx.restore();

      // Etiqueta externa con porcentaje y nombre claro ("Muy bien", "Bien", "Fuera de zona")
      const labelDist = radius + 30;
      const lx = cx + Math.cos(midAngle) * labelDist;
      const ly = cy + Math.sin(midAngle) * labelDist;

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
      pieCtx.fillText(`${slice.pct}%`, lx, ly - 7);

      pieCtx.font = '600 11px "Plus Jakarta Sans", sans-serif';
      pieCtx.fillStyle = '#E2E8F0';
      pieCtx.fillText(slice.shortLabel, lx, ly + 8);

      startAngle = endAngle;
    });

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
    const radius = Math.min(rect.width, rect.height) * 0.32;

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
        <div style="margin-top:3px; color:#CBD5E1; font-size:0.69rem;">${s.desc}</div>
      `;
      let left = mx + 14;
      if (left + 195 > rect.width) left = mx - 200;
      let top = my - 30;
      if (top < 6) top = 8;
      pieTooltip.style.left = `${left}px`;
      pieTooltip.style.top = `${top}px`;
      pieTooltip.style.display = 'block';
    }
  }

  // =========================================================================
  // MOTOR DE GRÁFICO TEMPORAL CONTINUO Y MÉTRICAS EXPLICADAS
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
        <span class="role-badge">${cfg.role === 'reward' ? 'Meta: Aumentar ↑' : 'Meta: Disminuir ↓'}</span>
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

    bandRoleIndicator.textContent = actualRole === 'reward' ? 'Meta: Aumentar' : 'Meta: Calmar';
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

    // Rachas continuas (uniendo a través de muestras válidas consecutivas)
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
    document.getElementById('metric-total-zone-sub').textContent = `${m.zoneSeconds} seg dentro de tu zona objetivo`;

    document.getElementById('metric-deep-zone').textContent = `${Math.round(m.deepZonePct)}%`;
    document.getElementById('metric-deep-zone-sub').textContent = `${m.deepZoneSeconds} seg en nivel «Muy bien»`;

    document.getElementById('metric-feedback-score').textContent = `${m.feedbackScore} pts`;
    document.getElementById('metric-feedback-score-sub').textContent = 'Puntos por mantenerte en meta';

    document.getElementById('metric-avg-streaks').textContent = `${m.avgStreak.toFixed(1)} seg`;
    document.getElementById('metric-avg-streaks-sub').textContent = `En ${m.streaksCount} entradas a la zona`;

    document.getElementById('metric-max-streaks').textContent = `${m.maxStreak} seg`;
    document.getElementById('metric-max-streaks-sub').textContent = 'Tiempo continuo sin salir de zona';

    document.getElementById('metric-xp').textContent = `+${m.xp} pts`;
    document.getElementById('metric-xp-sub').textContent = 'Sumados a tu progreso';

    // Ritmo durante la sesión en lenguaje sencillo
    const isImproving = (cfg.role === 'reward' && m.slope > 0.0003) || (cfg.role === 'inhibit' && m.slope < -0.0003);
    const isTiring = (cfg.role === 'reward' && m.slope < -0.0003) || (cfg.role === 'inhibit' && m.slope > 0.0003);

    const trendEl = document.getElementById('clinical-trend');
    const trendDescEl = document.getElementById('clinical-trend-desc');
    if (trendEl) {
      if (isImproving) {
        trendEl.textContent = '📈 De menos a más';
        if (trendDescEl) trendDescEl.textContent = 'Terminaste aún mejor que al inicio';
      } else if (isTiring) {
        trendEl.textContent = '🌱 Mejor al inicio';
        if (trendDescEl) trendDescEl.textContent = 'Sentiste algo de cansancio al final';
      } else {
        trendEl.textContent = '➡️ Ritmo constante';
        if (trendDescEl) trendDescEl.textContent = 'Te mantuviste parejo toda la sesión';
      }
    }

    if (m.bestMin) {
      const bestEl = document.getElementById('clinical-best-min');
      if (bestEl) bestEl.textContent = `Minuto ${m.bestMin.minute} (${m.bestMin.pct}% en zona)`;
    }

    if (m.worstMin) {
      const worstEl = document.getElementById('clinical-worst-min');
      if (worstEl) worstEl.textContent = `Minuto ${m.worstMin.minute} (${m.worstMin.pct}% en zona)`;
    }

    const thresholds = [...new Set(rawData.filter(r => r.band === currentBand && r.threshold !== null && !isNaN(r.threshold)).map(r => r.threshold))];
    if (thresholds.length === 1) {
      threshValBadge.textContent = `${thresholds[0].toFixed(2)} µV`;
    } else if (thresholds.length > 1) {
      threshValBadge.textContent = `${thresholds[0].toFixed(2)} → ${thresholds[thresholds.length - 1].toFixed(2)} µV`;
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
          <div class="minute-bar-fill" style="width: ${m.pct}%; background: linear-gradient(90deg, #38BDF8, #FACC15);"></div>
        </div>
        <div class="minute-bar-label">
          <span>Min ${m.minute}</span>
          <strong>${m.pct}%</strong>
        </div>
      `;
      minutesGrid.appendChild(item);
    });
  }

  // GRÁFICA TEMPORAL CONTINUA (Une todos los puntos válidos de principio a fin sin cortes)
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

    // 1. Etapa de calibración inicial (solo si existe en la sesión)
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

      ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.font = '10px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Preparación inicial (${calibT}s)`, padding.left + 6, padding.top + 14);
    }

    // 2. Líneas de referencia de "Muy bien" y "Bien" con colores del Boceto
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

      if (segIdx > 0) {
        const prevSeg = threshSegments[segIdx - 1];
        const prevY = getY(prevSeg.threshold);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x1, prevY);
        ctx.lineTo(x1, yZone);
        ctx.stroke();
      }

      // Línea de "Muy bien" (Amarillo Sol)
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, yDeep);
      ctx.lineTo(x2, yDeep);
      ctx.stroke();

      // Línea de "Bien" (Celeste Nube)
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, yZone);
      ctx.lineTo(x2, yZone);
      ctx.stroke();

      if (seg.endT >= maxT - 5) {
        ctx.fillStyle = '#FDE047';
        ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('Muy bien', w - padding.right - 2, yDeep - 4);

        ctx.fillStyle = '#7DD3FC';
        ctx.fillText('Bien (Meta)', w - padding.right - 2, yZone - 4);
        ctx.textAlign = 'left';
      }
    });
    ctx.setLineDash([]);

    // 3. UNIÓN CONTINUA DE TODOS LOS PUNTOS VÁLIDOS DE LA SESIÓN
    const validPointsRows = sortedRows.filter(r => r.valid === 1 && r.value !== null && !isNaN(r.value));
    if (validPointsRows.length >= 2) {
      const points = validPointsRows.map(r => ({
        x: getX(r.t_s),
        y: getY(r.value),
        t: r.t_s,
        val: r.value,
        thresh: r.threshold,
        success: r.success,
        row: r
      }));

      // Relleno suave debajo de toda la curva continua
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
      fillGrad.addColorStop(0, 'rgba(250, 204, 21, 0.14)');
      fillGrad.addColorStop(0.45, 'rgba(56, 189, 248, 0.09)');
      fillGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // Trazo continuo coloreado con la paleta del Boceto (Muy bien = Amarillo, Bien = Celeste, Fuera de zona = Gris)
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];

        let strokeColor = '#94A3B8'; // Fuera de zona (Gris)
        if (p0.thresh !== null && !isNaN(p0.thresh)) {
          const isSuccess = evaluateRowSuccess(p0.row, role);
          const isDeep = evaluateRowDeep(p0.row, role);

          if (isDeep) strokeColor = '#FACC15';      // Muy bien (Amarillo)
          else if (isSuccess) strokeColor = '#38BDF8'; // Bien (Celeste)
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = w < 480 ? 2.0 : 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        const midX = (p0.x + p1.x) / 2;
        ctx.bezierCurveTo(midX, p0.y, midX, p1.y, p1.x, p1.y);
        ctx.stroke();
      }
    }

    // 4. Cursor Hover / Touch continuo
    if (hoverSecond !== null) {
      const hX = getX(hoverSecond);
      const interpRow = getInterpolatedRowAtSecond(sortedRows, hoverSecond);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hX, padding.top);
      ctx.lineTo(hX, padding.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      if (interpRow && interpRow.value !== null) {
        const hY = getY(interpRow.value);
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

  // Obtiene el valor en el segundo buscado o interpola suavemente entre los vecinos válidos más cercanos
  function getInterpolatedRowAtSecond(sortedRows, targetSecond) {
    const exact = sortedRows.find(r => r.t_s === targetSecond && r.valid === 1 && r.value !== null);
    if (exact) return exact;

    const validList = sortedRows.filter(r => r.valid === 1 && r.value !== null);
    if (!validList.length) return null;

    let prev = null;
    let next = null;
    for (let i = 0; i < validList.length; i++) {
      if (validList[i].t_s <= targetSecond) prev = validList[i];
      if (validList[i].t_s >= targetSecond && !next) next = validList[i];
    }

    if (prev && next && prev.t_s !== next.t_s) {
      const ratio = (targetSecond - prev.t_s) / (next.t_s - prev.t_s);
      const interpVal = prev.value + ratio * (next.value - prev.value);
      const thresh = prev.threshold ?? next.threshold;
      const role = prev.role || 'reward';
      return {
        t_s: targetSecond,
        value: interpVal,
        threshold: thresh,
        role,
        valid: 1,
        success: thresh !== null ? (role === 'reward' ? (interpVal > thresh ? 1 : 0) : (interpVal < thresh ? 1 : 0)) : null
      };
    }

    return prev || next;
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

    const sortedRows = [...bandRows].sort((a, b) => a.t_s - b.t_s);
    const row = getInterpolatedRowAtSecond(sortedRows, targetSecond);
    if (!row) return;

    renderCurrentBand(targetSecond);

    const mm = Math.floor(targetSecond / 60).toString().padStart(2, '0');
    const ss = (targetSecond % 60).toString().padStart(2, '0');
    tooltipTime.textContent = `Minuto ${mm}:${ss}`;

    tooltipVal.textContent = row.value !== null ? `${row.value.toFixed(2)} µV` : '--';
    tooltipThresh.textContent = row.threshold !== null ? `${row.threshold.toFixed(2)} µV` : 'Preparación';

    if (row.threshold === null || isNaN(row.threshold)) {
      tooltipState.textContent = 'Preparación inicial';
      tooltipState.className = 'tooltip-badge neutral';
    } else {
      const isSuccess = evaluateRowSuccess(row, row.role);
      const isDeep = evaluateRowDeep(row, row.role);

      if (isDeep) {
        tooltipState.textContent = 'Muy bien';
        tooltipState.className = 'tooltip-badge deep';
      } else if (isSuccess) {
        tooltipState.textContent = 'Bien (En zona)';
        tooltipState.className = 'tooltip-badge zone';
      } else {
        tooltipState.textContent = 'Fuera de zona';
        tooltipState.className = 'tooltip-badge neutral';
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
      alert('Por favor selecciona una sesión antes de descargar el resumen.');
      return;
    }

    const pieDist = computePieDistribution();
    const summary = {
      exported_at: new Date().toISOString(),
      metadata,
      global_pie_summary: {
        calc_mode: pieCalcMode,
        scope: pieScope,
        muy_bien_pct: pieDist.sunPct,
        bien_pct: pieDist.cloudPct,
        fuera_de_zona_pct: pieDist.stormPct,
        total_zona_objetivo_pct: pieDist.sunPct + pieDist.cloudPct,
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
