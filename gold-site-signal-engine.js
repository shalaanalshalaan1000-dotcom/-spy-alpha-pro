import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeGoldSignal } from './gold-signal-model.js';

const PORT = Number(process.env.PORT || 3002);
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 65);
const QUOTE_URL = String(process.env.GOLD_ALPHA_QUOTE_URL || '').trim();
const CANDLES_URL = String(process.env.GOLD_ALPHA_CANDLES_URL || '').trim();
const DATA_DIR = process.env.GOLD_ALPHA_DATA_DIR || '/tmp/gold-alpha';
const STORE_PATH = process.env.GOLD_ALPHA_SITE_STORE_PATH || join(DATA_DIR, 'site-signal-state.json');
const BUILD = 'site-signal-noai-v2';
const MAX_SIGNAL_MS = 4 * 60 * 60_000;
const QUOTE_CACHE_MS = 1200;
const CANDLE_CACHE_MS = 10_000;

const state = {
  samples: [],
  signal: null,
  lastTerminal: null,
  blockedSetupIds: [],
  cooldownUntil: 0,
  trades: [],
  quote: null,
  quoteAt: 0,
  candlesAt: 0,
  candlesError: null
};

const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const iso = value => new Date(value).toISOString();
const round = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'x-gold-alpha-engine': BUILD
  });
  res.end(JSON.stringify(body));
}

function saveStore() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      signal: state.signal,
      lastTerminal: state.lastTerminal,
      blockedSetupIds: state.blockedSetupIds.slice(-80),
      cooldownUntil: state.cooldownUntil,
      trades: state.trades.slice(-200)
    }));
    renameSync(tmp, STORE_PATH);
  } catch {}
}

function loadStore() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(STORE_PATH)) return;
    const data = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    if (data.signal && typeof data.signal === 'object') state.signal = data.signal;
    if (data.lastTerminal && typeof data.lastTerminal === 'object') state.lastTerminal = data.lastTerminal;
    if (Array.isArray(data.blockedSetupIds)) state.blockedSetupIds = data.blockedSetupIds.slice(-80);
    if (Number.isFinite(Number(data.cooldownUntil))) state.cooldownUntil = Number(data.cooldownUntil);
    if (Array.isArray(data.trades)) state.trades = data.trades.slice(-200);
  } catch {}
}
loadStore();

async function fetchJson(url, timeoutMs = 7000) {
  if (!url) throw new Error('DATA_URL_MISSING');
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json', 'user-agent': 'GoldAlphaSiteEngine/2.0' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || data?.detail || `HTTP_${response.status}`));
  return data;
}

async function getQuote(force = false) {
  const now = Date.now();
  if (!force && state.quote && now - state.quoteAt < QUOTE_CACHE_MS) return state.quote;
  const data = await fetchJson(QUOTE_URL, 6000);
  const bid = num(data.bid);
  const ask = num(data.ask);
  const price = num(data.price) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  if (price == null || price <= 0) throw new Error('INVALID_XAUUSD_QUOTE');
  const parsedTime = Date.parse(data.updatedAt || '');
  const providerTime = num(data.t) ?? (Number.isFinite(parsedTime) ? parsedTime : now);
  state.quote = {
    price,
    bid: bid ?? price,
    ask: ask ?? price,
    t: providerTime,
    observedAt: now,
    updatedAt: iso(now),
    provider: data.provider || 'CAPITAL_COM',
    marketStatus: data.marketStatus || null,
    degraded: data.degraded === true || now - providerTime > 30_000
  };
  state.quoteAt = now;
  return state.quote;
}

function pushSample(t, price, bid = null, ask = null) {
  const time = num(t), p = num(price);
  if (time == null || p == null || p <= 0) return;
  state.samples.push({ t: time, p, price: p, bid: num(bid) ?? p, ask: num(ask) ?? p });
}

function normalizeSamples() {
  const cutoff = Date.now() - 2 * 60 * 60_000;
  const rows = state.samples
    .filter(row => num(row?.t) != null && num(row?.p ?? row?.price) != null && Number(row.t) >= cutoff)
    .sort((a, b) => Number(a.t) - Number(b.t));
  const unique = [];
  for (const row of rows) {
    const previous = unique.at(-1);
    if (previous && Number(previous.t) === Number(row.t)) Object.assign(previous, row);
    else unique.push(row);
  }
  state.samples = unique.slice(-1800);
}

