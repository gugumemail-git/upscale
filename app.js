import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = 1;

const state = {
  engine: 'swin2sr_photo',
  scale: 4,
  sharpness: 45,
  grain: 40,
  inject300Dpi: true,
  colorLock: true,
  items: [],
  activeIndex: -1,
  isZoomed: false,
  aiPipeline: null
};

const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput');
const dropzone = $('dropzone');
const compareWrapper = $('compareWrapper');
const imgBefore = $('imgBefore');
const imgAfter = $('imgAfter');
const beforeLayer = $('beforeLayer');
const sliderHandle = $('sliderHandle');

// =========================================================================
// TEMA TERANG / GELAP
// =========================================================================
$('btnToggleTheme').addEventListener('click', () => {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('uscale_theme', next);
});

if (localStorage.getItem('uscale_theme')) {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('uscale_theme'));
}

// =========================================================================
// MODAL PENGATURAN API KEY (OPSIONAL)
// =========================================================================
$('inputApiKey').value = localStorage.getItem('uscale_api_key') || '';
$('btnOpenSettings').addEventListener('click', () => $('settingsModal').style.display = 'flex');
$('btnCloseModal').addEventListener('click', () => $('settingsModal').style.display = 'none');
$('btnSaveKey').addEventListener('click', () => {
  localStorage.setItem('uscale_api_key', $('inputApiKey').value.trim());
  $('settingsModal').style.display = 'none';
});
$('btnClearKey').addEventListener('click', () => {
  localStorage.removeItem('uscale_api_key');
  $('inputApiKey').value = '';
});

// =========================================================================
// PRESET CERDAS 1-KLIK
// =========================================================================
const presets = {
  portrait: { engine: 'swin2sr_photo', sharpness: 45, grain: 40, colorLock: true },
  banner:   { engine: 'vector_edge',   sharpness: 88, grain: 0,  colorLock: true },
  product:  { engine: 'swin2sr_photo', sharpness: 65, grain: 15, colorLock: true },
  logo:     { engine: 'vector_edge',   sharpness: 95, grain: 0,  colorLock: false }
};

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const p = presets[btn.dataset.preset];
    if (!p) return;

    setEngine(p.engine);
    state.sharpness = p.sharpness;
    $('sharpRange').value = p.sharpness;
    $('sharpVal').textContent = p.sharpness + '%';

    state.grain = p.grain;
    $('grainRange').value = p.grain;
    $('grainVal').textContent = p.grain + '%';

    state.colorLock = p.colorLock;
    $('chkColorLock').checked = p.colorLock;
  });
});

function setEngine(eng) {
  state.engine = eng;
  document.querySelectorAll('.engine-card').forEach(c => {
    c.classList.toggle('active', c.dataset.engine === eng);
  });
  $('cloudModelGroup').style.display = eng === 'cloud' ? 'flex' : 'none';
}

document.querySelectorAll('.engine-card').forEach(card => {
  card.addEventListener('click', () => setEngine(card.dataset.engine));
});

// =========================================================================
// PILIHAN SKALA & SLIDER KONTROL
// =========================================================================
document.querySelectorAll('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.scale = parseInt(pill.dataset.scale, 10);
    updateResolutionCalc();
  });
});

$('sharpRange').addEventListener('input', (e) => {
  state.sharpness = parseInt(e.target.value, 10);
  $('sharpVal').textContent = state.sharpness + '%';
});

$('grainRange').addEventListener('input', (e) => {
  state.grain = parseInt(e.target.value, 10);
  $('grainVal').textContent = state.grain + '%';
});

$('chk300Dpi').addEventListener('change', (e) => state.inject300Dpi = e.target.checked);
$('chkColorLock').addEventListener('change', (e) => state.colorLock = e.target.checked);

// =========================================================================
// UNGGAH & DRAG-DROP GAMBAR
// =========================================================================
$('btnUploadTrigger').addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', () => fileInput.click());
$('viewerArea').addEventListener('dragover', (e) => e.preventDefault());
$('viewerArea').addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(e.target.files);
});

function formatNum(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function getSafeTargetDimensions(origW, origH, scale) {
  let tW = origW * scale;
  let tH = origH * scale;
  const MAX_DIM = 12000;
  if (tW > MAX_DIM || tH > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / tW, MAX_DIM / tH);
    tW = Math.round(tW * ratio);
    tH = Math.round(tH * ratio);
  }
  return { tW, tH };
}

