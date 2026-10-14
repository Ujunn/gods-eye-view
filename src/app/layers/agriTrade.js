import { holdContinuousRender, releaseContinuousRender, governorRequestRender } from '../../renderGovernor.js';
import { createAgriTradeLayer } from '../../layers/agriTrade/index.js';

const render = Object.freeze({
  hold: holdContinuousRender,
  release: releaseContinuousRender,
  request: governorRequestRender,
});

export function createApplicationAgriTrade(crop) {
  return createAgriTradeLayer({ crop, render });
}
