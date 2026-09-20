const SIGNAL_URL = String(process.env.BTC_TELEGRAM_SIGNAL_URL || 'https://spy-alpha-pro-1.onrender.com/api/btc-signal').trim();
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POLL_MS = Math.max(5000, Number(process.env.BTC_TELEGRAM_POLL_MS || 5000));
const MIN_CONFIDENCE = Math.max(70, Number(process.env.BTC_TELEGRAM_MIN_CONFIDENCE || 70));
const BTC_ACCOUNT_BALANCE_USD = Math.max(1, Number(process.env.BTC_ACCOUNT_BALANCE_USD || 155));
const BTC_CONTRACT_SIZE = Math.max(0.000001, Number(process.env.EXNESS_BTC_CONTRACT_SIZE || 1));
const BTC_LOT_STEP = Math.max(0.001, Number(process.env.EXNESS_BTC_LOT_STEP || 0.01));
const BTC_SAFE_RISK_USD = Math.max(1, Number(process.env.BTC_SAFE_RISK_USD || 5));
const BTC_MAX_RISK_USD = Math.max(BTC_SAFE_RISK_USD, Number(process.env.BTC_MAX_RISK_USD || 10));

let primed = false;
let previousActive = false;
let lastSentKey = null;
let lastSentAt = 0;
let trackedTrade = null;

function validNumber(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) && Number(value) > 0;
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
    Number(signal.confidence) >= MIN_CONFIDENCE &&
    [signal.entry, signal.stopLoss, signal.target1, signal.target2, signal.target3, signal.target4].every(validNumber)
  );
}

function signalKey(signal, now = Date.now()) {
  const fiveMinuteBucket = Math.floor(now / 300000);
  return `${signal.action}:${signal.strategy || 'SETUP'}:${fiveMinuteBucket}`;
}

function reached(side, price, target) {
  const p = Number(price);
  const t = Number(target);
  if (!Number.isFinite(p) || !Number.isFinite(t)) return false;
  return side === 'BUY' ? p >= t : side === 'SELL' ? p <= t : false;
}

function startTracking(signal, key, announcedAtMs = Date.now()) {
  trackedTrade = {
    key,
    side: signal.action,
    announcedAtMs,
    entry: Number(signal.entry),
    stopLoss: Number(signal.stopLoss),
    targets: [signal.target1, signal.target2, signal.target3, signal.target4].map(Number),
    sentTargets: [false, false, false, false]
  };
}

function tpHitMessage(index, target, livePrice) {
  return `✅ BTCUSD — TP${index + 1} HIT / تم ضرب الهدف ${index + 1}\n` +
    `🎯 TP${index + 1}: ${n(target)}\n` +
    `💵 BTC: ${n(livePrice)}`;
}

function stopHitMessage(trade) {
  return `🔴 BTCUSD — SL HIT / تم ضرب وقف الخسارة\n` +
    `الاتجاه: ${trade.side}\n📍 الدخول: ${n(trade.entry)}\n` +
    `🛑 SL: ${n(trade.stopLoss)}\n💵 BTC عند الرصد: ${n(trade.stopHitPrice)}\n` +
    'انتهت متابعة الصفقة — لا تُحتسب أهداف لاحقة لها.';
}

