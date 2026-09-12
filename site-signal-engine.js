// Site-owned signal engine for Gold Alpha Pro.
// This file centralizes BULL / BEAR / WAIT classification so the website,
// MT5 executor, Telegram, and UI can consume the same decision source.

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i += 1) out = values[i] * k + out * (1 - k);
  return out;
}

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function classifySignal(candles, opts = {}) {
  const settings = {
    fast: opts.fast || 9,
    slow: opts.slow || 21,
    structure: opts.structure || 8,
    atrPeriod: opts.atrPeriod || 14,
    minBodyAtr: opts.minBodyAtr || 0.55,
    minScore: opts.minScore || 3
  };

  if (!Array.isArray(candles) || candles.length < Math.max(settings.slow + 5, settings.structure + 5, settings.atrPeriod + 5)) {
    return { signal: 'WAIT', confidence: 0, reason: 'NOT_ENOUGH_DATA' };
  }

  const clean = candles
    .map(c => ({
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0),
      time: c.time || c.timestamp || null
    }))
    .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite));

  if (clean.length < settings.slow + 5) {
    return { signal: 'WAIT', confidence: 0, reason: 'BAD_DATA' };
  }

  const closes = clean.map(c => c.close);
  const last = clean[clean.length - 1];
  const prev = clean[clean.length - 2];
  const fast = ema(closes.slice(-Math.max(settings.slow * 3, 60)), settings.fast);
  const slow = ema(closes.slice(-Math.max(settings.slow * 3, 60)), settings.slow);
  const atrNow = atr(clean, settings.atrPeriod);

  if (!fast || !slow || !atrNow || atrNow <= 0) {
    return { signal: 'WAIT', confidence: 0, reason: 'CALCULATION_UNAVAILABLE' };
  }

  const prior = clean.slice(-(settings.structure + 1), -1);
  const structureHigh = Math.max(...prior.map(c => c.high));
  const structureLow = Math.min(...prior.map(c => c.low));

  const body = Math.abs(last.close - last.open);
  const bullCandle = last.close > last.open;
  const bearCandle = last.close < last.open;
  const bullBreak = last.close > structureHigh && prev.close <= structureHigh;
  const bearBreak = last.close < structureLow && prev.close >= structureLow;
  const displacement = body >= atrNow * settings.minBodyAtr;
  const bullTrend = last.close > fast && fast > slow;
  const bearTrend = last.close < fast && fast < slow;
  const bullMomentum = last.close > prev.close && last.close > fast;
  const bearMomentum = last.close < prev.close && last.close < fast;

  let bullScore = 0;
  let bearScore = 0;

  if (bullTrend) bullScore += 1;
  if (bearTrend) bearScore += 1;
  if (bullBreak) bullScore += 2;
  if (bearBreak) bearScore += 2;
  if (bullCandle && displacement) bullScore += 1;
  if (bearCandle && displacement) bearScore += 1;
  if (bullMomentum) bullScore += 1;
  if (bearMomentum) bearScore += 1;

  let signal = 'WAIT';
  let score = 0;
  if (bullScore >= settings.minScore && bullScore > bearScore) {
    signal = 'BULL';
    score = bullScore;
  } else if (bearScore >= settings.minScore && bearScore > bullScore) {
    signal = 'BEAR';
    score = bearScore;
  }

  const confidence = signal === 'WAIT' ? 0 : Math.min(95, 55 + score * 8);

  return {
    signal,
    confidence,
    price: last.close,
    atr: Number(atrNow.toFixed(4)),
    fastEma: Number(fast.toFixed(4)),
    slowEma: Number(slow.toFixed(4)),
    structureHigh,
    structureLow,
    timestamp: last.time || Date.now(),
    diagnostics: {
      bullScore,
      bearScore,
      bullBreak,
      bearBreak,
      displacement,
      bullTrend,
      bearTrend
    }
  };
}

module.exports = { classifySignal };
