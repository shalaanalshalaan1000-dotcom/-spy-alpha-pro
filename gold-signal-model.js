const round = (value, digits = 2) => Number.isFinite(Number(value))
  ? Number(Number(value).toFixed(digits))
  : null;

export function bars1m(samples = []) {
  const minutes = new Map();
  for (const sample of samples) {
    const time = Number(sample?.t);
    const price = Number(sample?.p ?? sample?.price);
    if (!Number.isFinite(time) || !Number.isFinite(price) || price <= 0) continue;
    const key = Math.floor(time / 60_000) * 60_000;
    const bar = minutes.get(key);
    if (!bar) minutes.set(key, {t:key, open:price, high:price, low:price, close:price});
    else {
      bar.high = Math.max(bar.high, price);
      bar.low = Math.min(bar.low, price);
      bar.close = price;
    }
  }
  return [...minutes.values()].sort((a, b) => a.t - b.t);
}

export function analyzeGoldSignal(samples, rawPrice, now = Date.now()) {
  const price = Number(rawPrice);
  const allBars = bars1m(samples);
  const closed = allBars.filter(bar => bar.t + 60_000 <= now);
  const completeness = Math.min(100, Math.round((Math.min(closed.length, 5) / 5) * 100));
  const recent = closed.slice(-8);
  const base = {
    status: closed.length < 5 ? 'COLLECTING' : 'WAIT',
    action:'WAIT', candidateAction:'WAIT', side:null,
    strategy:'READING', confidence:0, readingCompleteness:completeness,
    barCount:closed.length, sampleCount:samples.length, price:round(price),
    entry:null, entryLow:null, entryHigh:null, stopLoss:null,
    target1:null, target2:null, target3:null, target4:null, riskReward:null,
    reason:closed.length < 5 ? `جمع بيانات M1: ${closed.length}/5` : 'القراءة مكتملة — لا توجد إشارة مؤهلة الآن',
    updatedAt:new Date(now).toISOString()
  };
  if (!Number.isFinite(price) || price <= 0 || closed.length < 5) return base;

  const ranges = recent.map(bar => bar.high - bar.low).filter(value => value > 0);
  const atr = ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : Math.max(.5, price * .00015);
  const closes = recent.slice(-5).map(bar => bar.close);
  const reference = recent.slice(-3);
  const hi3 = Math.max(...reference.map(bar => bar.high));
  const lo3 = Math.min(...reference.map(bar => bar.low));
  const closedBias = closes.at(-1) - closes[0];
  const liveMomentum = price - closes[0];
  let side = null;
  let strategy = null;
  let confidence = 0;
  let stop = null;
  let entryBase = null;
  let structureAt = null;

  // The completed bars define the structure; the live quote triggers it. This removes
  // the extra one-minute candle-close delay without removing the trend/volatility gate.
  const liveTrendUp = price >= hi3 && liveMomentum > atr * .75 && closedBias >= -atr * .15;
  const liveTrendDown = price <= lo3 && liveMomentum < -atr * .75 && closedBias <= atr * .15;
  if (liveTrendUp) {
    side = 'BUY';
    strategy = 'TREND_CONTINUATION';
    confidence = 65 + Math.min(15, Math.round(Math.abs(liveMomentum) / Math.max(atr, .01) * 7));
    stop = Math.min(...reference.map(bar => bar.low)) - .25;
    entryBase = hi3;
    structureAt = Math.floor(now / 60_000) * 60_000;
  } else if (liveTrendDown) {
    side = 'SELL';
    strategy = 'TREND_CONTINUATION';
    confidence = 65 + Math.min(15, Math.round(Math.abs(liveMomentum) / Math.max(atr, .01) * 7));
    stop = Math.max(...reference.map(bar => bar.high)) + .25;
    entryBase = lo3;
    structureAt = Math.floor(now / 60_000) * 60_000;
  }

  // A completed sweep is still required for ICT reversal, but its MSS break may be
  // triggered by the live quote instead of waiting for that minute to close.
  if (!side && recent.length >= 6) {
    for (let index = Math.max(4, recent.length - 4); index < recent.length; index += 1) {
      const prior = recent.slice(Math.max(0, index - 4), index);
      const sweep = recent[index];
      if (prior.length < 3) continue;
      const after = recent.slice(index + 1);
      const priorHigh = Math.max(...prior.map(bar => bar.high));
      const priorLow = Math.min(...prior.map(bar => bar.low));
      const bullBreak = Math.max(...prior.slice(-2).map(bar => bar.high));
      const bearBreak = Math.min(...prior.slice(-2).map(bar => bar.low));
      const bullSweep = sweep.low < priorLow && sweep.close > priorLow;
      const bearSweep = sweep.high > priorHigh && sweep.close < priorHigh;
      const bullMss = bullSweep && (after.some(bar => bar.close > bullBreak) || price >= bullBreak);
      const bearMss = bearSweep && (after.some(bar => bar.close < bearBreak) || price <= bearBreak);
      if (bullMss) {
        side = 'BUY'; strategy = 'ICT_REVERSAL'; confidence = 72;
        stop = sweep.low - .25; entryBase = bullBreak; structureAt = sweep.t;
        break;
      }
      if (bearMss) {
        side = 'SELL'; strategy = 'ICT_REVERSAL'; confidence = 72;
        stop = sweep.high + .25; entryBase = bearBreak; structureAt = sweep.t;
        break;
      }
    }
  }

  if (!side) {
    const impulse = Math.min(60, Math.round(Math.abs(liveMomentum) / Math.max(atr, .01) * 20));
    return {...base, status:'WAIT', confidence:impulse, reason:'القراءة 100% — الثقة الحالية لا تكفي لدخول جديد'};
  }

  confidence = Math.min(90, confidence);
  const chaseDistance = Math.abs(price - entryBase);
  const maxChase = Math.max(1.25, atr * .75);
  if (chaseDistance > maxChase) {
    return {...base, status:'WAIT', candidateAction:'WAIT', confidence, strategy,
      reason:'NO CHASE: تجاوز السعر نطاق الدخول؛ أُلغيت المطاردة وننتظر بنية جديدة'};
  }
  const risk = Math.abs(entryBase - stop);
  if (risk < .6 || risk > 6) {
    return {...base, status:'WAIT', candidateAction:side, confidence, strategy,
      reason:risk < .6 ? 'إشارة موجودة لكن وقف الخسارة قريب جدًا' : 'إشارة موجودة لكن وقف الخسارة أوسع من 6$'};
  }

  const direction = side === 'BUY' ? 1 : -1;
  const half = Math.min(.8, Math.max(.20, atr * .18));
  const distance1 = Math.max(1.8, risk * 1.4);
  const distance2 = Math.max(3, risk * 2);
  const distance3 = Math.max(4, risk * 2.5);
  const distance4 = Math.max(5, risk * 3);
  const setupId = [side, strategy, structureAt, round(entryBase), round(stop)].join('|');
  return {
    ...base,
    status:'CANDIDATE', candidateAction:side, side, strategy, confidence,
    setupId, structureAt,
    entry:round(entryBase), entryLow:round(entryBase - half), entryHigh:round(entryBase + half), stopLoss:round(stop),
    target1:round(entryBase + direction * distance1), target2:round(entryBase + direction * distance2),
    target3:round(entryBase + direction * distance3), target4:round(entryBase + direction * distance4),
    riskReward:round(distance4 / risk, 2),
    reason:strategy === 'ICT_REVERSAL' ? 'ICT reversal مكتمل — التفعيل عند أول لمس' : 'استمرار ترند حي — التفعيل عند أول لمس'
  };
}
