import * as Cesium from 'cesium';

// FAOSTAT data is kept as JSON under public/data/trade/<crop>_2022.json.
// Each data source owns its own Cesium entities, billboards and animation listener.
const CROPS = Object.freeze({
  rice: { title: 'Rice 2022 (FAOSTAT)', color: '#35D0FF', icon: '🍚' },
  wheat: { title: 'Wheat 2022 (FAOSTAT)', color: '#F6C445', icon: '🌾' },
  maize: { title: 'Maize 2022 (FAOSTAT)', color: '#7ED957', icon: '🌽' },
  soybeans: { title: 'Soybeans 2022 (FAOSTAT)', color: '#B57CFF', icon: '🫘' },
});
const SEGMENTS = 48;
const TONNE_BREAKS = [20_000, 100_000, 300_000, 1_000_000, 5_000_000];

function arrowsForTonnes(volume) {
  return 1 + TONNE_BREAKS.filter((minimum) => volume >= minimum).length;
}

function arcPositions(from, to) {
  const origin = Cesium.Cartographic.fromDegrees(from.lon, from.lat);
  const destination = Cesium.Cartographic.fromDegrees(to.lon, to.lat);
  const greatCircle = new Cesium.EllipsoidGeodesic(origin, destination);
  const rise = Math.min(1_100_000, Math.max(130_000, greatCircle.surfaceDistance * 0.10));
  const positions = [];
  for (let index = 0; index <= SEGMENTS; index++) {
    const fraction = index / SEGMENTS;
    const point = greatCircle.interpolateUsingFraction(fraction);
    positions.push(Cesium.Cartesian3.fromRadians(
      point.longitude,
      point.latitude,
      16_000 + Math.sin(fraction * Math.PI) * rise,
    ));
  }
  return positions;
}

function pointOnArc(positions, fraction, target) {
  const step = Math.max(0, Math.min(positions.length - 1.000001, fraction * (positions.length - 1)));
  const index = Math.floor(step);
  return Cesium.Cartesian3.lerp(positions[index], positions[index + 1], step - index, target);
}

// A cyan/gold/green/purple glowing chevron, pointing "up" initially.
// Billboard rotation is updated to match each arc's on-screen tangent.
function makeArrowCanvas(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 44;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for agri trade arrows');
  ctx.strokeStyle = color;
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(9, 27);
  ctx.lineTo(22, 12);
  ctx.lineTo(35, 27);
  ctx.stroke();
  return canvas;
}

function validateRoute(route) {
  return (
    route && route.from && route.to &&
    Number.isFinite(route.from.lon) && Number.isFinite(route.from.lat) &&
    Number.isFinite(route.to.lon) && Number.isFinite(route.to.lat) &&
    Number.isFinite(route.volumeTonnes) && route.volumeTonnes > 0 &&
    Math.abs(route.from.lon) <= 180 && Math.abs(route.to.lon) <= 180 &&
    Math.abs(route.from.lat) <= 90 && Math.abs(route.to.lat) <= 90 &&
    !(route.from.lon === route.to.lon && route.from.lat === route.to.lat)
  );
}

