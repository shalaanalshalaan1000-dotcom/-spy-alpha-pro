const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const inRange = (value, low, high) => value != null && low != null && high != null
  && value >= Math.min(low, high) && value <= Math.max(low, high);

const REVIEW_SCHEMA = {
  type:'object',
  properties:{
    decision:{type:'string',enum:['ALLOW','DENY']},
    reason:{type:'string'},
    riskFlags:{type:'array',items:{type:'string'}}
  },
  required:['decision','reason','riskFlags'],
  additionalProperties:false
};

export function aiReviewerConfig(env = process.env) {
  const parsedTimeout = Number(env.OPENAI_REVIEW_TIMEOUT_MS || 2500);
  return {
    required:true,
    configured:Boolean(String(env.OPENAI_API_KEY || '').trim()),
    model:String(env.OPENAI_REVIEW_MODEL || 'gpt-5.6-luna').trim(),
    timeoutMs:Math.min(8_000, Math.max(1200, Number.isFinite(parsedTimeout) ? parsedTimeout : 2500))
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
  return {
    instrument:'XAUUSD',
    reviewPhase,
    setupId:String(model.setupId || ''),
    candidate:{
      side,
      strategy:model.strategy || null,
      confidence:number(model.confidence),
      minimumConfidence:Number(minConfidence),
      entry:number(model.entry),
      entryLow,
      entryHigh,
      stopLoss,
      target1:targets[0],
      target2:targets[1],
      target3:targets[2],
      target4:targets[3],
      riskReward:number(model.riskReward),
      structureAt:number(model.structureAt),
      ruleReason:String(model.reason || '').slice(0, 240)
    },
    market:{
      price:number(quote.price),
      bid:number(quote.bid),
      ask:number(quote.ask),
      executablePrice,
      priceInsideEntry,
      entryNotMissed,
      provider:String(quote.provider || ''),
      quoteAt,
      quoteAgeMs,
      degraded:Boolean(quote.degraded)
    },
    hardChecks:checks
  };
}

function extractResponseText(response = {}) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of Array.isArray(response.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'refusal') return null;
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return null;
}

function closedReview({setupId, model, reviewedAtMs, status = 'ERROR', code, reason, riskFlags = [], phase = 'EXECUTION'}) {
  return {
    required:true,
    allowed:false,
    decision:'DENY',
    status,
    code,
    phase,
    setupId,
    model,
    reason:String(reason || 'لم تصدر موافقة AI').slice(0, 320),
    riskFlags:Array.isArray(riskFlags) ? riskFlags.map(String).slice(0, 8) : [],
    reviewedAtMs,
    reviewedAt:new Date(reviewedAtMs).toISOString(),
    expiresAtMs:reviewedAtMs
  };
}

