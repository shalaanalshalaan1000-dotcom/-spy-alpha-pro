const SIGNAL_URL = String(process.env.BTC_TELEGRAM_SIGNAL_URL || 'https://spy-alpha-pro-1.onrender.com/api/btc-signal').trim();
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POLL_MS = Math.max(5000, Number(process.env.BTC_TELEGRAM_POLL_MS || 5000));
const MIN_CONFIDENCE = Math.max(70, Number(process.env.BTC_TELEGRAM_MIN_CONFIDENCE || 70));

let primed = false;
let previousActive = false;
let lastSentKey = null;
let lastSentAt = 0;

function validNumber(value) {
  return Number.isFinite(Number(value));
}

function n(value, digits = 2) {
  return validNumber(value) ? Number(value).toFixed(digits) : '—';
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

  return `${icon} BTCUSD — CONFIRMED ${signal.action}\n` +
    `🧠 Strategy: ${strategy}\n` +
    `📊 Confidence: ${Math.round(Number(signal.confidence) || 0)}%\n` +
    `📈 Trend: ${trend}\n` +
    `💵 Price: $${n(signal.price)}\n` +
    `📍 Entry: $${n(signal.entry)}\n` +
    `🛑 SL: $${n(signal.stopLoss)}\n` +
    `🎯 TP1: $${n(signal.target1)}\n` +
    `🎯 TP2: $${n(signal.target2)}\n` +
    `🎯 TP3: $${n(signal.target3)}\n` +
    `🎯 TP4: $${n(signal.target4)}\n` +
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
      console.log(`[btc-telegram] sent ${signal.action} ${signal.confidence}% strategy=${signal.strategy || 'SETUP'}`);
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

export { isConfirmed, message };
