// Advisory-only HTF context for gold. This module must not gate or reprioritize ICT entries.
function direction(value) {
  if (value === 1 || value === '1' || String(value).toUpperCase() === 'BUY' || String(value).toUpperCase() === 'UP') return 'BUY';
  if (value === -1 || value === '-1' || String(value).toUpperCase() === 'SELL' || String(value).toUpperCase() === 'DOWN') return 'SELL';
  if (value === 0 || value === '0' || String(value).toUpperCase() === 'NEUTRAL') return 'NEUTRAL';
  return null;
}

export function classifyGoldTimeframeAlignment(source = {}) {
  const trade = source.tradeState || {};
  const activeSide = trade.active === true ? direction(trade.side) : null;
  const side = activeSide || direction(source.side) || direction(source.candidateAction) || null;
  const ict = source.ict || source.liquidityContext || {};
  const reads = source.multiTimeframe?.reads || source.confluence?.multiTimeframe?.reads || {};
  const h4 = direction(ict.dir4 ?? reads.H4?.side);
  const h1 = direction(ict.dir1 ?? reads.H1?.side);
  const classification = !side ? 'NO_SETUP' : !h4 ? 'UNKNOWN' : h4 === 'NEUTRAL' ? 'NEUTRAL_HTF'
    : side === h4 ? 'WITH_TREND' : 'COUNTER_TREND';
  return {
    classification, side, h4Side: h4 || 'UNKNOWN', h1Side: h1 || 'UNKNOWN',
    h1Aligned: !side || !h1 || h1 === 'NEUTRAL' ? null : side === h1,
    advisoryOnly: true, entryGate: false,
    methodology: 'H4 PRIMARY / H1 SECONDARY / ICT M5 ENTRY UNCHANGED'
  };
}

export function withGoldTimeframeAlignment(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  return {...source, timeframeAlignment: classifyGoldTimeframeAlignment(source)};
}
