const CACHE_MS = Math.max(5000, Math.min(30000, Number(process.env.BTC_CACHE_MS || 12000) || 12000));
const MIN_STRENGTH = Math.max(60, Math.min(95, Number(process.env.BTC_SNR_MIN_STRENGTH || 72) || 72));
const CONTRACT_SIZE = Math.max(.000001, Number(process.env.EXNESS_BTC_CONTRACT_SIZE || 1));
const LOT_STEP = Math.max(.001, Number(process.env.EXNESS_BTC_LOT_STEP || .01));
const SAFE_RISK_USD = Math.max(1, Number(process.env.BTC_SAFE_RISK_USD || 5));
const MAX_RISK_USD = Math.max(SAFE_RISK_USD, Number(process.env.BTC_MAX_RISK_USD || 10));
// An intraday BTC entry is only actionable briefly. Existing positions can still be tracked.
const MAX_ENTRY_AGE_MS = Math.max(60000, Math.min(1800000, Number(process.env.BTC_SNR_MAX_ENTRY_AGE_MS || 300000) || 300000));

const cache = { expiresAt: 0, value: null };
const lifecycle = { signal: null, lastTerminal: null, lastClosedSignal: null, cooldownUntil: 0, seen: new Set() };

const num = v => v == null || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v, d = 2) => {
  const n = num(v);
  return n == null ? null : Number(n.toFixed(d));
};

async function coinbaseCandles(granularity) {
  const url = new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
  url.searchParams.set('granularity', String(granularity));
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Gold-Alpha-BTC-SNR/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000)
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows)) throw new Error(`Coinbase candles unavailable ${response.status}`);
  const now = Date.now();
  const span = granularity * 1000;
  return rows.map(x => ({
    t: Number(x[0]) * 1000,
    low: Number(x[1]),
    high: Number(x[2]),
    open: Number(x[3]),
    close: Number(x[4]),
    volume: Number(x[5] || 0)
  })).filter(x => [x.t, x.open, x.high, x.low, x.close].every(Number.isFinite) && x.close > 0 && x.t + span <= now + 1000)
    .sort((a, b) => a.t - b.t);
}

