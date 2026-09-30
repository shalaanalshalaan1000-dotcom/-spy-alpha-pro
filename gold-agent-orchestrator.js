const toNum = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? null : Number(n.toFixed(digits));
};
const validSide = value => ['BUY', 'SELL'].includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : null;

const memory = {
  stage: 'WAIT',
  setupKey: null,
  activeSignalId: null,
  tpHits: [false, false, false, false],
  lastEventKey: null,
  events: []
};

function pushEvent(type, payload = {}, now = Date.now()) {
  const key = [type, payload.setupKey || payload.signalId || '', payload.stage || '', payload.side || ''].join(':');
  if (memory.lastEventKey === key) return;
  memory.lastEventKey = key;
  memory.events.unshift({type, at:new Date(now).toISOString(), ...payload});
  memory.events = memory.events.slice(0, 40);
}

function sourceSide(source = {}) {
  return validSide(source.action) || validSide(source.candidateAction) || validSide(source.side);
}

function inferCondition(source = {}, names = []) {
  const haystack = [
    source.reason,
    source.strategy,
    source.tradeStyle,
    source?.confluence?.reason,
    source?.scenarioPlan?.reason,
    source?.importantCandles?.primary?.pattern
  ].filter(Boolean).join(' ').toLowerCase();
  return names.some(name => haystack.includes(String(name).toLowerCase()));
}

function marketAgent(source = {}, now = Date.now()) {
  const mtf = source.multiTimeframe || source?.confluence?.multiTimeframe || {};
  const reads = mtf.reads || {};
  const side = validSide(mtf.side) || sourceSide(source);
  const quoteAgeMs = toNum(source.quoteAgeMs);
  const fresh = source.liveFeedFresh === true || (quoteAgeMs != null && quoteAgeMs >= 0 && quoteAgeMs <= 20_000);
  const degraded = Boolean(source.degraded);
  const news = source.newsRisk || {};
  const blockedByNews = Boolean(news.blockEntries);
  const liquidity = inferCondition(source, ['liquidity', 'sweep', 'session low', 'session high']);
  const mss = inferCondition(source, ['mss', 'choch', 'structure shift']);
  const displacement = inferCondition(source, ['displacement', 'impulse']);
  const retest = inferCondition(source, ['retest', 'fvg', 'order block', 'ob']);

  return {
    name: 'MARKET_AGENT',
    mode: 'ANALYSIS_ONLY',
    side: side || 'NEUTRAL',
    fresh,
    degraded,
    blockedByNews,
    context: {
      macro: mtf.side || 'NEUTRAL',
      macroAligned: toNum(mtf.macroAligned) ?? 0,
      intradayAligned: toNum(mtf.intradayAligned) ?? 0,
      timeframes: Object.fromEntries(Object.entries(reads).map(([k, v]) => [k, v?.side || 'NEUTRAL'])),
      liquidity,
      mss,
      displacement,
      retest
    },
    ready: !degraded && !blockedByNews && (fresh || source.liveFeedFresh == null),
    updatedAt: new Date(now).toISOString()
  };
}

function setupAgent(source = {}, market, now = Date.now()) {
  const side = sourceSide(source);
  const confidence = toNum(source.signalConfidence ?? source.confidence) ?? 0;
  const minConfidence = Math.max(0, toNum(process.env.AGENT_MIN_CONFIDENCE ?? process.env.GOLD_TELEGRAM_MIN_CONFIDENCE ?? process.env.MIN_CONFIDENCE) ?? 75);
  const status = String(source.status || 'WAIT').toUpperCase();
  const terminal = source.terminalEvent || null;
  const hasEntry = toNum(source.entry) != null && toNum(source.stopLoss) != null;
  const setupKey = String(source.signalId || ((side || 'WAIT') + ':' + round(source.entry) + ':' + round(source.stopLoss) + ':' + (source.strategy || source.tradeStyle || 'UNKNOWN')));

  let stage = 'WAIT';
  if (terminal) stage = 'INVALIDATED';
  else if (status === 'MANAGING' || source.entered === true) stage = 'MANAGING';
  else if (source.executable === true && validSide(source.action) && confidence >= minConfidence) stage = 'CONFIRMED';
  else if (side && hasEntry && confidence >= minConfidence && market.ready) stage = 'ARMED';
  else if (side) stage = 'WATCHING';

  const evidence = {
    htfContext: market.side !== 'NEUTRAL',
    liquidityEvent: market.context.liquidity,
    structureShift: market.context.mss,
    displacement: market.context.displacement,
    retest: market.context.retest,
    confidencePass: confidence >= minConfidence,
    marketReady: market.ready
  };

  if (stage !== memory.stage || setupKey !== memory.setupKey) {
    pushEvent('SETUP_STAGE', {setupKey, stage, side:side || 'WAIT', confidence:round(confidence, 0)}, now);
    memory.stage = stage;
    memory.setupKey = setupKey;
  }

  return {
    name: 'SETUP_AGENT',
    stage,
    side: side || 'WAIT',
    confidence: round(confidence, 0),
    minConfidence,
    setupKey,
    evidence,
    deterministic: true,
    reason: source.reason || 'Waiting for a deterministic setup state transition'
  };
}

function roundDownToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return null;
  return Math.floor((value + 1e-12) / step) * step;
}

function riskAgent(source = {}, setup) {
  const entry = toNum(source.entry);
  const stopLoss = toNum(source.stopLoss);
  const balance = Math.max(0, toNum(process.env.XAU_ACCOUNT_BALANCE_USD) ?? 70);
  const safeRiskUsd = Math.max(0, toNum(process.env.XAU_SAFE_RISK_USD) ?? 5);
  const maxRiskUsd = Math.max(safeRiskUsd, toNum(process.env.XAU_MAX_RISK_USD) ?? 10);
  const contractSize = Math.max(0.000001, toNum(process.env.XAU_CONTRACT_SIZE) ?? 100);
  const lotStep = Math.max(0.000001, toNum(process.env.XAU_LOT_STEP) ?? 0.01);
  const stopDistance = entry != null && stopLoss != null ? Math.abs(entry - stopLoss) : null;
  const rawLot = stopDistance && stopDistance > 0 ? safeRiskUsd / (stopDistance * contractSize) : null;
  const lot = rawLot == null ? null : Math.max(lotStep, roundDownToStep(rawLot, lotStep));
  const estimatedRiskUsd = lot != null && stopDistance != null ? lot * stopDistance * contractSize : null;
  const riskPct = balance > 0 && estimatedRiskUsd != null ? estimatedRiskUsd / balance * 100 : null;
  const structurallyValid = setup.side === 'WAIT' || (entry != null && stopLoss != null && (setup.side === 'BUY' ? stopLoss < entry : stopLoss > entry));

  return {
    name: 'RISK_AGENT',
    balanceUsd: round(balance),
    safeRiskUsd: round(safeRiskUsd),
    maxRiskUsd: round(maxRiskUsd),
    entry: round(entry),
    stopLoss: round(stopLoss),
    stopDistanceUsd: round(stopDistance),
    recommendedLot: lot == null ? null : round(lot, 2),
    estimatedRiskUsd: round(estimatedRiskUsd),
    estimatedRiskPct: round(riskPct, 1),
    structurallyValid,
    allowed: structurallyValid && estimatedRiskUsd != null && estimatedRiskUsd <= maxRiskUsd + 0.01,
    note: riskPct != null && riskPct > 5 ? 'Risk exceeds 5% of reference balance; review manually before execution.' : 'Within configured risk ceiling.'
  };
}

function tradeManagerAgent(source = {}, setup, now = Date.now()) {
  const side = setup.side;
  const signalId = source.signalId || null;
  const price = toNum(source.price);
  const entry = toNum(source.entry);
  const stopLoss = toNum(source.stopLoss);
  const targets = [source.target1, source.target2, source.target3, source.target4].map(toNum);

  if (signalId && memory.activeSignalId !== signalId) {
    memory.activeSignalId = signalId;
    memory.tpHits = [false, false, false, false];
    pushEvent('TRADE_TRACK', {signalId, setupKey:setup.setupKey, side, stage:setup.stage}, now);
  }

  if (price != null && ['BUY', 'SELL'].includes(side)) {
    targets.forEach((target, index) => {
      if (target == null || memory.tpHits[index]) return;
      const hit = side === 'BUY' ? price >= target : price <= target;
      if (hit) {
        memory.tpHits[index] = true;
        pushEvent('TP' + (index + 1) + '_HIT', {signalId:signalId || setup.setupKey, side, stage:setup.stage}, now);
      }
    });
  }

  const stopped = price != null && stopLoss != null && ['BUY', 'SELL'].includes(side)
    ? (side === 'BUY' ? price <= stopLoss : price >= stopLoss)
    : false;
  const tp1Hit = Boolean(memory.tpHits[0]);
  const suggestedProtection = tp1Hit && entry != null ? {type:'MOVE_SL', to:round(entry), policy:'BREAKEVEN_AFTER_TP1'} : null;
  const executionEnabled = String(process.env.AGENT_EXECUTION_ENABLED || 'false').toLowerCase() === 'true';

  return {
    name: 'TRADE_MANAGER_AGENT',
    signalId,
    stage: setup.stage,
    tracking: Boolean(signalId || setup.stage === 'MANAGING' || setup.stage === 'CONFIRMED'),
    tpHits: {tp1:memory.tpHits[0], tp2:memory.tpHits[1], tp3:memory.tpHits[2], tp4:memory.tpHits[3]},
    stopped,
    suggestedProtection,
    executionEnabled,
    action: stopped ? 'EXIT_STATE' : setup.stage === 'MANAGING' ? 'MANAGE' : setup.stage === 'CONFIRMED' ? 'READY' : 'OBSERVE',
    note: executionEnabled ? 'Execution permission enabled by environment.' : 'Observation mode: no broker orders are sent by the agent layer.'
  };
}

