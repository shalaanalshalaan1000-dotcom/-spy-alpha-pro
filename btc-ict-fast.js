// Compatibility facade: BTC strategy is Laura-only.
// Existing imports keep this filename, but no ICT/SMC logic runs from here.
export { getBtcSignal, injectBtcPanel, analyzeBtcLaura } from './btc-laura-engine.js';
