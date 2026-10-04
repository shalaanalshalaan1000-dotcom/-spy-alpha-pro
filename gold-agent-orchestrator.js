// Reuse ICU state across polling calls; formatting options remain identical.
const RIYADH_WEEKDAY_FORMATTER=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',weekday:'short'});
import { analyzeLaura } from './gold-laura-agent.js';

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

function ictStateOf(source = {}) {
  return source?.ict || source?.liquidityContext || {};
}

function sweepSideOf(source = {}) {
  const ict = ictStateOf(source);
  const explicit = validSide(ict?.watchSide);
  if (explicit) return explicit;
  const sweep = ict?.legSweep || ict?.sweep || source?.confluence?.liquidity?.externalSweep || null;
  const name = String(sweep?.name || '');
  if (/High|pdh|pwh|h4SwingHigh|h1SwingHigh|m15SwingHigh/i.test(name)) return 'SELL';
  if (/Low|pdl|pwl|h4SwingLow|h1SwingLow|m15SwingLow/i.test(name)) return 'BUY';
  return null;
}

function sourceSide(source = {}) {
  return validSide(source.action) || validSide(source.candidateAction) || validSide(source.side) || sweepSideOf(source);
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
  const ict = ictStateOf(source);
  const side = sourceSide(source) || validSide(mtf.side);
  const quoteAgeMs = toNum(source.quoteAgeMs);
  const fresh = source.liveFeedFresh === true || (quoteAgeMs != null && quoteAgeMs >= 0 && quoteAgeMs <= 20_000);
  const degraded = Boolean(source.degraded);
  const news = source.newsRisk || {};
  const blockedByNews = Boolean(news.blockEntries);
  const liquidity = Boolean(ict?.hasSweep || ict?.legSweep || ict?.sweep || source?.confluence?.liquidity?.externalSweep) || inferCondition(source, ['liquidity', 'sweep', 'session low', 'session high']);
  const mss = Boolean(ict?.hasShift || ict?.mss || ict?.firstMssEvent) || inferCondition(source, ['mss', 'choch', 'structure shift']);
  const displacement = Boolean(ict?.hasDisplacement || ict?.displacement || ict?.firstDisplacementEvent) || inferCondition(source, ['displacement', 'impulse']);
  const retest = Boolean(ict?.hasIfvgRetest || ict?.retest || ict?.inverseFvg?.retested) || inferCondition(source, ['retest']);

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
  const maxStopDistanceUsd = Math.max(0.3, toNum(process.env.XAU_MAX_STOP_DISTANCE_USD) ?? 10);
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
    maxStopDistanceUsd: round(maxStopDistanceUsd),
    entry: round(entry),
    stopLoss: round(stopLoss),
    stopDistanceUsd: round(stopDistance),
    recommendedLot: lot == null ? null : round(lot, 2),
    estimatedRiskUsd: round(estimatedRiskUsd),
    estimatedRiskPct: round(riskPct, 1),
    structurallyValid,
    allowed: structurallyValid && stopDistance != null && estimatedRiskUsd != null,
    stopDistanceBlocking: false,
    riskAmountBlocking: false,
    note: stopDistance != null && stopDistance > maxStopDistanceUsd ? 'Wide structural stop is informational only; the setup is not blocked by stop distance.' : estimatedRiskUsd != null && estimatedRiskUsd > maxRiskUsd ? 'Estimated risk exceeds the reference ceiling, but stop/risk size is advisory only for setup authorization.' : riskPct != null && riskPct > 5 ? 'Risk exceeds 5% of reference balance; advisory only.' : 'Stop and risk are informational for setup authorization.'
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

function amdSessionAgent(source = {}, session = {}, market = {}, setup = {}, now = Date.now()) {
  const sessionRoot = source?.sessionLevels?.sessions || source?.sessionLiquidity?.sessions || source?.sessions || {};
  const tokyo = sessionRoot?.TOKYO || sessionRoot?.ASIA || null;
  const london = sessionRoot?.LONDON || null;
  const newYork = sessionRoot?.NEW_YORK || sessionRoot?.NEWYORK || null;
  const ict = ictStateOf(source);
  const sweep = ict?.legSweep || ict?.sweep || source?.confluence?.liquidity?.externalSweep || null;
  const sweepName = String(sweep?.name || '');
  const reason = String(source?.reason || '');
  const evidenceText = (sweepName + ' ' + reason).toLowerCase();
  const asiaHighSweep = /(?:tokyo|asia)[ _-]*(?:high|h)\b|(?:high)\b.*(?:tokyo|asia)/i.test(evidenceText);
  const asiaLowSweep = /(?:tokyo|asia)[ _-]*(?:low|l)\b|(?:low)\b.*(?:tokyo|asia)/i.test(evidenceText);
  const accumulationKnown = Boolean(
    tokyo &&
    toNum(tokyo.high) != null &&
    toNum(tokyo.low) != null &&
    toNum(tokyo.high) > toNum(tokyo.low)
  );
  const manipulationConfirmed = asiaHighSweep || asiaLowSweep;
  const manipulationSide = asiaHighSweep ? 'SELL' : asiaLowSweep ? 'BUY' : null;
  const structureConfirmed = Boolean(market?.context?.mss && (market?.context?.displacement || market?.context?.retest));
  const distributionCandidate = Boolean(manipulationConfirmed && structureConfirmed);
  const setupSide = validSide(setup?.side);
  const alignedWithSetup = manipulationSide && setupSide ? manipulationSide === setupSide : null;
  let phase = 'WAIT';
  if (distributionCandidate) phase = 'DISTRIBUTION_CANDIDATE';
  else if (manipulationConfirmed) phase = 'MANIPULATION_CONFIRMED';
  else if (accumulationKnown) phase = 'ACCUMULATION_CONTEXT';

  return {
    name: 'AMD_SESSION_AGENT',
    model: 'ACCUMULATION_MANIPULATION_DISTRIBUTION',
    mode: 'CONTEXT_ONLY',
    phase,
    side: manipulationSide || 'NEUTRAL',
    accumulation: {
      known: accumulationKnown,
      session: tokyo ? 'TOKYO_ASIA' : null,
      high: round(tokyo?.high, 3),
      low: round(tokyo?.low, 3),
      status: tokyo?.status || null
    },
    manipulation: {
      confirmed: manipulationConfirmed,
      sweptLevel: asiaHighSweep ? 'ASIA_HIGH' : asiaLowSweep ? 'ASIA_LOW' : null,
      side: manipulationSide
    },
    distribution: {
      candidate: distributionCandidate,
      newYorkContextAvailable: Boolean(newYork),
      newYorkStatus: newYork?.status || null,
      requiresM5Structure: true
    },
    londonStatus: london?.status || null,
    structureConfirmed,
    alignedWithSetup,
    contextOnly: true,
    canCreateSignal: false,
    canOverrideIctGate: false,
    updatedAt: new Date(now).toISOString(),
    rule: 'AMD is session context only: Asia range -> external-liquidity manipulation -> M5 MSS/displacement/retest -> distribution context. It never creates or authorizes a trade by itself.'
  };
}


function liquidityDecisionAgent(source = {}, setup = {}, now = Date.now()) {
  const ict = ictStateOf(source);
  const levels = ict?.levels || source?.liquidityContext?.levels || {};
  const side = validSide(setup?.side) || sourceSide(source);
  const entry = toNum(source.entry ?? source.price);
  const drawSide = side === 'BUY' ? 'BSL' : side === 'SELL' ? 'SSL' : 'WAIT';
  const rows = [];
  const add = (timeframe, liquiditySide, label, value) => {
    const level = toNum(value);
    if (level == null) return;
    rows.push({
      timeframe,
      liquiditySide,
      label,
      level: round(level,3),
      distance: entry == null ? null : round(Math.abs(level-entry),2),
      hierarchy: timeframe === 'H4' ? 1 : timeframe === 'H1' ? 2 : 3
    });
  };
  add('H4','BSL','H4_SWING_HIGH',levels.h4SwingHigh);
  add('H4','SSL','H4_SWING_LOW',levels.h4SwingLow);
  add('H1','BSL','H1_SWING_HIGH',levels.h1SwingHigh);
  add('H1','SSL','H1_SWING_LOW',levels.h1SwingLow);
  add('M15','BSL','M15_SWING_HIGH',levels.m15SwingHigh);
  add('M15','SSL','M15_SWING_LOW',levels.m15SwingLow);

  const directional = rows.filter(x =>
    drawSide !== 'WAIT' &&
    x.liquiditySide === drawSide &&
    entry != null &&
    (drawSide === 'BSL' ? x.level > entry : x.level < entry)
  );
  const nearest = [...directional].sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)||a.hierarchy-b.hierarchy)[0] || null;
  const primary = [...directional]
    .sort((a,b)=>a.hierarchy-b.hierarchy||(b.distance??0)-(a.distance??0))
    .find(x=>!nearest||Math.abs(x.level-nearest.level)>0.10) || nearest || null;

  const sweep = ict?.legSweep || ict?.sweep || null;
  const sweepName = String(sweep?.name || '');
  const sweptLiquiditySide = /high|pdh|pwh/i.test(sweepName) ? 'BSL' : /low|pdl|pwl/i.test(sweepName) ? 'SSL' : null;
  const m5Structure = Boolean(ict?.dm5?.mss || ict?.shift5 || ict?.hasShift || ict?.mss);
  const m5Displacement = Boolean(ict?.dm5?.displacement || ict?.hasDisplacement || ict?.displacement);
  const m5Retest = Boolean(ict?.hasIfvgRetest || ict?.retest || ict?.inverseFvg?.retested);
  const m5Confirmed = Boolean(m5Structure && m5Displacement && m5Retest);

  return {
    name:'LIQUIDITY_DECISION_AGENT',
    mode:'HIERARCHY_DECISION_ONLY',
    hierarchy:['H4','H1','M15'],
    executionTimeframe:'M5',
    side:side||'WAIT',
    drawSide,
    map:rows,
    sweptLiquiditySide,
    sweptLevel:round(sweep?.level,3),
    secondaryLiquidity:nearest,
    primaryLiquidity:primary,
    m5Confirmation:{required:true,structure:m5Structure,displacement:m5Displacement,retest:m5Retest,confirmed:m5Confirmed},
    recommendation:drawSide==='BSL'?'DRAW_TO_BUYSIDE_LIQUIDITY':drawSide==='SSL'?'DRAW_TO_SELLSIDE_LIQUIDITY':'WAIT_FOR_DIRECTION',
    canCreateSignal:false,
    canExecute:false,
    canOverrideIctGate:false,
    updatedAt:new Date(now).toISOString(),
    rule:'Map liquidity top-down on H4 -> H1 -> M15. M5 is execution confirmation only. This agent advises every other agent but never opens a trade.'
  };
}

