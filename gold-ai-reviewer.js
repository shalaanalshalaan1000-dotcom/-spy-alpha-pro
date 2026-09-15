const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const inRange = (value, low, high) => value != null && low != null && high != null
  && value >= Math.min(low, high) && value <= Math.max(low, high);

export function aiReviewerConfig() {
  return {
    required:false,
    configured:true,
    model:'GOLD_ALPHA_SITE_RULES',
    timeoutMs:0
  };
}

export function executableEntryPrice(side, quote = {}) {
  return number(side === 'BUY' ? quote.ask : quote.bid) ?? number(quote.price);
}

export function buildReviewSnapshot({model = {}, quote = {}, now = Date.now(), minConfidence = 65, phase = 'EXECUTION'} = {}) {
  const side = model.candidateAction || model.side;
  const entryLow = number(model.entryLow);
  const entryHigh = number(model.entryHigh);
  const stopLoss = number(model.stopLoss);
  const targets = [model.target1, model.target2, model.target3, model.target4].map(number);
  const executablePrice = executableEntryPrice(side, quote);
  const quoteAt = number(quote.t);
  const quoteAgeMs = quoteAt == null ? null : Math.max(0, now - quoteAt);
  const reviewPhase = phase === 'PRE_TOUCH' ? 'PRE_TOUCH' : 'EXECUTION';
  const priceInsideEntry = inRange(executablePrice, entryLow, entryHigh);
  const entryNotMissed = side === 'BUY'
    ? executablePrice != null && entryHigh != null && executablePrice <= entryHigh
    : side === 'SELL'
      ? executablePrice != null && entryLow != null && executablePrice >= entryLow
      : false;
  const orderedLevels = side === 'BUY'
    ? stopLoss != null && entryLow != null && entryHigh != null && stopLoss < entryLow && entryLow <= entryHigh
      && targets.every(value => value != null) && entryHigh < targets[0]
      && targets[0] <= targets[1] && targets[1] <= targets[2] && targets[2] <= targets[3]
    : side === 'SELL'
      ? stopLoss != null && entryLow != null && entryHigh != null && stopLoss > entryHigh && entryLow <= entryHigh
        && targets.every(value => value != null) && entryLow > targets[0]
        && targets[0] >= targets[1] && targets[1] >= targets[2] && targets[2] >= targets[3]
      : false;
  const checks = {
    validSide:['BUY','SELL'].includes(side),
    supportedStrategy:['MTF_TREND_CONTINUATION','MTF_ICT_REVERSAL','TREND_CONTINUATION','ICT_REVERSAL'].includes(model.strategy),
    quoteFresh:quote.degraded !== true && quoteAt != null && quoteAt <= now + 5000 && quoteAgeMs <= 30_000,
    entryTimingValid:reviewPhase === 'PRE_TOUCH' ? entryNotMissed : priceInsideEntry,
    confidenceMeetsMinimum:number(model.confidence) != null && number(model.confidence) >= Number(minConfidence),
    levelsOrdered:orderedLevels,
    riskRewardValid:number(model.riskReward) != null && number(model.riskReward) > 0,
    noLateEntry:!String(model.reason || '').toUpperCase().includes('NO CHASE')
  };
  return {instrument:'XAUUSD',reviewPhase,setupId:String(model.setupId || ''),hardChecks:checks};
}

export async function reviewGoldCandidate({
  model = {},
  quote = {},
  now = Date.now(),
  minConfidence = 65,
  phase = 'EXECUTION',
  clock = Date.now
} = {}) {
  const at = Number(clock());
  const setupId = String(model.setupId || '');
  const reviewPhase = phase === 'PRE_TOUCH' ? 'PRE_TOUCH' : 'EXECUTION';
  const snapshot = buildReviewSnapshot({model, quote, now, minConfidence, phase:reviewPhase});
  const failedChecks = Object.entries(snapshot.hardChecks).filter(([, passed]) => !passed).map(([name]) => name);

  if (failedChecks.length) {
    return {
      required:false,
      allowed:false,
      decision:'DENY',
      status:'DENIED',
      code:'SITE_RULE_DENY',
      phase:reviewPhase,
      setupId,
      model:'GOLD_ALPHA_SITE_RULES',
      reason:'رفض مباشر من قواعد الموقع لأن شرطاً أساسياً غير مكتمل',
      riskFlags:failedChecks,
      reviewedAtMs:at,
      reviewedAt:new Date(at).toISOString(),
      expiresAtMs:at
    };
  }

  return {
    required:false,
    allowed:true,
    decision:'ALLOW',
    status:'APPROVED',
    code:'SITE_RULE_APPROVED',
    phase:reviewPhase,
    setupId,
    model:'GOLD_ALPHA_SITE_RULES',
    reason:'اعتماد مباشر من نموذج Gold Alpha بالموقع — بدون AI خارجي',
    riskFlags:[],
    reviewedAtMs:at,
    reviewedAt:new Date(at).toISOString(),
    expiresAtMs:at + (reviewPhase === 'PRE_TOUCH' ? 45_000 : 12_000)
  };
}