async function coinbaseTicker() {
  const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker', {
    headers: { accept: 'application/json', 'user-agent': 'Gold-Alpha-BTC-SNR/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Coinbase ticker unavailable ${response.status}`);
  return data;
}

function aggregate(rows, hours) {
  const span = hours * 3600000;
  const out = new Map();
  for (const bar of rows) {
    const key = Math.floor(bar.t / span) * span;
    const old = out.get(key);
    if (!old) out.set(key, { ...bar, t: key });
    else {
      old.high = Math.max(old.high, bar.high);
      old.low = Math.min(old.low, bar.low);
      old.close = bar.close;
      old.volume += num(bar.volume) || 0;
    }
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

function atr(rows, period = 14) {
  if (!Array.isArray(rows) || rows.length <= period) return null;
  const vals = [];
  for (let i = rows.length - period; i < rows.length; i += 1) {
    const bar = rows[i], prev = rows[i - 1];
    vals.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close)));
  }
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function pivots(rows, left = 2, right = 2) {
  const highs = [], lows = [];
  for (let i = left; i < rows.length - right; i += 1) {
    const bar = rows[i];
    const before = rows.slice(i - left, i), after = rows.slice(i + 1, i + 1 + right);
    if (before.every(x => bar.high > x.high) && after.every(x => bar.high >= x.high)) highs.push({ t: bar.t, price: bar.high });
    if (before.every(x => bar.low < x.low) && after.every(x => bar.low <= x.low)) lows.push({ t: bar.t, price: bar.low });
  }
  return { highs, lows };
}

function collectRawLevels(frames) {
  const weights = { D1: 5, H4: 4, H1: 3, M15: 2 };
  const out = [];
  for (const [tf, rows] of Object.entries(frames)) {
    if (!weights[tf] || !Array.isArray(rows) || rows.length < 6) continue;
    const p = pivots(rows.slice(-160), 2, 2);
    for (const x of p.highs.slice(-12)) out.push({ price: x.price, kind: 'RESISTANCE', timeframe: tf, weight: weights[tf], t: x.t });
    for (const x of p.lows.slice(-12)) out.push({ price: x.price, kind: 'SUPPORT', timeframe: tf, weight: weights[tf], t: x.t });
  }
  return out.filter(x => Number.isFinite(x.price) && x.price > 0);
}

function clusterLevels(raw, price, m15Atr) {
  const clusterTol = Math.max(25, Math.min(140, Math.max(price * 0.00055, (m15Atr || price * 0.001) * 0.32)));
  const sorted = raw.slice().sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const level of sorted) {
    let cluster = clusters.find(c => Math.abs(c.mid - level.price) <= clusterTol);
    if (!cluster) {
      cluster = { items: [], mid: level.price };
      clusters.push(cluster);
    }
    cluster.items.push(level);
    const totalWeight = cluster.items.reduce((s, x) => s + x.weight, 0);
    cluster.mid = cluster.items.reduce((s, x) => s + x.price * x.weight, 0) / totalWeight;
  }
  const halfWidth = Math.max(20, Math.min(120, Math.max(clusterTol * 0.55, (m15Atr || 100) * 0.18)));
  return clusters.map((cluster, index) => {
    const kinds = cluster.items.reduce((acc, x) => {
      acc[x.kind] = (acc[x.kind] || 0) + x.weight;
      return acc;
    }, {});
    const kind = (kinds.SUPPORT || 0) >= (kinds.RESISTANCE || 0) ? 'SUPPORT' : 'RESISTANCE';
    const timeframes = [...new Set(cluster.items.map(x => x.timeframe))];
    const weightedTouches = cluster.items.reduce((s, x) => s + x.weight, 0);
    const strength = Math.min(100, Math.round(38 + Math.min(34, weightedTouches * 2.2) + Math.min(20, timeframes.length * 5)));
    return {
      id: `SNR-${index + 1}`,
      kind,
      low: round(cluster.mid - halfWidth),
      high: round(cluster.mid + halfWidth),
      mid: round(cluster.mid),
      strength,
      touches: cluster.items.length,
      timeframes,
      distance: round(Math.abs(cluster.mid - price))
    };
  }).filter(z => z.strength >= 50)
    .sort((a, b) => a.mid - b.mid);
}

function barShape(bar = {}) {
  const open = num(bar.open), high = num(bar.high), low = num(bar.low), close = num(bar.close);
  if ([open, high, low, close].some(v => v == null)) return null;
  const range = Math.max(0.01, high - low);
  const body = Math.abs(close - open);
  const upper = high - Math.max(open, close);
  const lower = Math.min(open, close) - low;
  return {
    bullish: close > open,
    bearish: close < open,
    lowerReject: lower >= Math.max(body * 1.2, range * 0.28),
    upperReject: upper >= Math.max(body * 1.2, range * 0.28),
    closePosition: (close - low) / range
  };
}

function nearestZones(zones, price) {
  const support = zones.filter(z => z.mid <= price).sort((a, b) => (price - a.mid) - (price - b.mid))[0] || null;
  const resistance = zones.filter(z => z.mid >= price).sort((a, b) => (a.mid - price) - (b.mid - price))[0] || null;
  return { support, resistance };
}

function nextTargets(zones, entry, side) {
  const candidates = zones.filter(z => side === 'BUY' ? z.mid > entry : z.mid < entry)
    .sort((a, b) => Math.abs(a.mid - entry) - Math.abs(b.mid - entry));
  const out = [];
  for (const z of candidates) {
    if (out.some(x => Math.abs(x.level - z.mid) < 25)) continue;
    out.push({ level: z.mid, label: `${z.kind} ${z.timeframes.join('/')}` });
    if (out.length === 4) break;
  }
  return out;
}

function lotForRisk(entry, stop, riskUsd) {
  const distance = Math.abs(Number(entry) - Number(stop));
  if (!(distance > 0)) return 0;
  const raw = riskUsd / (distance * CONTRACT_SIZE);
  const steps = Math.floor((raw + 1e-12) / LOT_STEP);
  return steps > 0 ? Number((steps * LOT_STEP).toFixed(3)) : 0;
}

