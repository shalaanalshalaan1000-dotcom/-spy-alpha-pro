const CALENDAR_URL = String(process.env.GOLD_ECON_CALENDAR_URL || 'https://nfs.faireconomy.media/ff_calendar_thisweek.json').trim();
const CACHE_MS = Math.max(60_000, Number(process.env.GOLD_NEWS_CACHE_MS || 300_000));
const RISK_CACHE_MS = Math.max(1_000, Number(process.env.GOLD_NEWS_RISK_CACHE_MS || 5_000));
const REQUIRE_NEWS_FEED = String(process.env.GOLD_REQUIRE_NEWS_FEED || 'true').toLowerCase() !== 'false';
const RIYADH_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
});

const cache = { expiresAt: 0, events: [], error: null, updatedAt: null };
let calendarLoadPromise = null;
let riskCache = { expiresAt: 0, value: null };

const MAJOR_RE = /(fomc statement|fomc minutes|federal funds rate|interest rate decision|fed press conference|cpi|consumer price index|core pce|pce price|non[- ]farm|employment situation|unemployment rate|average hourly earnings|payrolls)/i;
const FED_SPEECH_RE = /(speaks|speech|remarks|fireside|panel|interview)/i;
const IMPORTANT_RE = /(jobless claims|unemployment claims|retail sales|gdp|ism|jolts|ppi|producer price|consumer confidence|durable goods|adp|treasury|powell|warsh|federal reserve)/i;

function riyadhDayKey(ms) {
  return RIYADH_DAY_FORMATTER.format(new Date(ms));
}

function eventTime(event) {
  const raw = event?.date || event?.datetime || event?.time;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeImpact(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('high') || text === '3') return 'HIGH';
  if (text.includes('medium') || text.includes('med') || text === '2') return 'MEDIUM';
  if (text.includes('low') || text === '1') return 'LOW';
  return 'UNKNOWN';
}

function normalizeEvent(event = {}) {
  const title = String(event.title || event.event || event.name || '').trim();
  const country = String(event.country || event.currency || '').trim().toUpperCase();
  const atMs = eventTime(event);
  return {
    title,
    country,
    impact: normalizeImpact(event.impact),
    atMs,
    dayKey: atMs ? riyadhDayKey(atMs) : null,
    at: atMs ? new Date(atMs).toISOString() : null,
    forecast: event.forecast ?? null,
    previous: event.previous ?? null,
    actual: event.actual ?? null
  };
}

async function refreshCalendar(now) {
  try {
    const response = await fetch(CALENDAR_URL, {
      headers: { 'user-agent': 'Gold-Alpha-Pro/1.0', accept: 'application/json' },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`economic calendar HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
    cache.events = rows.map(normalizeEvent).filter(e => e.country === 'USD' && e.atMs && e.title);
    cache.error = null;
    cache.updatedAt = new Date(now).toISOString();
    cache.expiresAt = now + CACHE_MS;
  } catch (error) {
    cache.error = String(error?.message || error);
    cache.updatedAt = new Date(now).toISOString();
    cache.expiresAt = now + Math.min(CACHE_MS, 120_000);
  }
  return cache;
}

async function loadCalendar() {
  const now = Date.now();
  if (cache.expiresAt > now && (cache.events.length || cache.error)) return cache;
  if (calendarLoadPromise) return calendarLoadPromise;
  calendarLoadPromise = refreshCalendar(now);
  try {
    return await calendarLoadPromise;
  } finally {
    calendarLoadPromise = null;
  }
}

function windowsFor(event) {
  // Ordinary Fed/FOMC member speeches should not hard-block entries.
  // Keep blackout windows for actual policy decisions, press conferences, and major macro releases.
  if (FED_SPEECH_RE.test(event.title) && !/press conference/i.test(event.title)) {
    return { beforeMin: 0, afterMin: 0, severity: 'NORMAL' };
  }
  const major = MAJOR_RE.test(event.title);
  const important = IMPORTANT_RE.test(event.title);
  if (major) return { beforeMin: 120, afterMin: 180, severity: 'EXTREME' };
  if (event.impact === 'HIGH') return { beforeMin: 60, afterMin: 90, severity: important ? 'HIGH' : 'HIGH' };
  if (event.impact === 'MEDIUM' && important) return { beforeMin: 30, afterMin: 45, severity: 'ELEVATED' };
  return { beforeMin: 0, afterMin: 0, severity: 'NORMAL' };
}

function memoizeRisk(value, now) {
  riskCache = { expiresAt: now + RISK_CACHE_MS, value };
  return value;
}

export async function getGoldNewsRisk(now = Date.now()) {
  if (riskCache.value && riskCache.expiresAt > now) return riskCache.value;

  const cal = await loadCalendar();
  const todayKey = riyadhDayKey(now);
  const usdToday = cal.events
    .filter(e => e.dayKey === todayKey)
    .sort((a, b) => a.atMs - b.atMs);
  const highImpactToday = usdToday.filter(e => e.impact === 'HIGH' || MAJOR_RE.test(e.title));

  if (cal.error && REQUIRE_NEWS_FEED) {
    return memoizeRisk({
      available: false,
      dayHasHighImpactUsd: null,
      level: 'UNKNOWN',
      blockEntries: true,
      reason: 'NEWS_FEED_UNAVAILABLE — new XAUUSD entries paused until the USD calendar recovers',
      activeEvent: null,
      nextEvent: null,
      eventsToday: [],
      error: cal.error,
      updatedAt: cal.updatedAt
    }, now);
  }

  let activeEvent = null;
  let activeWindow = null;
  for (const event of usdToday) {
    const w = windowsFor(event);
    if (!w.beforeMin && !w.afterMin) continue;
    const start = event.atMs - w.beforeMin * 60_000;
    const end = event.atMs + w.afterMin * 60_000;
    if (now >= start && now <= end) {
      if (!activeEvent || w.severity === 'EXTREME' || (w.severity === 'HIGH' && activeWindow?.severity !== 'EXTREME')) {
        activeEvent = event;
        activeWindow = { ...w, start, end };
      }
    }
  }

  const future = usdToday.filter(e => e.atMs > now);
  const nextEvent = future.length ? future[0] : null;
  const dayHasHighImpactUsd = highImpactToday.length > 0;
  const blockEntries = Boolean(activeEvent);
  const level = activeWindow?.severity || (dayHasHighImpactUsd ? 'NEWS_DAY' : 'NORMAL');
  const reason = activeEvent
    ? `${level}: ${activeEvent.title} — XAUUSD entries blocked from ${activeWindow.beforeMin}m before until ${activeWindow.afterMin}m after the USD release`
    : dayHasHighImpactUsd
      ? `NEWS_DAY: ${highImpactToday.length} high-impact USD event(s) can move gold; entries allowed only outside blackout windows`
      : 'NORMAL: no high-impact USD event detected for today';

  return memoizeRisk({
    available: !cal.error,
    dayHasHighImpactUsd,
    level,
    blockEntries,
    reason,
    activeEvent: activeEvent ? { ...activeEvent, blackoutStart: new Date(activeWindow.start).toISOString(), blackoutEnd: new Date(activeWindow.end).toISOString() } : null,
    nextEvent,
    eventsToday: usdToday.slice(0, 12),
    updatedAt: cal.updatedAt,
    error: cal.error
  }, now);
}