async function refreshHistory(force = false) {
  const now = Date.now();
  if (!CANDLES_URL) return false;
  if (!force && state.samples.length >= 40 && now - state.candlesAt < CANDLE_CACHE_MS) return true;
  try {
    const data = await fetchJson(CANDLES_URL, 8000);
    const rows = Array.isArray(data.prices) ? data.prices : [];
    const seeded = [];
    for (const row of rows) {
      const t = num(row.t);
      const open = num(row.open), high = num(row.high), low = num(row.low), close = num(row.close);
      if (t == null || [open, high, low, close].some(value => value == null)) continue;
      if (t + 60_000 > now + 1500) continue;
      seeded.push(
        { t: t + 1000, p: open, price: open, bid: open, ask: open },
        { t: t + 16_000, p: high, price: high, bid: high, ask: high },
        { t: t + 31_000, p: low, price: low, bid: low, ask: low },
        { t: t + 59_000, p: close, price: close, bid: close, ask: close }
      );
    }
    if (seeded.length) {
      state.samples = seeded;
      normalizeSamples();
    }
    state.candlesAt = now;
    state.candlesError = null;
    return seeded.length > 0;
  } catch (error) {
    state.candlesAt = now;
    state.candlesError = String(error?.message || error);
    return false;
  }
}

function recordLiveQuote(quote) {
  const now = Date.now();
  const last = state.samples.at(-1);
  if (!last || now - Number(last.t) >= 4000) pushSample(now, quote.price, quote.bid, quote.ask);
  else Object.assign(last, { p: quote.price, price: quote.price, bid: quote.bid, ask: quote.ask });
  normalizeSamples();
}

function setupFingerprint(model = {}) {
  if (model.setupId) return String(model.setupId);
  return [model.candidateAction || model.side, model.strategy, round(model.entry), round(model.stopLoss), round(model.target1)].join('|');
}

function executablePrice(side, quote) {
  if (side === 'BUY') return num(quote.ask) ?? num(quote.price);
  if (side === 'SELL') return num(quote.bid) ?? num(quote.price);
  return num(quote.price);
}

function exitPrice(side, quote) {
  if (side === 'BUY') return num(quote.bid) ?? num(quote.price);
  if (side === 'SELL') return num(quote.ask) ?? num(quote.price);
  return num(quote.price);
}

function inRange(value, low, high) {
  return value != null && low != null && high != null && value >= Math.min(low, high) && value <= Math.max(low, high);
}

function targetReached(side, price, target) {
  return target != null && price != null && (side === 'BUY' ? price >= target : price <= target);
}

function stopReached(side, price, stop) {
  return stop != null && price != null && (side === 'BUY' ? price <= stop : price >= stop);
}

function levelsValid(model) {
  const side = model.candidateAction || model.side;
  const low = num(model.entryLow), high = num(model.entryHigh), stop = num(model.stopLoss);
  const targets = [model.target1, model.target2, model.target3, model.target4].map(num);
  if (!['BUY', 'SELL'].includes(side) || low == null || high == null || stop == null || targets.some(value => value == null)) return false;
  if (low > high) return false;
  if (side === 'BUY') return stop < low && targets[0] > high && targets[1] > targets[0] && targets[2] > targets[1] && targets[3] > targets[2];
  return stop > high && targets[0] < low && targets[1] < targets[0] && targets[2] < targets[1] && targets[3] < targets[2];
}

function blockSetup(setupId) {
  if (!setupId) return;
  state.blockedSetupIds = [...new Set([...state.blockedSetupIds, String(setupId)])].slice(-80);
}

function upsertTrade(event) {
  if (!event?.signalId) return;
  let row = state.trades.find(item => item.signalId === event.signalId);
  if (!row) {
    row = { signalId: event.signalId, createdAt: event.issuedAt || iso(Date.now()) };
    state.trades.push(row);
  }
  Object.assign(row, event, { updatedAt: iso(Date.now()) });
  state.trades = state.trades.slice(-200);
}

