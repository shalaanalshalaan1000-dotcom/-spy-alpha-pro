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

function slope(values = []) {
  if (values.length < 2) return 0;
  return (values.at(-1) - values[0]) / Math.max(1, values.length - 1);
}

function candlePressure(bars = []) {
  let bull = 0, bear = 0;
  for (const bar of bars) {
    const range = Math.max(.000001, bar.high - bar.low);
    const body = bar.close - bar.open;
    const upper = bar.high - Math.max(bar.open, bar.close);
    const lower = Math.min(bar.open, bar.close) - bar.low;
    if (body > 0) bull += Math.min(2, Math.abs(body) / range * 1.4);
    if (body < 0) bear += Math.min(2, Math.abs(body) / range * 1.4);
    if (lower > upper * 1.35) bull += .45;
    if (upper > lower * 1.35) bear += .45;
  }
  return {bull, bear, net:bull - bear};
}

function structureScore(bars = []) {
  const recent = bars.slice(-8);
  if (recent.length < 4) return 0;
  let score = 0;
  for (let i = 1; i < recent.length; i += 1) {
    if (recent[i].high >= recent[i - 1].high && recent[i].low >= recent[i - 1].low) score += 1;
    if (recent[i].high <= recent[i - 1].high && recent[i].low <= recent[i - 1].low) score -= 1;
  }
  return score;
}

function rangePosition(bars = [], price) {
  if (!bars.length) return .5;
  const high = Math.max(...bars.map(b => b.high));
  const low = Math.min(...bars.map(b => b.low));
  return high > low ? Math.max(0, Math.min(1, (price - low) / (high - low))) : .5;
}

function context15m(closed15, price) {
  const recent = closed15.slice(-10);
  if (recent.length < 2) return {bias:'NEUTRAL', strength:0, high:null, low:null};
  const closes = recent.map(bar => bar.close);
  const high = Math.max(...recent.map(bar => bar.high));
  const low = Math.min(...recent.map(bar => bar.low));
  const delta = closes.at(-1) - closes[0];
  const atr15 = Math.max(.01, averageRange(recent, Math.max(.75, price * .00025)));
  const position = high > low ? (price - low) / (high - low) : .5;
  const struct = structureScore(recent);
  const up = delta > atr15 * .08 || struct >= 2 || (delta >= -atr15 * .12 && position >= .55);
  const down = delta < -atr15 * .08 || struct <= -2 || (delta <= atr15 * .12 && position <= .45);
  if (up && !down) return {bias:'BUY', strength:Math.min(14, 4 + Math.round(Math.abs(delta) / atr15 * 6) + Math.max(0, struct)), high, low, atr15};
  if (down && !up) return {bias:'SELL', strength:Math.min(14, 4 + Math.round(Math.abs(delta) / atr15 * 6) + Math.max(0, -struct)), high, low, atr15};
  return {bias:'NEUTRAL', strength:0, high, low, atr15};
}

function oneMinuteConfirmation(closed1, side, price) {
  const recent = closed1.slice(-5);
  if (recent.length < 2) return {aligned:false, score:0};
  const closes = recent.map(b => b.close);
  const move = price - closes[0];
  const fast = closes.at(-1) - closes.at(-3 < -closes.length ? 0 : -3);
  const pressure = candlePressure(recent);
  const aligned = side === 'BUY'
    ? (move >= 0 && fast >= 0 && pressure.net >= -.5)
    : (move <= 0 && fast <= 0 && pressure.net <= .5);
  return {aligned, score:aligned ? 5 : 0, pressure:round(pressure.net,2)};
}

