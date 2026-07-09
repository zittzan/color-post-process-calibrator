(function () {
  'use strict';

  const { hexToRgb01, rgb01ToHex, buildPipeline, solveCorrection } = window.ColorMath;
  const { parseVolumeProfile } = window.AssetParser;

  const openAssetButton = document.getElementById('open-asset-button');
  const profileSummary = document.getElementById('profile-summary');
  const warningBanner = document.getElementById('warning-banner');
  const infoBanner = document.getElementById('info-banner');
  const rowsBody = document.getElementById('rows-body');

  const modal = document.getElementById('eyedropper-modal');
  const closeModalButton = document.getElementById('eyedropper-close');
  const recaptureButton = document.getElementById('recapture-button');
  const displaySelect = document.getElementById('display-select');
  const captureCanvas = document.getElementById('capture-canvas');
  const loupeCanvas = document.getElementById('loupe-canvas');
  const loupeHex = document.getElementById('loupe-hex');
  const captureError = document.getElementById('capture-error');

  const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
  const loupeCtx = loupeCanvas.getContext('2d');
  loupeCtx.imageSmoothingEnabled = false;

  let pipeline = null;
  let parsedProfile = null;
  let profilePath = '';
  let nextRowId = 1;
  let rows = [
    createRow('#2B4786'),
    createRow('#81C7E8')
  ];
  let eyedropperRowId = null;
  let captureSources = [];
  const debounceTimers = new Map();

  function createRow(target) {
    return {
      id: nextRowId++,
      target,
      input: '',
      output: '',
      corrected: null,
      correctedHex: '',
      residual255: null,
      usedResidual: false,
      delta: null,
      history: [],
      historyOpen: false,
      ui: {}
    };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function baseName(path) {
    return String(path || '').split(/[\\/]/).pop() || '';
  }

  function normalizeHex(value) {
    const rgb = hexToRgb01(value);
    return rgb ? rgb01ToHex(rgb) : '';
  }

  function setSwatch(swatch, rgb) {
    swatch.style.backgroundColor = rgb ? rgb01ToHex(rgb) : '#000000';
    swatch.style.opacity = rgb ? '1' : '0.35';
  }

  function signedNumber(value, digits) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return 'default';
    }
    const n = Number(value);
    return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
  }

  function tonemapName(mode) {
    if (mode === 1) {
      return 'ACES';
    }
    if (mode === 2) {
      return 'Neutral';
    }
    return 'None';
  }

  function setMessage(container, messages) {
    container.replaceChildren();
    if (!messages || messages.length === 0) {
      container.classList.add('hidden');
      return;
    }
    for (const message of messages) {
      const item = el('div', '', message);
      container.appendChild(item);
    }
    container.classList.remove('hidden');
  }

  function updateProfileSummary() {
    profileSummary.replaceChildren();
    if (!parsedProfile) {
      profileSummary.textContent = 'プロファイル: 未読み込み';
      setMessage(warningBanner, []);
      setMessage(infoBanner, []);
      return;
    }

    const params = parsedProfile.profileParams;
    profileSummary.appendChild(el('span', 'profile-name', `プロファイル: ${baseName(profilePath)}`));
    profileSummary.appendChild(el('span', 'chip', `LGG lift ${signedNumber(params.lift && params.lift.w, 3)} / gamma ${signedNumber(params.gamma && params.gamma.w, 3)} / gain ${signedNumber(params.gain && params.gain.w, 3)}`));
    profileSummary.appendChild(el('span', 'chip', `Sat ${signedNumber(params.saturation, 1)}`));
    profileSummary.appendChild(el('span', 'chip', `Tonemap ${tonemapName(params.tonemapMode)}`));

    setMessage(warningBanner, parsedProfile.warnings);
    setMessage(infoBanner, parsedProfile.info);
  }

  function createEditableColorCell(row, field, options) {
    const cell = el('div', `color-cell${options.actions ? ' has-actions' : ''}`);
    const swatch = el('div', 'swatch');
    const input = document.createElement('input');
    input.className = 'hex-input';
    input.type = 'text';
    input.spellcheck = false;
    input.value = row[field];
    input.placeholder = '#RRGGBB';
    input.addEventListener('input', () => {
      row[field] = input.value;
      updateRowVisual(row);
      scheduleRecalc(row);
    });

    row.ui[`${field}Input`] = input;
    row.ui[`${field}Swatch`] = swatch;
    cell.append(swatch, input);

    if (options.actions) {
      const eyedropperButton = el('button', 'mini-button');
      eyedropperButton.innerHTML = '<svg viewBox="0 0 512 512" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M262.015,92.108c-11.293-11.294-29.62-11.294-40.912,0c-8.181,8.171-2.625,2.625-7.529,7.52c-16.84,16.848-37.174,7.441-41.338-17.092c-2.556-15.058-10.119-41.59-25.968-57.439c-33.461-33.462-87.71-33.462-121.172,0c-33.462,33.453-33.462,87.71,0,121.172c15.849,15.849,42.382,23.412,57.439,25.968c24.533,4.164,33.94,24.499,17.092,41.338c-4.894,4.904,0.652-0.652-7.52,7.529c-11.294,11.292-11.294,29.619,0,40.912c11.292,11.293,29.618,11.293,40.912,0L262.015,133.02C273.308,121.726,273.308,103.4,262.015,92.108z"/><path d="M359.749,415.466c-10.928-3.895-20.674-7.138-29.611-11.467c-8.937-4.347-17.178-9.676-25.758-18.23c-19.379-19.378-52.162-52.162-80.104-80.103c-13.962-13.962-26.724-26.724-35.991-35.992c-9.267-9.267-15.031-15.031-15.04-15.04l-18.882,18.883c0.009,0.017,5.773,5.772,15.04,15.048c27.802,27.794,87.031,87.032,116.094,116.086c10.789,10.824,22.004,18.074,33.018,23.386c16.605,7.963,32.262,11.902,47.919,18.622c15.692,6.729,31.897,15.935,50.849,34.826C438.357,502.559,447.798,512,447.798,512l18.883-18.882c0,0-9.441-9.45-30.506-30.514C407.834,434.097,381.561,423.196,359.749,415.466z"/><path d="M481.486,417.284c-25.133-25.308-33.279-45.564-40.868-66.541c-3.765-10.476-7.259-21.195-12.58-32.227c-5.312-11.014-12.562-22.23-23.386-33.018c-19.37-19.378-52.162-52.162-80.094-80.104c-13.972-13.961-26.733-26.724-35.992-35.991c-9.276-9.267-15.032-15.032-15.048-15.04l-18.883,18.882c0.017,0.009,5.772,5.772,15.04,15.04c27.803,27.802,87.041,87.032,116.096,116.095c8.554,8.58,13.883,16.822,18.23,25.758c6.52,13.354,10.484,28.777,18.091,46.764c7.607,17.952,19.17,37.99,40.512,59.273c21.064,21.065,30.515,30.506,30.515,30.506L512,447.798C512,447.798,502.559,438.357,481.486,417.284z"/></svg>';
      eyedropperButton.type = 'button';
      eyedropperButton.title = 'スポイト';
      eyedropperButton.addEventListener('click', () => openEyedropper(row.id));

      const iterateButton = el('button', 'mini-button', '↻');
      iterateButton.type = 'button';
      iterateButton.title = '反復';
      iterateButton.addEventListener('click', () => iterateRow(row.id));
      row.ui.iterateButton = iterateButton;

      cell.append(eyedropperButton, iterateButton);
    }

    return cell;
  }

  function createResultCell(row) {
    const wrap = el('div', 'result-cell');
    const line = el('div', 'copy-row');
    const swatch = el('div', 'swatch');
    const input = document.createElement('input');
    input.className = 'hex-input';
    input.type = 'text';
    input.readOnly = true;
    input.value = row.correctedHex;

    const copyButton = el('button', 'mini-button', '⧉');
    copyButton.type = 'button';
    copyButton.title = 'コピー';
    copyButton.addEventListener('click', () => copyCorrected(row.id, copyButton));

    const subtext = el('div', 'subtext');
    row.ui.correctedInput = input;
    row.ui.correctedSwatch = swatch;
    row.ui.copyButton = copyButton;
    row.ui.subtext = subtext;

    line.append(swatch, input, copyButton);
    wrap.append(line, subtext);
    return wrap;
  }

  function renderRows() {
    rowsBody.replaceChildren();
    rows.forEach((row, index) => {
      row.ui = {};
      const tr = document.createElement('tr');

      const indexCell = el('td', 'row-index', String(index + 1));
      const targetCell = document.createElement('td');
      targetCell.appendChild(createEditableColorCell(row, 'target', { actions: false }));

      const inputCell = document.createElement('td');
      inputCell.appendChild(createEditableColorCell(row, 'input', { actions: false }));

      const outputCell = document.createElement('td');
      outputCell.appendChild(createEditableColorCell(row, 'output', { actions: true }));

      const resultCell = document.createElement('td');
      resultCell.appendChild(createResultCell(row));

      const actionsCell = document.createElement('td');
      const actionWrap = el('div', 'row-actions');
      if (index === 0) {
        const lock = el('button', 'mini-button', '🔒');
        lock.type = 'button';
        lock.disabled = true;
        actionWrap.appendChild(lock);
      } else {
        const removeButton = el('button', 'mini-button', '✕');
        removeButton.type = 'button';
        removeButton.title = '行を削除';
        removeButton.addEventListener('click', () => removeRow(row.id));
        actionWrap.appendChild(removeButton);
      }

      const addButton = el('button', 'mini-button', '＋');
      addButton.type = 'button';
      addButton.title = '下に行を追加';
      addButton.addEventListener('click', () => addRowAfter(row.id));
      actionWrap.appendChild(addButton);
      actionsCell.appendChild(actionWrap);

      tr.append(indexCell, targetCell, inputCell, outputCell, resultCell, actionsCell);
      rowsBody.appendChild(tr);

      if (row.history.length > 0) {
        const historyRow = document.createElement('tr');
        historyRow.className = 'history-row';
        const historyCell = document.createElement('td');
        historyCell.colSpan = 6;
        historyCell.appendChild(createHistoryPanel(row));
        historyRow.appendChild(historyCell);
        rowsBody.appendChild(historyRow);
      }

      updateRowVisual(row);
    });
  }

  function createHistoryPanel(row) {
    const panel = el('div', 'history-panel');
    const toggle = el('button', 'history-toggle', `履歴 (${row.history.length}) ${row.historyOpen ? '▼' : '▶'}`);
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      row.historyOpen = !row.historyOpen;
      renderRows();
    });
    panel.appendChild(toggle);

    if (row.historyOpen) {
      const list = el('div', 'history-list');
      row.history.forEach((item, index) => {
        list.appendChild(el('div', 'history-item', `${index + 1}回目 入力 ${item.input || '-'} / 出力 ${item.output || '-'} → 修正 ${item.corrected || '-'}`));
      });
      panel.appendChild(list);
    }

    return panel;
  }

  function updateRowVisual(row) {
    const targetRgb = hexToRgb01(row.target);
    const inputRgb = row.input.trim() ? hexToRgb01(row.input) : null;
    const outputRgb = row.output.trim() ? hexToRgb01(row.output) : null;

    if (row.ui.targetInput) {
      row.ui.targetInput.classList.toggle('invalid', !targetRgb);
      setSwatch(row.ui.targetSwatch, targetRgb);
    }
    if (row.ui.inputInput) {
      row.ui.inputInput.classList.toggle('invalid', Boolean(row.input.trim()) && !inputRgb);
      setSwatch(row.ui.inputSwatch, inputRgb);
    }
    if (row.ui.outputInput) {
      row.ui.outputInput.classList.toggle('invalid', Boolean(row.output.trim()) && !outputRgb);
      setSwatch(row.ui.outputSwatch, outputRgb);
    }

    if (row.ui.correctedInput) {
      row.ui.correctedInput.value = row.correctedHex;
      setSwatch(row.ui.correctedSwatch, row.corrected);
      row.ui.copyButton.disabled = !row.correctedHex;
      row.ui.iterateButton.disabled = !row.correctedHex;
      updateSubtext(row, targetRgb);
    }
  }

  function updateSubtext(row, targetRgb) {
    const subtext = row.ui.subtext;
    subtext.classList.remove('warn', 'error');

    if (!pipeline) {
      subtext.textContent = '.asset を読み込んでください';
      return;
    }
    if (!targetRgb) {
      subtext.textContent = '目標値を確認してください';
      subtext.classList.add('error');
      return;
    }
    if (!row.correctedHex) {
      subtext.textContent = '';
      return;
    }

    const notes = [];
    if (row.usedResidual) {
      notes.push('残差補正あり');
    }
    if (row.residual255 !== null && row.residual255 > 1) {
      notes.push(`近似（残差 ${row.residual255.toFixed(1)}/255）`);
      subtext.classList.add('warn');
    }
    subtext.textContent = notes.join(' / ');
  }

  function scheduleRecalc(row) {
    if (debounceTimers.has(row.id)) {
      clearTimeout(debounceTimers.get(row.id));
    }
    debounceTimers.set(row.id, setTimeout(() => {
      debounceTimers.delete(row.id);
      recalcRow(row);
    }, 150));
  }

  function recalcRow(row) {
    if (!pipeline) {
      row.corrected = null;
      row.correctedHex = '';
      row.residual255 = null;
      row.usedResidual = false;
      row.delta = null;
      updateRowVisual(row);
      return;
    }

    const target = hexToRgb01(row.target);
    if (!target) {
      row.corrected = null;
      row.correctedHex = '';
      row.residual255 = null;
      row.usedResidual = false;
      row.delta = null;
      updateRowVisual(row);
      return;
    }

    const input = row.input.trim() ? hexToRgb01(row.input) : null;
    const output = row.output.trim() ? hexToRgb01(row.output) : null;

    try {
      const result = solveCorrection({
        target,
        input,
        output,
        pipeline
      });
      row.corrected = result.corrected;
      row.correctedHex = rgb01ToHex(result.corrected);
      row.residual255 = result.residual255;
      row.usedResidual = result.usedResidual;
      row.delta = result.delta;
    } catch (error) {
      row.corrected = null;
      row.correctedHex = '';
      row.residual255 = null;
      row.usedResidual = false;
      row.delta = null;
      console.error(error);
    }

    updateRowVisual(row);
  }

  function recalcAllRows() {
    rows.forEach((row) => recalcRow(row));
  }

  function addRowAfter(rowId) {
    const index = rows.findIndex((row) => row.id === rowId);
    rows.splice(index + 1, 0, createRow('#FFFFFF'));
    renderRows();
    recalcAllRows();
  }

  function removeRow(rowId) {
    const index = rows.findIndex((row) => row.id === rowId);
    if (index <= 0) {
      return;
    }
    rows = rows.filter((row) => row.id !== rowId);
    renderRows();
    recalcAllRows();
  }

  function iterateRow(rowId) {
    const row = rows.find((item) => item.id === rowId);
    if (!row || !row.correctedHex) {
      return;
    }

    row.history.push({
      input: normalizeHex(row.input),
      output: normalizeHex(row.output),
      corrected: row.correctedHex
    });
    row.historyOpen = true;
    row.input = row.correctedHex;
    row.output = '';
    renderRows();
    recalcRow(row);
    setTimeout(() => {
      const current = rows.find((item) => item.id === rowId);
      if (current && current.ui.outputInput) {
        current.ui.outputInput.focus();
      }
    }, 0);
  }

  async function copyCorrected(rowId, button) {
    const row = rows.find((item) => item.id === rowId);
    if (!row || !row.correctedHex || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(row.correctedHex);
    const original = button.textContent;
    button.textContent = '✓';
    setTimeout(() => {
      button.textContent = original;
    }, 900);
  }

  async function loadAsset() {
    try {
      const result = await window.api.openAsset();
      if (!result) {
        return;
      }
      parsedProfile = parseVolumeProfile(result.content);
      profilePath = result.path;
      pipeline = buildPipeline(parsedProfile.profileParams);
      updateProfileSummary();
      recalcAllRows();
    } catch (error) {
      setMessage(warningBanner, [`読み込みに失敗しました: ${error && error.message ? error.message : String(error)}`]);
    }
  }

  async function openEyedropper(rowId) {
    eyedropperRowId = rowId;
    modal.classList.remove('hidden');
    await recaptureScreens();
  }

  function closeEyedropper() {
    modal.classList.add('hidden');
    eyedropperRowId = null;
  }

  function showCaptureError() {
    captureError.textContent = '画面キャプチャに失敗しました。Windows の 設定 > プライバシーとセキュリティ で画面キャプチャが許可されているか確認してください';
    captureError.classList.remove('hidden');
  }

  async function recaptureScreens() {
    captureError.classList.add('hidden');
    displaySelect.replaceChildren();
    captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    loupeCtx.clearRect(0, 0, loupeCanvas.width, loupeCanvas.height);
    loupeHex.textContent = '#------';

    try {
      const result = await window.api.captureScreens();
      if (!Array.isArray(result) || result.error || result.length === 0) {
        showCaptureError();
        return;
      }

      captureSources = result;
      captureSources.forEach((source, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${source.name} (${source.width}×${source.height})`;
        displaySelect.appendChild(option);
      });
      await drawSelectedCapture();
    } catch (error) {
      showCaptureError();
    }
  }

  function drawSelectedCapture() {
    return new Promise((resolve) => {
      const source = captureSources[Number(displaySelect.value) || 0];
      if (!source) {
        showCaptureError();
        resolve();
        return;
      }

      const image = new Image();
      image.onload = () => {
        captureCanvas.width = image.naturalWidth;
        captureCanvas.height = image.naturalHeight;
        captureCtx.drawImage(image, 0, 0);
        resolve();
      };
      image.onerror = () => {
        showCaptureError();
        resolve();
      };
      image.src = source.dataURL;
    });
  }

  function canvasPoint(event) {
    const rect = captureCanvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * captureCanvas.width / rect.width);
    const y = Math.floor((event.clientY - rect.top) * captureCanvas.height / rect.height);
    return {
      x: clampInt(x, 0, captureCanvas.width - 1),
      y: clampInt(y, 0, captureCanvas.height - 1)
    };
  }

  function clampInt(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pixelHex(x, y) {
    const pixel = captureCtx.getImageData(x, y, 1, 1).data;
    return rgb01ToHex([pixel[0] / 255, pixel[1] / 255, pixel[2] / 255]);
  }

  function updateLoupe(event) {
    if (!captureCanvas.width || !captureCanvas.height) {
      return;
    }

    const point = canvasPoint(event);
    const size = 11;
    const sx = clampInt(point.x - 5, 0, Math.max(0, captureCanvas.width - size));
    const sy = clampInt(point.y - 5, 0, Math.max(0, captureCanvas.height - size));
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.clearRect(0, 0, loupeCanvas.width, loupeCanvas.height);
    loupeCtx.drawImage(captureCanvas, sx, sy, size, size, 0, 0, loupeCanvas.width, loupeCanvas.height);
    loupeCtx.strokeStyle = '#ffffff';
    loupeCtx.lineWidth = 1;
    loupeCtx.beginPath();
    loupeCtx.moveTo(loupeCanvas.width / 2, 0);
    loupeCtx.lineTo(loupeCanvas.width / 2, loupeCanvas.height);
    loupeCtx.moveTo(0, loupeCanvas.height / 2);
    loupeCtx.lineTo(loupeCanvas.width, loupeCanvas.height / 2);
    loupeCtx.stroke();
    loupeHex.textContent = pixelHex(point.x, point.y);
  }

  function pickPixel(event) {
    if (eyedropperRowId === null || !captureCanvas.width || !captureCanvas.height) {
      return;
    }
    const point = canvasPoint(event);
    const row = rows.find((item) => item.id === eyedropperRowId);
    if (row) {
      row.output = pixelHex(point.x, point.y);
      closeEyedropper();
      renderRows();
      recalcRow(row);
    }
  }

  openAssetButton.addEventListener('click', loadAsset);
  closeModalButton.addEventListener('click', closeEyedropper);
  recaptureButton.addEventListener('click', recaptureScreens);
  displaySelect.addEventListener('change', drawSelectedCapture);
  captureCanvas.addEventListener('mousemove', updateLoupe);
  captureCanvas.addEventListener('click', pickPixel);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeEyedropper();
    }
  });

  updateProfileSummary();
  renderRows();
}());