export async function reviewGoldCandidate({
  model = {},
  quote = {},
  now = Date.now(),
  minConfidence = 65,
  phase = 'EXECUTION',
  apiKey = process.env.OPENAI_API_KEY,
  modelId = aiReviewerConfig().model,
  timeoutMs = aiReviewerConfig().timeoutMs,
  fetchImpl = globalThis.fetch,
  clock = Date.now
} = {}) {
  const reviewedAtMs = () => Number(clock());
  const setupId = String(model.setupId || '');
  const safeModel = String(modelId || 'gpt-5.6-luna');
  const reviewPhase = phase === 'PRE_TOUCH' ? 'PRE_TOUCH' : 'EXECUTION';
  const key = String(apiKey || '').trim();
  const snapshot = buildReviewSnapshot({model, quote, now, minConfidence, phase:reviewPhase});
  const failedChecks = Object.entries(snapshot.hardChecks).filter(([, passed]) => !passed).map(([name]) => name);

  if (!key) {
    const at = reviewedAtMs();
    if (failedChecks.length) {
      return closedReview({
        setupId,
        model:safeModel,
        reviewedAtMs:at,
        phase:reviewPhase,
        status:'DENIED',
        code:'RULE_FALLBACK_DENY',
        reason:'فشل شرط أمان برمجي؛ لم تُنشر الإشارة',
        riskFlags:failedChecks
      });
    }
    return {
      required:true,
      allowed:true,
      decision:'ALLOW',
      status:'APPROVED',
      code:'RULE_FALLBACK_APPROVED',
      phase:reviewPhase,
      setupId,
      model:'hard-rule-fallback',
      reason:'اعتماد آلي بقواعد الأمان لأن مراجع AI غير مهيأ',
      riskFlags:[],
      reviewedAtMs:at,
      reviewedAt:new Date(at).toISOString(),
      expiresAtMs:at + (reviewPhase === 'PRE_TOUCH' ? 45_000 : 12_000)
    };
  }

  if (failedChecks.length) {
    return closedReview({
      setupId,
      model:safeModel,
      reviewedAtMs:reviewedAtMs(),
      phase:reviewPhase,
      status:'DENIED',
      code:'HARD_RULE_DENY',
      reason:'فشل شرط أمان برمجي قبل مراجعة AI',
      riskFlags:failedChecks
    });
  }

  const body = {
    model:safeModel,
    store:false,
    reasoning:{effort:'none'},
    max_output_tokens:120,
    input:[
      {
        role:'system',
        content:'أنت المراجع النهائي المحافظ قبل نشر إشارة ذهب XAUUSD. استخدم بيانات JSON فقط ولا تفترض أي سعر أو خبر خارجي. PRE_TOUCH يعني موافقة مبكرة على بنية الصفقة قبل دخول السعر نطاق التنفيذ؛ لا تشترط أن يكون السعر داخل النطاق، لكن ارفض إذا كان قد تجاوز النطاق في اتجاه الصفقة أو كانت البنية غير متسقة. EXECUTION يعني أن السعر يجب أن يكون داخل النطاق الآن. أعد ALLOW فقط إذا كانت جميع hardChecks صحيحة والأرقام والاتجاه والمخاطر متسقة ولا يوجد دخول متأخر أو غموض. عند أي شك أعد DENY. اجعل reason وriskFlags بالعربية ومختصرين جدًا.'
      },
      {role:'user', content:JSON.stringify(snapshot)}
    ],
    text:{
      format:{
        type:'json_schema',
        name:'xauusd_signal_review',
        strict:true,
        schema:REVIEW_SCHEMA
      }
    }
  };

  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(Math.min(8_000, Math.max(1200, Number(timeoutMs) || 2500)))
    });
    if (!response?.ok) {
      return closedReview({setupId, model:safeModel, reviewedAtMs:reviewedAtMs(), phase:reviewPhase, code:'OPENAI_HTTP_ERROR', reason:`تعذر أخذ موافقة AI (HTTP ${Number(response?.status) || 0})`});
    }
    const payload = await response.json().catch(() => null);
    if (!payload || (payload.status && payload.status !== 'completed')) {
      return closedReview({setupId, model:safeModel, reviewedAtMs:reviewedAtMs(), phase:reviewPhase, code:'OPENAI_INCOMPLETE', reason:'رد AI غير مكتمل؛ مُنعت الإشارة'});
    }
    const text = extractResponseText(payload);
    if (!text) {
      return closedReview({setupId, model:safeModel, reviewedAtMs:reviewedAtMs(), phase:reviewPhase, code:'OPENAI_REFUSAL', reason:'لم يمنح AI موافقة صريحة؛ مُنعت الإشارة'});
    }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      return closedReview({setupId, model:safeModel, reviewedAtMs:reviewedAtMs(), phase:reviewPhase, code:'INVALID_AI_JSON', reason:'صيغة مراجعة AI غير صالحة؛ مُنعت الإشارة'});
    }
    const decision = parsed?.decision === 'ALLOW' ? 'ALLOW' : 'DENY';
    const at = reviewedAtMs();
    if (decision !== 'ALLOW') {
      return closedReview({
        setupId,
        model:safeModel,
        reviewedAtMs:at,
        phase:reviewPhase,
        status:'DENIED',
        code:'AI_DENY',
        reason:parsed?.reason || 'رفض AI الإشارة',
        riskFlags:parsed?.riskFlags
      });
    }
    return {
      required:true,
      allowed:true,
      decision:'ALLOW',
      status:'APPROVED',
      code:reviewPhase === 'PRE_TOUCH' ? 'AI_PREAPPROVED' : 'AI_ALLOW',
      phase:reviewPhase,
      setupId,
      model:safeModel,
      reason:String(parsed?.reason || 'وافق AI على الإشارة').slice(0, 320),
      riskFlags:Array.isArray(parsed?.riskFlags) ? parsed.riskFlags.map(String).slice(0, 8) : [],
      reviewedAtMs:at,
      reviewedAt:new Date(at).toISOString(),
      expiresAtMs:at + (reviewPhase === 'PRE_TOUCH' ? 45_000 : 12_000)
    };
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return closedReview({
      setupId,
      model:safeModel,
      reviewedAtMs:reviewedAtMs(),
      phase:reviewPhase,
      code:timeout ? 'OPENAI_TIMEOUT' : 'OPENAI_UNAVAILABLE',
      reason:timeout ? 'انتهت مهلة موافقة AI؛ مُنعت الإشارة' : 'تعذر الاتصال بمراجع AI؛ مُنعت الإشارة'
    });
  }
}
