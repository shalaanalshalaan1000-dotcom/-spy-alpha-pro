const round = (value, digits = 2) => Number.isFinite(Number(value))
  ? Number(Number(value).toFixed(digits))
  : null;

function barsFromSamples(samples = [], timeframeMinutes = 1) {
  const span = timeframeMinutes * 60_000;
  const buckets = new Map();
  for (const sample of samples) {
    const time = Number(sample?.t);
    const price = Number(sample?.p ?? sample?.price);
    if (!Number.isFinite(time) || !Number.isFinite(price) || price <= 0) continue;
    const key = Math.floor(time / span) * span;
    const bar = buckets.get(key);
    if (!bar) buckets.set(key, {t:key, open:price, high:price, low:price, close:price});
    else {
      bar.high = Math.max(bar.high, price);
      bar.low = Math.min(bar.low, price);
      bar.close = price;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

export function bars1m(samples = []) {
  return barsFromSamples(samples, 1);
}

export function bars5m(samples = []) {
  return barsFromSamples(samples, 5);
}

export function bars15m(samples = []) {
  return barsFromSamples(samples, 15);
}

function closedBars(bars, timeframeMinutes, now) {
  const span = timeframeMinutes * 60_000;
  return bars.filter(bar => bar.t + span <= now);
}

function averageRange(bars, fallback) {
  const ranges = bars.map(bar => bar.high - bar.low).filter(value => value > 0);
  return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : fallback;
}

function context15m(closed15, price) {
  const recent = closed15.slice(-4);
  if (recent.length < 2) return {bias:'NEUTRAL', strength:0, high:null, low:null};
  const closes = recent.map(bar => bar.close);
  const high = Math.max(...recent.map(bar => bar.high));
  const low = Math.min(...recent.map(bar => bar.low));
  const delta = closes.at(-1) - closes[0];
  const atr15 = Math.max(.01, averageRange(recent, Math.max(.75, price * .00025)));
  const position = high > low ? (price - low) / (high - low) : .5;
  const up = delta > atr15 * .12 || (delta >= -atr15 * .08 && position >= .58);
  const down = delta < -atr15 * .12 || (delta <= atr15 * .08 && position <= .42);
  if (up && !down) return {bias:'BUY', strength:Math.min(15, 5 + Math.round(Math.abs(delta) / atr15 * 8)), high, low, atr15};
  if (down && !up) return {bias:'SELL', strength:Math.min(15, 5 + Math.round(Math.abs(delta) / atr15 * 8)), high, low, atr15};
  return {bias:'NEUTRAL', strength:0, high, low, atr15};
}

function oneMinuteConfirmation(closed1, side, price) {
  const recent = closed1.slice(-3);
  if (recent.length < 2) return {aligned:false, score:0};
  const first = recent[0].close;
  const last = recent.at(-1).close;
  const move = price - first;
  const aligned = side === 'BUY' ? (move >= 0 && last >= first) : (move <= 0 && last <= first);
  return {aligned, score:aligned ? 3 : 0};
}

export function analyzeGoldSignal(samples, rawPrice, now = Date.now()) {
  const price = Number(rawPrice);
  const all1 = bars1m(samples);
  const all5 = bars5m(samples);
  const all15 = bars15m(samples);
  const closed1 = closedBars(all1, 1, now);
  const closed5 = closedBars(all5, 5, now);
  const closed15 = closedBars(all15, 15, now);

  // Five completed M1 bars are enough to start the fast engine. 15m context becomes
  // authoritative as soon as two completed 15m bars exist, avoiding a long restart lockout.
  const completeness = Math.min(100, Math.round((Math.min(closed1.length, 5) / 5) * 100));
  const base = {
    status: closed1.length < 5 ? 'COLLECTING' : 'WAIT',
    action:'WAIT', candidateAction:'WAIT', side:null,
    strategy:'READING', confidence:0, readingCompleteness:completeness,
    barCount:closed1.length, barCount5m:closed5.length, barCount15m:closed15.length,
    modelTimeframes:{context:'15m', execution:'5m', confirmation:'1m'},
    sampleCount:samples.length, price:round(price),
    entry:null, entryLow:null, entryHigh:null, stopLoss:null,
    target1:null, target2:null, target3:null, target4:null, riskReward:null,
    contextBias:'NEUTRAL',
    reason:closed1.length < 5 ? `جمع بيانات M1: ${closed1.length}/5` : 'القراءة مكتملة — لا توجد إشارة مؤهلة الآن',
    updatedAt:new Date(now).toISOString()
  };
  if (!Number.isFinite(price) || price <= 0 || closed1.length < 5) return base;

  const ctx = context15m(closed15, price);
  const execution = closed5.slice(-6);

  // During the first ~30 minutes after a cold deploy there may not yet be two closed
  // 15m bars. In that temporary phase use the latest 15-minute rolling M1 structure as
  // context, but never use M1 as the primary entry generator.
  let contextBias = ctx.bias;
  let contextStrength = ctx.strength;
  if (contextBias === 'NEUTRAL' && closed15.length < 2 && closed1.length >= 8) {
    const rolling = closed1.slice(-15);
    const delta = rolling.at(-1).close - rolling[0].close;
    const atr1 = Math.max(.01, averageRange(rolling, Math.max(.5, price * .00015)));
    if (delta > atr1 * 1.2) { contextBias = 'BUY'; contextStrength = 5; }
    else if (delta < -atr1 * 1.2) { contextBias = 'SELL'; contextStrength = 5; }
  }

  const recent5 = execution.length >= 3 ? execution : closed1.slice(-5);
  const atr5 = Math.max(.01, averageRange(recent5, Math.max(.75, price * .00018)));
  const reference = recent5.slice(-3);
  const hi3 = Math.max(...reference.map(bar => bar.high));
  const lo3 = Math.min(...reference.map(bar => bar.low));
  const execCloses = recent5.map(bar => bar.close);
  const execBias = execCloses.at(-1) - execCloses[0];
  const liveFromExec = price - execCloses[0];

  let side = null;
  let strategy = null;
  let confidence = 0;
  let stop = null;
  let entryBase = null;
  let structureAt = null;

  // 5m execution: completed structure defines the level; the live quote triggers it.
  // We do not wait for a 15m close after context is known, which keeps entries timely.
  const breakoutUp = price >= hi3 && liveFromExec > atr5 * .55 && execBias >= -atr5 * .20;
  const breakoutDown = price <= lo3 && liveFromExec < -atr5 * .55 && execBias <= atr5 * .20;
  if (breakoutUp && contextBias !== 'SELL') {
    side = 'BUY';
    strategy = 'MTF_TREND_CONTINUATION';
    confidence = 65 + contextStrength + Math.min(10, Math.round(Math.abs(liveFromExec) / Math.max(atr5, .01) * 4));
    stop = Math.min(...reference.map(bar => bar.low)) - .25;
    entryBase = hi3;
    structureAt = reference.at(-1)?.t ?? Math.floor(now / 300_000) * 300_000;
  } else if (breakoutDown && contextBias !== 'BUY') {
    side = 'SELL';
    strategy = 'MTF_TREND_CONTINUATION';
    confidence = 65 + contextStrength + Math.min(10, Math.round(Math.abs(liveFromExec) / Math.max(atr5, .01) * 4));
    stop = Math.max(...reference.map(bar => bar.high)) + .25;
    entryBase = lo3;
    structureAt = reference.at(-1)?.t ?? Math.floor(now / 300_000) * 300_000;
  }

  // ICT reversal on the 5m execution structure. The higher-timeframe context may be
  // neutral or aligned, but a reversal is blocked when it directly fights a clear 15m bias.
  if (!side && recent5.length >= 5) {
    for (let index = Math.max(3, recent5.length - 3); index < recent5.length; index += 1) {
      const prior = recent5.slice(Math.max(0, index - 3), index);
      const sweep = recent5[index];
      if (prior.length < 3) continue;
      const priorHigh = Math.max(...prior.map(bar => bar.high));
      const priorLow = Math.min(...prior.map(bar => bar.low));
      const bullBreak = Math.max(...prior.slice(-2).map(bar => bar.high));
      const bearBreak = Math.min(...prior.slice(-2).map(bar => bar.low));
      const bullSweep = sweep.low < priorLow && sweep.close > priorLow;
      const bearSweep = sweep.high > priorHigh && sweep.close < priorHigh;
      const bullMss = bullSweep && price >= bullBreak;
      const bearMss = bearSweep && price <= bearBreak;
      if (bullMss && contextBias !== 'SELL') {
        side = 'BUY'; strategy = 'MTF_ICT_REVERSAL'; confidence = 70 + contextStrength;
        stop = sweep.low - .25; entryBase = bullBreak; structureAt = sweep.t;
        break;
      }
      if (bearMss && contextBias !== 'BUY') {
        side = 'SELL'; strategy = 'MTF_ICT_REVERSAL'; confidence = 70 + contextStrength;
        stop = sweep.high + .25; entryBase = bearBreak; structureAt = sweep.t;
        break;
      }
    }
  }

  if (!side) {
    const impulse = Math.min(60, Math.round(Math.abs(liveFromExec) / Math.max(atr5, .01) * 20));
    return {...base, status:'WAIT', confidence:impulse, contextBias,
      reason:contextBias === 'NEUTRAL'
        ? 'سياق 15m محايد — ننتظر نموذج 5m أوضح'
        : `اتجاه 15m ${contextBias === 'BUY' ? 'صاعد' : 'هابط'} — لا يوجد تفعيل 5m صالح الآن`};
  }

  const confirm1 = oneMinuteConfirmation(closed1, side, price);
  confidence = Math.min(92, confidence + confirm1.score);

  const chaseDistance = Math.abs(price - entryBase);
  const maxChase = Math.max(1.25, atr5 * .65);
  if (chaseDistance > maxChase) {
    return {...base, status:'WAIT', candidateAction:'WAIT', confidence, strategy, contextBias,
      reason:'NO CHASE: تجاوز السعر نطاق دخول 5m؛ أُلغيت المطاردة وننتظر بنية جديدة'};
  }

  const risk = Math.abs(entryBase - stop);
  if (risk < .6 || risk > 6) {
    return {...base, status:'WAIT', candidateAction:side, confidence, strategy, contextBias,
      reason:risk < .6 ? 'إشارة 5m موجودة لكن وقف الخسارة قريب جدًا' : 'إشارة 5m موجودة لكن وقف الخسارة أوسع من 6$'};
  }

  const direction = side === 'BUY' ? 1 : -1;
  // 1m confirmation only tightens the entry zone; it never creates or reverses a trade.
  const halfBase = confirm1.aligned ? atr5 * .14 : atr5 * .18;
  const half = Math.min(.8, Math.max(.20, halfBase));
  const distance1 = Math.max(1.8, risk * 1.4);
  const distance2 = Math.max(3, risk * 2);
  const distance3 = Math.max(4, risk * 2.5);
  const distance4 = Math.max(5, risk * 3);
  const setupId = [side, strategy, structureAt, contextBias, round(entryBase), round(stop)].join('|');

  return {
    ...base,
    status:'CANDIDATE', candidateAction:side, side, strategy, confidence,
    contextBias, oneMinuteConfirmed:confirm1.aligned,
    setupId, structureAt,
    entry:round(entryBase), entryLow:round(entryBase - half), entryHigh:round(entryBase + half), stopLoss:round(stop),
    target1:round(entryBase + direction * distance1), target2:round(entryBase + direction * distance2),
    target3:round(entryBase + direction * distance3), target4:round(entryBase + direction * distance4),
    riskReward:round(distance4 / risk, 2),
    reason:strategy === 'MTF_ICT_REVERSAL'
      ? `ICT 5m متوافق مع سياق 15m${confirm1.aligned ? ' + تأكيد 1m' : ''} — التفعيل عند أول لمس`
      : `استمرار 5m متوافق مع سياق 15m${confirm1.aligned ? ' + تأكيد 1m' : ''} — التفعيل عند أول لمس`
  };
}