async function sendTrackedTargetHits(signal, send = telegram) {
  if (!trackedTrade) return;
  const livePrice = Number(signal?.price);
  // Latch the stop before delivery: a failed notification must never allow later TPs.
  if (!trackedTrade.stopHitPrice && validNumber(signal?.price) &&
      (trackedTrade.side === 'BUY' ? livePrice <= trackedTrade.stopLoss : livePrice >= trackedTrade.stopLoss)) {
    trackedTrade.stopHitPrice = livePrice;
  }
  if (trackedTrade.stopHitPrice) {
    await send('sendMessage', {
      chat_id: CHAT_ID,
      text: stopHitMessage(trackedTrade),
      disable_web_page_preview: true
    });
    console.log(`[btc-telegram] SL hit key=${trackedTrade.key} stop=${n(trackedTrade.stopLoss)} live=${n(trackedTrade.stopHitPrice)}`);
    trackedTrade = null;
    return;
  }
  if (!validNumber(signal?.price)) return;

  for (let i = 0; i < trackedTrade.targets.length; i++) {
    const target = trackedTrade.targets[i];
    if (!trackedTrade.sentTargets[i] && reached(trackedTrade.side, livePrice, target)) {
      await send('sendMessage', {
        chat_id: CHAT_ID,
        text: tpHitMessage(i, target, livePrice),
        disable_web_page_preview: true
      });
      trackedTrade.sentTargets[i] = true;
      console.log(`[btc-telegram] TP${i + 1} hit key=${trackedTrade.key} target=${n(target)} live=${n(livePrice)}`);
    }
  }

  if (trackedTrade.sentTargets.every(Boolean)) {
    console.log(`[btc-telegram] all targets completed key=${trackedTrade.key}`);
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
  const icon = signal.action === 'BUY' ? '🟢' : '🔴';
  const strategy = signal.strategy || 'BTC SETUP';
  const trend = signal.trend || '—';
  const stamp = new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  }).format(new Date());

  const sizing = lotSizingLines(signal.entry, signal.stopLoss);
  return `${icon} BTCUSD — CONFIRMED ${signal.action}\n` +
    `🧠 Strategy: ${strategy}\n` +
    `📊 Confidence: ${Math.round(Number(signal.confidence) || 0)}%\n` +
    `📈 Trend: ${trend}\n` +
    `💵 Price: ${n(signal.price)}\n` +
    `📍 Entry: ${n(signal.entry)}\n` +
    `🛑 SL: ${n(signal.stopLoss)}\n` +
    `🎯 TP1: ${n(signal.target1)}\n` +
    `🎯 TP2: ${n(signal.target2)}\n` +
    `🎯 TP3: ${n(signal.target3)}\n` +
    `🎯 TP4: ${n(signal.target4)}\n\n` +
    `${sizing.join('\\n')}\n` +
    `⏱️ 5m setup / 1m timing\n` +
    `🕒 ${stamp} بتوقيت السعودية\n` +
    `⚪ إشارات فقط — لا تداول آلي`;
}

async function fetchSignal() {
  const response = await fetch(SIGNAL_URL, {
    headers: { accept: 'application/json', 'user-agent': 'Gold-Alpha-BTC-Telegram/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`BTC signal HTTP ${response.status}`);
  return response.json();
}

async function tick() {
  const signal = await fetchSignal();

  // Target lifecycle is independent from whether the signal endpoint still reports ACTIVE.
  // Once announced, watch until the stop or all four targets are reached.
  await sendTrackedTargetHits(signal);

  const active = isConfirmed(signal);

  // Prime from the live state after a deploy so an already-existing signal is not resent.
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

  // Send only on a fresh WAIT -> ACTIVE transition. The bucket key prevents rapid flicker duplicates.
  if (!previousActive) {
    const now = Date.now();
    const key = signalKey(signal, now);
    if (key !== lastSentKey || now - lastSentAt > 300000) {
      await telegram('sendMessage', {
        chat_id: CHAT_ID,
        text: message(signal),
        disable_web_page_preview: true
      });
      lastSentKey = key;
      lastSentAt = now;
      startTracking(signal, key, now);
      console.log(`[btc-telegram] sent+tracking ${signal.action} ${signal.confidence}% strategy=${signal.strategy || 'SETUP'} key=${key}`);
    }
  }

  previousActive = true;
}

console.log(`[btc-telegram] ${BOT_TOKEN && CHAT_ID ? 'enabled' : 'disabled: token/chat id missing'}; source=${SIGNAL_URL}; min=${MIN_CONFIDENCE}%`);

if (process.env.NODE_ENV !== 'test' && BOT_TOKEN && CHAT_ID) {
  (async function loop() {
    while (true) {
      try { await tick(); }
      catch (error) { console.error('[btc-telegram]', error?.message || error); }
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
  })();
}

export { isConfirmed, message, reached, tpHitMessage, startTracking, sendTrackedTargetHits };
