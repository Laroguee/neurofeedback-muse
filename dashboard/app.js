/**
 * Neurofeedback Session Summary Engine (Responsive Edition)
 * Soporta Escritorio, Tableta y Móvil con Touch y Canvas de Alta Resolución
 */

(function () {
  const DEEP_ZONE_FACTOR = 1.25;
  
  let rawData = [];
  let availableBands = [];
  let currentBand = 'low_beta';
  let invertAxisForInhibit = true;
  let currentMetrics = null;
  let metadata = window.DEFAULT_METADATA || {
    session_id: 'sim-001',
    protocol_name: 'Foco Clínico · SMR',
    device: 'Muse 2',
    channels: ['TP9', 'AF7', 'AF8', 'TP10'],
    sampling_rate: 256
  };

  const BAND_CONFIG = {
    low_beta: { displayName: 'Beta Baja (SMR)', freq: '12-15 Hz', desc: 'Foco sostenido y tranquilidad mental', role: 'reward' },
    theta: { displayName: 'Theta', freq: '4-8 Hz', desc: 'Inhibir somnolencia y mente errante', role: 'inhibit' },
    high_beta: { displayName: 'Beta Alta', freq: '20-30 Hz', desc: 'Inhibir tensión muscular y rumiación', role: 'inhibit' },
    alpha: { displayName: 'Alfa', freq: '8-12 Hz', desc: 'Relajación consciente y calma alerta', role: 'reward' },
    beta: { displayName: 'Beta', freq: '15-20 Hz', desc: 'Atención activa y procesamiento cognitivo', role: 'reward' },
    delta: { displayName: 'Delta', freq: '0.5-4 Hz', desc: 'Inhibir desconexión o somnolencia', role: 'inhibit' }
  };

  // Elementos DOM
  const canvas = document.getElementById('neuro-canvas');
  const ctx = canvas.getContext('2d');
  const canvasContainer = document.getElementById('canvas-container');
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
    setupEventListeners();
    setupDragAndDrop();
    setupResizeObserver();
    loadDefaultData();
  }

  // Selector de Modo de Vista (Desktop, Tablet, Mobile, Auto)
  function setupViewModeSwitcher() {
    const toggleBtns = document.querySelectorAll('.view-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        document.body.className = `mode-${mode}`;
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Redimensionar canvas tras cambio de layout
        setTimeout(() => {
          resizeCanvas();
          renderCurrentBand();
        }, 150);
      });
    });
  }

  function setupEventListeners() {
    invertAxisToggle.addEventListener('change', (e) => {
      invertAxisForInhibit = e.target.checked;
      renderCurrentBand();
    });

    // Puntero ratón en canvas
    canvas.addEventListener('mousemove', (e) => handlePointer(e.clientX, e.clientY));
    canvas.addEventListener('mouseleave', () => {
      canvasTooltip.style.display = 'none';
      renderCurrentBand();
    });

    // Soporte táctil para móviles y tabletas
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        handlePointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        handlePointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      canvasTooltip.style.display = 'none';
      renderCurrentBand();
    });

    // Carga de archivo CSV
    const fileInput = document.getElementById('csv-file-input');
    fileInput.addEventListener('change', handleFileUpload);

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
      alert(`✅ Sesión ${metadata.session_id} archivada correctamente.\nMétricas y tendencias sincronizadas.`);
    });
    document.getElementById('btn-export-summary').addEventListener('click', exportSummaryJSON);
  }

  function setupDragAndDrop() {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.body.style.opacity = '0.92';
    });

    window.addEventListener('dragleave', (e) => {
      if (e.clientX === 0 || e.clientY === 0) {
        document.body.style.opacity = '1';
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      document.body.style.opacity = '1';
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.toLowerCase().endsWith('.csv')) {
          const reader = new FileReader();
          reader.onload = (event) => parseCSV(event.target.result);
          reader.readAsText(file);
        } else {
          alert("Por favor arrastra un archivo con extensión .csv");
        }
      }
    });
  }

  function setupResizeObserver() {
    if (window.ResizeObserver && canvasContainer) {
      const ro = new ResizeObserver(() => {
        resizeCanvas();
        renderCurrentBand();
      });
      ro.observe(canvasContainer);
    } else {
      window.addEventListener('resize', () => {
        resizeCanvas();
        renderCurrentBand();
      });
    }
  }

  function loadDefaultData() {
    if (window.DEFAULT_CSV_RAW) {
      parseCSV(window.DEFAULT_CSV_RAW);
    } else {
      fetch('../data/sesion_simulada.csv')
        .then(res => res.text())
        .then(csv => parseCSV(csv))
        .catch(err => console.error("Error al cargar CSV:", err));
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      parseCSV(event.target.result);
      e.target.value = ''; // Permite recargar el mismo archivo si se modifica
    };
    reader.readAsText(file);
  }

  function parseCSV(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {
      alert("El archivo CSV no contiene suficientes datos.");
      return;
    }
    
    // Mapeo dinámico de encabezados insensible a mayúsculas y espacios
    const rawHeaders = lines[0].split(',').map(h => h.trim().toLowerCase());
    const col = {};
    rawHeaders.forEach((h, idx) => {
      col[h] = idx;
    });

    // Validar columnas esenciales
    const hasRequired = ['t_s', 'band', 'value'].every(key => key in col);
    if (!hasRequired) {
      alert("El CSV debe incluir al menos las columnas: t_s, band, value");
      return;
    }

    const parsed = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < rawHeaders.length) continue;
      
      const tsVal = parts[col['t_s']] !== undefined ? parseInt(parts[col['t_s']]) : i - 1;
      const bandVal = parts[col['band']]?.trim();
      if (!bandVal || isNaN(tsVal)) continue;

      const rawVal = parts[col['value']]?.trim();
      const rawThresh = col['threshold'] !== undefined ? parts[col['threshold']]?.trim() : '';
      const rawSuccess = col['success'] !== undefined ? parts[col['success']]?.trim() : '';
      const rawValid = col['valid'] !== undefined ? parts[col['valid']]?.trim() : '1';
      const rawRole = col['role'] !== undefined ? parts[col['role']]?.trim().toLowerCase() : null;

      parsed.push({
        session_id: (col['session_id'] !== undefined ? parts[col['session_id']]?.trim() : '') || 'sesion',
        t_s: tsVal,
        timestamp: (col['timestamp'] !== undefined ? parts[col['timestamp']]?.trim() : '') || '',
        band: bandVal,
        role: rawRole || (BAND_CONFIG[bandVal]?.role || 'reward'),
        value: rawVal !== '' && rawVal !== undefined ? parseFloat(rawVal) : null,
        valid: rawValid !== '' && rawValid !== undefined ? parseInt(rawValid) : 1,
        threshold: rawThresh !== '' && rawThresh !== undefined ? parseFloat(rawThresh) : null,
        success: rawSuccess !== '' && rawSuccess !== undefined ? parseInt(rawSuccess) : null
      });
    }

    if (!parsed.length) {
      alert("No se pudieron extraer filas válidas del CSV.");
      return;
    }

    rawData = parsed;
    availableBands = [...new Set(parsed.map(r => r.band))];

    if (parsed[0]?.session_id) {
      document.getElementById('session-id-display').textContent = `Sesión ${parsed[0].session_id}`;
    }

    // Si la banda actual no está en el nuevo CSV, seleccionamos la primera disponible
    if (!availableBands.includes(currentBand)) {
      currentBand = availableBands[0];
    }

    renderBandTabs();
    resizeCanvas();
    renderCurrentBand();
  }

  function renderBandTabs() {
    bandNav.innerHTML = '';
    availableBands.forEach(bandKey => {
      const cfg = BAND_CONFIG[bandKey] || { displayName: bandKey, role: 'reward' };
      const btn = document.createElement('button');
      btn.className = `band-tab ${cfg.role} ${bandKey === currentBand ? 'active' : ''}`;
      btn.innerHTML = `
        <span>${cfg.displayName}</span>
        <span class="role-badge">${cfg.role === 'reward' ? 'Reforzar' : 'Inhibir'}</span>
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

    const cfg = BAND_CONFIG[currentBand] || { displayName: currentBand, role: bandRows[0].role, desc: '' };
    
    bandRoleIndicator.textContent = cfg.role.toUpperCase();
    bandRoleIndicator.className = `role-pill ${cfg.role}`;
    bandDescriptionText.textContent = `${cfg.displayName} · ${cfg.desc}`;

    currentMetrics = computeMetrics(bandRows, cfg.role);
    updateMetricsUI(currentMetrics, cfg);
    renderMinutesBreakdown(currentMetrics.minutes);

    drawChart(bandRows, cfg.role, currentMetrics, hoverSecond);
  }

  function computeMetrics(rows, role) {
    const validWithThresh = rows.filter(r => r.valid === 1 && r.threshold !== null && !isNaN(r.threshold));
    const totalValid = validWithThresh.length;
    const artifacts = rows.filter(r => r.valid === 0).length;
    const calibrationSeconds = rows.filter(r => r.threshold === null).length;

    let zoneSeconds = 0;
    let deepZoneSeconds = 0;

    validWithThresh.forEach(r => {
      const isSuccess = role === 'reward' ? (r.value >= r.threshold) : (r.value <= r.threshold);
      if (isSuccess) zoneSeconds++;

      const isDeep = role === 'reward'
        ? (r.value >= r.threshold * DEEP_ZONE_FACTOR)
        : (r.value <= r.threshold / DEEP_ZONE_FACTOR);
      if (isDeep) deepZoneSeconds++;
    });

    const totalZonePct = totalValid > 0 ? (zoneSeconds / totalValid) * 100 : 0;
    const deepZonePct = totalValid > 0 ? (deepZoneSeconds / totalValid) * 100 : 0;

    // Rachas
    const streaks = [];
    let currentStreak = 0;
    const maxT = Math.max(...rows.map(r => r.t_s));
    for (let t = 0; t <= maxT; t++) {
      const row = rows.find(r => r.t_s === t);
      if (row && row.valid === 1 && row.threshold !== null) {
        const isSuccess = role === 'reward' ? (row.value >= row.threshold) : (row.value <= row.threshold);
        if (isSuccess) currentStreak++;
        else {
          if (currentStreak > 0) streaks.push(currentStreak);
          currentStreak = 0;
        }
      } else {
        if (currentStreak > 0) streaks.push(currentStreak);
        currentStreak = 0;
      }
    }
    if (currentStreak > 0) streaks.push(currentStreak);

    const avgStreak = streaks.length > 0 ? (streaks.reduce((a, b) => a + b, 0) / streaks.length) : 0;
    const maxStreak = streaks.length > 0 ? Math.max(...streaks) : 0;

    let feedbackScore = (zoneSeconds * 1) + (deepZoneSeconds * 2);
    streaks.forEach(s => {
      if (s >= 10) feedbackScore += Math.floor(s * 1.5);
    });
    const xp = Math.round(feedbackScore * 0.45);

    // Minuto a Minuto
    const minutes = [0, 1, 2, 3, 4].map(minIdx => {
      const minStart = minIdx * 60;
      const minEnd = minStart + 59;
      const minRows = validWithThresh.filter(r => r.t_s >= minStart && r.t_s <= minEnd);
      const minSuccess = minRows.filter(r => role === 'reward' ? r.value >= r.threshold : r.value <= r.threshold).length;
      const pct = minRows.length > 0 ? (minSuccess / minRows.length) * 100 : 0;
      return { minute: minIdx + 1, pct: Math.round(pct), count: minRows.length };
    });

    const activeMinutes = minutes.filter(m => m.count > 10);
    let bestMin = activeMinutes[0];
    let worstMin = activeMinutes[0];
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
    document.getElementById('metric-feedback-score-sub').textContent = `Estabilidad sostenida`;

    document.getElementById('metric-avg-streaks').textContent = `${m.avgStreak.toFixed(1)} sec`;
    document.getElementById('metric-avg-streaks-sub').textContent = `${m.streaksCount} rachas continuas`;

    document.getElementById('metric-max-streaks').textContent = `${m.maxStreak} sec`;
    document.getElementById('metric-max-streaks-sub').textContent = `Concentración continua`;

    document.getElementById('metric-xp').textContent = `${m.xp}`;
    document.getElementById('metric-xp-sub').textContent = `Gamificación`;

    const trendText = m.slope > 0.0003 
      ? (cfg.role === 'reward' ? '📈 Ascenso (+Foco)' : '📉 Descenso (+Esfuerzo)')
      : (m.slope < -0.0003 
          ? (cfg.role === 'inhibit' ? '📈 Inhibición Exitosa' : '📉 Fatiga Cognitiva')
          : '➡️ Estable');
    document.getElementById('clinical-trend').textContent = trendText;

    if (m.bestMin) {
      document.getElementById('clinical-best-min').textContent = `Min ${m.bestMin.minute} (${m.bestMin.pct}%)`;
    }
    document.getElementById('clinical-artifacts').textContent = `${m.artifacts}s (${((m.artifacts/300)*100).toFixed(1)}%)`;

    const thresholds = [...new Set(rawData.filter(r => r.band === currentBand && r.threshold !== null).map(r => r.threshold))];
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

    const maxT = Math.max(...rows.map(r => r.t_s), 299);
    
    const validValues = rows.filter(r => r.valid === 1 && r.value !== null).map(r => r.value);
    const validThresh = rows.filter(r => r.threshold !== null).map(r => r.threshold);
    const allKeyValues = [...validValues, ...validThresh];
    
    let rawMinY = Math.min(...allKeyValues);
    let rawMaxY = Math.max(...allKeyValues);
    const yMargin = (rawMaxY - rawMinY) * 0.18;
    rawMinY = Math.max(0, rawMinY - yMargin);
    rawMaxY = rawMaxY + yMargin;

    const shouldInvert = (role === 'inhibit' && invertAxisForInhibit);

    function getX(t) {
      return padding.left + (t / maxT) * chartW;
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

    // 1. Calibración
    const calibT = metrics.calibrationSeconds || 31;
    const calibX = getX(calibT);
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
    ctx.fillText('Calibración (30s)', padding.left + 6, padding.top + 14);

    // 2. Umbrales dinámicos escalonados
    const threshSegments = [];
    let curThresh = null;
    let segStart = 0;

    for (let t = 0; t <= maxT; t++) {
      const r = rows.find(row => row.t_s === t);
      const th = r ? r.threshold : null;
      if (th !== curThresh) {
        if (curThresh !== null) {
          threshSegments.push({ startT: segStart, endT: t, threshold: curThresh });
        }
        curThresh = th;
        segStart = t;
      }
    }
    if (curThresh !== null) {
      threshSegments.push({ startT: segStart, endT: maxT, threshold: curThresh });
    }

    threshSegments.forEach(seg => {
      const x1 = getX(seg.startT);
      const x2 = getX(seg.endT);
      const yZone = getY(seg.threshold);
      
      const deepVal = role === 'reward' ? seg.threshold * DEEP_ZONE_FACTOR : seg.threshold / DEEP_ZONE_FACTOR;
      const yDeep = getY(deepVal);

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
        ctx.fillText('Deep Zone', w - padding.right - 2, yDeep - 4);

        ctx.fillStyle = 'rgba(52, 211, 153, 0.9)';
        ctx.fillText('Zone', w - padding.right - 2, yZone - 4);
        ctx.textAlign = 'left';
      }
    });
    ctx.setLineDash([]);

    // 3. Artefactos
    rows.forEach(r => {
      if (r.valid === 0) {
        const x = getX(r.t_s);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
        ctx.fillRect(x - 1, padding.top, 2, chartH);
      }
    });

    // 4. Cadenas válidas
    const validChains = [];
    let currentChain = [];

    rows.forEach(r => {
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
      if (chain.length < 2) return;

      const points = chain.map(r => ({
        x: getX(r.t_s),
        y: getY(r.value),
        t: r.t_s,
        val: r.value,
        thresh: r.threshold,
        success: r.success
      }));

      // Relleno inferior
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

      // Trazo coloreado
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];

        let strokeColor = '#94A3B8';
        if (p0.thresh !== null && !isNaN(p0.thresh)) {
          const isSuccess = role === 'reward' ? (p0.val >= p0.thresh) : (p0.val <= p0.thresh);
          const isDeep = role === 'reward'
            ? (p0.val >= p0.thresh * DEEP_ZONE_FACTOR)
            : (p0.val <= p0.thresh / DEEP_ZONE_FACTOR);

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
    
    const relX = Math.max(0, Math.min(chartW, mouseX - padding.left));
    const targetSecond = Math.round((relX / chartW) * 299);

    const bandRows = rawData.filter(r => r.band === currentBand);
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

      if (row.threshold === null) {
        tooltipState.textContent = 'Calibrando';
        tooltipState.className = 'tooltip-badge neutral';
      } else {
        const isSuccess = row.role === 'reward' ? (row.value >= row.threshold) : (row.value <= row.threshold);
        const isDeep = row.role === 'reward' 
          ? (row.value >= row.threshold * DEEP_ZONE_FACTOR)
          : (row.value <= row.threshold / DEEP_ZONE_FACTOR);

        if (isDeep) {
          tooltipState.textContent = 'Deep Zone ⚡';
          tooltipState.className = 'tooltip-badge deep';
        } else if (isSuccess) {
          tooltipState.textContent = 'In Zone ✨';
          tooltipState.className = 'tooltip-badge zone';
        } else {
          tooltipState.textContent = 'Neutral';
          tooltipState.className = 'tooltip-badge neutral';
        }
      }
    }

    let tipLeft = mouseX + 15;
    if (tipLeft + 160 > rect.width) tipLeft = mouseX - 165;
    let tipTop = mouseY - 45;
    if (tipTop < 5) tipTop = 10;

    canvasTooltip.style.left = `${tipLeft}px`;
    canvasTooltip.style.top = `${tipTop}px`;
    canvasTooltip.style.display = 'flex';
  }

  function exportSummaryJSON() {
    const summary = {
      exported_at: new Date().toISOString(),
      metadata,
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