function handleFiles(fileList) {
  Array.from(fileList).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        state.items.push({
          id: Date.now() + Math.random(),
          name: file.name.replace(/\.[^/.]+$/, ''),
          origUrl: ev.target.result,
          origW: img.width,
          origH: img.height,
          outUrl: null,
          status: 'Siap'
        });
        if (state.activeIndex === -1) selectItem(0);
        renderBatchStrip();
        $('btnProcess').disabled = false;
        $('btnProcessAll').disabled = state.items.length < 2;
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderBatchStrip() {
  const strip = $('batchStrip');
  if (state.items.length === 0) {
    strip.style.display = 'none';
    return;
  }
  strip.style.display = 'flex';
  strip.innerHTML = state.items.map((item, idx) => `
    <div class="batch-item ${idx === state.activeIndex ? 'active' : ''}" data-idx="${idx}">
      <img src="${item.outUrl || item.origUrl}" />
      <span class="batch-status">${item.status}</span>
    </div>
  `).join('');

  strip.querySelectorAll('.batch-item').forEach(el => {
    el.addEventListener('click', () => selectItem(parseInt(el.dataset.idx, 10)));
  });
}

function selectItem(idx) {
  state.activeIndex = idx;
  const item = state.items[idx];
  if (!item) return;

  dropzone.style.display = 'none';
  compareWrapper.style.display = 'block';
  imgBefore.src = item.origUrl;
  imgAfter.src = item.outUrl || item.origUrl;
  $('badgeAfterLabel').textContent = item.outUrl ? `SESUDAH (${state.scale}x)` : 'PRATINJAU ASLI';
  $('btnDownload').disabled = !item.outUrl;
  $('btnHoldCompare').disabled = !item.outUrl;
  $('btnZoomToggle').disabled = false;

  setTimeout(syncComparisonDimensions, 50);
  updateResolutionCalc();
  renderBatchStrip();
}

function updateResolutionCalc() {
  const item = state.items[state.activeIndex];
  if (!item) return;
  const { tW, tH } = getSafeTargetDimensions(item.origW, item.origH, state.scale);

  $('infoOrigRes').textContent = `${formatNum(item.origW)} × ${formatNum(item.origH)} px`;
  $('infoTargetRes').textContent = `${formatNum(tW)} × ${formatNum(tH)} px`;

  const pW = (tW / 118.11).toFixed(1).replace('.', ',');
  const pH = (tH / 118.11).toFixed(1).replace('.', ',');
  $('infoPrintPhoto').textContent = `${pW} × ${pH} cm`;

  const bW = (tW / 59.05).toFixed(1).replace('.', ',');
  const bH = (tH / 59.05).toFixed(1).replace('.', ',');
  $('infoPrintBanner').textContent = `${bW} × ${bH} cm`;

  const oW = (tW / 2835).toFixed(2).replace('.', ',');
  const oH = (tH / 2835).toFixed(2).replace('.', ',');
  $('infoPrintOutdoor').textContent = `${oW} × ${oH} m`;
}

// =========================================================================
// SPLIT SLIDER, TAHAN LIHAT ASLI & ZOOM
// =========================================================================
function syncComparisonDimensions() {
  if (imgAfter.clientWidth > 0) {
    imgBefore.style.width = imgAfter.clientWidth + 'px';
    imgBefore.style.height = imgAfter.clientHeight + 'px';
  }
}
window.addEventListener('resize', syncComparisonDimensions);

let savedSliderPct = 50;
const holdBtn = $('btnHoldCompare');

function showOriginalFull() {
  if (holdBtn.disabled) return;
  savedSliderPct = parseFloat(beforeLayer.style.width) || 50;
  beforeLayer.style.width = '100%';
  sliderHandle.style.left = '100%';
}

function restoreSlider() {
  if (holdBtn.disabled) return;
  beforeLayer.style.width = savedSliderPct + '%';
  sliderHandle.style.left = savedSliderPct + '%';
}

holdBtn.addEventListener('mousedown', showOriginalFull);
holdBtn.addEventListener('touchstart', showOriginalFull);
window.addEventListener('mouseup', restoreSlider);
window.addEventListener('touchend', restoreSlider);

let isDragging = false;
sliderHandle.addEventListener('mousedown', () => isDragging = true);
sliderHandle.addEventListener('touchstart', () => isDragging = true);
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('touchend', () => isDragging = false);

function moveSlider(clientX) {
  if (!isDragging) return;
  const rect = compareWrapper.getBoundingClientRect();
  let pct = ((clientX - rect.left) / rect.width) * 100;
  pct = Math.max(0, Math.min(100, pct));
  beforeLayer.style.width = pct + '%';
  sliderHandle.style.left = pct + '%';
}
window.addEventListener('mousemove', (e) => moveSlider(e.clientX));
window.addEventListener('touchmove', (e) => moveSlider(e.touches[0].clientX));

$('btnZoomToggle').addEventListener('click', () => {
  state.isZoomed = !state.isZoomed;
  if (state.isZoomed) {
    imgAfter.style.maxHeight = 'none';
    imgAfter.style.maxWidth = 'none';
    compareWrapper.style.maxHeight = '70vh';
    compareWrapper.style.overflow = 'auto';
    $('btnZoomToggle').textContent = '🔎 Fit Layar';
  } else {
    imgAfter.style.maxHeight = '70vh';
    imgAfter.style.maxWidth = '100%';
    compareWrapper.style.overflow = 'hidden';
    $('btnZoomToggle').textContent = '🔍 Zoom 100%';
  }
  setTimeout(syncComparisonDimensions, 50);
});

// =========================================================================
// INJEKSI METADATA 300 DPI ASLI (JPEG JFIF & PNG pHYs)
// =========================================================================
function inject300DpiToDataUrl(dataUrl, mimeType) {
  if (!state.inject300Dpi) return dataUrl;

  const base64 = dataUrl.split(',')[1];
  const binStr = atob(base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

  if (mimeType === 'image/jpeg' && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF && bytes[3] === 0xE0) {
    bytes[13] = 0x01;
    bytes[14] = 0x01; bytes[15] = 0x2C;
    bytes[16] = 0x01; bytes[17] = 0x2C;
    return uint8ToDataUrl(bytes, mimeType);
  }

  if (mimeType === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const physChunk = new Uint8Array([
      0x00, 0x00, 0x00, 0x09,
      0x70, 0x48, 0x59, 0x73,
      0x00, 0x00, 0x2E, 0x23,
      0x00, 0x00, 0x2E, 0x23,
      0x01,
      0x00, 0x00, 0x00, 0x00
    ]);
    const crc = crc32(physChunk.subarray(4, 17));
    physChunk[17] = (crc >>> 24) & 0xFF;
    physChunk[18] = (crc >>> 16) & 0xFF;
    physChunk[19] = (crc >>> 8) & 0xFF;
    physChunk[20] = crc & 0xFF;

    const combined = new Uint8Array(bytes.length + physChunk.length);
    combined.set(bytes.subarray(0, 33), 0);
    combined.set(physChunk, 33);
    combined.set(bytes.subarray(33), 33 + physChunk.length);
    return uint8ToDataUrl(combined, mimeType);
  }

  return dataUrl;
}

function uint8ToDataUrl(bytes, mimeType) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,` + btoa(binary);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// =========================================================================
// HELPER: MULTI-STEP PROGRESSIVE RESIZE
// =========================================================================
function loadImageAsync(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function progressiveResizeToCanvas(img, targetW, targetH) {
  let curCanvas = document.createElement('canvas');
  curCanvas.width = img.width;
  curCanvas.height = img.height;
  curCanvas.getContext('2d').drawImage(img, 0, 0);

  let curW = img.width;
  let curH = img.height;

  while (curW < targetW) {
    const nextW = Math.min(targetW, Math.round(curW * 1.45));
    const nextH = Math.min(targetH, Math.round(curH * 1.45));
    const stepCanvas = document.createElement('canvas');
    stepCanvas.width = nextW;
    stepCanvas.height = nextH;
    const stepCtx = stepCanvas.getContext('2d');
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(curCanvas, 0, 0, nextW, nextH);
    curCanvas = stepCanvas;
    curW = nextW;
    curH = nextH;
  }

  if (curW > targetW) {
    const downCanvas = document.createElement('canvas');
    downCanvas.width = targetW;
    downCanvas.height = targetH;
    const downCtx = downCanvas.getContext('2d');
    downCtx.imageSmoothingEnabled = true;
    downCtx.imageSmoothingQuality = 'high';
    downCtx.drawImage(curCanvas, 0, 0, targetW, targetH);
    curCanvas = downCanvas;
  }

  return curCanvas;
}

// =========================================================================
// MESIN 1: AI SWIN2SR PHOTOREAL + ORIGINAL COLOR LOCK + MICRO-PORE SYNTHESIS
// =========================================================================
async function getSwin2SrPipeline() {
  if (state.aiPipeline) return state.aiPipeline;

  $('loaderTitle').textContent = 'Menyiapkan Jaringan Saraf AI Swin2SR...';
  $('loaderSub').textContent = 'Mengunduh model sekali (tersimpan otomatis di cache browser)';

  const progressCb = (info) => {
    if (info.status === 'progress' && info.progress) {
      const pct = Math.round(info.progress);
      $('progressFill').style.width = pct + '%';
      $('loaderSub').textContent = `Mengunduh Bobot AI: ${pct}%`;
    }
  };

  let useDevice = 'wasm';
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) useDevice = 'webgpu';
    } catch (_) {
      useDevice = 'wasm';
    }
  }

  state.aiPipeline = await pipeline(
    'image-to-image',
    'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr',
    { device: useDevice, progress_callback: progressCb }
  );

  return state.aiPipeline;
}

async function processPhotorealAiUpscale(item) {
  const totalPixels = item.origW * item.origH;
  const { tW, tH } = getSafeTargetDimensions(item.origW, item.origH, state.scale);

  // Jika file sudah berukuran besar (> 1.8 MP), arahkan ke Vector-Edge Print De-Blur agar aman
  if (totalPixels > 1800000) {
    $('loaderTitle').textContent = 'File Resolusi Tinggi — Mengaktifkan Vector-Edge Print...';
    $('loaderSub').textContent = 'Menjaga ketajaman detail & huruf cetak 300 DPI';
    return await processVectorEdgePrint(item.origUrl, tW, tH);
  }

  const upscaler = await getSwin2SrPipeline();

  $('loaderTitle').textContent = 'AI Swin2SR Merekonstruksi Struktur Wajah...';
  $('loaderSub').textContent = 'Tahap 1/2: Deep Learning Super-Resolution berjalan...';
  $('progressFill').style.width = '75%';
  await new Promise(r => setTimeout(r, 40));

  const rawOutput = await upscaler(item.origUrl);
  const aiCanvas = rawOutput.toCanvas();
  const stdCanvas = document.createElement('canvas');
  stdCanvas.width = aiCanvas.width;
  stdCanvas.height = aiCanvas.height;
  stdCanvas.getContext('2d').drawImage(aiCanvas, 0, 0);
  const aiDataUrl = stdCanvas.toDataURL('image/png');

  $('loaderTitle').textContent = 'Sintesis Pori Kulit Alami & Original Color Lock...';
  $('loaderSub').textContent = 'Tahap 2/2: Menghilangkan efek kartun & injeksi 300 DPI...';
  $('progressFill').style.width = '100%';
  await new Promise(r => setTimeout(r, 30));

  const [origImg, aiImg] = await Promise.all([
    loadImageAsync(item.origUrl),
    loadImageAsync(aiDataUrl)
  ]);

  const origCanvas = progressiveResizeToCanvas(origImg, tW, tH);
  const finalCanvas = progressiveResizeToCanvas(aiImg, tW, tH);

  const origData = origCanvas.getContext('2d').getImageData(0, 0, tW, tH).data;
  const finalCtx = finalCanvas.getContext('2d');
  const imgData = finalCtx.getImageData(0, 0, tW, tH);
  const data = imgData.data;
  const copy = new Uint8ClampedArray(data);

  // Parameter fotografi alami (ANTI-KARTUN: tidak ada sigmoid shock filter di mode foto!)
  const clarityGain = (state.sharpness / 100) * 0.65;
  const poreStrength = (state.grain / 100) * 9.5;

  // Generator noise Gaussian/organik multi-frekuensi untuk mensimulasikan pori kulit & sensor kamera
  let s1 = 1337, s2 = 7331;
  function organicMicroTexture(x, y) {
    s1 = (s1 * 16807) % 2147483647;
    s2 = (s2 * 48271) % 2147483647;
    const fine = ((s1 / 2147483647) + (s2 / 2147483647) - 1.0); // Distribusi triangular (lebih alami dari uniform)
    // Gelombang mikro halus mirip pori kulit 2-3 piksel
    const porePattern = Math.sin(x * 1.15 + Math.cos(y * 0.95)) * 0.35;
    return (fine * 0.75 + porePattern * 0.25);
  }

  for (let y = 1; y < tH - 1; y++) {
    for (let x = 1; x < tW - 1; x++) {
      const idx = (y * tW + x) * 4;

      // 1. High-Pass Luminance Clarity (Hanya menajamkan kecerahan, BUKAN warna, agar tepi tidak seperti garis kartun)
      const lumC = 0.299 * copy[idx] + 0.587 * copy[idx + 1] + 0.114 * copy[idx + 2];
      const lumN = 0.299 * copy[((y - 1) * tW + x) * 4] + 0.587 * copy[((y - 1) * tW + x) * 4 + 1] + 0.114 * copy[((y - 1) * tW + x) * 4 + 2];
      const lumS = 0.299 * copy[((y + 1) * tW + x) * 4] + 0.587 * copy[((y + 1) * tW + x) * 4 + 1] + 0.114 * copy[((y + 1) * tW + x) * 4 + 2];
      const lumW = 0.299 * copy[(y * tW + (x - 1)) * 4] + 0.587 * copy[(y * tW + (x - 1)) * 4 + 1] + 0.114 * copy[(y * tW + (x - 1)) * 4 + 2];
      const lumE = 0.299 * copy[(y * tW + (x + 1)) * 4] + 0.587 * copy[(y * tW + (x + 1)) * 4 + 1] + 0.114 * copy[(y * tW + (x + 1)) * 4 + 2];

      const lumAvg = (lumN + lumS + lumW + lumE) * 0.25;
      const highPass = (lumC - lumAvg) * clarityGain;

      // 2. Hitung deteksi area kulit / midtone untuk menyuntikkan tekstur pori alami
      const rAi = copy[idx], gAi = copy[idx + 1], bAi = copy[idx + 2];
      const isSkinOrMidtone = (lumC > 45 && lumC < 225) ? 1.0 : 0.35;
      const microTex = poreStrength > 0 ? organicMicroTexture(x, y) * poreStrength * isSkinOrMidtone : 0;

      // 3. Original Color Lock: Ambil krominansi (warna asli) dari gambar original agar wajah tidak pucat/oranye
      let rOut = rAi + highPass + microTex;
      let gOut = gAi + highPass + microTex * 0.92;
      let bOut = bAi + highPass + microTex * 0.85;

      if (state.colorLock) {
        const lumOrig = 0.299 * origData[idx] + 0.587 * origData[idx + 1] + 0.114 * origData[idx + 2];
        const lumNew = 0.299 * rOut + 0.587 * gOut + 0.114 * bOut;
        const deltaLum = lumNew - lumOrig;

        // Gabungkan 80% warna asli dari foto original + 20% warna AI, lalu terapkan pencahayaan tajam dari AI
        rOut = (origData[idx] * 0.80 + rAi * 0.20) + deltaLum;
        gOut = (origData[idx + 1] * 0.80 + gAi * 0.20) + deltaLum;
        bOut = (origData[idx + 2] * 0.80 + bAi * 0.20) + deltaLum;
      }

      data[idx]     = Math.max(0, Math.min(255, rOut));
      data[idx + 1] = Math.max(0, Math.min(255, gOut));
      data[idx + 2] = Math.max(0, Math.min(255, bOut));
    }
  }

  finalCtx.putImageData(imgData, 0, 0);
  const format = $('exportFormat').value;
  const rawDataUrl = finalCanvas.toDataURL(format, 0.96);
  return inject300DpiToDataUrl(rawDataUrl, format);
}

// =========================================================================
// MESIN 2: VECTOR-EDGE PRINT DE-BLUR (KHUSUS BANNER, TULISAN & LOGO)
// =========================================================================
async function processVectorEdgePrint(sourceUrl, targetW, targetH) {
  const img = await loadImageAsync(sourceUrl);
  const curCanvas = progressiveResizeToCanvas(img, targetW, targetH);

  const finalCtx = curCanvas.getContext('2d');
  const imgData = finalCtx.getImageData(0, 0, targetW, targetH);
  const data = imgData.data;
  const copy = new Uint8ClampedArray(data);

  // Radius pemindaian tepi menyesuaikan skala pembesaran agar menangkap seluruh area buram huruf
  const radius = Math.max(2, Math.min(6, state.scale));
  const sharpNorm = state.sharpness / 100;
  const steepPower = 1.0 + sharpNorm * 3.4;
  const detailBoost = sharpNorm * 0.65;

  for (let y = radius; y < targetH - radius; y++) {
    for (let x = radius; x < targetW - radius; x++) {
      const idx = (y * targetW + x) * 4;

      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];

        const n = copy[((y - radius) * targetW + x) * 4 + c];
        const s = copy[((y + radius) * targetW + x) * 4 + c];
        const w = copy[(y * targetW + (x - radius)) * 4 + c];
        const e = copy[(y * targetW + (x + radius)) * 4 + c];
        const nw = copy[((y - radius) * targetW + (x - radius)) * 4 + c];
        const ne = copy[((y - radius) * targetW + (x + radius)) * 4 + c];
        const sw = copy[((y + radius) * targetW + (x - radius)) * 4 + c];
        const se = copy[((y + radius) * targetW + (x + radius)) * 4 + c];

        const minVal = Math.min(center, n, s, w, e, nw, ne, sw, se);
        const maxVal = Math.max(center, n, s, w, e, nw, ne, sw, se);
        const range = maxVal - minVal;

        let val = center;

        // Sigmoidal Shock Filter: Memadatkan tepi buram huruf menjadi garis vektor tegas tanpa merubah bentuk font
        if (range >= 14 && sharpNorm > 0) {
          const t = (center - minVal) / range;
          const steepT = t < 0.5
            ? 0.5 * Math.pow(2 * t, steepPower)
            : 1.0 - 0.5 * Math.pow(2 * (1 - t), steepPower);
          val = minVal + steepT * range;
        }

        const localAvg = (n + s + w + e) * 0.15 + (nw + ne + sw + se) * 0.10;
        val += (center - localAvg) * detailBoost;

        data[idx + c] = Math.max(0, Math.min(255, val));
      }
    }
  }

  finalCtx.putImageData(imgData, 0, 0);
  const format = $('exportFormat').value;
  const rawDataUrl = curCanvas.toDataURL(format, 0.96);
  return inject300DpiToDataUrl(rawDataUrl, format);
}

// =========================================================================
// MESIN 3: CLOUD GPU GENERATIVE AI (OPSIONAL)
// =========================================================================
async function processCloudUpscale(item) {
  const customKey = localStorage.getItem('uscale_api_key') || '';
  const response = await fetch('/api/upscale', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(customKey ? { 'X-Custom-Api-Key': customKey } : {})
    },
    body: JSON.stringify({
      image: item.origUrl,
      scale: state.scale,
      faceEnhance: true,
      modelType: $('cloudModelSelect').value
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Gagal terhubung ke Cloud GPU.');
  }
  return result.outputUrl;
}

// =========================================================================
// EKSEKUSI PEMROSESAN & UNDUH
// =========================================================================
async function processSingle(idx) {
  const item = state.items[idx];
  if (!item) return;

  $('loaderOverlay').style.display = 'flex';
  $('progressFill').style.width = '10%';
  $('progressTrack').style.display = state.engine === 'swin2sr_photo' ? 'block' : 'none';

  try {
    let outputUrl;
    const { tW, tH } = getSafeTargetDimensions(item.origW, item.origH, state.scale);

    if (state.engine === 'swin2sr_photo') {
      outputUrl = await processPhotorealAiUpscale(item);
    } else if (state.engine === 'vector_edge') {
      $('loaderTitle').textContent = 'Memproses Vector-Edge Print De-Blur...';
      $('loaderSub').textContent = `Memadatkan ketajaman tulisan & desain (${state.scale}x) + 300 DPI`;
      await new Promise(r => setTimeout(r, 30));
      outputUrl = await processVectorEdgePrint(item.origUrl, tW, tH);
    } else {
      $('loaderTitle').textContent = 'Menjalankan Cloud GPU AI...';
      $('loaderSub').textContent = `Memproses ${item.name} di server GPU`;
      outputUrl = await processCloudUpscale(item);
    }

    item.outUrl = outputUrl;
    item.status = `${state.scale}x ✓`;
    selectItem(idx);
  } catch (err) {
    alert('Kendala Pemrosesan: ' + err.message);
    item.status = 'Gagal';
    renderBatchStrip();
  } finally {
    $('loaderOverlay').style.display = 'none';
  }
}

$('btnProcess').addEventListener('click', () => processSingle(state.activeIndex));

$('btnProcessAll').addEventListener('click', async () => {
  for (let i = 0; i < state.items.length; i++) {
    await processSingle(i);
  }
});

$('btnDownload').addEventListener('click', async () => {
  const item = state.items[state.activeIndex];
  if (!item || !item.outUrl) return;

  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const ext = extMap[$('exportFormat').value] || 'png';
  const dpiTag = state.inject300Dpi ? '_300DPI' : '';
  const fileName = `${item.name}_UltraScale_${state.scale}x${dpiTag}.${ext}`;

  if (item.outUrl.startsWith('http')) {
    const res = await fetch(item.outUrl);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(blobUrl);
  } else {
    const a = document.createElement('a');
    a.href = item.outUrl;
    a.download = fileName;
    a.click();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
