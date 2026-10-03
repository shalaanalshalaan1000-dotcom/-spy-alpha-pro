// Compatibility wrapper: BTC runtime is Laura-only.
// Legacy callers may keep importing btc-ict-fast.js, but all signal logic now comes from btc-laura-engine.js.
export { getBtcSignal, analyzeBtcLaura, injectBtcPanel } from './btc-laura-engine.js';
