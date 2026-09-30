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
  else if (status === 'MANAGING' || source.brokerConfirmed === true) stage = 'MANAGING';
  else if (
    side && hasEntry && confidence >= minConfidence && market.ready &&
    (
      source.executable === true ||
      source.triggered === true ||
      source.entered === true ||
      ['ACTIVE','SIGNAL','CONFIRMED'].includes(status)
    )
  ) stage = 'CONFIRMED';
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


function stateEngineAgent(source = {}, market = {}) {
  const bid = toNum(source.bid);
  const ask = toNum(source.ask);
  const spread = bid != null && ask != null && ask >= bid ? ask - bid : toNum(source.spread);
  const mtf = source.multiTimeframe || source?.confluence?.multiTimeframe || {};
  const reads = mtf.reads || {};
  const timeframes = Object.fromEntries(
    ['MN1','W1','D2','D1','H4','H1','M15','M5','M1'].map(tf => [tf, validSide(reads?.[tf]?.side) || 'NEUTRAL'])
  );
  const volatility = toNum(source.realizedVolatility ?? source.volatility ?? source.atrPct);
  let regime = 'TRANSITION';
  if (market.degraded || !market.fresh) regime = 'DEGRADED';
  else if (market.blockedByNews) regime = 'NEWS_BLOCK';
  else if (volatility != null && volatility >= Math.max(0, toNum(process.env.AGENT_HIGH_VOL_THRESHOLD) ?? 2.5)) regime = 'HIGH_VOL';
  else if ((toNum(mtf.macroAligned) ?? 0) >= 3 && (toNum(mtf.intradayAligned) ?? 0) >= 2) regime = 'TREND';
  else if (inferCondition(source, ['range','sideways','mean reversion','balanced'])) regime = 'RANGE';

  return {
    name: 'STATE_ENGINE',
    symbol: 'XAUUSD',
    price: round(source.price),
    bid: round(bid),
    ask: round(ask),
    spreadUsd: round(spread, 3),
    quoteAgeMs: round(source.quoteAgeMs, 0),
    provider: source.provider || null,
    fresh: market.fresh,
    degraded: market.degraded,
    blockedByNews: market.blockedByNews,
    regime,
    mtfSide: market.side,
    timeframes,
    liquidity: market.context.liquidity,
    mss: market.context.mss,
    displacement: market.context.displacement,
    retest: market.context.retest,
    sourceStatus: String(source.status || 'WAIT').toUpperCase(),
    sourceExecutable: source.executable === true
  };
}

function setupQuality(stateEngine = {}) {
  const points = [stateEngine.liquidity, stateEngine.mss, stateEngine.displacement, stateEngine.retest].filter(Boolean).length;
  return points >= 4 ? 3 : points >= 2 ? 2 : points >= 1 ? 1 : 0;
}

function brainAgent(source = {}, setup = {}, stateEngine = {}, research = {}) {
  const entryLow = toNum(source.entryLow ?? source.entry);
  const entryHigh = toNum(source.entryHigh ?? source.entry);
  const targets = [source.target1,source.target2,source.target3,source.target4].map(toNum).filter(v => v != null);
  const direction = setup.side === 'BUY' ? 'LONG' : setup.side === 'SELL' ? 'SHORT' : 'NEUTRAL';
  return {
    name: 'BRAIN',
    role: 'RESEARCH_STRATEGY_DERIVATION',
    direction,
    regime: stateEngine.regime,
    confidence: round((toNum(setup.confidence) ?? 0) / 100, 3),
    setupQuality: setupQuality(stateEngine),
    thesis: {
      htfBias: stateEngine.mtfSide,
      liquidityEvent: stateEngine.liquidity,
      structureShift: stateEngine.mss,
      displacement: stateEngine.displacement,
      retest: stateEngine.retest,
      catalyst: research.event || null
    },
    proposedPlan: {
      entry: round(source.entry),
      entryZone: entryLow != null && entryHigh != null ? [round(Math.min(entryLow,entryHigh)), round(Math.max(entryLow,entryHigh))] : null,
      stop: round(source.stopLoss),
      targets: targets.map(v => round(v))
    },
    rule: 'The BRAIN proposes the thesis. It cannot authorize execution or override risk.'
  };
}

