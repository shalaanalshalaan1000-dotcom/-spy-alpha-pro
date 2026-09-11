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

export function bars1m(samples = []) { return barsFromSamples(samples, 1); }
export function bars5m(samples = []) { return barsFromSamples(samples, 5); }
export function bars15m(samples = []) { return barsFromSamples(samples, 15); }

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
  const up = delta > atr15 * .08 || (delta >= -atr15 * .12 && position >= .55);
  const down = delta < -atr15 * .08 || (delta <= atr15 * .12 && position <= .45);
  if (up && !down) return {bias:'BUY', strength:Math.min(12, 4 + Math.round(Math.abs(delta) / atr15 * 7)), high, low, atr15};
  if (down && !up) return {bias:'SELL', strength:Math.min(12, 4 + Math.round(Math.abs(delta) / atr15 * 7)), high, low, atr15};
  return {bias:'NEUTRAL', strength:0, high, low, atr15};
}

function oneMinuteConfirmation(closed1, side, price) {
  const recent = closed1.slice(-3);
  if (recent.length < 2) return {aligned:false, score:0};
  const first = recent[0].close;
  const last = recent.at(-1).close;
  const move = price - first;
  const aligned = side === 'BUY' ? (move >= 0 && last >= first) : (move <= 0 && last <= first);
  return {aligned, score:aligned ? 4 : 0};
}

function normalizeSampleClock(samples = [], now = Date.now()) {
  const valid = samples.filter(s => Number.isFinite(Number(s?.t)) && Number.isFinite(Number(s?.p ?? s?.price)));
  if (!valid.length) return samples;
  const latestT = Math.max(...valid.map(s => Number(s.t)));
  const skew = latestT - now;
  if (Math.abs(skew) <= 60_000) return samples;
  return samples.map(s => {
    const t = Number(s?.t);
    return Number.isFinite(t) ? {...s, t:t-skew} : s;
  });
}