function closeSignal(outcome, now, exit, cooldownMs, block = true) {
  const signal = state.signal;
  if (!signal) return null;
  if (block) blockSetup(signal.setupId);
  const terminal = {
    ...signal,
    outcome,
    result: outcome === 'SL' ? 'SL' : outcome === 'TP4' ? 'TP4' : 'CANCELLED',
    closedAtMs: now,
    closedAt: iso(now),
    exitPrice: num(exit)
  };
  state.lastTerminal = terminal;
  state.signal = null;
  state.cooldownUntil = Math.max(Number(state.cooldownUntil) || 0, now + cooldownMs);
  upsertTrade({ ...terminal, status: 'CLOSED' });
  saveStore();
  return terminal;
}

function manageActiveSignal(quote, now) {
  const signal = state.signal;
  if (!signal) return;
  const price = exitPrice(signal.side, quote);
  if (stopReached(signal.side, price, signal.stopLoss)) {
    closeSignal('SL', now, signal.stopLoss, 180_000, true);
    return;
  }
  const targets = [signal.target1, signal.target2, signal.target3, signal.target4];
  for (let index = 0; index < targets.length; index += 1) {
    if (!signal.targetHits[index] && targetReached(signal.side, price, targets[index])) {
      signal.targetHits[index] = true;
      signal.targetHitAt[index] = now;
    }
  }
  if (signal.targetHits[3]) {
    closeSignal('TP4', now, signal.target4, 90_000, true);
    return;
  }
  if (now - Number(signal.issuedAtMs || now) > MAX_SIGNAL_MS) {
    closeSignal('EXPIRED', now, price, 90_000, true);
    return;
  }
  upsertTrade({ ...signal, status: 'SIGNAL' });
}

function createConfirmedSignal(model, quote, now) {
  if (state.signal || now < state.cooldownUntil || quote.degraded === true) return null;
  const side = model.candidateAction;
  const confidence = Number(model.confidence || 0);
  if (model.status !== 'CANDIDATE' || !['BUY', 'SELL'].includes(side) || confidence < MIN_CONFIDENCE || !levelsValid(model)) return null;
  const setupId = setupFingerprint(model);
  if (state.blockedSetupIds.includes(setupId)) return null;
  const entryPrice = executablePrice(side, quote);
  const low = num(model.entryLow), high = num(model.entryHigh);
  if (!inRange(entryPrice, low, high)) return null;
  const marketExit = exitPrice(side, quote);
  if (stopReached(side, marketExit, num(model.stopLoss)) || targetReached(side, marketExit, num(model.target1))) {
    blockSetup(setupId);
    return null;
  }
  state.signal = {
    signalId: `XAU-${now}-${side}`,
    setupId,
    side,
    candidateAction: side,
    action: 'WAIT',
    status: 'ACTIVE',
    strategy: model.strategy || null,
    confidence,
    signalConfidence: confidence,
    entry: num(model.entry),
    entryLow: low,
    entryHigh: high,
    stopLoss: num(model.stopLoss),
    target1: num(model.target1),
    target2: num(model.target2),
    target3: num(model.target3),
    target4: num(model.target4),
    riskReward: num(model.riskReward),
    contextBias: model.contextBias || null,
    prediction: model.prediction || null,
    oneMinuteConfirmed: Boolean(model.oneMinuteConfirmed),
    issuedAtMs: now,
    issuedAt: iso(now),
    targetHits: [false, false, false, false],
    targetHitAt: [null, null, null, null],
    source: 'GOLD_ALPHA_SITE',
    executionMode: 'SIGNAL_ONLY_TELEGRAM',
    executable: false,
    entered: true,
    triggered: true,
    triggerPrice: entryPrice,
    reason: 'CONFIRMED BY SITE ENGINE — أُرسلت الإشارة للتليغرام بدون AI وبدون تنفيذ آلي'
  };
  upsertTrade({ ...state.signal, status: 'SIGNAL' });
  saveStore();
  return state.signal;
}

