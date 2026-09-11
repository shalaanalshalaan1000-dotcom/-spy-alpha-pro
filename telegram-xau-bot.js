const AUTO_URL = process.env.TELEGRAM_SIGNAL_URL || 'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
let CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POLL_MS = Math.max(1500, Number(process.env.TELEGRAM_POLL_MS || 3000));
let updateOffset = 0;
let boundAnnounced = false;
let bootReady = false;

const sent = {
  signalId: null,
  targets: [false, false, false, false],
  terminalKey: null
};

function n(v, digits = 3) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(digits) : '—';
}

async function tg(method, body = null) {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? {'content-type': 'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok === false) throw new Error(`${method} ${r.status} ${d?.description || ''}`.trim());
  return d;
}

async function startup() {
  if (bootReady) return true;
  if (!BOT_TOKEN) {
    console.error('[telegram-xau-bot] TELEGRAM_BOT_TOKEN missing');
    return false;
  }
  try {
    const me = await tg('getMe');
    console.log(`[telegram-xau-bot] authenticated as @${me?.result?.username || 'unknown'}`);
    await tg('deleteWebhook', {drop_pending_updates:false});
    console.log('[telegram-xau-bot] webhook cleared; polling enabled');
    bootReady = true;
    return true;
  } catch (e) {
    console.error('[telegram-xau-bot] startup failed', e?.message || e);
    return false;
  }
}

async function sendDirect(chatId, text) {
  if (!chatId) return false;
  await tg('sendMessage', {chat_id: chatId, text, disable_web_page_preview: true});
  return true;
}

async function resolveChatId() {
  if (CHAT_ID) return CHAT_ID;
  if (!(await startup())) return '';
  try {
    const u = new URL(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
    u.searchParams.set('timeout', '0');
    if (updateOffset) u.searchParams.set('offset', String(updateOffset));
    const r = await fetch(u, {cache:'no-store', signal:AbortSignal.timeout(8000)});
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.ok === false) throw new Error(`getUpdates ${r.status} ${d?.description || ''}`.trim());
    const rows = Array.isArray(d.result) ? d.result : [];
    for (const row of rows) {
      updateOffset = Math.max(updateOffset, Number(row.update_id || 0) + 1);
      const msg = row.message || row.edited_message || null;
      const chat = msg?.chat;
      if (chat?.type === 'private') {
        CHAT_ID = String(chat.id);
        if (!boundAnnounced) {
          await sendDirect(CHAT_ID, '✅ تم ربط Majedinobot بمنصة Gold Alpha Pro.\nسأرسل إشارات XAUUSD الجديدة وتحديثات TP1–TP4 ووقف الخسارة تلقائيًا.');
          boundAnnounced = true;
        }
        console.log(`[telegram-xau-bot] private chat bound: ${CHAT_ID}`);
        break;
      }
    }
  } catch (e) {
    console.error('[telegram-xau-bot] chat bind failed', e?.message || e);
  }
  return CHAT_ID;
}

async function telegram(text) {
  if (!CHAT_ID) await resolveChatId();
  if (!CHAT_ID) return false;
  return sendDirect(CHAT_ID, text);
}

function activeSignal(s) {
  return s && ['BUY', 'SELL'].includes(s.action) && s.status === 'ACTIVE' && s.signalId;
}

function signalMessage(s) {
  const icon = s.action === 'BUY' ? '🟢' : '🔴';
  return `${icon} XAUUSD — ${s.action}\n\n📍 الدخول:\nمن: ${n(s.entryHigh)}\nإلى: ${n(s.entryLow)}\n\n🎯 الأهداف:\nTP1: ${n(s.target1)}\nTP2: ${n(s.target2)}\nTP3: ${n(s.target3)}\nTP4: ${n(s.target4)}\n\n🛑 STOP LOSS:\n${n(s.stopLoss)}\n\nالثقة: ${Math.round(Number(s.confidence || s.signalConfidence || 0))}%`;
}

function tpMessage(i, price) {
  return `✅ XAUUSD — TP${i + 1} HIT\n🎯 TP${i + 1}: ${n(price)}`;
}

function terminalKey(t) {
  if (!t || !t.signalId || !t.outcome) return null;
  return `${t.signalId}:${t.outcome}:${t.closedAtMs || t.closedAt || ''}`;
}

async function tick() {
  try {
    if (!(await startup())) return;
    if (!CHAT_ID) await resolveChatId();
    if (!CHAT_ID) return;

    const r = await fetch(AUTO_URL, {cache:'no-store', signal:AbortSignal.timeout(7000)});
    if (!r.ok) throw new Error(`signal ${r.status}`);
    const s = await r.json();

    if (activeSignal(s)) {
      if (sent.signalId !== s.signalId) {
        await telegram(signalMessage(s));
        sent.signalId = s.signalId;
        sent.targets = [false, false, false, false];
      }
      const hits = Array.isArray(s.targetHits) ? s.targetHits : [];
      const targets = [s.target1, s.target2, s.target3, s.target4];
      for (let i = 0; i < 4; i += 1) {
        if (hits[i] && !sent.targets[i]) {
          await telegram(tpMessage(i, targets[i]));
          sent.targets[i] = true;
        }
      }
    }

    const t = s.terminalEvent;
    const key = terminalKey(t);
    if (key && key !== sent.terminalKey) {
      if (t.outcome === 'SL') {
        await telegram(`🛑 XAUUSD — STOP LOSS HIT\nSL: ${n(t.stopLoss)}\nExit: ${n(t.exitPrice)}`);
      } else if (t.outcome === 'TP4') {
        for (let i = 0; i < 4; i += 1) {
          const targets = [t.target1, t.target2, t.target3, t.target4];
          if (Array.isArray(t.targetHits) && t.targetHits[i] && !sent.targets[i]) {
            await telegram(tpMessage(i, targets[i]));
            sent.targets[i] = true;
          }
        }
        await telegram(`🏁 XAUUSD — ALL TARGETS COMPLETED\nTP4: ${n(t.target4)}`);
      }
      sent.terminalKey = key;
    }
  } catch (e) {
    console.error('[telegram-xau-bot]', e?.message || e);
  }
}

console.log(`[telegram-xau-bot] ${BOT_TOKEN ? (CHAT_ID ? 'enabled with configured chat' : 'enabled; waiting for first private message') : 'disabled: TELEGRAM_BOT_TOKEN missing'}`);
(async function loop() {
  while (true) {
    await tick();
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
})();