function lotSizing(entry, stop) {
  const distance = Math.abs(entry - stop);
  return {
    recommendedLot: lotForRisk(entry, stop, SAFE_RISK_USD),
    maxLot: lotForRisk(entry, stop, MAX_RISK_USD),
    stopDistance: round(distance),
    safeRiskUsd: SAFE_RISK_USD,
    maxRiskUsd: MAX_RISK_USD
  };
}

function scoreSetup(zone, confirmations) {
  let score = Math.min(78, Math.max(45, Number(zone?.strength) || 45));
  if (confirmations.includes('M15_BREAK')) score += 7;
  if (confirmations.includes('M5_RETEST_HOLD')) score += 8;
  if (confirmations.includes('M5_REJECTION')) score += 8;
  if (confirmations.includes('M1_CONFIRM')) score += 7;
  return Math.min(100, Math.round(score));
}

function analyze({ M1 = [], M5 = [], M15 = [], H1 = [], H4 = [], D1 = [], ticker = {} }) {
  const price = num(ticker?.price) ?? num(M1.at(-1)?.close) ?? num(M5.at(-1)?.close);
  const m15Atr = atr(M15) || atr(H1) || (price ? price * 0.001 : 100);
  const m5Atr = atr(M5) || Math.max(20, m15Atr * 0.45);
  const raw = collectRawLevels({ D1, H4, H1, M15 });
  const zones = price == null ? [] : clusterLevels(raw, price, m15Atr);
  const nearest = price == null ? { support: null, resistance: null } : nearestZones(zones, price);
  const base = {
    symbol: 'BTCUSD',
    status: 'WAIT',
    action: 'WAIT',
    side: null,
    executable: false,
    executionMode: 'SIGNALS_ONLY',
    strategy: 'SNR_CLASSICAL',
    tradeStyle: 'SNR_ONLY',
    confidence: 0,
    price: round(price),
    entry: null,
    stopLoss: null,
    target1: null,
    target2: null,
    target3: null,
    target4: null,
    targetLabels: [],
    lotSizing: null,
    snr: {
      nearestSupport: nearest.support,
      nearestResistance: nearest.resistance,
      zones: zones.slice().sort((a, b) => a.distance - b.distance).slice(0, 12),
      atrM15: round(m15Atr),
      atrM5: round(m5Atr)
    },
    priceAction: { triggers: [] },
    updatedAt: new Date().toISOString(),
    reason: 'SNR WAIT — waiting for support/resistance rejection or breakout-retest confirmation.'
  };
  if (price == null || M5.length < 3 || M15.length < 3 || M1.length < 2 || zones.length < 2) return base;

  const m5 = M5.at(-1), m1 = M1.at(-1), m15 = M15.at(-1), prev15 = M15.at(-2);
  const m5Shape = barShape(m5);
  const retestTol = Math.max(18, Math.min(120, m5Atr * 0.35));
  const breakBuf = Math.max(12, Math.min(90, m15Atr * 0.15));
  const maxZoneDistance = Math.max(120, Math.min(650, m15Atr * 2.2));

  const setups = [];
  for (const zone of zones) {
    if (Math.abs(zone.mid - price) > maxZoneDistance && Math.abs(zone.mid - m15.close) > maxZoneDistance) continue;

    const touched = m5.low <= zone.high + retestTol && m5.high >= zone.low - retestTol;

    if (zone.kind === 'SUPPORT' && touched && m5.close > zone.mid && (m5Shape?.bullish || m5Shape?.lowerReject)) {
      const confirms = ['M5_REJECTION'];
      if (m1.close >= m1.open && m1.close > zone.mid) confirms.push('M1_CONFIRM');
      const score = scoreSetup(zone, confirms);
      setups.push({ side: 'BUY', type: 'SNR_REJECTION', zone, confirms, score, entry: m1.close });
    }
    if (zone.kind === 'RESISTANCE' && touched && m5.close < zone.mid && (m5Shape?.bearish || m5Shape?.upperReject)) {
      const confirms = ['M5_REJECTION'];
      if (m1.close <= m1.open && m1.close < zone.mid) confirms.push('M1_CONFIRM');
      const score = scoreSetup(zone, confirms);
      setups.push({ side: 'SELL', type: 'SNR_REJECTION', zone, confirms, score, entry: m1.close });
    }

    const brokeUp = prev15.close <= zone.high && m15.close > zone.high + breakBuf;
    if (zone.kind === 'RESISTANCE' && brokeUp) {
      const retested = m5.low <= zone.high + retestTol && m5.close > zone.high;
      if (retested) {
        const confirms = ['M15_BREAK', 'M5_RETEST_HOLD'];
        if (m1.close >= m1.open && m1.close > zone.high) confirms.push('M1_CONFIRM');
        const score = scoreSetup(zone, confirms);
        setups.push({ side: 'BUY', type: 'SNR_BREAKOUT_RETEST', zone, confirms, score, entry: m1.close });
      }
    }

    const brokeDown = prev15.close >= zone.low && m15.close < zone.low - breakBuf;
    if (zone.kind === 'SUPPORT' && brokeDown) {
      const retested = m5.high >= zone.low - retestTol && m5.close < zone.low;
      if (retested) {
        const confirms = ['M15_BREAK', 'M5_RETEST_HOLD'];
        if (m1.close <= m1.open && m1.close < zone.low) confirms.push('M1_CONFIRM');
        const score = scoreSetup(zone, confirms);
        setups.push({ side: 'SELL', type: 'SNR_BREAKOUT_RETEST', zone, confirms, score, entry: m1.close });
      }
    }
  }

  const chosen = setups.sort((a, b) => b.score - a.score || Math.abs(a.zone.mid - price) - Math.abs(b.zone.mid - price))[0];
  if (!chosen || chosen.score < MIN_STRENGTH || !chosen.confirms.includes('M1_CONFIRM')) {
    return {
      ...base,
      confidence: chosen?.score || 0,
      priceAction: { triggers: chosen?.confirms || [] },
      reason: chosen
        ? `SNR WATCH — ${chosen.type} at ${chosen.zone.mid} scored ${chosen.score}/100; waiting for full confirmation.`
        : base.reason
    };
  }

  const buffer = Math.max(18, Math.min(140, m5Atr * 0.28));
  const stop = chosen.side === 'BUY' ? chosen.zone.low - buffer : chosen.zone.high + buffer;
  const entry = chosen.entry;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return base;

  const targets = nextTargets(zones, entry, chosen.side);
  if (!targets.length) {
    return { ...base, confidence: chosen.score, reason: 'SNR WAIT — setup confirmed but no opposing S/R target is mapped.' };
  }
  const rr1 = Math.abs(targets[0].level - entry) / risk;
  if (rr1 < 0.9) {
    return {
      ...base,
      confidence: chosen.score,
      reason: `SNR WAIT — nearest opposing S/R gives only ${rr1.toFixed(2)}R; skip crowded setup.`
    };
  }

  // The M1 candle reference can lag far behind the live ticker. Never recommend
  // an entry after TP1 has already passed, or when the reference price is stale.
  const entryBlock = btcEntryBlockReason({
    action: chosen.side, price, entry, stopLoss: stop, target1: targets[0].level
  });
  if (entryBlock) {
    return {
      ...base,
      entryEligible: false,
      staleSetup: true,
      reason: `SNR NO ENTRY — ${entryBlock}. The completed setup is not a fresh trade.`
    };
  }

  const setupId = `BTC-SNR-${chosen.side}-${chosen.type}-${chosen.zone.id}-${m5.t}`;
  return {
    ...base,
    status: 'ACTIVE',
    action: chosen.side,
    side: chosen.side,
    confidence: chosen.score,
    entry: round(entry),
    stopLoss: round(stop),
    target1: targets[0]?.level ?? null,
    target2: targets[1]?.level ?? null,
    target3: targets[2]?.level ?? null,
    target4: targets[3]?.level ?? null,
    targetLabels: targets.map(x => x.label),
    riskReward: round(rr1),
    lotSizing: lotSizing(entry, stop),
    setupId,
    snr: {
      ...base.snr,
      setupType: chosen.type,
      activeZone: chosen.zone
    },
    priceAction: { triggers: chosen.confirms },
    reason: `SNR ${chosen.side} — ${chosen.type} at ${chosen.zone.mid} → ${chosen.confirms.join(' + ')}; TP1 is the nearest opposing S/R zone.`
  };
}