function dailyOpportunityAgent(source = {}, now = Date.now()) {
  const minTarget=Math.max(1,Math.min(3,toNum(process.env.GOLD_DAILY_QUALIFIED_MIN)??1));
  const preferredHigh=Math.max(minTarget,Math.min(3,toNum(process.env.GOLD_DAILY_QUALIFIED_PREFERRED_HIGH)??3));
  const current=Math.max(0,toNum(source.dailySignalCount ?? source.dailySignalNumber)??0);
  const remainingToMin=Math.max(0,minTarget-current);
  let state='OPEN_FOR_ADDITIONAL_QUALIFIED_SETUPS';
  if(current<minTarget)state='SEARCHING_FOR_MINIMUM';
  else if(current<preferredHigh)state='OPEN_FOR_MORE_QUALIFIED_SETUPS';
  return {
    name:'DAILY_OPPORTUNITY_AGENT',
    mode:'SOFT_FREQUENCY_TARGET_NO_HARD_CAP',
    target:{min:minTarget,preferredHigh,hardMax:null},
    current,
    remainingToMin,
    state,
    scanCadence:'EVERY_5_MINUTES',
    hardCap:false,
    forceTrade:false,
    mayRelaxLiquidityHierarchy:false,
    mayRelaxM5Confirmation:false,
    mayRelaxConfidence:false,
    canCreateSignal:false,
    canExecute:false,
    rule:'Aim for at least 1 qualified opportunity and preferably 1-3 per trading day, but continue accepting additional qualified setups beyond 3. Never invent or force a trade to satisfy the count.'
  };
}

