export const ENTRY_TTL_MS = 90_000;
export const MAX_SIGNAL_LIFE_MS = 4 * 60 * 60_000;

const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const iso = value => new Date(value).toISOString();
const inRange = (value, low, high) => value != null && low != null && high != null && value >= Math.min(low, high) && value <= Math.max(low, high);

export function setupFingerprint(model = {}) {
  if (model.setupId) return String(model.setupId);
  const side = ['BUY', 'SELL'].includes(model.candidateAction) ? model.candidateAction : model.side;
  return [side, model.strategy, num(model.entry), num(model.stopLoss), num(model.target1)].join('|');
}

export function normalizeLifecycleState(state = {}) {
  if (!Array.isArray(state.blockedSetupIds)) state.blockedSetupIds = [];
  if (!('lastTerminal' in state)) state.lastTerminal = null;
  if (!Number.isFinite(Number(state.cooldownUntil))) state.cooldownUntil = 0;
  if (state.signal && typeof state.signal.triggered !== 'boolean') state.signal.triggered = Boolean(state.signal.entered);
  return state;
}

function approvalForSetup(approval, setupId, now) {
  return approval?.allowed === true
    && approval?.decision === 'ALLOW'
    && String(approval?.setupId || '') === String(setupId || '')
    && Number(approval?.reviewedAtMs) <= now + 1000
    && Number(approval?.expiresAtMs) >= now;
}

function signalWasApproved(signal) {
  return signal?.aiReview?.decision === 'ALLOW'
    && signal?.aiReview?.allowed === true
    && String(signal?.aiReview?.setupId || '') === String(signal?.setupId || '');
}

export function createSignal(model, now = Date.now(), approval = null) {
  const side = model.candidateAction || model.side;
  if (!['BUY', 'SELL'].includes(side)) return null;
  const setupId = setupFingerprint(model);
  return {
    signalId:`XAU-${now}-${side}`,
    setupId,
    side,
    strategy:model.strategy || null,
    confidence:num(model.confidence) || 0,
    entry:num(model.entry),
    entryLow:num(model.entryLow),
    entryHigh:num(model.entryHigh),
    stopLoss:num(model.stopLoss),
    target1:num(model.target1),
    target2:num(model.target2),
    target3:num(model.target3),
    target4:num(model.target4),
    riskReward:num(model.riskReward),
    issuedAtMs:now,
    issuedAt:iso(now),
    expiresAtMs:now + ENTRY_TTL_MS,
    expiresAt:iso(now + ENTRY_TTL_MS),
    triggered:false,
    triggeredAtMs:null,
    triggeredAt:null,
    triggerPrice:null,
    entered:false,
    enteredAtMs:null,
    enteredAt:null,
    executedPrice:null,
    brokerConfirmed:false,
    brokerPositionId:null,
    targetHits:[false, false, false, false],
    targetHitAt:[null, null, null, null],
    lastProcessedAtMs:now - 1,
    maxFavorablePrice:null,
    maxAdversePrice:null,
    aiReview:approvalForSetup(approval, setupId, now) ? {
      required:true,
      allowed:true,
      decision:'ALLOW',
      status:'APPROVED',
      code:approval.code || 'AI_ALLOW',
      setupId,
      model:approval.model || null,
      reason:approval.reason || 'وافق AI على الإشارة',
      riskFlags:Array.isArray(approval.riskFlags) ? approval.riskFlags.slice(0, 8) : [],
      reviewedAtMs:Number(approval.reviewedAtMs),
      reviewedAt:approval.reviewedAt || iso(approval.reviewedAtMs)
    } : null
  };
}

function entryPrice(side, point) {
  return num(side === 'BUY' ? point.ask : point.bid) ?? num(point.price);
}

function exitPrice(side, point) {
  return num(side === 'BUY' ? point.bid : point.ask) ?? num(point.price);
}

function targetReached(side, price, target) {
  return target != null && price != null && (side === 'BUY' ? price >= target : price <= target);
}

function stopReached(side, price, stop) {
  return stop != null && price != null && (side === 'BUY' ? price <= stop : price >= stop);
}

function passedEntry(side, price, low, high) {
  if (price == null || low == null || high == null) return false;
  return side === 'BUY' ? price > Math.max(low, high) : price < Math.min(low, high);
}

function blockSetup(state, signal) {
  if (!signal?.setupId) return;
  state.blockedSetupIds = [...new Set([...state.blockedSetupIds, signal.setupId])].slice(-50);
}

function closeSignal(state, signal, outcome, now, exit, cooldownMs, block = false) {
  if (block) blockSetup(state, signal);
  const terminal = {
    ...signal,
    outcome,
    result:outcome === 'SL' ? 'SL' : outcome === 'TP4' ? 'TP4' : 'CANCELLED',
    stopped:outcome === 'SL',
    closedAtMs:now,
    closedAt:iso(now),
    exitPrice:num(exit)
  };
  state.lastTerminal = terminal;
  state.signal = null;
  state.cooldownUntil = Math.max(Number(state.cooldownUntil) || 0, now + cooldownMs);
  return terminal;
}

