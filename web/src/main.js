import './style.css';
import { loadAtlasManifest, firstTarget, targetSettings } from './atlas/loadAtlas.js';
import { buildMeshGeometry, loadPatch } from './tiling/geometry.js';
import { WallpaperRenderer } from './render/webgpuRenderer.js';
import { buildPalette, displayGamutLabel, MAX_COLORS, oklchCss, oklchToLinearSrgb } from './color/palette.js';
import { intSetting } from './settings/androidSettings.js';

const state = {
  manifest: null,
  category: null,
  item: null,
  patch: null,
  settings: null,
  customColors: null,
  selectedColor: 0,
};

const el = {
  viewport: document.getElementById('viewport'),
  category: document.getElementById('categorySelect'),
  target: document.getElementById('targetSelect'),
  title: document.getElementById('targetTitle'),
  tileCount: document.getElementById('tileCount'),
  colorMode: document.getElementById('colorMode'),
  colorCount: document.getElementById('colorCount'),
  colorCountValue: document.getElementById('colorCountValue'),
  swatches: document.getElementById('swatches'),
  wheel: document.getElementById('colorWheel'),
  lightness: document.getElementById('lightness'),
  lightnessValue: document.getElementById('lightnessValue'),
  gamut: document.getElementById('gamutLabel'),
  material: {
    mat_relief: [document.getElementById('matRelief'), document.getElementById('matReliefValue')],
    mat_roughness: [document.getElementById('matRoughness'), document.getElementById('matRoughnessValue')],
    mat_metalness: [document.getElementById('matMetalness'), document.getElementById('matMetalnessValue')],
    mat_clearcoat: [document.getElementById('matClearcoat'), document.getElementById('matClearcoatValue')],
    mat_iridescence: [document.getElementById('matIridescence'), document.getElementById('matIridescenceValue')],
  },
};

let renderer = null;

async function boot() {
  state.manifest = await loadAtlasManifest();
  const first = firstTarget(state.manifest);
  bindControls();
  renderer = new WallpaperRenderer(el.viewport);
  await renderer.init();
  await selectTarget(first.category.id, first.item.id);
  el.gamut.textContent = displayGamutLabel();
}

function bindControls() {
  el.category.addEventListener('change', async () => {
    const category = state.manifest.categories.find(c => c.id === el.category.value);
    const item = category.items[0];
    await selectTarget(category.id, item.id);
  });
  el.target.addEventListener('change', async () => {
    await selectTarget(state.category.id, el.target.value);
  });
  el.colorMode.addEventListener('click', event => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    state.settings.color_mode = button.dataset.mode;
    updateGeometryColors();
  });
  el.colorCount.addEventListener('input', () => {
    state.settings.color_count = Number(el.colorCount.value);
    updateGeometryColors();
  });
  for (const [key, [input]] of Object.entries(el.material)) {
    input.addEventListener('input', () => {
      state.settings[key] = Number(input.value);
      updateGeometryColors();
    });
  }
  el.wheel.addEventListener('pointerdown', event => {
    el.wheel.setPointerCapture(event.pointerId);
    applyWheelEvent(event);
  });
  el.wheel.addEventListener('pointermove', event => {
    if (event.buttons) applyWheelEvent(event);
  });
  el.lightness.addEventListener('input', () => {
    const color = currentCustomColor();
    color[0] = Number(el.lightness.value);
    updateGeometryColors();
  });
}

async function selectTarget(categoryId, itemId) {
  const category = state.manifest.categories.find(c => c.id === categoryId);
  const item = category.items.find(i => i.id === itemId) ?? category.items[0];
  state.category = category;
  state.item = item;
  state.settings = targetSettings(item);
  state.customColors = null;
  state.patch = await loadPatch(item);
  syncSelectors();
  updateGeometryColors();
}

function syncSelectors() {
  el.category.innerHTML = '';
  for (const category of state.manifest.categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.label;
    el.category.append(option);
  }
  el.category.value = state.category.id;

  el.target.innerHTML = '';
  for (const item of state.category.items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    el.target.append(option);
  }
  el.target.value = state.item.id;
}

