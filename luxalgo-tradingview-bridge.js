const FRAME_TTL_MS = {
  '1m': 20 * 60_000,
  '5m': 60 * 60_000,
  '15m': 3 * 60 * 60_000,
  '1h': 8 * 60 * 60_000,
  '4h': 20 * 60 * 60_000
};

const ALLOWED_EVENTS = new Set([
  'BULLISH_MSS','BEARISH_MSS',
  'BULLISH_BOS','BEARISH_BOS',
  'BULLISH_DISPLACEMENT','BEARISH_DISPLACEMENT',
  'BULLISH_FVG','BEARISH_FVG',
  'BULLISH_OB','BEARISH_OB',
  'SELLSIDE_LIQUIDITY_SWEPT','BUYSIDE_LIQUIDITY_SWEPT'
]);

const store = {
  lastEventAt: 0,
  lastEvent: null,
  totalEvents: 0,
  frames: Object.create(null),
  events: []
};

const num = v => v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const boolEnv = (name, fallback=false) => {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1','true','yes','on'].includes(String(value).toLowerCase());
};

function normalizeTimeframe(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '');
  if (['1','1m','m1','01'].includes(compact)) return '1m';
  if (['5','5m','m5','05'].includes(compact)) return '5m';
  if (['15','15m','m15'].includes(compact)) return '15m';
  if (['60','60m','1h','h1'].includes(compact)) return '1h';
  if (['240','240m','4h','h4'].includes(compact)) return '4h';
  return compact;
}