function hardRiskLayer(source = {}, stateEngine = {}, setup = {}, baseRisk = {}) {
  const maxDailyLossUsd = Math.max(0, toNum(process.env.XAU_MAX_DAILY_LOSS_USD) ?? 10);
  const maxDrawdownPct = Math.max(0, toNum(process.env.XAU_MAX_DRAWDOWN_PCT) ?? 15);
  const maxSpreadUsd = Math.max(0, toNum(process.env.XAU_MAX_SPREAD_USD) ?? 1.5);
  const minRr = Math.max(0, toNum(process.env.AGENT_MIN_RR) ?? toNum(process.env.GOLD_TELEGRAM_MIN_RR) ?? 0.6);
  const dailyLossUsd = toNum(source.dailyLossUsd ?? source?.accountRisk?.dailyLossUsd);
  const drawdownPct = toNum(source.drawdownPct ?? source?.accountRisk?.drawdownPct);
  const positionOpen = Boolean(source.positionOpen ?? source?.mt5?.positionOpen ?? false);
  const reward = toNum(source.entry) != null && toNum(source.target1) != null ? Math.abs(toNum(source.target1)-toNum(source.entry)) : null;
  const rr = toNum(baseRisk.stopDistanceUsd) && reward != null ? reward / toNum(baseRisk.stopDistanceUsd) : null;
  const spreadOk = stateEngine.spreadUsd == null || stateEngine.spreadUsd <= maxSpreadUsd;
  const dailyLossOk = dailyLossUsd == null || dailyLossUsd < maxDailyLossUsd;
  const drawdownOk = drawdownPct == null || drawdownPct < maxDrawdownPct;
  const onePositionOk = !positionOpen || setup.stage === 'MANAGING';
  const rrOk = rr == null || rr >= minRr;
  const vetoes = [];
  if (!baseRisk.structurallyValid) vetoes.push('INVALID_STOP_STRUCTURE');
  if (baseRisk.estimatedRiskUsd == null) vetoes.push('UNKNOWN_RISK');
  if (baseRisk.estimatedRiskUsd != null && baseRisk.estimatedRiskUsd > baseRisk.maxRiskUsd + 0.01) vetoes.push('MAX_RISK_EXCEEDED');
  if (!spreadOk) vetoes.push('SPREAD_TOO_WIDE');
  if (!dailyLossOk) vetoes.push('DAILY_LOSS_LIMIT');
  if (!drawdownOk) vetoes.push('MAX_DRAWDOWN_LIMIT');
  if (!onePositionOk) vetoes.push('POSITION_ALREADY_OPEN');
  if (!rrOk) vetoes.push('RR_TOO_LOW');
  return {
    ...baseRisk,
    name: 'RISK_LAYER',
    deterministic: true,
    cannotBeOverriddenByModel: true,
    maxDailyLossUsd: round(maxDailyLossUsd),
    maxDrawdownPct: round(maxDrawdownPct,1),
    maxSpreadUsd: round(maxSpreadUsd,2),
    minRr: round(minRr,2),
    rrToTp1: round(rr,2),
    dailyLossUsd: round(dailyLossUsd),
    drawdownPct: round(drawdownPct,1),
    positionOpen,
    allowed: Boolean(baseRisk.allowed && spreadOk && dailyLossOk && drawdownOk && onePositionOk && rrOk),
    vetoes
  };
}

function reflexAgent(stateEngine = {}, setup = {}, risk = {}, research = {}, tradeManager = {}) {
  const sourceConfirmed = setup.stage === 'CONFIRMED';
  const confidencePass = (toNum(setup.confidence) ?? 0) >= (toNum(setup.minConfidence) ?? 75);
  const marketReady = stateEngine.fresh && !stateEngine.degraded;
  const newsOk = !research.blockEntries;
  const allGatesPassed = Boolean(sourceConfirmed && confidencePass && marketReady && newsOk && risk.allowed);
  const executionEnabled = Boolean(tradeManager.executionEnabled);
  const vetoes = [];
  if (!sourceConfirmed) vetoes.push('SETUP_' + setup.stage);
  if (!confidencePass) vetoes.push('CONFIDENCE_BELOW_THRESHOLD');
  if (!stateEngine.fresh) vetoes.push('STALE_QUOTE');
  if (stateEngine.degraded) vetoes.push('DEGRADED_FEED');
  if (!newsOk) vetoes.push('NEWS_VETO');
  if (Array.isArray(risk.vetoes)) vetoes.push(...risk.vetoes);
  if (!executionEnabled) vetoes.push('EXECUTION_PERMISSION_OFF');
  return {
    name: 'REFLEX',
    role: 'LIVE_DECISION_AND_EXECUTION_GATE',
    deterministic: true,
    allGatesPassed,
    executionEnabled,
    executable: allGatesPassed && executionEnabled,
    action: allGatesPassed && executionEnabled ? setup.side : 'WAIT',
    vetoes: [...new Set(vetoes)],
    rule: 'Only REFLEX may authorize execution. BRAIN output alone is never executable.'
  };
}

