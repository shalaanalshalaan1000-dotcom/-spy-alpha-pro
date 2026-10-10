import fs from 'node:fs';

const SIGNAL_URL = String(process.env.BTC_TELEGRAM_SIGNAL_URL || 'https://spy-alpha-pro-1.onrender.com/api/btc-signal').trim();
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POLL_MS = Math.max(5000, Number(process.env.BTC_TELEGRAM_POLL_MS || 5000));
const BTC_ACCOUNT_BALANCE_USD = Math.max(1, Number(process.env.BTC_ACCOUNT_BALANCE_USD || 178));
const BTC_CONTRACT_SIZE = Math.max(0.000001, Number(process.env.EXNESS_BTC_CONTRACT_SIZE || 1));
const BTC_LOT_STEP = Math.max(0.001, Number(process.env.EXNESS_BTC_LOT_STEP || 0.01));
const BTC_SAFE_RISK_USD = Math.max(1, Number(process.env.BTC_SAFE_RISK_USD || 5));
const BTC_MAX_RISK_USD = Math.max(BTC_SAFE_RISK_USD, Number(process.env.BTC_MAX_RISK_USD || 10));
const BTC_JOURNAL_PATH = String(process.env.BTC_TRADE_JOURNAL_PATH || '/tmp/gold-alpha-btc-trades.json').trim();

let primed = false;
let previousActive = false;
let lastSentKey = null;
let lastSentAt = 0;
let trackedTrade = null;

function validNumber(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number.isFinite(Number(value)) && Number(value) > 0;
}

function n(value, digits = 2) {
  return validNumber(value) ? Number(value).toFixed(digits) : '—';
}

function lotForRisk(entry, stopLoss, riskUsd) {
  const distance = Math.abs(Number(entry) - Number(stopLoss));
  if (!(distance > 0) || !(riskUsd > 0)) return null;
  const raw = riskUsd / (distance * BTC_CONTRACT_SIZE);
  if (!(raw > 0)) return null;
  const stepped = Math.floor((raw + 1e-12) / BTC_LOT_STEP) * BTC_LOT_STEP;
  return stepped >= BTC_LOT_STEP ? Number(stepped.toFixed(3)) : 0;
}

function lotSizingLines(entry, stopLoss) {
  const distance = Math.abs(Number(entry) - Number(stopLoss));
  if (!(distance > 0)) return [];
  const safeLot = lotForRisk(entry, stopLoss, BTC_SAFE_RISK_USD);
  const maxLot = lotForRisk(entry, stopLoss, BTC_MAX_RISK_USD);
  const minLotRisk = distance * BTC_CONTRACT_SIZE * BTC_LOT_STEP;
  const safePct = BTC_SAFE_RISK_USD / BTC_ACCOUNT_BALANCE_USD * 100;
  const maxPct = BTC_MAX_RISK_USD / BTC_ACCOUNT_BALANCE_USD * 100;
  const fmt = lot => lot && lot > 0 ? `${lot.toFixed(2)} lot` : `أقل من ${BTC_LOT_STEP.toFixed(2)} lot`;
  const lines = [
    `🏦 Broker: Exness • BTCUSD`,
    `💼 Balance: ${BTC_ACCOUNT_BALANCE_USD.toFixed(0)}`,
    `📏 SL distance: ${distance.toFixed(2)}`,
    `✅ Suggested lot (risk ≈ ${BTC_SAFE_RISK_USD.toFixed(0)} / ${safePct.toFixed(1)}%): ${fmt(safeLot)}`,
    `⛔ Max lot (risk ≈ ${BTC_MAX_RISK_USD.toFixed(0)} / ${maxPct.toFixed(1)}%): ${fmt(maxLot)}`
  ];
  if (maxLot === 0) lines.push(`🚫 Skip: minimum ${BTC_LOT_STEP.toFixed(2)} lot risks ≈ ${minLotRisk.toFixed(2)} at SL`);
  else lines.push('⚠️ Do not exceed the max lot for this setup');
  return lines;
}

function isConfirmed(signal) {
  return Boolean(
    signal &&
    signal.status === 'ACTIVE' &&
    ['BUY', 'SELL'].includes(signal.action) &&
    signal.strategy === 'ICT_LIQUIDITY_HUNT_M5_MSS_RETEST' &&
    [signal.entry, signal.stopLoss, signal.target1].every(validNumber)
  );
}