function drawOnLiquidityAgent(source = {}, setup = {}, session = {}, liquidityDecision = {}, now = Date.now()) {
  const side = validSide(setup?.side) || sourceSide(source);
  const entry = toNum(source.entry ?? source.price);
  const ict = ictStateOf(source);
  const levels = ict?.levels || source?.liquidityContext?.levels || {};
  const sessionRoot = source?.sessionLevels?.sessions || session?.data?.sessions || {};
  const candidates = [];

  const priorityOf = label => {
    const x=String(label||'').toUpperCase();
    if (/H4.*SWING/.test(x)) return 0;
    if (/H1.*SWING/.test(x)) return 1;
    if (/M15.*SWING/.test(x)) return 2;
    if (/^PW[HL]$/.test(x)) return 0;
    if (/^PD[HL]$/.test(x)) return 1;
    if (/ASIA|TOKYO|LONDON|NEW[_ ]?YORK|NY[_ ]?AM/.test(x)) return 3;
    return 4;
  };
  const add = (label, value, liquidityClass='EXTERNAL', sourceName='ICT') => {
    const level=toNum(value);
    if (!side || entry == null || level == null) return;
    if (side==='BUY' ? level<=entry : level>=entry) return;
    if (candidates.some(x => Math.abs(x.level-level) <= 0.10)) return;
    candidates.push({
      label:String(label||'EXTERNAL_LIQUIDITY').toUpperCase(),
      level:round(level,3),
      distance:round(Math.abs(level-entry),2),
      liquidityClass,
      source:sourceName,
      priority:priorityOf(label)
    });
  };

  add('PWH',levels.pwh); add('PWL',levels.pwl);
  add('PDH',levels.pdh); add('PDL',levels.pdl);
  add('H4_SWING_HIGH',levels.h4SwingHigh); add('H4_SWING_LOW',levels.h4SwingLow);
  add('H1_SWING_HIGH',levels.h1SwingHigh); add('H1_SWING_LOW',levels.h1SwingLow);
  add('M15_SWING_HIGH',levels.m15SwingHigh); add('M15_SWING_LOW',levels.m15SwingLow);
  add('ASIA_HIGH',levels.asiaHigh); add('ASIA_LOW',levels.asiaLow);
  add('LONDON_HIGH',levels.londonHigh); add('LONDON_LOW',levels.londonLow);
  add('NY_AM_HIGH',levels.nyHigh); add('NY_AM_LOW',levels.nyLow);

  for (const row of Object.values(sessionRoot || {})) {
    add((row?.label||row?.id||'SESSION')+'_HIGH',row?.high,'EXTERNAL','SESSION_LEVELS');
    add((row?.label||row?.id||'SESSION')+'_LOW',row?.low,'EXTERNAL','SESSION_LEVELS');
  }

  const providedLabels=Array.isArray(source?.targetLabels)?source.targetLabels:[];
  [1,2,3,4].forEach((i,idx)=>add(providedLabels[idx]||('TARGET_'+i),source?.['target'+i],'EXTERNAL','MODEL_TARGET'));

  const byDistance=[...candidates].sort((a,b)=>a.distance-b.distance||a.priority-b.priority);
  const secondary=liquidityDecision?.secondaryLiquidity||byDistance[0]||null;
  const byStrategic=[...candidates].sort((a,b)=>a.priority-b.priority||b.distance-a.distance);
  const primary=liquidityDecision?.primaryLiquidity||byStrategic.find(x=>!secondary||Math.abs(x.level-secondary.level)>0.10)||secondary||null;
  const secondaryDistinct=secondary&&primary&&Math.abs(secondary.level-primary.level)<=0.10?null:secondary;
  const friday=RIYADH_WEEKDAY_FORMATTER.format(new Date(now))==='Fri';
  const fridayPrimaryMaxDistance=Math.max(1,toNum(process.env.TELEGRAM_FRIDAY_PRIMARY_MAX_DISTANCE_USD)??25);
  const primaryPractical=Boolean(primary && (!friday || primary.distance<=fridayPrimaryMaxDistance));

  const references=[];
  const pushReference=(type,value)=>{
    const v=toNum(value);
    if(v!=null) references.push({type,level:round(v,3)});
  };
  pushReference('ORIGIN_FVG_MID',ict?.originFvg?.mid);
  pushReference('INVERSE_FVG_MID',ict?.inverseFvg?.mid);
  pushReference('NWOG_MID',source?.nwog?.mid ?? source?.liquidityContext?.nwog?.mid);

  return {
    name:'DRAW_ON_LIQUIDITY_AGENT',
    mode:'OBJECTIVES_ONLY',
    liquidityHierarchyAgent:liquidityDecision?.name||null,
    drawSide:liquidityDecision?.drawSide||null,
    side:side||'WAIT',
    entry:round(entry,3),
    secondaryLiquidity:secondaryDistinct,
    primaryLiquidity:primary,
    primaryPractical,
    friday,
    fridayPrimaryMaxDistanceUsd:round(fridayPrimaryMaxDistance,0),
    candidates:byDistance.slice(0,8),
    references,
    canCreateSignal:false,
    canOverrideIctGate:false,
    rule:'Secondary is the nearest valid external objective; Primary is the higher-priority strategic external draw. FVG/NWOG are references only and never create a trade.'
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
  // Stop distance and estimated amount are advisory only; they do not veto an otherwise valid ICT setup.
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
    mode: 'PROPOSE_VERSIONED_PATCHES',
    autoRewriteLiveCode: false,
    directMainWrites: false,
    requires: ['isolated branch','regression tests','final check','human merge'],
    metrics: ['fills','misses','slippage','calibration','Brier score when labeled outcomes exist','session performance','duplicate alerts','missed external-liquidity targets'],
    rule: 'Review may propose versioned strategy repairs on an isolated branch, but never rewrites or deploys live trading logic directly to main.'
  };
}