function decisionSchema(source = {}, stateEngine = {}, setup = {}, risk = {}, reflex = {}, now = Date.now()) {
  const entryLow = toNum(source.entryLow ?? source.entry);
  const entryHigh = toNum(source.entryHigh ?? source.entry);
  const targets = [source.target1,source.target2,source.target3,source.target4].map(toNum).filter(v => v != null);
  const proposedAction = setup.side === 'BUY' ? 'LONG' : setup.side === 'SELL' ? 'SHORT' : 'NEUTRAL';
  return {
    schema: 'XAU_JEV_V2',
    decisionId: String(source.signalId || setup.setupKey || ('decision-' + now)),
    symbol: 'XAUUSD',
    timestamp: new Date(now).toISOString(),
    action: reflex.executable ? proposedAction : 'NEUTRAL',
    proposedAction,
    regime: stateEngine.regime,
    setupQuality: setupQuality(stateEngine),
    confidence: round((toNum(setup.confidence) ?? 0) / 100,3),
    confidencePct: round(setup.confidence,0),
    entryZone: entryLow != null && entryHigh != null ? [round(Math.min(entryLow,entryHigh)),round(Math.max(entryLow,entryHigh))] : null,
    stopLoss: round(source.stopLoss),
    targets: targets.map(v => round(v)),
    riskState: risk.allowed ? 'SAFE' : 'BLOCKED',
    recommendedLot: risk.recommendedLot,
    executable: reflex.executable,
    vetoes: reflex.vetoes
  };
}

function finalCheckAgent(stateEngine = {}, setup = {}, risk = {}, reflex = {}) {
  const concerns = [];
  if (!stateEngine.fresh) concerns.push('Quote may be stale');
  if (stateEngine.degraded) concerns.push('Market data feed is degraded');
  if (stateEngine.blockedByNews) concerns.push('High-impact USD news veto is active');
  const opposite = setup.side === 'BUY' ? 'SELL' : setup.side === 'SELL' ? 'BUY' : null;
  if (opposite && Object.values(stateEngine.timeframes || {}).filter(v => v === opposite).length >= 4) concerns.push('Multi-timeframe direction is materially conflicted');
  if (risk.rrToTp1 != null && risk.rrToTp1 < risk.minRr) concerns.push('RR to TP1 is below minimum');
  if (risk.estimatedRiskPct != null && risk.estimatedRiskPct > 5) concerns.push('Risk exceeds 5% of reference balance');
  if (!reflex.executionEnabled) concerns.push('Live execution permission is disabled');
  return {
    name: 'FINAL_CHECK',
    question: 'WHAT COULD I BE WRONG ABOUT?',
    concerns,
    survivabilityFirst: true,
    pass: reflex.allGatesPassed,
    conclusion: concerns.length ? 'Keep the deterministic gate in control.' : 'No additional contradiction detected.'
  };
}

function selfImprovementAgent() {
  return {
    name: 'SELF_IMPROVEMENT',
    mode: 'REVIEW_ONLY',
    autoRewriteLiveCode: false,
    metrics: ['fills','misses','slippage','calibration','Brier score when labeled outcomes exist','session performance'],
    rule: 'Review can propose versioned changes, but never rewrites or deploys live trading logic autonomously.'
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
  const baseRisk = riskAgent(source, setup);
  const tradeManager = tradeManagerAgent(source, setup, now);
  const research = researchAgent(source);
  const session = sessionAgent(source);
  const stateEngine = stateEngineAgent(source, market);
  const brain = brainAgent(source, setup, stateEngine, research);
  const risk = hardRiskLayer(source, stateEngine, setup, baseRisk);
  const reflex = reflexAgent(stateEngine, setup, risk, research, tradeManager);
  const schema = decisionSchema(source, stateEngine, setup, risk, reflex, now);
  const finalCheck = finalCheckAgent(stateEngine, setup, risk, reflex);
  const journal = journalAgent(setup, risk, tradeManager);
  const selfImprovement = selfImprovementAgent();

  return {
    architecture: 'GOLD_AGENT_STACK_V2_BRAIN_REFLEX',
    layers: {
      BRAIN: 'Research + strategy derivation + thesis',
      REFLEX: 'Deterministic state + risk + live execution gate'
    },
    symbol: 'XAUUSD',
    mode: reflex.executionEnabled ? 'EXECUTION_PERMISSION_ON' : 'OBSERVE_ONLY',
    decision: {
      stage: setup.stage,
      side: setup.side,
      ready: reflex.allGatesPassed,
      executable: reflex.executable,
      action: reflex.action,
      reason: reflex.vetoes.length ? reflex.vetoes.join(' | ') : 'All deterministic gates passed'
    },
    decisionSchema: schema,
    agents: {brain, reflex, stateEngine, market, setup, risk, tradeManager, session, research, journal, selfImprovement, finalCheck},
    updatedAt: new Date(now).toISOString()
  };
}

export function applyAgentExecutionGate(source = {}, now = Date.now()) {
  const stack = orchestrateGoldAgents(source, now);
  if (stack.decision.executable) {
    return {
      ...source,
      status: 'CONFIRMED',
      action: stack.decision.action,
      executable: true,
      executionMode: 'AGENT_BRAIN_REFLEX',
      agentStack: stack,
      agentDecision: stack.decision,
      agentSchema: stack.decisionSchema
    };
  }
  const managing = String(source.status || '').toUpperCase() === 'MANAGING';
  return {
    ...source,
    status: managing ? source.status : 'WAIT',
    action: managing ? source.action : 'WAIT',
    executable: false,
    agentStack: stack,
    agentDecision: stack.decision,
    agentSchema: stack.decisionSchema,
    reason: 'AGENT GATE: ' + stack.decision.reason
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