function signalKey(signal) {
  return String(signal.setupId || `${signal.action}:${signal.strategy}:${signal.entry}:${signal.stopLoss}`);
}

function reached(side, price, target) {
  const p = Number(price), t = Number(target);
  if (!Number.isFinite(p) || !Number.isFinite(t)) return false;
  return side === 'BUY' ? p >= t : p <= t;
}

function readBtcJournal() {
  try {
    const rows = JSON.parse(fs.readFileSync(BTC_JOURNAL_PATH, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

function writeBtcJournal(rows) {
  try {
    const tmp = BTC_JOURNAL_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rows.slice(-300)), 'utf8');
    fs.renameSync(tmp, BTC_JOURNAL_PATH);
  } catch (error) {
    console.error('[btc-journal] write failed', error?.message || error);
  }
}

function closeBtcJournalTrade(trade, outcome, exitPrice, closedAtMs = Date.now()) {
  if (!trade) return;
  const entry = Number(trade.entry);
  const originalStopLoss = Number(trade.originalStopLoss);
  const risk = Math.abs(entry - originalStopLoss);
  const directionalMove = trade.side === 'BUY' ? Number(exitPrice) - entry : entry - Number(exitPrice);
  const realizedR = risk > 0 ? directionalMove / risk : 0;
  const result = realizedR > 0.05 ? 'WIN' : realizedR >= -0.05 ? 'BREAKEVEN' : 'LOSS';
  const row = {
    status: 'CLOSED',
    asset: 'BTCUSD',
    key: trade.key,
    setupId: trade.key,
    side: trade.side,
    action: trade.side,
    strategy: 'ICT_LIQUIDITY_HUNT_M5_MSS_RETEST',
    confidence: Number(trade.confidence) || 0,
    entry,
    originalStopLoss,
    stopLoss: Number(trade.stopLoss),
    targets: trade.targets,
    targetHits: trade.sentTargets,
    managementStage: Number(trade.managementStage) || 0,
    outcome,
    result,
    exitPrice: Number(exitPrice),
    realizedUsd: Number(directionalMove.toFixed(2)),
    realizedR: Number(realizedR.toFixed(2)),
    issuedAt: new Date(trade.announcedAtMs).toISOString(),
    issuedAtMs: trade.announcedAtMs,
    closedAt: new Date(closedAtMs).toISOString(),
    closedAtMs
  };
  const rows = readBtcJournal().filter(x => x?.key !== row.key || x?.closedAtMs !== row.closedAtMs);
  rows.push(row);
  writeBtcJournal(rows);
  console.log(`[btc-journal] closed ${row.side} ${row.result} ${row.realizedR}R outcome=${outcome} key=${row.key}`);
}

function startTracking(signal, key, announcedAtMs = Date.now()) {
  const rawTargets = [signal.target1, signal.target2, signal.target3, signal.target4];
  const targets = rawTargets.filter(validNumber).map(Number);
  trackedTrade = {
    key,
    side: signal.action,
    strategy: 'ICT_LIQUIDITY_HUNT_M5_MSS_RETEST',
    confidence: Number(signal.confidence) || 0,
    announcedAtMs,
    signalId: String(signal.signalId || ''),
    entry: Number(signal.entry),
    originalStopLoss: Number(signal.stopLoss),
    stopLoss: Number(signal.stopLoss),
    bestPrice: Number(signal.entry),
    managementStage: 0,
    targets,
    sentTargets: targets.map(() => false)
  };
}

function tpHitMessage(index, target, livePrice, newStop = null) {
  return `✅ BTCUSD — TP${index + 1} HIT / تحقق الهدف ${index + 1}\n`
    + `🎯 TP${index + 1}: ${n(target)}\n`
    + `💵 السعر المرصود: ${n(livePrice)}\n`
    + (validNumber(newStop) ? `🔒 وقف الحماية الافتراضي للإشارة: ${n(newStop)}\n` : '')
    + '⛔ لا دخول جديد على الإشارة القديمة.';
}

function closeSignalMessage(trade, outcome, exitPrice) {
  const tp = String(outcome).startsWith('TP');
  const title = tp ? `✅ BTCUSD — SIGNAL CLOSED • ${outcome} HIT`
    : outcome === 'PROTECTED_STOP' ? '🟠 BTCUSD — SIGNAL CLOSED • PROTECTED STOP'
    : outcome === 'EXPIRED' ? '⏳ BTCUSD — SIGNAL EXPIRED • NO ENTRY'
    : '🔴 BTCUSD — SIGNAL CLOSED • SL HIT';
  return `${title}\n📍 Entry: ${n(trade.entry)}\n💵 Exit reference: ${n(exitPrice)}\n`
    + `🛑 Initial SL: ${n(trade.originalStopLoss)}\n`
    + `🏁 Outcome: ${outcome}\n`
    + '⛔ تم إنهاء إشارة الموقع، ولا تعتبر صفقة جديدة.\n'
    + '⚠️ هذا إغلاق للإشارة فقط، وليس تأكيد إغلاق صفقة Exness.';
}

async function sendTrackedTargetHits(signal, send = telegram) {
  if (!trackedTrade) return;
  const livePrice = validNumber(signal?.price) ? Number(signal.price) : null;
  const finalEvent = signal?.terminalEvent?.signalId
    && String(signal.terminalEvent.signalId) === trackedTrade.signalId
      ? signal.terminalEvent : null;
  const hitPrice = finalEvent && validNumber(finalEvent.price) ? Number(finalEvent.price) : livePrice;
  // When API has already closed the signal, replay TP observations before its final
  // closure notification. This avoids missing a target when the poll skips past TP1.
  const targetClose = finalEvent && /^TP[12]$/.test(String(finalEvent.type));
  const validHitPrice = validNumber(hitPrice);
  const stopPrice = trackedTrade.stopLoss;
  const hitStop = !targetClose && validNumber(livePrice)
    && (trackedTrade.side === 'BUY' ? livePrice <= stopPrice : livePrice >= stopPrice);
  // Once a stop is observed, latch it until delivery succeeds. A rebound cannot erase the alert.
  if (hitStop && !trackedTrade.stopHitPrice) trackedTrade.stopHitPrice = livePrice;
  const stopOutcome = finalEvent && ['SL','PROTECTED_STOP','EXPIRED'].includes(finalEvent.type)
    ? finalEvent.type : trackedTrade.stopHitPrice
      ? (trackedTrade.managementStage > 0 ? 'PROTECTED_STOP' : 'SL') : null;

  if (stopOutcome) {
    const finalPrice = finalEvent && validNumber(finalEvent.price)
      ? Number(finalEvent.price) : Number(trackedTrade.stopHitPrice || stopPrice);
    await send('sendMessage', { chat_id: CHAT_ID,
      text: closeSignalMessage(trackedTrade, stopOutcome, finalPrice), disable_web_page_preview: true });
    closeBtcJournalTrade(trackedTrade, stopOutcome, stopOutcome === 'EXPIRED' ? trackedTrade.entry : stopPrice);
    trackedTrade = null;
    return;
  }
  if (!validHitPrice) return;

  const closingTargetCount = Math.min(2, trackedTrade.targets.length);
  for (let i = 0; i < closingTargetCount; i += 1) {
    const target = trackedTrade.targets[i];
    const hit = reached(trackedTrade.side, hitPrice, target)
      || (targetClose && finalEvent.targetHits?.[i] === true);
    if (!trackedTrade.sentTargets[i] && hit) {
      await send('sendMessage', { chat_id: CHAT_ID,
        text: tpHitMessage(i, target, hitPrice, i === 0 && closingTargetCount > 1 ? target : null),
        disable_web_page_preview: true });
      // Record after successful send to retry on Telegram network errors.
      trackedTrade.sentTargets[i] = true;
      trackedTrade.managementStage = Math.max(trackedTrade.managementStage || 0, i + 1);
      if (i === 0) trackedTrade.stopLoss = Number(target);
    }
  }

  if ((closingTargetCount === 1 && trackedTrade.sentTargets[0])
    || (closingTargetCount >= 2 && trackedTrade.sentTargets[1])) {
    const outcome = `TP${closingTargetCount}`;
    const exit = Number(trackedTrade.targets[closingTargetCount - 1]);
    await send('sendMessage', { chat_id: CHAT_ID,
      text: closeSignalMessage(trackedTrade, outcome, hitPrice), disable_web_page_preview: true });
    closeBtcJournalTrade(trackedTrade, outcome, exit);
    trackedTrade = null;
  }
}

async function telegram(method, body) {
  if (!BOT_TOKEN || !CHAT_ID) throw new Error('Telegram token/chat id missing');
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(`${method} ${response.status} ${data?.description || ''}`.trim());
  return data;
}

function message(signal) {
 const icon=signal.action==='BUY'?'🟢':'🔴',ict=signal.ict||{},sweep=ict.legSweep||{},
   mss=ict.m5MssEvent||{},retest=ict.m5MssRetest||{};
 const labels=Array.isArray(signal.targetLabels)?signal.targetLabels:[];
 const stamp=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date());
 const sizing=lotSizingLines(signal.entry,signal.stopLoss);
 const targetLines=[signal.target1,signal.target2,signal.target3,signal.target4]
   .map((t,i)=>validNumber(t)?'🎯 TP'+(i+1)+': '+n(t)+' • '+(labels[i]||'EXTERNAL_LIQUIDITY'):null)
   .filter(Boolean).join('\n');
 return `${icon} 🟣 BTCUSD — PURE ICT ${signal.action}\n`
  + '🧠 Strategy: ICT_EXTERNAL_LIQUIDITY_M5_MSS_RETEST\n'
  + '✅ External sweep: '+String(sweep.name||'—')+' @ '+n(sweep.level)+'\n'
  + '🔄 M5 MSS / Displacement: '+(mss.confirmed?'CONFIRMED':'WAIT')+' @ '+n(mss.level)+'\n'
  + '🔁 M5 Retest/Hold: '+(retest.confirmed?'CONFIRMED':'WAIT')+'\n'
  + '📊 Setup quality (not win probability): '+Math.round(Number(signal.confidence)||0)+'/100\n'
  + '💵 Price: '+n(signal.price)+'\n'
  + '📍 Entry: '+n(signal.entry)+'\n'
  + '🛑 Structural SL: '+n(signal.stopLoss)+'\n'
  + targetLines+'\n\n'+sizing.join('\n')+'\n'
  + '⏱️ External Sweep → closed M5 displaced MSS → later M5 Retest/Hold; only external liquidity targets\n'
  + '🕒 '+stamp+' بتوقيت السعودية\n'
  + '⚪ إشارات فقط — لا تداول آلي';
}

async function fetchSignal() {
  const response = await fetch(SIGNAL_URL, {
    headers: { accept: 'application/json', 'user-agent': 'Gold-Alpha-BTC-Telegram-ICT/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`BTC signal HTTP ${response.status}`);
  return response.json();
}

async function tick() {
  const signal = await fetchSignal();
  await sendTrackedTargetHits(signal);
  const active = isConfirmed(signal) && signal.entryEligible !== false;

  if (!primed) {
    primed = true;
    previousActive = active;
    console.log(`[btc-telegram] primed; current=${active ? `${signal.action} ${signal.confidence}%` : 'WAIT'}`);
    return;
  }

  if (!active) {
    previousActive = false;
    return;
  }

  if (!previousActive) {
    const now = Date.now();
    const key = signalKey(signal);
    if (key !== lastSentKey || now - lastSentAt > 300000) {
      await telegram('sendMessage', { chat_id: CHAT_ID, text: message(signal), disable_web_page_preview: true });
      lastSentKey = key;
      lastSentAt = now;
      startTracking(signal, key, now);
      console.log(`[btc-telegram] sent+tracking ${signal.action} ${signal.confidence}% strategy=ICT_LIQUIDITY_HUNT_M5_MSS_RETEST key=${key}`);
    }
  }

  previousActive = true;
}

console.log(`[btc-telegram] ${BOT_TOKEN && CHAT_ID ? 'enabled' : 'disabled: token/chat id missing'}; source=${SIGNAL_URL}; mode=ict-only`);

if (process.env.NODE_ENV !== 'test' && BOT_TOKEN && CHAT_ID) {
  (async function loop() {
    while (true) {
      try { await tick(); }
      catch (error) { console.error('[btc-telegram]', error?.message || error); }
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
  })();
}

export { isConfirmed, message, reached, tpHitMessage, startTracking, sendTrackedTargetHits, closeBtcJournalTrade, readBtcJournal };
