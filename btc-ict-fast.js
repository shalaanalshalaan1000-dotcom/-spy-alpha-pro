// Compatibility wrapper: BTC runtime uses the Laura + Precision Sunday-trial hybrid.
// Legacy callers keep the same import path while the entry model is W1/D1/H4/H1 -> POI -> M5 precision.
export { getBtcSignal, analyzeBtcLaura, analyzeBtcLauraPrecision, injectBtcPanel } from './btc-laura-precision-engine.js';