function normalizeEvent(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function normalizeSide(value, event) {
  const side = String(value ?? '').trim().toUpperCase();
  if (side === 'BUY' || side === 'BULL' || side === 'BULLISH') return 'BUY';
  if (side === 'SELL' || side === 'BEAR' || side === 'BEARISH') return 'SELL';
  if (event.startsWith('BULLISH_')) return 'BUY';
  if (event.startsWith('BEARISH_')) return 'SELL';
  if (event === 'SELLSIDE_LIQUIDITY_SWEPT') return 'BUY';
  if (event === 'BUYSIDE_LIQUIDITY_SWEPT') return 'SELL';
  return null;
}

function eventKind(event) {
  if (event.endsWith('_MSS')) return 'mss';
  if (event.endsWith('_BOS')) return 'bos';
  if (event.endsWith('_DISPLACEMENT')) return 'displacement';
  if (event.endsWith('_FVG')) return 'fvg';
  if (event.endsWith('_OB')) return 'orderBlock';
  if (event.includes('LIQUIDITY_SWEPT')) return 'liquiditySweep';
  return 'other';
}

function eventTimestamp(payload, now=Date.now()) {
  const raw = num(payload?.time ?? payload?.timestamp ?? payload?.ts);
  if (raw != null) {
    const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : null;
    if (ms != null && ms <= now + 5 * 60_000 && ms >= now - 36 * 60 * 60_000) return ms;
  }
  const parsed = Date.parse(payload?.time ?? payload?.timestamp ?? '');
  return Number.isFinite(parsed) && parsed <= now + 5 * 60_000 ? parsed : now;
}

function sanitizeZone(payload) {
  const low = num(payload?.zoneLow ?? payload?.fvgLow ?? payload?.low);
  const high = num(payload?.zoneHigh ?? payload?.fvgHigh ?? payload?.high);
  if (low == null || high == null) return null;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function compactEvent(event) {
  if (!event) return null;
  return {
    event: event.event,
    kind: event.kind,
    side: event.side,
    timeframe: event.timeframe,
    price: event.price,
    zone: event.zone,
    killzone: event.killzone,
    at: event.at,
    atIso: new Date(event.at).toISOString()
  };
}

function isFresh(event, timeframe, now) {
  if (!event) return false;
  const ttl = FRAME_TTL_MS[timeframe] ?? 2 * 60 * 60_000;
  return now - event.at >= 0 && now - event.at <= ttl;
}

function freshEvent(frame, key, timeframe, now) {
  const value = frame?.[key];
  return isFresh(value, timeframe, now) ? value : null;
}

function frameView(timeframe, now) {
  const frame = store.frames[timeframe] || {};
  const mss = freshEvent(frame, 'mss', timeframe, now);
  const bos = freshEvent(frame, 'bos', timeframe, now);
  const structure = [mss, bos].filter(Boolean).sort((a,b)=>b.at-a.at)[0] || null;
  const displacement = freshEvent(frame, 'displacement', timeframe, now);
  const fvg = freshEvent(frame, 'fvg', timeframe, now);
  const orderBlock = freshEvent(frame, 'orderBlock', timeframe, now);
  const liquiditySweep = freshEvent(frame, 'liquiditySweep', timeframe, now);
  return {
    timeframe,
    structure: compactEvent(structure),
    mss: compactEvent(mss),
    bos: compactEvent(bos),
    displacement: compactEvent(displacement),
    fvg: compactEvent(fvg),
    orderBlock: compactEvent(orderBlock),
    liquiditySweep: compactEvent(liquiditySweep)
  };
}

function sameSide(event, side) {
  return Boolean(event && event.side === side);
}

function oppositeSide(event, side) {
  return Boolean(event && event.side && event.side !== side);
}

export function ingestLuxAlgoEvent(payload, options={}) {
  const now = Date.now();
  const expectedSecret = String(options.expectedSecret ?? process.env.LUXALGO_WEBHOOK_SECRET ?? '');
  if (!expectedSecret) return { ok:false, statusCode:503, error:'LUXALGO_WEBHOOK_SECRET_NOT_CONFIGURED' };
  if (String(payload?.secret ?? '') !== expectedSecret) return { ok:false, statusCode:401, error:'INVALID_WEBHOOK_SECRET' };

  const symbol = String(payload?.symbol ?? payload?.ticker ?? '').trim().toUpperCase();
  if (!symbol || (!symbol.includes('XAUUSD') && !symbol.includes('XAU/USD') && !symbol.includes('GOLD'))) {
    return { ok:false, statusCode:400, error:'UNSUPPORTED_SYMBOL' };
  }

  const timeframe = normalizeTimeframe(payload?.timeframe ?? payload?.interval);
  if (!FRAME_TTL_MS[timeframe]) return { ok:false, statusCode:400, error:'UNSUPPORTED_TIMEFRAME' };

  const event = normalizeEvent(payload?.event);
  if (!ALLOWED_EVENTS.has(event)) return { ok:false, statusCode:400, error:'UNSUPPORTED_EVENT' };

  const side = normalizeSide(payload?.side, event);
  if (!side) return { ok:false, statusCode:400, error:'MISSING_EVENT_SIDE' };

  const at = eventTimestamp(payload, now);
  const item = {
    source: 'LUXALGO_ICT_CONCEPTS',
    symbol,
    timeframe,
    event,
    kind: eventKind(event),
    side,
    price: num(payload?.price ?? payload?.close),
    zone: sanitizeZone(payload),
    killzone: String(payload?.killzone ?? 'UNKNOWN').trim().toUpperCase(),
    at,
    receivedAt: now
  };

  const frame = store.frames[timeframe] ||= {};
  frame[item.kind] = item;
  frame.lastEvent = item;
  store.lastEventAt = now;
  store.lastEvent = item;
  store.totalEvents += 1;
  store.events.push(item);
  store.events = store.events.slice(-200);

  return {
    ok:true,
    statusCode:202,
    accepted:compactEvent(item),
    state:getLuxAlgoState(now)
  };
}

export function getLuxAlgoState(now=Date.now()) {
  const frames = {
    '1h': frameView('1h', now),
    '15m': frameView('15m', now),
    '5m': frameView('5m', now),
    '1m': frameView('1m', now)
  };
  const connected = store.lastEventAt > 0 && now - store.lastEventAt <= 8 * 60 * 60_000;
  const strictReady = Boolean(
    frames['1h'].structure &&
    frames['15m'].structure &&
    frames['5m'].structure &&
    frames['5m'].displacement &&
    frames['5m'].fvg
  );
  return {
    source:'ICT Concepts [LuxAlgo] via TradingView alerts',
    connected,
    strictReady,
    required:boolEnv('LUXALGO_REQUIRED', false),
    lastEventAt:store.lastEventAt || null,
    lastEventAtIso:store.lastEventAt ? new Date(store.lastEventAt).toISOString() : null,
    lastEvent:compactEvent(store.lastEvent),
    totalEvents:store.totalEvents,
    frames,
    recentEvents:store.events.slice(-12).reverse().map(compactEvent)
  };
}

function block(model, snapshot, reason, code) {
  return {
    ...model,
    status:'WAIT',
    action:'WAIT',
    candidateAction:'WAIT',
    side:null,
    confidence:0,
    signalConfidence:0,
    luxalgo:{...snapshot,mode:'STRICT',gate:'BLOCK',gateCode:code,gateReason:reason},
    reason:`LUXALGO ICT BLOCK: ${reason}`
  };
}

export function gateGoldModelWithLuxAlgo(model, options={}) {
  const now = Number(options.now) || Date.now();
  const required = options.required ?? boolEnv('LUXALGO_REQUIRED', false);
  const snapshot = getLuxAlgoState(now);
  const candidate = ['BUY','SELL'].includes(model?.candidateAction)
    ? model.candidateAction
    : ['BUY','SELL'].includes(model?.side)
      ? model.side
      : null;

  if (!required) {
    return {
      ...model,
      luxalgo:{...snapshot,mode:'OBSERVE',gate:'OBSERVE_ONLY',gateReason:'Bridge is collecting LuxAlgo events; strict gating is not enabled yet.'}
    };
  }

  if (!candidate) {
    return {
      ...model,
      luxalgo:{...snapshot,mode:'STRICT',gate:'NO_CANDIDATE',gateReason:'No site-engine trade candidate to validate.'}
    };
  }

  const h1 = snapshot.frames['1h'];
  const m15 = snapshot.frames['15m'];
  const m5 = snapshot.frames['5m'];
  const m1 = snapshot.frames['1m'];

  if (!snapshot.connected) return block(model, snapshot, 'TradingView/LuxAlgo feed is not connected or is stale.', 'FEED_NOT_CONNECTED');
  if (!h1.structure || !m15.structure) return block(model, snapshot, 'Need fresh H1 and M15 MSS/BOS context before a trade.', 'HTF_CONTEXT_MISSING');
  if (oppositeSide(h1.structure, candidate)) return block(model, snapshot, `H1 structure is ${h1.structure.side}, opposite ${candidate}.`, 'H1_CONFLICT');
  if (oppositeSide(m15.structure, candidate)) return block(model, snapshot, `M15 structure is ${m15.structure.side}, opposite ${candidate}.`, 'M15_CONFLICT');
  if (!sameSide(h1.structure, candidate) || !sameSide(m15.structure, candidate)) {
    return block(model, snapshot, 'H1 and M15 are not aligned with the candidate.', 'HTF_NOT_ALIGNED');
  }

  if (!m5.structure) return block(model, snapshot, 'Need a fresh M5 MSS/BOS trigger.', 'M5_STRUCTURE_MISSING');
  if (oppositeSide(m5.structure, candidate)) return block(model, snapshot, `M5 structure is ${m5.structure.side}, opposite ${candidate}.`, 'M5_STRUCTURE_CONFLICT');
  if (!sameSide(m5.displacement, candidate)) return block(model, snapshot, 'Need same-side M5 displacement.', 'M5_DISPLACEMENT_MISSING');
  if (!sameSide(m5.fvg, candidate)) return block(model, snapshot, 'Need same-side M5 FVG after structure/displacement.', 'M5_FVG_MISSING');

  if (m1.structure && oppositeSide(m1.structure, candidate)) {
    return block(model, snapshot, `M1 timing structure is ${m1.structure.side}; wait for execution alignment.`, 'M1_TIMING_CONFLICT');
  }

  return {
    ...model,
    luxalgo:{...snapshot,mode:'STRICT',gate:'PASS',gateReason:`H1/M15 context + M5 structure/displacement/FVG confirm ${candidate}.`}
  };
}
