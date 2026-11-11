export function m1AnalysisFresh(model, samples, now = Date.now()) {
  const read = model?.multiTimeframe?.reads?.M1;
  if (!read?.ready || !Number.isFinite(Number(read.bars))) return false;
  const closed = samples.filter(x => Number.isFinite(Number(x.t)) && Number(x.t) + 60_000 <= now)
    .sort((a, b) => Number(a.t) - Number(b.t));
  const last = closed.at(-1);
  if (!last || now - Number(last.t) > 3 * 60_000) return false;
  if (closed.length - Number(read.bars) > 2) return false;
  const close = Number(last.close ?? last.p ?? last.price);
  return Number.isFinite(close) && Number.isFinite(Number(read.currentClose))
    && Math.abs(close - Number(read.currentClose)) <= 0.011;
}

export function newsEntryBlocked(risk) {
  return !risk || risk.available !== true || risk.blockEntries === true
    || risk.level === 'EXTREME' || risk.level === 'HIGH'
    || risk.activeEvent?.impact === 'HIGH';
}