export function createAgriTradeLayer({ crop, render }) {
  const spec = CROPS[crop];
  if (!spec) throw new TypeError(`Unknown agricultural crop: ${crop}`);
  if (!render?.hold || !render?.release || !render?.request)
    throw new TypeError('Agricultural trade layer requires render-governor hooks');

  const id = `agri-${crop}-2022`;
  const sourceId = `agri-trade:${crop}`;
  const color = Cesium.Color.fromCssColorString(spec.color);
  let viewer = null;
  let dataSource = null;
  let billboards = null;
  let removeFrameListener = null;
  let active = false;
  let loaded = false;
  let loading = null;
  let abortFetch = null;
  let rows = [];
  let selection = null;
  let lastError = null;
  let lastUpdate = null;
  let listener = null;
  let startMs = 0;
  let arrows = [];
  let graphics = [];
  let routeLimit = 30; // Default to 30 strongest trade links per crop.

  function removeGraphics() {
    dataSource?.entities.removeAll();
    billboards?.removeAll();
    arrows = [];
    graphics = [];
  }

  function displayedCount() {
    return Math.max(0, Math.min(routeLimit, graphics.length));
  }

  function syncVisibility() {
    const visibleCount = displayedCount();
    for (let index = 0; index < graphics.length; index++) {
      const visible = index < visibleCount;
      graphics[index].entity.show = visible;
      for (const billboard of graphics[index].billboards) billboard.show = visible;
    }
    if (active && visibleCount > 0) render.hold(id);
    else render.release(id);
    render.request(id);
    listener?.();
  }

  function animate() {
    if (!active || !billboards || !viewer || viewer.isDestroyed()) return;
    const secs = (performance.now() - startMs) / 1000;
    const scene = viewer.scene;
    const p1 = new Cesium.Cartesian3();
    const p2 = new Cesium.Cartesian3();
    for (const entry of arrows) {
      if (!entry.billboard.show) continue;
      const progress = ((secs / entry.seconds + entry.offset + entry.phase) % 1 + 1) % 1;
      // Use a small forward tangent for screen rotation.
      const t = 0.015 + progress * 0.97;
      const target = pointOnArc(entry.positions, t, p1);
      const lookAhead = pointOnArc(entry.positions, Math.min(0.995, t + 0.008), p2);
      entry.billboard.position = target;
      const a = Cesium.SceneTransforms.worldToWindowCoordinates(scene, target);
      const b = Cesium.SceneTransforms.worldToWindowCoordinates(scene, lookAhead);
      if (a && b && Number.isFinite(a.x + a.y + b.x + b.y)) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.01) entry.billboard.rotation = Math.atan2(-dx, -dy);
      }
    }
  }

  function paint() {
    if (!dataSource || !billboards) return;
    removeGraphics();
    const biggest = Math.max(1, ...rows.map((row) => row.volumeTonnes));
    const image = makeArrowCanvas(spec.color);
    for (const [routeIndex, row] of rows.entries()) {
      if (!validateRoute(row)) continue;
      let positions;
      try { positions = arcPositions(row.from, row.to); }
      catch (err) { console.warn(`[${id}] Skipped invalid geodesic ${row.id}:`, err); continue; }
      const strength = Math.sqrt(Math.max(0, row.volumeTonnes) / biggest);
      const entity = dataSource.entities.add({
        id: `${sourceId}:${row.id}`,
        name: `${row.from.name} → ${row.to.name} · ${row.volumeTonnes.toLocaleString()} t · 2022`,
        polyline: {
          positions,
          arcType: Cesium.ArcType.NONE,
          width: 1.0 + 3.1 * strength,
          // Restore the original thin visual weight; keep true solid-color strokes, no glow.
          material: new Cesium.ColorMaterialProperty(color.withAlpha(0.91)),
        },
        properties: {
          simulated: false,
          year: 2022,
          crop,
          exporter: row.from.name,
          importer: row.to.name,
          volumeTonnes: row.volumeTonnes,
          quantitySource: row.quantitySource,
          tradeValue1000USD: row.tradeValue1000USD,
        },
      });
      const count = arrowsForTonnes(row.volumeTonnes);
      const phase = (routeIndex * 0.137) % 1;
      const routeGraphic = { entity, billboards: [] };
      const seconds = 7 + (1 - strength) * 5;
      for (let arrowIndex = 0; arrowIndex < count; arrowIndex++) {
        const billboard = billboards.add({
          position: positions[0],
          width: 19,
          height: 19,
          color: Cesium.Color.WHITE.withAlpha(0.58 + 0.4 * strength),
          // Occlusion by the globe is desired: hide routes behind the planet.
          disableDepthTestDistance: 0,
        });
        routeGraphic.billboards.push(billboard);
        // Cesium's texture atlas can reuse one image per crop rather than
        // allocating a distinct canvas texture for every chevron.
        billboard.setImage(`${sourceId}:chevron`, image);
        arrows.push({
          positions,
          seconds,
          phase,
          offset: arrowIndex / count,
          billboard,
        });
      }
      graphics.push(routeGraphic);
    }
    startMs = performance.now();
    syncVisibility();
  }

  return {
    id,
    name: spec.title,
    icon: spec.icon,
    source: 'FAOSTAT TM · 2022 · EXPORT TONNES',
    updateInterval: 0,
    async init(nextViewer) {
      if (dataSource) return true;
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(sourceId);
      dataSource.show = false;
      await viewer.dataSources.add(dataSource);
      billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
      billboards.show = false;
      removeFrameListener = viewer.scene.preRender.addEventListener(animate);
      return true;
    },
    enable() {
      active = true;
      if (dataSource) dataSource.show = true;
      if (billboards) billboards.show = true;
      syncVisibility();
      return true;
    },
    async update(_viewer, { signal } = {}) {
      if (!active || !dataSource) return false;
      if (loaded) return true;
      if (loading) return loading;
      const controller = new AbortController();
      abortFetch = controller;
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      loading = (async () => {
        try {
          const response = await fetch(`/data/trade/${crop}_2022.json`, { signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${crop}_2022.json`);
          const payload = await response.json();
          if (payload?.crop !== crop || payload?.year !== 2022 || payload?.simulated !== false || !Array.isArray(payload?.routes))
            throw new Error(`Unexpected dataset structure in ${crop}_2022.json`);
          if (!active || controller.signal.aborted) return false;
          // The JSON contains already-filtered real flows. Re-sort so top-N
          // display always means the N greatest 2022 quantities.
          rows = payload.routes.filter(validateRoute).sort((a, b) =>
            b.volumeTonnes - a.volumeTonnes || String(a.id).localeCompare(String(b.id)));
          selection = payload.selection;
          routeLimit = Math.min(routeLimit, rows.length);
          if (!rows.length) throw new Error(`No trade routes found in ${crop}_2022.json`);
          paint();
          loaded = true;
          lastError = null;
          lastUpdate = Date.now();
          return true;
        } catch (error) {
          if (controller.signal.aborted) return false;
          lastError = error?.message || String(error);
          throw error;
        } finally {
          signal?.removeEventListener('abort', cancel);
          if (abortFetch === controller) abortFetch = null;
          loading = null;
        }
      })();
      return loading;
    },
    disable() {
      active = false;
      abortFetch?.abort();
      if (dataSource) dataSource.show = false;
      if (billboards) billboards.show = false;
      render.release(id);
      render.request(id);
      return true;
    },
    setParams(params = {}) {
      if (!Object.hasOwn(params, 'routeLimit')) return true;
      const next = Number(params.routeLimit);
      if (!Number.isInteger(next) || next < 0 || next > 120) return false;
      routeLimit = next;
      syncVisibility();
      return true;
    },
    getParams() { return { routeLimit }; },
    getRowControls() {
      return {
        chips: [],
        legend: [],
        range: {
          id: 'routeLimit', crop, label: 'DISPLAY ROUTES', min: 0,
          max: rows.length || 120, step: 1,
          value: Math.min(routeLimit, rows.length || 120),
          color: spec.color, suffix: 'routes',
        },
        info: `REAL · 2022 · top ${Math.min(routeLimit, rows.length)} of ${rows.length} filtered routes · ${(() => {
          const total = Number(selection?.allValidGeocodedVolumeTonnes);
          if (!total || !Number.isFinite(total)) return '—';
          const shown = rows.slice(0, routeLimit).reduce((sum, row) => sum + row.volumeTonnes, 0);
          return (shown / total * 100).toFixed(2);
        })()}% of all geocoded trade tonnes displayed. Export-reported preferred; missing exporters mirrored from importers.`,
      };
    },
    setRowControlsListener(fn) { listener = typeof fn === 'function' ? fn : null; },
    getStats() {
      return {
        count: loaded ? Math.min(routeLimit, rows.length) : 0,
        countLabel: loaded ? `${Math.min(routeLimit, rows.length)}/${rows.length} routes` : undefined,
        lastUpdate,
        error: lastError,
        source: 'FAOSTAT · 2022',
      };
    },
    destroy() {
      this.disable();
      removeFrameListener?.();
      removeFrameListener = null;
      if (billboards && viewer && !viewer.isDestroyed()) viewer.scene.primitives.remove(billboards);
      if (dataSource && viewer && !viewer.isDestroyed()) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      billboards = null;
      viewer = null;
      arrows = [];
      graphics = [];
      rows = [];
      selection = null;
      loaded = false;
      loading = null;
      listener = null;
      return true;
    },
  };
}