export function analyzeGoldSignal(samples, rawPrice, now = Date.now()) {
  const price = Number(rawPrice);
  const alignedSamples = normalizeSampleClock(samples, now);
  const all1 = bars1m(alignedSamples);
  const all5 = bars5m(alignedSamples);
  const all15 = bars15m(alignedSamples);
  const closed1 = closedBars(all1, 1, now);
  const closed5 = closedBars(all5, 5, now);
  const closed15 = closedBars(all15, 15, now);

  const current5Key = Math.floor(now / 300_000) * 300_000;
  const completed5 = all5.filter(bar => bar.t < current5Key);
  const usable5 = closed5.length ? closed5 : completed5;
  const ready5 = usable5.length >= 1;
  const ready1 = closed1.length >= 2;
  const ready = ready5 && ready1;
  const completeness5 = Math.min(1, usable5.length);
  const completeness1 = Math.min(1, closed1.length / 2);
  const completeness = Math.round(Math.min(completeness5, completeness1) * 100);

  const base = {
    status: ready ? 'WAIT' : 'COLLECTING',
    action:'WAIT', candidateAction:'WAIT', side:null,
    strategy:'READING', confidence:0, readingCompleteness:completeness,
    barCount:closed1.length, barCount5m:usable5.length, barCount15m:closed15.length,
    modelTimeframes:{context:'15m-optional', execution:'5m', confirmation:'1m'},
    sampleCount:alignedSamples.length, price:round(price),
    entry:null, entryLow:null, entryHigh:null, stopLoss:null,
    target1:null,target2:null,target3:null,target4:null,riskReward:null,
    contextBias:'NEUTRAL',
    reason: !ready5
      ? `جمع شمعة M5 الحقيقية: ${usable5.length}/1`
      : !ready1
        ? `جمع تأكيد M1 السريع: ${closed1.length}/2`
        : 'القراءة مكتملة — لا توجد إشارة مؤهلة الآن',
    updatedAt:new Date(now).toISOString()
  };

  if (!Number.isFinite(price) || price <= 0 || !ready) return base;

  const ctx = context15m(closed15, price);
  const contextBias = ctx.bias;
  const contextStrength = ctx.strength;
  const recent5 = usable5.slice(-6);
  const atr5 = Math.max(.01, averageRange(recent5, Math.max(.75, price * .00018)));
  const reference = recent5.slice(-Math.min(3,recent5.length));
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

  // RELAXED DEMO PROFILE: react earlier to directional movement instead of waiting for a large breakout.
  const breakoutUp = price >= hi3 - atr5 * .12 && liveFromExec > atr5 * .30 && execBias >= -atr5 * .35;
  const breakoutDown = price <= lo3 + atr5 * .12 && liveFromExec < -atr5 * .30 && execBias <= atr5 * .35;
  if (breakoutUp && contextBias !== 'SELL') {
    side = 'BUY'; strategy = 'MTF_TREND_CONTINUATION'; confidence = 60 + contextStrength + Math.min(12, Math.round(Math.abs(liveFromExec) / Math.max(atr5, .01) * 5));
    stop = Math.min(...reference.map(bar => bar.low)) - .25; entryBase = Math.min(price,hi3); structureAt = reference.at(-1)?.t ?? current5Key;
  } else if (breakoutDown && contextBias !== 'BUY') {
    side = 'SELL'; strategy = 'MTF_TREND_CONTINUATION'; confidence = 60 + contextStrength + Math.min(12, Math.round(Math.abs(liveFromExec) / Math.max(atr5, .01) * 5));
    stop = Math.max(...reference.map(bar => bar.high)) + .25; entryBase = Math.max(price,lo3); structureAt = reference.at(-1)?.t ?? current5Key;
  }

  if (!side && recent5.length >= 4) {
    for (let index = Math.max(3, recent5.length - 3); index < recent5.length; index += 1) {
      const prior = recent5.slice(Math.max(0, index - 3), index);
      const sweep = recent5[index];
      if (prior.length < 3) continue;
      const priorHigh = Math.max(...prior.map(bar => bar.high));
      const priorLow = Math.min(...prior.map(bar => bar.low));
      const bullBreak = Math.max(...prior.slice(-2).map(bar => bar.high));
      const bearBreak = Math.min(...prior.slice(-2).map(bar => bar.low));
      const bullSweep = sweep.low < priorLow && sweep.close >= priorLow - atr5 * .08;
      const bearSweep = sweep.high > priorHigh && sweep.close <= priorHigh + atr5 * .08;
      const bullMss = bullSweep && price >= bullBreak - atr5 * .12;
      const bearMss = bearSweep && price <= bearBreak + atr5 * .12;
      if (bullMss && contextBias !== 'SELL') { side='BUY'; strategy='MTF_ICT_REVERSAL'; confidence=64+contextStrength; stop=sweep.low-.25; entryBase=Math.min(price,bullBreak); structureAt=sweep.t; break; }
      if (bearMss && contextBias !== 'BUY') { side='SELL'; strategy='MTF_ICT_REVERSAL'; confidence=64+contextStrength; stop=sweep.high+.25; entryBase=Math.max(price,bearBreak); structureAt=sweep.t; break; }
    }
  }

  // Fallback momentum entry: when the 5m move is clear but no textbook breakout/sweep exists.
  if (!side && Math.abs(liveFromExec) >= atr5 * .24) {
    side = liveFromExec > 0 ? 'BUY' : 'SELL';
    if ((side === 'BUY' && contextBias !== 'SELL') || (side === 'SELL' && contextBias !== 'BUY') || contextBias === 'NEUTRAL') {
      strategy='TREND_CONTINUATION';
      confidence=58 + contextStrength + Math.min(8,Math.round(Math.abs(liveFromExec)/Math.max(atr5,.01)*4));
      entryBase=price;
      stop=side==='BUY' ? Math.min(...reference.map(bar=>bar.low))-.25 : Math.max(...reference.map(bar=>bar.high))+.25;
      structureAt=reference.at(-1)?.t ?? current5Key;
    } else side=null;
  }

  if (!side) {
    const impulse = Math.min(60, Math.round(Math.abs(liveFromExec) / Math.max(atr5, .01) * 20));
    return {...base,status:'WAIT',confidence:impulse,contextBias,
      reason:contextBias==='NEUTRAL'?'لا يوجد اتجاه كافٍ الآن':`اتجاه 15m ${contextBias==='BUY'?'صاعد':'هابط'} — الحركة الحالية غير كافية`};
  }

  const confirm1 = oneMinuteConfirmation(closed1, side, price);
  confidence = Math.min(92, confidence + confirm1.score);
  const chaseDistance = Math.abs(price - entryBase);
  const maxChase = Math.max(2.0, atr5 * .90);
  if (chaseDistance > maxChase) return {...base,status:'WAIT',candidateAction:'WAIT',confidence,strategy,contextBias,reason:'NO CHASE: السعر ابتعد كثيرًا عن منطقة الدخول'};

  const risk = Math.abs(entryBase - stop), maxStopUsd = 5;
  if (risk < .35 || risk > maxStopUsd) return {...base,status:'WAIT',candidateAction:side,confidence,strategy,contextBias,reason:risk<.35?'وقف الخسارة قريب جدًا':`وقف الخسارة أوسع من ${maxStopUsd}$`};

  const direction = side === 'BUY' ? 1 : -1;
  const halfBase = confirm1.aligned ? atr5 * .22 : atr5 * .28;
  const half = Math.min(1.25, Math.max(.35, halfBase));
  const distance1 = Math.max(1.2, risk * 1.2), distance2=Math.max(2.2,risk*1.7), distance3=Math.max(3.2,risk*2.2), distance4=Math.max(4.2,risk*2.7);
  const setupId = [side,strategy,structureAt,contextBias,round(entryBase),round(stop)].join('|');
  return {...base,status:'CANDIDATE',candidateAction:side,side,strategy,confidence,contextBias,oneMinuteConfirmed:confirm1.aligned,setupId,structureAt,
    entry:round(entryBase),entryLow:round(entryBase-half),entryHigh:round(entryBase+half),stopLoss:round(stop),
    target1:round(entryBase+direction*distance1),target2:round(entryBase+direction*distance2),target3:round(entryBase+direction*distance3),target4:round(entryBase+direction*distance4),riskReward:round(distance4/risk,2),
    reason:strategy==='MTF_ICT_REVERSAL'?`ICT 5m مرن${confirm1.aligned?' + تأكيد 1m':''}`:`استمرار/زخم 5m مرن${confirm1.aligned?' + تأكيد 1m':''}`};
}