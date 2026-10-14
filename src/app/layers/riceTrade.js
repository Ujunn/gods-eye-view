import { createRiceTradeLayer } from '../../layers/riceTrade/index.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
  governorRequestRender,
} from '../../renderGovernor.js';

// Keep the project-specific renderer policy out of the reusable layer module.
export function createApplicationRiceTrade() {
  return createRiceTradeLayer({
    render: {
      hold: holdContinuousRender,
      release: releaseContinuousRender,
      request: governorRequestRender,
    },
  });
}