function researchAgent(source = {}) {
  const news = source.newsRisk || {};
  const event = news.activeEvent || news.nextEvent || null;
  return {
    name: 'RESEARCH_AGENT',
    contextOnly: true,
    newsAvailable: news.available !== false,
    highImpactUsd: Boolean(news.dayHasHighImpactUsd),
    blockEntries: Boolean(news.blockEntries),
    event: event ? {title:event.title || null, time:event.time || event.date || null, impact:event.impact || null} : null,
    rule: 'Research context can veto or annotate a setup, but cannot create a BUY/SELL signal by itself.'
  };
}

function sessionAgent(source = {}) {
  const session = source.sessionLiquidity || source.sessionLevels || source.sessions || source.liquidity || null;
  return {
    name: 'SESSION_LIQUIDITY_AGENT',
    timeframe: 'M15/M30 context; M5 confirmation',
    data: session,
    detectedFromSetup: inferCondition(source, ['london', 'new york', 'tokyo', 'session', 'liquidity', 'sweep']),
    rule: 'Session high/low breaks are alerts; entries require a confirmed structure shift/retest.'
  };
}

function journalAgent(setup, risk, tradeManager) {
  return {
    name: 'JOURNAL_AGENT',
    currentSetupKey: setup.setupKey,
    currentStage: setup.stage,
    riskSnapshot: {estimatedRiskUsd:risk.estimatedRiskUsd, recommendedLot:risk.recommendedLot},
    tradeState: {signalId:tradeManager.signalId, tpHits:tradeManager.tpHits, action:tradeManager.action},
    recentEvents: memory.events.slice(0, 12)
  };
}

export function orchestrateGoldAgents(source = {}, now = Date.now()) {
  const market = marketAgent(source, now);
  const setup = setupAgent(source, market, now);
  const risk = riskAgent(source, setup);
  const tradeManager = tradeManagerAgent(source, setup, now);
  const research = researchAgent(source);
  const session = sessionAgent(source);
  const journal = journalAgent(setup, risk, tradeManager);
  const executionEnabled = tradeManager.executionEnabled;
  const decisionReady = setup.stage === 'CONFIRMED' && market.ready && risk.allowed && !research.blockEntries;

  return {
    architecture: 'GOLD_AGENT_STACK_V1',
    symbol: 'XAUUSD',
    mode: executionEnabled ? 'EXECUTION_PERMISSION_ON' : 'OBSERVE_ONLY',
    decision: {
      stage: setup.stage,
      side: setup.side,
      ready: decisionReady,
      executable: decisionReady && executionEnabled,
      reason: !market.ready ? 'Market agent not ready' : research.blockEntries ? 'Research/news veto' : !risk.allowed ? 'Risk agent veto' : setup.stage !== 'CONFIRMED' ? ('Setup stage ' + setup.stage) : executionEnabled ? 'All deterministic gates passed' : 'All gates passed; execution permission remains off'
    },
    agents: {market, setup, risk, tradeManager, session, research, journal},
    updatedAt: new Date(now).toISOString()
  };
}

export function resetGoldAgentMemory() {
  memory.stage = 'WAIT';
  memory.setupKey = null;
  memory.activeSignalId = null;
  memory.tpHits = [false, false, false, false];
  memory.lastEventKey = null;
  memory.events = [];
}
