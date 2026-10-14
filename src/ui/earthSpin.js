import * as Cesium from 'cesium';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

// Faster = fewer seconds per full visual rotation. The original version used 5s.
export const EARTH_SPIN_PERIOD_MS = 30_000;
const PERIOD_MIN_MS = 5_000;
const PERIOD_MAX_MS = 120_000;
const PERIOD_STEP_MS = 5_000;
const RENDER_OWNER = 'earth-auto-spin';
const POINTER_RESUME_DELAY_MS = 250;
const MAX_FRAME_DELTA_MS = 80;
const PERIOD_STORAGE_KEY = 'gev:earth-spin-period-ms:v2';

function readStoredPeriod() {
  try {
    const stored = Number(window.localStorage.getItem(PERIOD_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= PERIOD_MIN_MS && stored <= PERIOD_MAX_MS && stored % PERIOD_STEP_MS === 0
      ? stored : EARTH_SPIN_PERIOD_MS;
  } catch {
    return EARTH_SPIN_PERIOD_MS;
  }
}

/**
 * Simulated globe spin: rotate Cesium camera around the Earth's ECEF Z axis.
 * It preserves the geographic coordinates of the four FAOSTAT trade layers.
 * Pauses while dragging and continues from the user's new camera view.
 */
export function installEarthSpin(viewer) {
  if (!viewer?.scene || !viewer?.camera || !viewer?.container)
    throw new TypeError('installEarthSpin requires a Cesium Viewer');
  if (document.getElementById('gev-earth-spin-toggle'))
    throw new Error('Earth-spin button already exists');

  let enabled = false;
  let destroyed = false;
  let periodMs = readStoredPeriod();
  let lastTime = 0;
  let resumeAfter = 0;
  const heldPointers = new Set();
  let removeFrameListener = null;

  const root = document.createElement('section');
  root.id = 'gev-earth-spin-panel';
  root.style.cssText = [
    'position:fixed', 'right:20px', 'bottom:90px', 'z-index:2500',
    'width:260px', 'max-width:calc(100vw - 40px)',
    'background:rgba(5,10,20,.95)', 'color:#c5c9d4',
    'border:1px solid rgba(139,159,195,.23)', 'border-radius:12px',
    'box-shadow:0 12px 36px rgba(0,0,0,.48)',
    'font:600 11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
    'letter-spacing:.08em', 'overflow:hidden',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;';
  const button = document.createElement('button');
  button.id = 'gev-earth-spin-toggle';
  button.type = 'button';
  button.setAttribute('aria-label', '切换地球自转');
  button.style.cssText = [
    'flex:1', 'border:0', 'background:transparent', 'color:#9fb8c6',
    'text-align:left', 'font:inherit', 'cursor:pointer', 'padding:4px 2px',
  ].join(';');
  const expand = document.createElement('button');
  expand.id = 'gev-earth-spin-settings-toggle';
  expand.type = 'button';
  expand.setAttribute('aria-controls', 'gev-earth-spin-settings');
  expand.setAttribute('aria-expanded', 'false');
  expand.setAttribute('aria-label', '展开地球自转速度设置');
  expand.title = '展开／收起速度调节';
  expand.textContent = '⚙';
  expand.style.cssText = 'border:1px solid rgba(139,159,195,.25);border-radius:5px;background:rgba(255,255,255,.04);color:#9fb8c6;padding:3px 8px;cursor:pointer;';
  header.append(button, expand);

  const settings = document.createElement('div');
  settings.id = 'gev-earth-spin-settings';
  settings.hidden = true;
  settings.style.cssText = 'border-top:1px solid rgba(139,159,195,.18);padding:13px 14px 15px;';
  const label = document.createElement('label');
  label.setAttribute('for', 'gev-earth-spin-period');
  label.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;';
  const description = document.createElement('span');
  description.textContent = '周期 · 秒/圈';
  const readout = document.createElement('output');
  readout.id = 'gev-earth-spin-period-value';
  readout.setAttribute('for', 'gev-earth-spin-period');
  readout.style.cssText = 'color:#35d0ff;font-size:12px;';
  label.append(description, readout);
  const range = document.createElement('input');
  range.id = 'gev-earth-spin-period';
  range.type = 'range';
  range.min = String(PERIOD_MIN_MS / 1000);
  range.max = String(PERIOD_MAX_MS / 1000);
  range.step = String(PERIOD_STEP_MS / 1000);
  range.value = String(periodMs / 1000);
  range.style.cssText = 'display:block;width:100%;margin:0;accent-color:#35d0ff;cursor:pointer;';
  const hint = document.createElement('div');
  hint.textContent = '← 转得快　　　　转得慢 →';
  hint.style.cssText = 'margin-top:8px;font-size:10px;color:#718195;';
  settings.append(label, range, hint);
  root.append(header, settings);

  function syncUI() {
    button.textContent = enabled ? '⟳ 地球自转 · ON' : '⟳ 地球自转 · OFF';
    button.setAttribute('aria-pressed', String(enabled));
    button.style.color = enabled ? '#7fffe2' : '#a2b4c8';
    readout.textContent = `${periodMs / 1000} s`;
    range.value = String(periodMs / 1000);
    button.title = `模拟地球自转 · ${periodMs / 1000} 秒一圈 · 拖拽暂停、松开恢复`;
  }

  function tick() {
    const now = performance.now();
    if (!lastTime) lastTime = now;
    const elapsed = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - lastTime));
    lastTime = now;
    if (!enabled || destroyed || viewer.isDestroyed?.()) return;
    if (heldPointers.size || now < resumeAfter) return;
    if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return;
    if (viewer.trackedEntity) return;
    const camera = viewer.camera;
    if (!Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY)) return;
    const angle = (-2 * Math.PI * elapsed) / periodMs;
    if (angle) camera.rotate(Cesium.Cartesian3.UNIT_Z, angle);
  }

  function setEnabled(next) {
    if (destroyed || enabled === next) return;
    enabled = next;
    lastTime = 0;
    if (enabled) {
      if (!viewer.trackedEntity && viewer.scene.mode === Cesium.SceneMode.SCENE3D)
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      removeFrameListener = viewer.scene.preRender.addEventListener(tick);
      holdContinuousRender(RENDER_OWNER);
    } else {
      removeFrameListener?.();
      removeFrameListener = null;
      releaseContinuousRender(RENDER_OWNER);
    }
    syncUI();
  }

  function onPeriodInput() {
    periodMs = Math.max(PERIOD_MIN_MS, Math.min(PERIOD_MAX_MS, Number(range.value) * 1000));
    lastTime = 0; // no jump on speed changes
    try { window.localStorage.setItem(PERIOD_STORAGE_KEY, String(periodMs)); } catch { /* storage optional */ }
    syncUI();
  }
  function onDown(event) { heldPointers.add(event.pointerId); }
  function onUp(event) {
    heldPointers.delete(event.pointerId);
    resumeAfter = performance.now() + POINTER_RESUME_DELAY_MS;
    lastTime = 0;
  }
  function pauseBriefly() {
    resumeAfter = performance.now() + POINTER_RESUME_DELAY_MS;
    lastTime = 0;
  }
  function onBlur() { heldPointers.clear(); pauseBriefly(); }
  function onToggle() { setEnabled(!enabled); }
  function onExpand() {
    settings.hidden = !settings.hidden;
    expand.setAttribute('aria-expanded', String(!settings.hidden));
  }

  button.addEventListener('click', onToggle);
  expand.addEventListener('click', onExpand);
  range.addEventListener('input', onPeriodInput);
  viewer.container.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  window.addEventListener('blur', onBlur);
  viewer.container.addEventListener('wheel', pauseBriefly, { capture: true, passive: true });
  document.body.appendChild(root);
  syncUI();

  return function destroy() {
    if (destroyed) return;
    setEnabled(false);
    destroyed = true;
    button.removeEventListener('click', onToggle);
    expand.removeEventListener('click', onExpand);
    range.removeEventListener('input', onPeriodInput);
    viewer.container.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    window.removeEventListener('blur', onBlur);
    viewer.container.removeEventListener('wheel', pauseBriefly, true);
    root.remove();
  };
}
