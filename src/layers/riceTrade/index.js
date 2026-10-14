import * as Cesium from 'cesium';
import { generateRiceTradeData } from './data.js';

const HOLD_ID = 'rice-trade';
const SAMPLES = 48;

function createArc(from, to) {
  const start = Cesium.Cartographic.fromDegrees(from.lon, from.lat);
  const end = Cesium.Cartographic.fromDegrees(to.lon, to.lat);
  const geodesic = new Cesium.EllipsoidGeodesic(start, end);
  const height = Math.min(1_100_000, Math.max(130_000, geodesic.surfaceDistance * 0.11));
  const positions = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const point = geodesic.interpolateUsingFraction(t);
    // Elevated arc: symbolic trade connection, not actual ship/flight path.
    positions.push(Cesium.Cartesian3.fromRadians(
      point.longitude,
      point.latitude,
      12_000 + Math.sin(Math.PI * t) * height,
    ));
  }
  return positions;
}

/** A data-manager-compatible, locally simulated rice trade layer. */
export function createRiceTradeLayer({ render }) {
  if (!render?.hold || !render?.release || !render?.request)
    throw new TypeError('RiceTrade requires render governor operations');

  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let seed = 20261014;
  let snapshot = null;
  let rowControlsListener = null;

  function populate() {
    if (!dataSource) return;
    snapshot = generateRiceTradeData({ seed, countryCount: 100, flowCount: 200 });
    dataSource.entities.removeAll();
    const now = performance.now();

    for (const country of snapshot.countries) {
      dataSource.entities.add({
        id: `rice-country:${country.id}`,
        position: Cesium.Cartesian3.fromDegrees(country.lon, country.lat, 14_000),
        point: {
          pixelSize: 4,
          color: Cesium.Color.fromCssColorString('#f7d77a'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
        },
      });
    }

    for (const flow of snapshot.flows) {
      const positions = createArc(flow.from, flow.to);
      const normalized = flow.volumeKt / 500;
      const width = 1.2 + Math.sqrt(normalized) * 3.8;
      const color = Cesium.Color.fromCssColorString('#47d9ff')
        .withAlpha(0.20 + 0.72 * Math.sqrt(normalized));

      dataSource.entities.add({
        id: `rice-line:${flow.id}`,
        name: `${flow.from.name} → ${flow.to.name} · ${flow.volumeKt} 千吨/年（模拟）`,
        polyline: {
          positions,
          width,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({ color, glowPower: 0.18 }),
        },
        properties: {
          from: flow.from.name,
          to: flow.to.name,
          volumeKt: flow.volumeKt,
          simulated: true,
        },
      });

      // Only the point changes per frame. Arc geometry stays static.
      dataSource.entities.add({
        id: `rice-motion:${flow.id}`,
        position: new Cesium.CallbackProperty((time, result) => {
          const seconds = (performance.now() - now) / 1000;
          const t = ((seconds / flow.durationSeconds + flow.phase) % 1 + 1) % 1;
          const scaled = t * (positions.length - 1);
          const index = Math.min(Math.floor(scaled), positions.length - 2);
          return Cesium.Cartesian3.lerp(
            positions[index], positions[index + 1], scaled - index, result || new Cesium.Cartesian3(),
          );
        }, false),
        point: {
          pixelSize: 3 + 3 * Math.sqrt(normalized),
          color: Cesium.Color.fromCssColorString('#fff3b0'),
          outlineColor: Cesium.Color.fromCssColorString('#ed9f38'),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    render.request(HOLD_ID);
    rowControlsListener?.();
  }

  return {
    id: HOLD_ID,
    name: 'Rice Trade (Simulated)',
    icon: '🌾',
    source: 'SIMULATED · NOT OBSERVED',
    updateInterval: 0,

    async init(nextViewer) {
      if (dataSource) return true;
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(HOLD_ID);
      dataSource.show = false;
      await viewer.dataSources.add(dataSource);
      return true;
    },
    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
      render.hold(HOLD_ID); // Required: God's Eye View otherwise idles the render loop.
    },
    update() {
      if (!enabled || !dataSource) return false;
      if (!snapshot) populate();
      return true;
    },
    disable() {
      enabled = false;
      if (dataSource) dataSource.show = false;
      render.release(HOLD_ID);
      render.request(HOLD_ID);
    },
    setParams(params = {}) {
      if (params.regenerate === true) {
        seed = (seed + 1) >>> 0;
        snapshot = null;
        if (enabled) populate();
        rowControlsListener?.();
      }
      return true;
    },
    getRowControls() {
      return {
        chips: [{ id: 'regenerate', label: 'REGENERATE', params: { regenerate: true } }],
        info: `DEMO ONLY · ${snapshot?.countries.length ?? 100} countries · ${snapshot?.flows.length ?? 200} random flows · 1–500 kt/year · seed ${seed}`,
        legend: [],
      };
    },
    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },
    getStats() {
      return {
        count: enabled ? (snapshot?.flows.length || 0) : 0,
        countLabel: enabled && snapshot ? `${snapshot.flows.length} routes` : undefined,
        lastUpdate: null,
        error: null,
      };
    },
    destroy() {
      render.release(HOLD_ID);
      if (dataSource && viewer && !viewer.isDestroyed())
        viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      viewer = null;
      snapshot = null;
      enabled = false;
      rowControlsListener = null;
    },
  };
}
