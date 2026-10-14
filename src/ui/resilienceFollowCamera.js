import * as Cesium from 'cesium';
import { holdContinuousRender, releaseContinuousRender } from '../renderGovernor.js';

const CAMERA_OWNER = 'resilience-attack-follow';
const SPIN_OWNER = 'resilience-attack-follow';
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Wide-view (v7): whole-globe target follow rather than close-up.
 * One-target-at-a-time replay. The supplied order is already computed from
 * FAOSTAT by prepare.py; this camera controller NEVER reranks attacks.
 * All timers, flights, and render holds are cancellable on user input.
 */
export function createResilienceAttackFollow({
  viewer, getNode, getEdge, onAttack, onPhase, onEnd,
}) {
  if (!viewer?.camera || !viewer?.scene) throw new TypeError('A Cesium viewer is required');
  let running = false;
  let epoch = 0;
  let waitTimer = null;
  let resolveWait = null;
  let resolveFlight = null;
  let ourFlight = false;

  function releaseCamera() {
    releaseContinuousRender(CAMERA_OWNER);
    window.dispatchEvent(new CustomEvent('gev:earth-spin-resume', {
      detail: { owner: SPIN_OWNER },
    }));
  }

  function stop(reason = 'paused') {
    const wasRunning = running;
    running = false;
    epoch++;
    if (waitTimer !== null) clearTimeout(waitTimer);
    waitTimer = null;
    const settleWait = resolveWait;
    resolveWait = null;
    settleWait?.();
    if (ourFlight && !viewer.isDestroyed?.()) {
      ourFlight = false;
      viewer.camera.cancelFlight();
    }
    const settleFlight = resolveFlight;
    resolveFlight = null;
    settleFlight?.();
    if (wasRunning) {
      releaseCamera();
      onEnd?.(reason);
    }
  }

  function wait(ms) {
    return new Promise(resolve => {
      resolveWait = () => { resolveWait = null; resolve(); };
      waitTimer = setTimeout(() => {
        waitTimer = null;
        resolveWait?.();
      }, ms);
    });
  }

  function focusTarget(mode, id, durationSeconds) {
    const isNode = mode.startsWith('node-');
    let sphere;
    let range;
    let pitch;
    let name;
    try {
      if (isNode) {
        const n = getNode(id);
        if (!n || !Number.isFinite(n.lon) || !Number.isFinite(n.lat)) return Promise.resolve(null);
        sphere = new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(n.lon, n.lat), 400_000);
        range = 17_000_000;
        pitch = -Cesium.Math.PI_OVER_TWO + .13;
        name = n.name || id;
      } else {
        const edge = getEdge(id);
        if (!edge) return Promise.resolve(null);
        const a = getNode(edge.source), b = getNode(edge.target);
        if (!a || !b) return Promise.resolve(null);
        const start = Cesium.Cartographic.fromDegrees(a.lon, a.lat);
        const end = Cesium.Cartographic.fromDegrees(b.lon, b.lat);
        const geodesic = new Cesium.EllipsoidGeodesic(start, end);
        const points = [];
        const elevation = Math.min(1_100_000, Math.max(140_000, geodesic.surfaceDistance * .1));
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const p = geodesic.interpolateUsingFraction(t);
          points.push(Cesium.Cartesian3.fromRadians(
            p.longitude, p.latitude, 16_000 + Math.sin(t * Math.PI) * elevation,
          ));
        }
        sphere = Cesium.BoundingSphere.fromPoints(points);
        range = clamp(sphere.radius * 3.3, 17_000_000, 29_000_000);
        pitch = -Cesium.Math.PI_OVER_TWO + .18;
        name = `${a.name || a.id} → ${b.name || b.id}`;
      }
    } catch (error) {
      console.warn('[Resilience Follow] Focus calculation failed:', error);
      return Promise.resolve(null);
    }
    if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return Promise.resolve(name);
    viewer.trackedEntity = undefined;
    // Preserve Cesium's usual drag/zoom semantics. We never disable the camera controller.
    return new Promise(resolve => {
      let finished = false;
      const settle = () => {
        if (finished) return;
        finished = true;
        resolveFlight = null;
        ourFlight = false;
        resolve(name);
      };
      resolveFlight = settle;
      ourFlight = true;
      try {
        viewer.camera.flyToBoundingSphere(sphere, {
          duration: durationSeconds,
          offset: new Cesium.HeadingPitchRange(0, pitch, range),
          complete: settle,
          cancel: settle,
        });
      } catch (error) {
        console.warn('[Resilience Follow] Camera flight failed:', error);
        settle();
      }
    });
  }

  async function play({ mode, order, fromCount = 0, secondsPerTarget = 4 }) {
    stop('superseded');
    if (!Array.isArray(order) || !order.length) return false;
    if (fromCount >= order.length) return false;
    const generation = ++epoch;
    running = true;
    const duration = clamp(secondsPerTarget, 2, 10);
    holdContinuousRender(CAMERA_OWNER);
    window.dispatchEvent(new CustomEvent('gev:earth-spin-suspend', {
      detail: { owner: SPIN_OWNER },
    }));
    try {
      for (let i = fromCount; i < order.length; i++) {
        if (!running || generation !== epoch) return true;
        const id = order[i];
        const secondsToFly = Math.min(1.45, duration * .38);
        const targetLabel = mode.startsWith('node-')
          ? (getNode(id)?.name || id)
          : (() => { const e=getEdge(id), a=e&&getNode(e.source), b=e&&getNode(e.target);
              return e ? `${a?.name||e.source} → ${b?.name||e.target}` : id; })();
        onPhase?.({ phase: 'locating', id, name: targetLabel, index: i + 1, total: order.length });
        const targetName = await focusTarget(mode, id, secondsToFly);
        if (!running || generation !== epoch) return true;
        onAttack?.({ id, index: i + 1, total: order.length, name: targetName });
        onPhase?.({ phase: 'attacked', id, index: i + 1, total: order.length, name: targetName });
        await wait(Math.max(400, duration * 1000 - secondsToFly * 1000));
      }
      if (running && generation === epoch) stop('finished');
    } catch (error) {
      console.error('[Resilience Follow] Replay interrupted:', error);
      if (running && generation === epoch) stop('error');
    }
    return true;
  }

  return { play, stop, isRunning: () => running };
}

