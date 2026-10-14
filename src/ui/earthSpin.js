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
  let celestialSnapshot = null;
  const rotatedPosition = new Cesium.Cartesian3();
  const rotatedDirection = new Cesium.Cartesian3();
  const rotatedUp = new Cesium.Cartesian3();
  const zRotation = new Cesium.Matrix3();

  // Dock the compact orbit control above (rather than on top of) the right
  // resilience lab. Settings open to the LEFT so the lab remains readable.
  const style = document.createElement('style');
  style.textContent = `
    #gev-earth-spin-panel {
      position: fixed; top: 24px; right: 140px; z-index: 2600;
      width: 198px; max-width: calc(100vw - 24px);
      color: #c6d9e8; background: rgba(4, 12, 25, .96);
      border: 1px solid rgba(69, 151, 186, .45); border-radius: 11px;
      box-shadow: 0 10px 30px rgba(0,0,0,.38);
      font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: .025em;
    }
    #gev-earth-spin-panel button { font: inherit; cursor: pointer; }
    #gev-earth-spin-panel .gev-spin-header {
      display: flex; align-items: center; gap: 6px; padding: 6px 7px 6px 11px;
    }
    #gev-earth-spin-toggle {
      flex: 1; min-width: 0; text-align: left;
      background: transparent; border: 0; padding: 5px 0;
      color: #aec3d2;
    }
    #gev-earth-spin-toggle[aria-pressed="true"] { color: #77f5de; }
    #gev-earth-spin-settings-toggle {
      flex: none; width: 29px; height: 27px;
      border: 1px solid #30516b; border-radius: 7px;
      background: #10283c; color: #9bd5ed;
    }
    #gev-earth-spin-settings-toggle[aria-expanded="true"],
    #gev-earth-spin-settings-toggle:hover { border-color: #35d0ff; color: #dff9ff; }
    #gev-earth-spin-settings {
      position: absolute; top: 0; right: calc(100% + 10px);
      box-sizing: border-box; width: 248px;
      background: rgba(4, 12, 25, .98);
      border: 1px solid rgba(69, 151, 186, .48);
      border-radius: 11px; padding: 12px 14px 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,.5);
    }
    #gev-earth-spin-settings[hidden] { display: none; }
    #gev-earth-spin-settings .gev-spin-title {
      color: #61d8f6; letter-spacing: .12em; font-size: 10px;
      margin: 0 0 12px;
    }
    #gev-earth-spin-period { accent-color: #35d0ff; }
    @media (max-width: 690px) {
      #gev-earth-spin-panel { top: 14px; right: 12px; width: 192px; }
      #gev-earth-spin-settings {
        top: calc(100% + 9px); right: 0;
        width: min(248px, calc(100vw - 24px));
      }
      /* A stacked layout gives the speed popover its own space. */
      #gev-resilience-root { top: 240px; }
      #gev-resilience-root .gev-lab-body { max-height: calc(100vh - 300px); }
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('section');
  root.id = 'gev-earth-spin-panel';
  root.setAttribute('aria-label', '镜头环绕控制');

  const header = document.createElement('div');
  header.className = 'gev-spin-header';
  const button = document.createElement('button');
  button.id = 'gev-earth-spin-toggle';
  button.type = 'button';
  button.setAttribute('aria-label', '切换镜头环绕');
  const expand = document.createElement('button');
  expand.id = 'gev-earth-spin-settings-toggle';
  expand.type = 'button';
  expand.setAttribute('aria-controls', 'gev-earth-spin-settings');
  expand.setAttribute('aria-expanded', 'false');
  expand.setAttribute('aria-label', '展开镜头环绕速度设置');
  expand.title = '速度设置';
  expand.textContent = '⚙';
  header.append(button, expand);

  const settings = document.createElement('div');
  settings.id = 'gev-earth-spin-settings';
  settings.hidden = true;
  const title = document.createElement('div');
  title.className = 'gev-spin-title';
  title.textContent = 'CAMERA ORBIT · 速度设置';
  settings.append(title);
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
    button.textContent = enabled ? '⟳ 镜头环绕 · ON' : '⟳ 镜头环绕 · OFF';
    button.setAttribute('aria-pressed', String(enabled));
    readout.textContent = `${periodMs / 1000} s`;
    range.value = String(periodMs / 1000);
    button.title = `摄像机绕地轴环绕 · ${periodMs / 1000} 秒一圈 · 拖拽暂停、松开恢复；环绕期间隐藏动态星体`; 
  }

  function hideMovingSky() {
    if (celestialSnapshot) return;
    const scene = viewer.scene;
    celestialSnapshot = {
      skyBox: scene.skyBox ? scene.skyBox.show : null,
      sun: scene.sun ? scene.sun.show : null,
      moon: scene.moon ? scene.moon.show : null,
    };
    // A real camera orbit changes the starfield perspective. Suppress moving
    // celestial bodies while active rather than imply they stay fixed.
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
  }
  function restoreSky() {
    if (!celestialSnapshot) return;
    const scene = viewer.scene;
    if (scene.skyBox && celestialSnapshot.skyBox !== null) scene.skyBox.show = celestialSnapshot.skyBox;
    if (scene.sun && celestialSnapshot.sun !== null) scene.sun.show = celestialSnapshot.sun;
    if (scene.moon && celestialSnapshot.moon !== null) scene.moon.show = celestialSnapshot.moon;
    celestialSnapshot = null;
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
    if (!angle) return;
    // Rotate the *camera pose* around Earth's ECEF Z axis, preserving distance,
    // camera tilt and the new user-selected view after a manual drag.
    // No globe/entity/planet transforms are modified.
    Cesium.Matrix3.fromRotationZ(angle, zRotation);
    Cesium.Matrix3.multiplyByVector(zRotation, camera.positionWC, rotatedPosition);
    Cesium.Matrix3.multiplyByVector(zRotation, camera.directionWC, rotatedDirection);
    Cesium.Matrix3.multiplyByVector(zRotation, camera.upWC, rotatedUp);
    camera.setView({
      destination: rotatedPosition,
      orientation: { direction: rotatedDirection, up: rotatedUp },
    });
  }

  function setEnabled(next) {
    if (destroyed || enabled === next) return;
    enabled = next;
    lastTime = 0;
    if (enabled) {
      if (!viewer.trackedEntity && viewer.scene.mode === Cesium.SceneMode.SCENE3D)
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      hideMovingSky();
      removeFrameListener = viewer.scene.preRender.addEventListener(tick);
      holdContinuousRender(RENDER_OWNER);
    } else {
      removeFrameListener?.();
      removeFrameListener = null;
      releaseContinuousRender(RENDER_OWNER);
      restoreSky();
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
  function onExternalPause(event) {
    const duration = Number(event.detail?.durationMs);
    resumeAfter = performance.now() + (Number.isFinite(duration) ? Math.max(350,Math.min(duration,15000)) : 2500);
    lastTime = 0;
  }
  function onToggle() { setEnabled(!enabled); }
  function setSettingsOpen(next) {
    settings.hidden = !next;
    expand.setAttribute('aria-expanded', String(next));
    expand.setAttribute('aria-label', next ? '收起镜头环绕速度设置' : '展开镜头环绕速度设置');
  }
  function onExpand() { setSettingsOpen(settings.hidden); }
  function onOutside(event) {
    if (!settings.hidden && !root.contains(event.target)) setSettingsOpen(false);
  }
  function onKeyDown(event) {
    if (event.key === 'Escape' && !settings.hidden) {
      setSettingsOpen(false);
      expand.focus();
    }
  }

  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKeyDown, true);
  button.addEventListener('click', onToggle);
  expand.addEventListener('click', onExpand);
  range.addEventListener('input', onPeriodInput);
  viewer.container.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('gev:earth-spin-pause', onExternalPause);
  viewer.container.addEventListener('wheel', pauseBriefly, { capture: true, passive: true });
  document.body.appendChild(root);
  syncUI();

  return function destroy() {
    if (destroyed) return;
    setEnabled(false);
    destroyed = true;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKeyDown, true);
    button.removeEventListener('click', onToggle);
    expand.removeEventListener('click', onExpand);
    range.removeEventListener('input', onPeriodInput);
    viewer.container.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('gev:earth-spin-pause', onExternalPause);
    viewer.container.removeEventListener('wheel', pauseBriefly, true);
    root.remove();
    style.remove();
  };
}