function reached(side, price, target) {
  const p = num(price), t = num(target);
  if (p == null || t == null || p <= 0 || t <= 0) return false;
  return side === 'BUY' ? p >= t : p <= t;
}

// Pure safety check for the displayed entry. Setup strength is not a live entry permission.
export function btcEntryBlockReason(candidate = {}) {
  const side = candidate.action;
  const price = num(candidate.price), entry = num(candidate.entry);
  const stop = num(candidate.stopLoss), tp1 = num(candidate.target1);
  if (!['BUY', 'SELL'].includes(side) ||
      [price, entry, stop, tp1].some(v => v == null || v <= 0)) return 'MISSING_VALID_LIVE_LEVELS';
  if (side === 'BUY' ? !(stop < entry && entry < tp1) : !(tp1 < entry && entry < stop)) {
    return 'INVALID_ENTRY_STOP_TARGET_GEOMETRY';
  }
  if (reached(side, price, tp1)) return 'TP1_ALREADY_REACHED';
  if (side === 'BUY' ? price <= stop : price >= stop) return 'STOP_ALREADY_REACHED';
  // A large gap between last completed M1 candle and live ticker is not an executable price.
  const maxDrift = Math.max(20, Math.min(200, Math.abs(entry - stop) * 0.5));
  if (Math.abs(price - entry) > maxDrift) return 'LIVE_PRICE_TOO_FAR_FROM_ENTRY';
  return null;
}