function orderedPoints(observations, quote, now, after) {
  const rows = [...(Array.isArray(observations) ? observations : []), {...quote, t:num(quote?.t) ?? now}]
    .map(point => ({...point, t:num(point?.t)}))
    .filter(point => point.t != null && point.t > after && point.t <= now)
    .sort((a, b) => a.t - b.t);
  const unique = [];
  for (const row of rows) {
    const previous = unique.at(-1);
    if (previous && previous.t === row.t) Object.assign(previous, row);
    else unique.push(row);
  }
  return unique;
}

function preIssueRejection(model, observations, quote, now) {
  const side = model.candidateAction || model.side;
  const structureAt = num(model.structureAt);
  const after = structureAt == null ? now - 1 : structureAt - 1;
  const points = orderedPoints(observations, quote, now, after);
  for (const point of points) {
    const executable = entryPrice(side, point);
    const marketExit = exitPrice(side, point);
    if (stopReached(side, marketExit, num(model.stopLoss))) return 'PREENTRY_INVALIDATED';
    if (targetReached(side, marketExit, num(model.target1))) return 'MISSED_ENTRY';
    if (passedEntry(side, executable, num(model.entryLow), num(model.entryHigh))) return 'MISSED_ENTRY';
  }
  return null;
}

export function processSignalLifecycle(state, {model = {}, quote = {}, observations = [], now = Date.now(), execute = false, publish = execute, approval = null, minConfidence = 65} = {}) {
  normalizeLifecycleState(state);
  let signal = state.signal;

  if (signal) {
    if (!Array.isArray(signal.targetHits)) signal.targetHits = [false, false, false, false];
    if (!Array.isArray(signal.targetHitAt)) signal.targetHitAt = [null, null, null, null];
    if (!Number.isFinite(Number(signal.lastProcessedAtMs))) signal.lastProcessedAtMs = signal.issuedAtMs - 1;
    if (signal.entered) signal.triggered = true;
    const points = orderedPoints(observations, quote, now, signal.lastProcessedAtMs);

    if (!signal.triggered) {
      for (const point of points) {
        const price = exitPrice(signal.side, point);
        if (stopReached(signal.side, price, signal.stopLoss)) {
          return {terminal:closeSignal(state, signal, 'PREENTRY_INVALIDATED', point.t, signal.stopLoss, 180_000, true)};
        }
        if (targetReached(signal.side, price, signal.target1)) {
          return {terminal:closeSignal(state, signal, 'MISSED_ENTRY', point.t, signal.target1, 30_000, true)};
        }
        signal.lastProcessedAtMs = point.t;
      }
      if (now > signal.expiresAtMs) {
        return {terminal:closeSignal(state, signal, 'ENTRY_EXPIRED', now, exitPrice(signal.side, quote), 30_000, true)};
      }
      const executable = entryPrice(signal.side, quote);
      if (execute && signalWasApproved(signal) && inRange(executable, signal.entryLow, signal.entryHigh)) {
        signal.triggered = true;
        signal.triggeredAtMs = now;
        signal.triggeredAt = iso(now);
        signal.triggerPrice = executable;
        signal.entered = true;
        signal.enteredAtMs = now;
        signal.enteredAt = iso(now);
        signal.executedPrice = executable;
        signal.lastProcessedAtMs = now;
      }
    } else {
      const executable = entryPrice(signal.side, quote);
      if (execute && signalWasApproved(signal) && !signal.entered && now <= signal.expiresAtMs && inRange(executable, signal.entryLow, signal.entryHigh)) {
        signal.entered = true;
        signal.enteredAtMs = now;
        signal.enteredAt = iso(now);
        signal.executedPrice = executable;
      }
      for (const point of points) {
        const price = exitPrice(signal.side, point);
        signal.maxFavorablePrice = signal.maxFavorablePrice == null ? price : (signal.side === 'BUY' ? Math.max(signal.maxFavorablePrice, price) : Math.min(signal.maxFavorablePrice, price));
        signal.maxAdversePrice = signal.maxAdversePrice == null ? price : (signal.side === 'BUY' ? Math.min(signal.maxAdversePrice, price) : Math.max(signal.maxAdversePrice, price));
        if (stopReached(signal.side, price, signal.stopLoss)) {
          return {terminal:closeSignal(state, signal, 'SL', point.t, signal.stopLoss, 180_000, true)};
        }
        const targets = [signal.target1, signal.target2, signal.target3, signal.target4];
        for (let index = 0; index < targets.length; index += 1) {
          if (!signal.targetHits[index] && targetReached(signal.side, price, targets[index])) {
            signal.targetHits[index] = true;
            signal.targetHitAt[index] = point.t;
          }
        }
        signal.lastProcessedAtMs = point.t;
        if (signal.targetHits[3]) {
          return {terminal:closeSignal(state, signal, 'TP4', point.t, signal.target4, 90_000, false)};
        }
      }
      if (now - signal.issuedAtMs > MAX_SIGNAL_LIFE_MS) {
        return {terminal:closeSignal(state, signal, 'EXPIRED', now, exitPrice(signal.side, quote), 90_000, false)};
      }
    }
  }

  signal = state.signal;
  const side = model.candidateAction;
  const setupId = setupFingerprint(model);
  const candidate = ['BUY', 'SELL'].includes(side) && Number(model.confidence) >= minConfidence;
  const executable = entryPrice(side, quote);
  const validLevels = [model.entryLow, model.entryHigh, model.stopLoss, model.target1, model.target4].every(value => num(value) != null);
  const blocked = state.blockedSetupIds.includes(setupId);

  if (!signal && publish && quote.degraded !== true && candidate && validLevels && now >= state.cooldownUntil && !blocked) {
    const rejection = preIssueRejection(model, observations, quote, now);
    if (rejection) {
      blockSetup(state, {setupId});
      return {signal:null, blocked:true, setupId, rejection};
    }
    if (inRange(executable, num(model.entryLow), num(model.entryHigh))) {
      if (!approvalForSetup(approval, setupId, now)) {
        return {signal:null, blocked:false, setupId, rejection:'AI_APPROVAL_REQUIRED'};
      }
      state.signal = createSignal(model, now, approval);
      state.signal.triggered = true;
      state.signal.triggeredAtMs = now;
      state.signal.triggeredAt = iso(now);
      state.signal.triggerPrice = executable;
      state.signal.lastProcessedAtMs = now;
      return processSignalLifecycle(state, {model, quote, observations:[], now, execute, publish:false, approval, minConfidence});
    }
  }

  return {signal:state.signal, blocked, setupId};
}