function updateGeometryColors() {
  const built = buildMeshGeometry(state.patch, state.settings, state.customColors);
  renderer.setGeometry(built.geometry);
  renderer.setSettings(state.settings, built.palette);
  el.title.textContent = state.item.name;
  el.tileCount.textContent = state.patch.tiles.length.toLocaleString();
  syncControls(built.palette);
}

function syncControls(palette) {
  const colorMode = String(intSetting(state.settings, 'color_mode', 0, 2));
  for (const button of el.colorMode.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.mode === colorMode);
  }
  const colorCount = intSetting(state.settings, 'color_count', 2, MAX_COLORS);
  el.colorCount.value = String(colorCount);
  el.colorCountValue.textContent = String(colorCount);

  el.swatches.innerHTML = '';
  for (let i = 0; i < colorCount; i++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `swatch${i === state.selectedColor ? ' active' : ''}`;
    button.style.background = oklchCss(palette.colors[i]);
    button.title = `Color ${i + 1}`;
    button.addEventListener('click', () => {
      state.selectedColor = i;
      syncControls(palette);
    });
    el.swatches.append(button);
  }

  for (const [key, [input, output]] of Object.entries(el.material)) {
    input.value = String(state.settings[key] ?? 0);
    output.textContent = String(state.settings[key] ?? 0);
  }
  const selected = selectedDisplayColor(palette.colors);
  el.lightness.value = String(selected[0]);
  el.lightnessValue.textContent = selected[0].toFixed(3);
  drawWheel(palette.colors);
}

function ensureCustomColors(sourceColors = null) {
  if (!state.customColors) {
    const base = sourceColors ?? buildPalette(intSetting(state.settings, 'preset', 0, 11), intSetting(state.settings, 'color_count', 2, MAX_COLORS)).colors;
    state.customColors = base.map(c => c.slice());
    state.settings.preset = '11';
  }
  return state.customColors;
}

function currentCustomColor(sourceColors = null) {
  const colors = ensureCustomColors(sourceColors);
  return colors[Math.max(0, Math.min(colors.length - 1, state.selectedColor))];
}

function selectedDisplayColor(sourceColors = null) {
  const colors = state.customColors ?? sourceColors ?? buildPalette(intSetting(state.settings, 'preset', 0, 11), intSetting(state.settings, 'color_count', 2, MAX_COLORS)).colors;
  return colors[Math.max(0, Math.min(colors.length - 1, state.selectedColor))];
}

function applyWheelEvent(event) {
  const rect = el.wheel.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * 2 - 1;
  const y = (event.clientY - rect.top) / rect.height * 2 - 1;
  const radius = Math.min(1, Math.hypot(x, y));
  const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const color = currentCustomColor();
  color[1] = radius * 0.37;
  color[2] = hue;
  updateGeometryColors();
}

function drawWheel(sourceColors = null) {
  const ctx = el.wheel.getContext('2d', { willReadFrequently: true });
  const size = el.wheel.width;
  const image = ctx.createImageData(size, size);
  const selected = selectedDisplayColor(sourceColors);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1) * 2 - 1;
      const ny = y / (size - 1) * 2 - 1;
      const radius = Math.hypot(nx, ny);
      const idx = (y * size + x) * 4;
      if (radius > 1) {
        image.data[idx + 3] = 0;
        continue;
      }
      const hue = (Math.atan2(ny, nx) * 180 / Math.PI + 360) % 360;
      const css = oklchToRgbBytes([selected[0], radius * 0.37, hue]);
      image.data[idx] = css[0];
      image.data[idx + 1] = css[1];
      image.data[idx + 2] = css[2];
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const markerRadius = selected[1] / 0.37 * size * 0.5;
  const markerAngle = selected[2] * Math.PI / 180;
  ctx.beginPath();
  ctx.arc(size * 0.5 + Math.cos(markerAngle) * markerRadius, size * 0.5 + Math.sin(markerAngle) * markerRadius, 6, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

function oklchToRgbBytes(color) {
  return oklchToLinearSrgb(color).map(channel => {
    const v = Math.max(0, Math.min(1, channel));
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
}

boot().catch(error => {
  document.body.innerHTML = `<pre style="margin:24px;color:#ffb4a8;white-space:pre-wrap">${error.stack || error.message}</pre>`;
});