function responseFor(model, quote, now) {
  const baseMeta = {
    source: 'GOLD_ALPHA_SITE',
    executionMode: 'SIGNAL_ONLY_TELEGRAM',
    executable: false,
    provider: quote.provider,
    marketStatus: quote.marketStatus,
    degraded: Boolean(quote.degraded),
    price: num(quote.price),
    bid: num(quote.bid),
    ask: num(quote.ask),
    updatedAt: iso(now),
    readingCompleteness: Number(model.readingCompleteness || 0),
    barCount: Number(model.barCount || 0),
    barCount5m: Number(model.barCount5m || 0),
    barCount15m: Number(model.barCount15m || 0),
    sampleCount: Number(model.sampleCount || state.samples.length),
    signalConfidence: Number(state.signal?.confidence ?? model.confidence ?? 0),
    minConfidence: MIN_CONFIDENCE,
    cooldownUntil: state.cooldownUntil || 0,
    terminalEvent: state.lastTerminal,
    build: BUILD,
    noAI: true
  };
  if (state.signal) {
    return {
      ...state.signal,
      ...baseMeta,
      status: 'ACTIVE',
      action: 'WAIT',
      candidateAction: state.signal.side,
      tp1: Boolean(state.signal.targetHits[0]),
      tp2: Boolean(state.signal.targetHits[1]),
      tp3: Boolean(state.signal.targetHits[2]),
      tp4: Boolean(state.signal.targetHits[3]),
      reason: state.signal.reason
    };
  }
  let reason = model.reason || 'بانتظار إشارة مؤكدة من محرك الموقع';
  if (quote.degraded) reason = 'STALE QUOTE: بيانات السعر غير حديثة؛ لن تصدر أي إشارة';
  else if (now < state.cooldownUntil) reason = 'COOLDOWN: فترة حماية بعد انتهاء الصفقة السابقة';
  else if (model.status === 'CANDIDATE' && ['BUY', 'SELL'].includes(model.candidateAction)) reason = 'السيناريو مكتمل لكن السعر لم يلمس نطاق الدخول المؤكد بعد';
  return {
    ...model,
    ...baseMeta,
    action: 'WAIT',
    status: model.status || 'WAIT',
    reason
  };
}

let queue = Promise.resolve();
async function evaluate() {
  const quote = await getQuote(false);
  await refreshHistory(false);
  recordLiveQuote(quote);
  const now = Date.now();
  manageActiveSignal(quote, now);
  const model = analyzeGoldSignal(state.samples, quote.price, now);
  if (!state.signal) createConfirmedSignal(model, quote, now);
  saveStore();
  return responseFor(model, quote, now);
}
function signal() {
  const task = queue.then(() => evaluate(), () => evaluate());
  queue = task.catch(() => {});
  return task;
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return json(res, 200, { service: 'Gold Alpha Site Signal Engine', mode: 'XAUUSD_SIGNAL_ONLY', build: BUILD, noAI: true, autoExecution: false });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        service: 'gold-alpha-site-signal-engine',
        build: BUILD,
        noAI: true,
        autoExecution: false,
        telegramOnly: true,
        quoteProvider: state.quote?.provider || null,
        quoteAgeMs: state.quote?.t ? Math.max(0, Date.now() - Number(state.quote.t)) : null,
        sampleCount: state.samples.length,
        candlesReady: state.samples.length >= 40,
        candlesError: state.candlesError,
        cooldownUntil: state.cooldownUntil || 0
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/auto-trade/signal') return json(res, 200, await signal());
    if (req.method === 'GET' && url.pathname === '/api/gold') return json(res, 200, await signal());
    if (req.method === 'GET' && url.pathname === '/api/gold-live') return json(res, 200, await signal());
    if (req.method === 'GET' && url.pathname === '/api/auto-trade/trades') return json(res, 200, { trades: state.trades, mode: 'SIGNAL_ONLY_TELEGRAM' });
    if (req.method === 'GET' && url.pathname === '/api/performance/journal') {
      const closed = state.trades.filter(row => row.status === 'CLOSED');
      const wins = closed.filter(row => row.outcome === 'TP4').length;
      const losses = closed.filter(row => row.outcome === 'SL').length;
      return json(res, 200, { trades: state.trades, closed: closed.length, wins, losses, winRate: closed.length ? round(wins / closed.length * 100, 1) : null });
    }
    if (req.method === 'POST' && url.pathname === '/api/auto-trade/report') {
      await readBody(req);
      return json(res, 200, { ok: true, ignored: true, mode: 'SIGNAL_ONLY_TELEGRAM', reason: 'Broker execution is disabled; site signal is the only source.' });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    return json(res, 503, { error: 'Signal engine unavailable', detail: String(error?.message || error), build: BUILD, noAI: true });
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[gold-site-signal-engine] ${BUILD} listening on ${PORT}; AI=off; execution=off; telegram-only`);
  try { await refreshHistory(true); } catch {}
});