export function signalResponse(state, model, quote, now = Date.now(), allowAction = false) {
  normalizeLifecycleState(state);
  const signal = state.signal;
  if (!signal) {
    return {
      ...model,
      action:'WAIT',
      executionMode:'XAUUSD_ONLY',
      terminalEvent:state.lastTerminal,
      blockedAfterStop:state.blockedSetupIds.includes(setupFingerprint(model)),
      cooldownUntil:state.cooldownUntil || 0,
      provider:quote.provider,
      degraded:Boolean(quote.degraded),
      price:num(quote.price),
      bid:num(quote.bid),
      ask:num(quote.ask),
      updatedAt:iso(now)
    };
  }
  const executable = entryPrice(signal.side, quote);
  const canExecute = allowAction && signalWasApproved(signal) && quote.degraded !== true && now <= signal.expiresAtMs && inRange(executable, signal.entryLow, signal.entryHigh) && !signal.brokerConfirmed;
  return {
    ...signal,
    tp1:signal.targetHits[0],
    tp2:signal.targetHits[1],
    tp3:signal.targetHits[2],
    tp4:signal.targetHits[3],
    status:signal.brokerConfirmed ? 'MANAGING' : now <= signal.expiresAtMs ? 'ACTIVE' : 'MANAGING',
    action:canExecute ? signal.side : 'WAIT',
    candidateAction:signal.side,
    entryConfirmation:signal.brokerConfirmed ? 'MT5_CONFIRMED' : signal.entered ? 'BROKER_PENDING' : signal.triggered ? 'PRICE_TRIGGERED' : 'PENDING',
    price:num(quote.price),
    bid:num(quote.bid),
    ask:num(quote.ask),
    provider:quote.provider,
    degraded:Boolean(quote.degraded),
    updatedAt:iso(now),
    reason:signal.brokerConfirmed ? 'MT5 entry confirmed — managing position' : signal.entered ? 'Execution requested — waiting for MT5 confirmation' : signal.triggered ? 'وافق AI — صدرت الإشارة عند أول لمسة حية' : 'Waiting for executable entry price'
  };
}

export function confirmBrokerOpen(state, report, now = Date.now()) {
  normalizeLifecycleState(state);
  const signal = state.signal;
  if (!signal || (report.side && report.side !== signal.side)) return null;
  signal.entered = true;
  signal.enteredAtMs ||= now;
  signal.enteredAt ||= report.openedAt || iso(now);
  signal.executedPrice = num(report.entry) ?? signal.executedPrice ?? signal.entry;
  signal.brokerConfirmed = true;
  signal.brokerPositionId = String(report.positionId ?? report.ticket ?? '');
  return signal;
}

export function applyBrokerTargetReport(state, report) {
  const signal = state.signal;
  if (!signal) return null;
  const keys = ['tp1Hit', 'tp2Hit', 'tp3Hit', 'tp4Hit'];
  keys.forEach((key, index) => {
    if (report[key] === true) signal.targetHits[index] = true;
  });
  return signal;
}