function predictiveRead({closed1, usable5, closed15, price, atr5, contextBias}) {
  const m1 = closed1.slice(-30);
  const m5 = usable5.slice(-18);
  const m15 = closed15.slice(-12);
  const closes1 = m1.map(b => b.close), closes5 = m5.map(b => b.close), closes15 = m15.map(b => b.close);
  const s1 = slope(closes1.slice(-12));
  const s5 = slope(closes5.slice(-8));
  const s15 = slope(closes15.slice(-6));
  const recent1 = slope(closes1.slice(-5));
  const prior1 = closes1.length >= 10 ? slope(closes1.slice(-10,-5)) : 0;
  const acceleration = recent1 - prior1;
  const p1 = candlePressure(m1.slice(-8));
  const p5 = candlePressure(m5.slice(-6));
  const struct1 = structureScore(m1.slice(-10));
  const struct5 = structureScore(m5.slice(-8));
  const pos5 = rangePosition(m5.slice(-8), price);
  const recentRanges = m1.slice(-10).map(b => b.high - b.low).filter(v => v > 0);
  const olderRanges = m1.slice(-20,-10).map(b => b.high - b.low).filter(v => v > 0);
  const avgRecentRange = recentRanges.length ? recentRanges.reduce((a,b)=>a+b,0)/recentRanges.length : 0;
  const avgOlderRange = olderRanges.length ? olderRanges.reduce((a,b)=>a+b,0)/olderRanges.length : avgRecentRange;
  const expansion = avgOlderRange > 0 ? avgRecentRange / avgOlderRange : 1;

  let buy = 0, sell = 0;
  const norm = Math.max(.05, atr5 / 5);
  if (s1 > 0) buy += Math.min(14, Math.abs(s1) / norm * 5); else sell += Math.min(14, Math.abs(s1) / norm * 5);
  if (s5 > 0) buy += Math.min(18, Math.abs(s5) / norm * 4); else sell += Math.min(18, Math.abs(s5) / norm * 4);
  if (s15 > 0) buy += Math.min(10, Math.abs(s15) / norm * 2); else sell += Math.min(10, Math.abs(s15) / norm * 2);
  if (acceleration > 0) buy += Math.min(10, Math.abs(acceleration) / norm * 4); else sell += Math.min(10, Math.abs(acceleration) / norm * 4);
  if (p1.net > 0) buy += Math.min(9,p1.net*1.5); else sell += Math.min(9,-p1.net*1.5);
  if (p5.net > 0) buy += Math.min(9,p5.net*1.4); else sell += Math.min(9,-p5.net*1.4);
  if (struct1 > 0) buy += Math.min(8,struct1*1.2); else sell += Math.min(8,-struct1*1.2);
  if (struct5 > 0) buy += Math.min(8,struct5*1.4); else sell += Math.min(8,-struct5*1.4);
  if (pos5 >= .62) buy += 5; else if (pos5 <= .38) sell += 5;
  if (contextBias === 'BUY') buy += 8;
  if (contextBias === 'SELL') sell += 8;
  if (expansion >= 1.18) {
    if (recent1 > 0) buy += 4;
    if (recent1 < 0) sell += 4;
  }

  const diff = buy - sell;
  const side = diff >= 7 ? 'BUY' : diff <= -7 ? 'SELL' : null;
  const confidence = side ? Math.min(86, Math.round(54 + Math.abs(diff) * .72)) : Math.min(59, Math.round(40 + Math.abs(diff)));
  return {
    side, confidence, buyScore:round(buy,1), sellScore:round(sell,1), scoreGap:round(diff,1),
    acceleration:round(acceleration,4), expansion:round(expansion,2), rangePosition5m:round(pos5,2),
    structure1m:struct1, structure5m:struct5, pressure1m:round(p1.net,2), pressure5m:round(p5.net,2)
  };
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
    historyWindow:{m1:Math.min(30,closed1.length),m5:Math.min(18,usable5.length),m15:Math.min(12,closed15.length)},
    modelTimeframes:{context:'15m predictive', execution:'5m predictive', confirmation:'1m predictive'},
    sampleCount:alignedSamples.length, price:round(price),
    entry:null, entryLow:null, entryHigh:null, stopLoss:null,
    target1:null,target2:null,target3:null,target4:null,riskReward:null,
    contextBias:'NEUTRAL', prediction:null,
    reason: !ready5
      ? `جمع شمعة M5 الحقيقية: ${usable5.length}/1`
      : !ready1
        ? `جمع تأكيد M1 السريع: ${closed1.length}/2`
        : 'القراءة مكتملة — يتم تقدير الحركة التالية من الشموع السابقة',
    updatedAt:new Date(now).toISOString()
  };

  if (!Number.isFinite(price) || price <= 0 || !ready) return base;

  const ctx = context15m(closed15, price);
  const contextBias = ctx.bias;
  const contextStrength = ctx.strength;
  const recent5 = usable5.slice(-18);
  const atr5 = Math.max(.01, averageRange(recent5.slice(-8), Math.max(.75, price * .00018)));
  const reference = recent5.slice(-Math.min(5,recent5.length));
  const hi3 = Math.max(...reference.slice(-3).map(bar => bar.high));
  const lo3 = Math.min(...reference.slice(-3).map(bar => bar.low));
  const execCloses = recent5.map(bar => bar.close);
  const execBias = execCloses.at(-1) - execCloses[0];
  const liveFromExec = price - execCloses[0];
  const prediction = predictiveRead({closed1,usable5,closed15,price,atr5,contextBias});

  let side = null;
  let strategy = null;
  let confidence = 0;
  let stop = null;
  let entryBase = null;
  let structureAt = null;

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
    for (let index = Math.max(3, recent5.length - 4); index < recent5.length; index += 1) {
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

  if (!side && prediction.side && prediction.confidence >= 60) {
    side = prediction.side;
    strategy = 'TREND_CONTINUATION';
    confidence = prediction.confidence;
    entryBase = price;
    const local = closed1.slice(-10);
    const localLow = local.length ? Math.min(...local.map(b => b.low)) : Math.min(...reference.map(b => b.low));
    const localHigh = local.length ? Math.max(...local.map(b => b.high)) : Math.max(...reference.map(b => b.high));
    stop = side === 'BUY'
      ? Math.max(price - Math.max(.7,atr5*.7), localLow - .20)
      : Math.min(price + Math.max(.7,atr5*.7), localHigh + .20);
    structureAt = closed1.at(-1)?.t ?? reference.at(-1)?.t ?? current5Key;
  }

  if (!side && Math.abs(liveFromExec) >= atr5 * .22) {
    const fallback = liveFromExec > 0 ? 'BUY' : 'SELL';
    if ((fallback === 'BUY' && contextBias !== 'SELL') || (fallback === 'SELL' && contextBias !== 'BUY') || contextBias === 'NEUTRAL') {
      side=fallback; strategy='TREND_CONTINUATION';
      confidence=58 + contextStrength + Math.min(8,Math.round(Math.abs(liveFromExec)/Math.max(atr5,.01)*4));
      entryBase=price;
      stop=side==='BUY' ? Math.min(...reference.map(bar=>bar.low))-.25 : Math.max(...reference.map(bar=>bar.high))+.25;
      structureAt=reference.at(-1)?.t ?? current5Key;
    }
  }

  if (!side) {
    return {...base,status:'WAIT',confidence:prediction.confidence,contextBias,prediction,
      reason:`توقع الشمعة القادمة غير حاسم — BUY ${prediction.buyScore} / SELL ${prediction.sellScore}`};
  }

  const confirm1 = oneMinuteConfirmation(closed1, side, price);
  confidence = Math.min(92, confidence + confirm1.score);
  const chaseDistance = Math.abs(price - entryBase);
  const maxChase = Math.max(2.0, atr5 * .90);
  if (chaseDistance > maxChase) return {...base,status:'WAIT',candidateAction:'WAIT',confidence,strategy,contextBias,prediction,reason:'NO CHASE: السعر ابتعد كثيرًا عن منطقة الدخول'};

  const risk = Math.abs(entryBase - stop), maxStopUsd = 5;
  if (risk < .35 || risk > maxStopUsd) return {...base,status:'WAIT',candidateAction:side,confidence,strategy,contextBias,prediction,reason:risk<.35?'وقف الخسارة قريب جدًا':`وقف الخسارة أوسع من ${maxStopUsd}$`};

  const direction = side === 'BUY' ? 1 : -1;
  const halfBase = confirm1.aligned ? atr5 * .22 : atr5 * .30;
  const half = Math.min(1.35, Math.max(.40, halfBase));
  const distance1 = Math.max(1.2, risk * 1.2), distance2=Math.max(2.2,risk*1.7), distance3=Math.max(3.2,risk*2.2), distance4=Math.max(4.2,risk*2.7);
  const setupId = [side,strategy,structureAt,contextBias,round(entryBase),round(stop)].join('|');
  const predictive = strategy==='TREND_CONTINUATION' && prediction.side===side && prediction.confidence>=60;
  return {...base,status:'CANDIDATE',candidateAction:side,side,strategy,confidence,contextBias,oneMinuteConfirmed:confirm1.aligned,setupId,structureAt,prediction,
    entry:round(entryBase),entryLow:round(entryBase-half),entryHigh:round(entryBase+half),stopLoss:round(stop),
    target1:round(entryBase+direction*distance1),target2:round(entryBase+direction*distance2),target3:round(entryBase+direction*distance3),target4:round(entryBase+direction*distance4),riskReward:round(distance4/risk,2),
    reason:predictive
      ? `توقع مبكر ${side} من 30×1m + 18×5m + 12×15m${confirm1.aligned?' + تأكيد 1m':''}`
      : strategy==='MTF_ICT_REVERSAL'
        ? `ICT 5m مرن${confirm1.aligned?' + تأكيد 1m':''}`
        : `استمرار/زخم 5m مرن${confirm1.aligned?' + تأكيد 1m':''}`};
}
