import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MASSIVE_BASE = 'https://api.massive.com';
const UNIVERSE_LIMIT = 1500;
const TOP_LIMIT = 20;
const MIN_PRICE = 1;
const MAX_PRICE = 5;
const MIN_VOLUME = 250000;
const MIN_DOLLAR_VOLUME = 500000;
const COMPANY_TYPES = new Set(['CS', 'ADRC']);
const COMPANY_EXCHANGES = new Set(['XNAS', 'XNYS', 'XASE']);
const HTML = readFileSync(join(__dirname, 'public', 'index.html'), 'utf8');

const scanCache = {expiresAt: 0, value: null, inflight: null};
const metadataCache = {expiresAt: 0, symbols: null};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function timestampMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e17) return n / 1e6;
  if (n > 1e14) return n / 1e3;
  if (n > 1e11) return n;
  return n * 1000;
}

function marketProgress(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value])
  );
  if (['Sat', 'Sun'].includes(parts.weekday)) return 1;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (minutes <= open) return 0.08;
  if (minutes >= close) return 1;
  return clamp((minutes - open) / (close - open), 0.08, 1);
}

async function massiveGet(pathOrUrl, params = {}) {
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) throw new Error('MASSIVE_API_KEY is not configured');

  const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : MASSIVE_BASE + pathOrUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  if (!url.searchParams.has('apiKey')) url.searchParams.set('apiKey', apiKey);

  const response = await fetch(url, {
    headers: {accept: 'application/json'},
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status === 'ERROR') {
    const error = new Error(body.error || body.message || ('Massive HTTP ' + response.status));
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

async function loadCompanySymbols() {
  if (metadataCache.symbols && Date.now() < metadataCache.expiresAt) return metadataCache.symbols;

  const symbols = new Set();
  let url = '/v3/reference/tickers?market=stocks&active=true&limit=1000&sort=ticker&order=asc';
  let pages = 0;

  while (url && pages < 20) {
    const data = await massiveGet(url);
    for (const row of data.results || []) {
      if (!row || !COMPANY_TYPES.has(row.type)) continue;
      if (row.primary_exchange && !COMPANY_EXCHANGES.has(row.primary_exchange)) continue;
      const ticker = String(row.ticker || '').trim().toUpperCase();
      if (/^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(ticker)) symbols.add(ticker);
    }
    url = data.next_url || null;
    pages += 1;
  }

  if (symbols.size < 500) throw new Error('Company universe metadata is unexpectedly small');

  metadataCache.symbols = symbols;
  metadataCache.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  return symbols;
}

function normalizeSnapshot(row, companySymbols, progress) {
  const symbol = String(row?.ticker || '').trim().toUpperCase();
  if (!companySymbols.has(symbol)) return null;

  const day = row?.day || {};
  const minute = row?.min || {};
  const prev = row?.prevDay || {};
  const price = Number(row?.lastTrade?.p ?? minute.c ?? day.c);
  const high = Number(day.h);
  const low = Number(day.l);
  const open = Number(day.o);
  const vwap = Number(day.vw);
  const volume = Number(day.v ?? minute.av ?? minute.v);
  const previousVolume = Number(prev.v);
  const changePct = Number(row?.todaysChangePerc);
  const updatedMs = timestampMs(row?.updated ?? minute.t ?? row?.lastTrade?.t);

  if (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) return null;
  if (!Number.isFinite(volume) || volume < MIN_VOLUME) return null;

  const dollarVolume = price * volume;
  if (!Number.isFinite(dollarVolume) || dollarVolume < MIN_DOLLAR_VOLUME) return null;
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= 0 || low <= 0) return null;

  const distanceToHighPct = Math.max(0, (high - price) / high * 100);
  const rangePct = (high - low) / low * 100;
  const relativeVolume = Number.isFinite(previousVolume) && previousVolume > 0
    ? volume / Math.max(previousVolume * progress, 1)
    : null;
  const aboveVwap = Number.isFinite(vwap) ? price >= vwap : null;
  const freshnessMinutes = updatedMs ? Math.max(0, (Date.now() - updatedMs) / 60000) : null;

  return {
    symbol,
    price,
    high,
    low,
    open: Number.isFinite(open) ? open : null,
    vwap: Number.isFinite(vwap) ? vwap : null,
    volume,
    previousVolume: Number.isFinite(previousVolume) ? previousVolume : null,
    dollarVolume,
    changePct: Number.isFinite(changePct) ? changePct : null,
    distanceToHighPct,
    rangePct,
    relativeVolume,
    aboveVwap,
    freshnessMinutes,
    updatedAt: updatedMs ? new Date(updatedMs).toISOString() : null
  };
}

function scoreCandidate(item) {
  const logDollar = Math.log10(Math.max(item.dollarVolume, 1));
  const logVolume = Math.log10(Math.max(item.volume, 1));

  const liquidityScore = clamp((logDollar - 5.7) / (8.5 - 5.7) * 20, 0, 20);
  const volumeScore = clamp((logVolume - 5.3) / (7.7 - 5.3) * 10, 0, 10);
  const momentumScore = clamp((item.changePct || 0) / 12 * 20, 0, 20);

  let highScore = 0;
  if (item.distanceToHighPct <= 0.15) highScore = 15;
  else if (item.distanceToHighPct <= 0.35) highScore = 13;
  else if (item.distanceToHighPct <= 0.75) highScore = 10;
  else if (item.distanceToHighPct <= 1.5) highScore = 6;
  else if (item.distanceToHighPct <= 3) highScore = 2;

  const rangeScore = clamp(item.rangePct / 12 * 10, 0, 10);
  const rvolScore = item.relativeVolume == null
    ? 4
    : clamp((item.relativeVolume - 0.6) / (2.5 - 0.6) * 20, 0, 20);
  const vwapScore = item.aboveVwap === true ? 5 : item.aboveVwap === null ? 2 : 0;

  let score = liquidityScore + volumeScore + momentumScore + highScore + rangeScore + rvolScore + vwapScore;
  if ((item.changePct || 0) <= 0) score -= 12;
  if (item.freshnessMinutes != null && item.freshnessMinutes > 20) score -= 18;
  score = clamp(Math.round(score), 0, 100);

  const reasons = [];
  if (item.relativeVolume != null && item.relativeVolume >= 1.5) reasons.push('RVOL ' + item.relativeVolume.toFixed(1) + 'x');
  if (item.distanceToHighPct <= 0.75) reasons.push('قريب من هاي اليوم ' + item.distanceToHighPct.toFixed(2) + '%');
  if ((item.changePct || 0) >= 3) reasons.push('زخم +' + item.changePct.toFixed(1) + '%');
  if (item.aboveVwap === true) reasons.push('فوق VWAP');
  if (item.dollarVolume >= 10000000) reasons.push('سيولة دولارية قوية');
  if (!reasons.length) reasons.push('أفضل تجميع نسبي داخل الـ universe الحالي');

  let signal = 'PASS';
  if (score >= 75 && (item.changePct || 0) > 0 && item.distanceToHighPct <= 1.5) signal = 'BEST LONG';
  else if (score >= 60 && (item.changePct || 0) > 0) signal = 'WATCH';

  return {
    ...item,
    score,
    signal,
    reasons: reasons.slice(0, 3)
  };
}

async function buildScan() {
  const companySymbols = await loadCompanySymbols();
  const snapshot = await massiveGet('/v2/snapshot/locale/us/markets/stocks/tickers', {include_otc: false});
  const rows = Array.isArray(snapshot.tickers) ? snapshot.tickers : [];
  const progress = marketProgress();

  const eligible = rows
    .map(row => normalizeSnapshot(row, companySymbols, progress))
    .filter(Boolean)
    .sort((a, b) => b.dollarVolume - a.dollarVolume);

  const universe = eligible.slice(0, UNIVERSE_LIMIT);
  const ranked = universe
    .map(scoreCandidate)
    .sort((a, b) =>
      b.score - a.score ||
      (b.relativeVolume || 0) - (a.relativeVolume || 0) ||
      b.dollarVolume - a.dollarVolume
    );

  const best = ranked[0] || null;

  return {
    ok: true,
    provider: 'MASSIVE',
    generatedAt: new Date().toISOString(),
    scannedMarket: rows.length,
    companyMetadataCount: companySymbols.size,
    eligibleCount: eligible.length,
    universeCount: universe.length,
    requestedUniverse: UNIVERSE_LIMIT,
    topCount: Math.min(TOP_LIMIT, ranked.length),
    filters: {
      price: '$1–$5',
      otc: false,
      companyTypes: [...COMPANY_TYPES],
      minVolume: MIN_VOLUME,
      minDollarVolume: MIN_DOLLAR_VOLUME
    },
    best: best ? publicItem(best, 1) : null,
    items: ranked.slice(0, TOP_LIMIT).map((item, index) => publicItem(item, index + 1))
  };
}

function publicItem(item, rank) {
  return {
    rank,
    symbol: item.symbol,
    price: round(item.price),
    score: item.score,
    signal: item.signal,
    changePct: round(item.changePct, 2),
    volume: Math.round(item.volume),
    dollarVolume: Math.round(item.dollarVolume),
    relativeVolume: round(item.relativeVolume, 2),
    high: round(item.high),
    low: round(item.low),
    distanceToHighPct: round(item.distanceToHighPct, 2),
    rangePct: round(item.rangePct, 2),
    vwap: round(item.vwap),
    aboveVwap: item.aboveVwap,
    freshnessMinutes: round(item.freshnessMinutes, 1),
    updatedAt: item.updatedAt,
    reasons: item.reasons
  };
}

async function getScan(force = false) {
  if (!force && scanCache.value && Date.now() < scanCache.expiresAt) return scanCache.value;
  if (scanCache.inflight) return scanCache.inflight;

  scanCache.inflight = (async () => {
    const value = await buildScan();
    scanCache.value = value;
    scanCache.expiresAt = Date.now() + 60 * 1000;
    return value;
  })();

  try {
    return await scanCache.inflight;
  } finally {
    scanCache.inflight = null;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      });
      return res.end(HTML);
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        configured: Boolean(process.env.MASSIVE_API_KEY),
        universe: UNIVERSE_LIMIT
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/scan') {
      const data = await getScan(url.searchParams.get('force') === '1');
      return sendJson(res, 200, data);
    }

    return sendJson(res, 404, {error: 'Not found'});
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return sendJson(res, status, {error: String(error.message || error)});
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Alpha Cheap Stocks 1500 listening on ' + PORT);
});