function noNewEntry(signal, status, reason, terminalEvent) {
  return {
    ...signal,
    status,
    action: 'WAIT',
    side: null,
    tradeSide: signal.tradeSide || signal.action,
    executable: false,
    entryEligible: false,
    confidence: 0,
    originalSetupStrength: signal.originalSetupStrength ?? signal.confidence,
    reason,
    lockedTargets: true,
    terminalEvent
  };
}

function closeBtcSignal(signal, type, price, now) {
  const at = new Date(now).toISOString();
  const terminalEvent = {
    type, side: signal.action, signalId: signal.signalId, at,
    price: round(price), entry: signal.entry,
    stopLoss: signal.stopLoss, target1: signal.target1, target2: signal.target2,
    targetHits: [...(signal.targetHits || [])],
    status: 'CLOSED', // Model signal outcome, NOT a confirmed broker-side closure.
    brokerPositionClosed: false
  };
  lifecycle.lastTerminal = terminalEvent;
  lifecycle.cooldownUntil = now + 60000;
  lifecycle.signal = null;
  const reason = `BTC SNR SIGNAL CLOSED — ${type}; signal ended at ${round(price)}. Not a broker trade closure. NO NEW ENTRY.`;
  lifecycle.lastClosedSignal = {
    ...noNewEntry(signal, 'CLOSED', reason, terminalEvent),
    closedAt: at,
    closedReason: type,
    brokerPositionClosed: false
  };
  return lifecycle.lastClosedSignal;
}

