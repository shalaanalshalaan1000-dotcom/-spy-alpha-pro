// Compatibility wrapper: BTC runtime uses Laura classical price action only.
// No ICT/SMC/Precision hybrid gates are allowed in the BTC decision path.
export { getBtcSignal, analyzeBtcLaura, injectBtcPanel } from './btc-laura-engine.js';
export { analyzeBtcLaura as analyzeBtcLauraPrecision } from './btc-laura-engine.js';