function tradingAgent({
  brain,
  reflex,
  stateEngine,
  market,
  setup,
  risk,
  tradeManager,
  session,
  amd,
  drawOnLiquidity,
  liquidityDecision,
  dailyOpportunity,
  research,
  journal,
  selfImprovement,
  finalCheck
} = {}) {
  const side = ['BUY','SELL'].includes(setup?.side) ? setup.side : 'WAIT';
  const managing = setup?.stage === 'MANAGING' || tradeManager?.action === 'MANAGE';
  const stopped = tradeManager?.stopped === true || tradeManager?.action === 'EXIT_STATE';
  const advisoryReady = Boolean(
    setup?.stage === 'CONFIRMED' &&
    market?.ready &&
    risk?.allowed &&
    !research?.blockEntries &&
    finalCheck?.pass &&
    !stopped
  );
  const executionEnabled = reflex?.executionEnabled === true;
  const executable = Boolean(advisoryReady && executionEnabled && !managing);
  const blockers = [...new Set([
    ...(Array.isArray(reflex?.vetoes) ? reflex.vetoes.filter(x => x !== 'EXECUTION_PERMISSION_OFF') : []),
    ...(!finalCheck?.pass ? ['FINAL_CHECK_FAILED'] : []),
    ...(stopped ? ['TRADE_STOPPED'] : [])
  ])];

  let state = 'WAIT';
  if (stopped) state = 'EXIT';
  else if (managing) state = 'MANAGING';
  else if (advisoryReady) state = 'READY';
  else if (setup?.stage === 'ARMED') state = 'ARMED';
  else if (setup?.stage === 'WATCHING') state = 'WATCHING';

  const feed = {
    brain: brain?.direction || 'NEUTRAL',
    stateEngine: stateEngine?.regime || 'TRANSITION',
    market: market?.ready ? 'READY' : 'WAIT',
    setup: setup?.stage || 'WAIT',
    risk: risk?.allowed ? 'PASS' : 'VETO',
    session: session?.detectedFromSetup ? 'ACTIVE_CONTEXT' : 'CONTEXT',
    amd: amd?.phase || 'WAIT',
    amdAlignment: amd?.alignedWithSetup === true ? 'ALIGNED' : amd?.alignedWithSetup === false ? 'CONFLICT' : 'UNCONFIRMED',
    drawOnLiquidity: drawOnLiquidity?.primaryLiquidity ? 'MAPPED' : 'WAIT',
    liquidityDecision: liquidityDecision?.recommendation || 'WAIT_FOR_DIRECTION',
    m5LiquidityConfirmation: liquidityDecision?.m5Confirmation?.confirmed ? 'CONFIRMED' : 'WAIT',
    dailyOpportunity: dailyOpportunity?.state || 'SEARCHING_FOR_MINIMUM',
    research: research?.blockEntries ? 'VETO' : 'CLEAR',
    tradeManager: tradeManager?.action || 'OBSERVE',
    finalCheck: finalCheck?.pass ? 'PASS' : 'HOLD',
    journal: Array.isArray(journal?.recentEvents) ? journal.recentEvents.length : 0,
    selfImprovement: selfImprovement?.mode || 'REVIEW_ONLY'
  };

  const telegramBrief = {
    title: 'XAUUSD AGENT DESK',
    state,
    side,
    confidence: round(setup?.confidence, 0),
    advisoryReady,
    executable,
    feed,
    blockers,
    protection: tradeManager?.suggestedProtection || null,
    liquidityObjectives: {
      type: liquidityDecision?.drawSide || null,
      secondary: drawOnLiquidity?.secondaryLiquidity || null,
      primary: drawOnLiquidity?.primaryLiquidity || null,
      primaryPractical: drawOnLiquidity?.primaryPractical ?? null,
      hierarchy: liquidityDecision?.hierarchy || ['H4','H1','M15'],
      executionTimeframe: liquidityDecision?.executionTimeframe || 'M5'
    },
    dailyOpportunity: dailyOpportunity || null
  };

  return {
    name: 'TRADING_AGENT',
    role: 'SINGLE_CONSUMER_OF_ALL_AGENT_OUTPUTS',
    state,
    side,
    advisoryReady,
    executionEnabled,
    executable,
    action: executable ? side : (managing ? 'MANAGE' : stopped ? 'EXIT_STATE' : 'WAIT'),
    manualAction: advisoryReady && !executionEnabled ? side : (managing ? 'MANAGE' : stopped ? 'EXIT_STATE' : 'WAIT'),
    blockers,
    feed,
    telegramBrief,
    rule: 'Every specialist agent feeds this trading agent. Only this agent emits the consolidated trade decision and Telegram brief.'
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
  const amd = amdSessionAgent(source, session, market, setup, now);
  const liquidityDecision = liquidityDecisionAgent(source, setup, now);
  const drawOnLiquidity = drawOnLiquidityAgent(source, setup, session, liquidityDecision, now);
  const dailyOpportunity = dailyOpportunityAgent(source, now);
  const laura = analyzeLaura(source, now);
  const stateEngine = stateEngineAgent(source, market);
  const brain = brainAgent(source, setup, stateEngine, research);
  const risk = hardRiskLayer(source, stateEngine, setup, baseRisk);
  const reflex = reflexAgent(stateEngine, setup, risk, research, tradeManager);
  const schema = decisionSchema(source, stateEngine, setup, risk, reflex, now);
  const finalCheck = finalCheckAgent(stateEngine, setup, risk, reflex);
  const journal = journalAgent(setup, risk, tradeManager);
  const selfImprovement = selfImprovementAgent();
  const trading = tradingAgent({
    brain, reflex, stateEngine, market, setup, risk, tradeManager,
    session, amd, drawOnLiquidity, liquidityDecision, dailyOpportunity, research, journal, selfImprovement, finalCheck
  });

  return {
    architecture: 'GOLD_AGENT_STACK_V3_TRADING_HUB',
    layers: {
      SPECIALISTS: 'Market + setup + state + session + H4/H1/M15 liquidity decision + AMD context + draw-on-liquidity + daily opportunity + research + risk + journal + review',
      LAURA_AGENT: 'Independent classical price-action desk: W1/D1/H4 outlook + M15 break + M5 retest; does not feed or override ICT execution',
      TRADING_AGENT: 'Single consolidated consumer and decision publisher for the ICT stack',
      EXECUTION: 'Deterministic permission gate; manual MT5 remains possible when execution permission is off'
    },
    symbol: 'XAUUSD',
    mode: reflex.executionEnabled ? 'EXECUTION_PERMISSION_ON' : 'MANUAL_MT5_TELEGRAM',
    decision: {
      stage: setup.stage,
      side: setup.side,
      ready: trading.advisoryReady,
      executable: trading.executable,
      action: trading.action,
      manualAction: trading.manualAction,
      reason: trading.blockers.length ? trading.blockers.join(' | ') : (trading.advisoryReady ? 'All specialist-agent gates passed' : 'Waiting for specialist-agent agreement')
    },
    decisionSchema: schema,
    telegramBrief: trading.telegramBrief,
    agents: {brain, reflex, stateEngine, market, setup, risk, tradeManager, session, amd, liquidityDecision, drawOnLiquidity, dailyOpportunity, research, journal, selfImprovement, finalCheck, trading, laura},
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
      executionMode: 'AGENT_TRADING_HUB',
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