export function lifecycleSignal(candidate, now = Date.now()) {
  const price = num(candidate?.price);
  const validPrice = price != null && price > 0;

  if (lifecycle.signal) {
    const signal = lifecycle.signal;
    const alreadyHitTp1 = signal.targetHits?.[0] === true;
    const protectiveLevel = alreadyHitTp1 ? signal.target1 : signal.stopLoss;
    const stopHit = validPrice && num(protectiveLevel) != null &&
      (signal.action === 'BUY' ? price <= protectiveLevel : price >= protectiveLevel);
    if (stopHit) {
      return closeBtcSignal(signal, alreadyHitTp1 ? 'PROTECTED_STOP' : 'SL', price, now);
    }
    if (validPrice) {
      signal.price = round(price);
      signal.updatedAt = candidate.updatedAt || new Date(now).toISOString();
      const priorHits = [...signal.targetHits];
      signal.targetHits = [signal.target1, signal.target2, signal.target3, signal.target4]
        .map((target, i) => priorHits[i] || reached(signal.action, price, target));
      // TP2 is the default completion point. If only TP1 exists, TP1 completes the model signal.
      const closeAt = num(signal.target2) != null && signal.target2 > 0 ? 2 : 1;
      if (signal.targetHits[closeAt - 1]) {
        return closeBtcSignal(signal, `TP${closeAt}`, price, now);
      }
      if (!alreadyHitTp1 && signal.targetHits[0]) {
        signal.latestMilestone = {
          type: 'TP1', price: round(price), target: signal.target1,
          at: new Date(now).toISOString(), signalId: signal.signalId
        };
      }
    }
    if (signal.targetHits[0]) {
      return noNewEntry(signal, 'TP1_HIT',
        `BTC SNR TP1 HIT at ${signal.target1}; entry is closed to new traders. TP2 or protective stop is next. NO NEW ENTRY.`,
        lifecycle.lastTerminal);
    }
    if (now - signal.issuedAtMs >= MAX_ENTRY_AGE_MS) {
      return closeBtcSignal(signal, 'EXPIRED', price, now);
    }
    return { ...signal, status: 'ACTIVE', entryEligible: true, lockedTargets: true, terminalEvent: lifecycle.lastTerminal };
  }

  if (now >= lifecycle.cooldownUntil && candidate.status === 'ACTIVE' && candidate.setupId && !lifecycle.seen.has(candidate.setupId)) {
    // A stale or already-consumed target MUST NOT be issued as a fresh SELL/BUY.
    const entryBlock = btcEntryBlockReason(candidate);
    if (entryBlock) {
      lifecycle.seen.add(candidate.setupId);
      return lifecycle.lastClosedSignal
        ? { ...lifecycle.lastClosedSignal, price: round(price), updatedAt: candidate.updatedAt }
        : { ...candidate, status: 'WAIT', action: 'WAIT', side: null,
            entry: null, stopLoss: null, target1: null, target2: null, target3: null, target4: null,
            confidence: 0, executable: false, entryEligible: false,
            reason: `BTC SNR BLOCKED — ${entryBlock}; historical setup is not a new entry.`,
            terminalEvent: lifecycle.lastTerminal };
    }
    lifecycle.seen.add(candidate.setupId);
    if (lifecycle.seen.size > 200) lifecycle.seen.delete(lifecycle.seen.values().next().value);
    lifecycle.lastClosedSignal = null;
    lifecycle.signal = {
      ...candidate, signalId: `BTC-SNR-${now}`, issuedAtMs: now,
      targetHits: [false, false, false, false],
      lockedTargets: true, entryEligible: true, latestMilestone: null
    };
    return { ...lifecycle.signal, terminalEvent: lifecycle.lastTerminal };
  }

  if (lifecycle.lastClosedSignal) {
    return {
      ...lifecycle.lastClosedSignal,
      price: round(price),
      updatedAt: candidate.updatedAt || new Date(now).toISOString()
    };
  }

  return {
    ...candidate,
    status: 'WAIT',
    action: 'WAIT',
    side: null,
    entry: null,
    stopLoss: null,
    target1: null,
    target2: null,
    target3: null,
    target4: null,
    signalId: null,
    confidence: 0,
    executable: false,
    entryEligible: false,
    terminalEvent: lifecycle.lastTerminal,
    cooldownRemainingMs: Math.max(0, lifecycle.cooldownUntil - now)
  };
}

export function resetBtcLifecycleForTests() {
  lifecycle.signal = null;
  lifecycle.lastTerminal = null;
  lifecycle.lastClosedSignal = null;
  lifecycle.cooldownUntil = 0;
  lifecycle.seen.clear();
}

async function freshCandidate(force = false) {
  if (!force && cache.value && Date.now() < cache.expiresAt) return cache.value;
  const [M1, M5, M15, H1, D1, ticker] = await Promise.all([
    coinbaseCandles(60),
    coinbaseCandles(300),
    coinbaseCandles(900),
    coinbaseCandles(3600),
    coinbaseCandles(86400),
    coinbaseTicker()
  ]);
  const H4 = aggregate(H1, 4);
  const value = analyze({ M1, M5, M15, H1, H4, D1, ticker });
  cache.value = value;
  cache.expiresAt = Date.now() + CACHE_MS;
  return value;
}

export async function getBtcSignal(force = false) {
  return lifecycleSignal(await freshCandidate(force));
}

export function analyzeBtcSnr(input) {
  return analyze(input);
}
