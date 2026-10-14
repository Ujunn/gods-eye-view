/** A scoped second-level control for the four custom FAOSTAT data-layer rows.
 *  The normal panel owns its event subscription; this module only builds DOM.
 */
export function createTradeRouteSlider(range, bind, onInput) {
  if (!range || typeof bind !== 'function' || typeof onInput !== 'function')
    throw new TypeError('Missing trade route slider descriptor');
  const container = document.createElement('div');
  container.className = 'gev-trade-route-slider';
  container.style.cssText = [
    'margin:8px 1px 7px', 'padding:10px 11px 12px',
    'border:1px solid rgba(136,156,189,.18)', 'border-radius:9px',
    'background:rgba(6,12,23,.88)', 'box-sizing:border-box',
  ].join(';');

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:9px;';
  const label = document.createElement('label');
  label.textContent = '显示贸易线路';
  label.style.cssText = 'font:500 11px ui-monospace,monospace;letter-spacing:.12em;color:#a9afbc;';
  const value = document.createElement('output');
  value.className = 'gev-trade-route-slider-value';
  value.style.cssText = 'font:600 12px ui-monospace,monospace;white-space:nowrap;';
  row.append(label, value);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'gev-trade-route-slider-input';
  slider.style.cssText = 'display:block;width:100%;margin:0;cursor:pointer;';
  const uniqueId = `gev-range-${String(range.crop || range.id || 'routes')}`;
  slider.id = uniqueId;
  label.htmlFor = uniqueId;
  value.htmlFor = uniqueId;
  bind(slider, 'input', () => {
    value.textContent = `${Number(slider.value)} / ${Number(slider.max)}`;
    onInput(Number(slider.value), range.id);
  });
  container.append(row, slider);
  syncTradeRouteSlider(container, range);
  return container;
}

export function syncTradeRouteSlider(container, range) {
  if (!container || !range) return;
  const slider = container.querySelector('.gev-trade-route-slider-input');
  const output = container.querySelector('.gev-trade-route-slider-value');
  if (!slider || !output) return;
  const max = Math.max(0, Number(range.max) || 0);
  const min = Math.max(0, Number(range.min) || 0);
  const current = Math.min(max, Math.max(min, Number(range.value) || 0));
  const attr = { min: String(min), max: String(max), step: String(range.step || 1), value: String(current) };
  for (const [key, val] of Object.entries(attr)) if (slider[key] !== val) slider[key] = val;
  const accent = range.color || '#35d0ff';
  slider.style.accentColor = accent;
  output.style.color = accent;
  output.textContent = `${current} / ${max}`;
  slider.title = `贸易量排名前 ${current} 条（最多 ${max} 条）`;
}
