const AUTO_URL = process.env.TELEGRAM_SIGNAL_URL || 'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BITCOIN_URL = process.env.TELEGRAM_BITCOIN_URL || 'http://127.0.0.1:3004/api/capital/bitcoin';
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
let CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POLL_MS = Math.max(1500, Number(process.env.TELEGRAM_POLL_MS || 3000));
const CANDIDATE_MIN_CONFIDENCE = Math.max(1, Number(process.env.TELEGRAM_CANDIDATE_MIN_CONFIDENCE || process.env.MIN_CONFIDENCE || 55));
const CANDIDATE_REPEAT_MS = Math.max(30_000, Number(process.env.TELEGRAM_CANDIDATE_REPEAT_MS || 180_000));
let updateOffset = 0;
let boundAnnounced = false;
let bootReady = false;
let currentSignal = null;
let confirmedSignalId = null;
let rejectedSignalId = null;
let lastCandidateKey = null;
let lastCandidateAt = 0;

const sent = {
  signalId: null,
  targets: [false, false, false, false],
  terminalKey: null
};

function n(v, digits = 3) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(digits) : '—';
}

function money(v, digits = 2) {
  const x = Number(v);
  return Number.isFinite(x) ? '$' + x.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
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

async function fetchBitcoin() {
  const r = await fetch(BITCOIN_URL + (BITCOIN_URL.includes('?') ? '&' : '?') + 'force=1', {cache:'no-store', signal:AbortSignal.timeout(7000)});
  const d = await r.json().catch(()=>({}));
  if(!r.ok || !Number.isFinite(Number(d?.price))) throw new Error(d?.error || `bitcoin ${r.status}`);
  return d;
}

function bitcoinMessage(b){
  return `₿ BTCUSD — Capital.com LIVE\n\n💵 السعر: ${money(b.price)}\nBid: ${money(b.bid)}\nAsk: ${money(b.ask)}\n📈 السوق: ${b.marketStatus || '—'}\n🔎 Epic: ${b.epic || '—'}\n🕒 التحديث: ${b.updatedAt ? new Date(b.updatedAt).toLocaleString() : '—'}\n\nBitcoin الآن قراءة مباشرة من Capital.com. لا توجد إشارة BUY/SELL للبيتكوين إلا إذا كان محرك Bitcoin مستقلًا ومفعّلًا.`;
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

async function sendDirect(chatId, text, replyMarkup = null) {
  if (!chatId) return false;
  const body={chat_id: chatId, text, disable_web_page_preview: true};
  if(replyMarkup) body.reply_markup=replyMarkup;
  await tg('sendMessage', body);
  return true;
}

async function announceBound(chatId){
  if(!chatId||boundAnnounced) return;
  await sendDirect(chatId, '✅ تم ربط Majedinobot بمنصة Gold Alpha Pro.\n\n🥇 XAUUSD: تنبيه مبكر عند اكتمال المرشح، ثم إشارة تنفيذية عند دخول السعر للنطاق مع زر تأكيد أو رفض.\n₿ BTCUSD: قراءة LIVE من Capital.com ويمكنك طلبها بالأمر /bitcoin.\n\n⚠️ التأكيد في تيليجرام يثبت موافقتك على الإشارة فقط ولا يرسل أمرًا ماليًا تلقائيًا إلى الوسيط.');
  boundAnnounced=true;
}

async function processUpdates(){
  if (!(await startup())) return;
  try{
    const u=new URL(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
    u.searchParams.set('timeout','0');
    if(updateOffset) u.searchParams.set('offset',String(updateOffset));
    const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(8000)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d?.ok===false) throw new Error(`getUpdates ${r.status} ${d?.description||''}`.trim());
    const rows=Array.isArray(d.result)?d.result:[];
    for(const row of rows){
      updateOffset=Math.max(updateOffset,Number(row.update_id||0)+1);
      const msg=row.message||row.edited_message||null;
      const chat=msg?.chat;
      if(chat?.type==='private'&&!CHAT_ID){ CHAT_ID=String(chat.id); await announceBound(CHAT_ID); console.log(`[telegram-xau-bot] private chat bound: ${CHAT_ID}`); }

      if(msg?.text && chat?.type==='private'){
        const text=String(msg.text).trim().toLowerCase();
        if(text==='/bitcoin' || text==='/btc'){
          try{ const b=await fetchBitcoin(); await sendDirect(String(chat.id), bitcoinMessage(b)); }
          catch(e){ await sendDirect(String(chat.id), `⚠️ تعذر جلب Bitcoin الآن: ${String(e?.message||e)}`); }
        }
      }

      const cb=row.callback_query;
      if(cb){
        const cbChat=String(cb.message?.chat?.id||'');
        if(!CHAT_ID&&cbChat) CHAT_ID=cbChat;
        const allowedChat=!CHAT_ID||cbChat===String(CHAT_ID);
        if(!allowedChat){ await tg('answerCallbackQuery',{callback_query_id:cb.id,text:'غير مصرح لهذا الحساب',show_alert:true}); continue; }
        if(cb.data==='confirm_signal'){
          if(!currentSignal?.signalId){ await tg('answerCallbackQuery',{callback_query_id:cb.id,text:'لا توجد إشارة فعالة الآن',show_alert:true}); continue; }
          confirmedSignalId=String(currentSignal.signalId); rejectedSignalId=null;
          await tg('answerCallbackQuery',{callback_query_id:cb.id,text:'تم تأكيد الإشارة'});
          await sendDirect(cbChat,`✅ تم تأكيد الإشارة يدويًا\n${currentSignal.action} XAUUSD\nEntry: ${n(currentSignal.entryLow)} — ${n(currentSignal.entryHigh)}\nSL: ${n(currentSignal.stopLoss)}\nTP1: ${n(currentSignal.target1)}\nTP2: ${n(currentSignal.target2)}\nTP3: ${n(currentSignal.target3)}\nTP4: ${n(currentSignal.target4)}\n\nرقم الإشارة: ${currentSignal.signalId}\n\nالتنفيذ المالي لا يتم تلقائيًا من هذا الزر.`);
        } else if(cb.data==='reject_signal'){
          if(currentSignal?.signalId) rejectedSignalId=String(currentSignal.signalId);
          confirmedSignalId=null;
          await tg('answerCallbackQuery',{callback_query_id:cb.id,text:'تم رفض الإشارة'});
          await sendDirect(cbChat,'❌ تم رفض الإشارة الحالية ولن تعتبر مؤكدة.');
        }
      }
    }
  }catch(e){ console.error('[telegram-xau-bot] update poll failed',e?.message||e); }
}

async function resolveChatId() {
  if (CHAT_ID) return CHAT_ID;
  await processUpdates();
  return CHAT_ID;
}

async function telegram(text, replyMarkup=null) {
  if (!CHAT_ID) await resolveChatId();
  if (!CHAT_ID) return false;
  return sendDirect(CHAT_ID, text, replyMarkup);
}

function activeSignal(s) {
  return s && ['BUY', 'SELL'].includes(s.action) && s.status === 'ACTIVE' && s.signalId;
}

function candidateSide(s){
  return ['BUY','SELL'].includes(s?.candidateAction) ? s.candidateAction : null;
}

function candidateReady(s){
  const side=candidateSide(s);
  const confidence=Number(s?.confidence ?? s?.signalConfidence ?? 0);
  const levels=[s?.entryLow,s?.entryHigh,s?.stopLoss,s?.target1,s?.target2].every(v=>Number.isFinite(Number(v)));
  return Boolean(side && levels && confidence>=CANDIDATE_MIN_CONFIDENCE && s?.degraded!==true);
}

function candidateKey(s){
  const side=candidateSide(s)||'WAIT';
  return [side,s?.strategy||'',n(s?.entryLow,2),n(s?.entryHigh,2),n(s?.stopLoss,2),n(s?.target1,2)].join('|');
}

function candidateMessage(s){
  const side=candidateSide(s);
  const icon=side==='BUY'?'🟢':'🔴';
  return `🟡 XAUUSD — SETUP ARMED\n${icon} الاتجاه: ${side}\n\n📍 نطاق الدخول المتوقع:\n${n(s.entryLow)} — ${n(s.entryHigh)}\n🛑 SL: ${n(s.stopLoss)}\n🎯 TP1: ${n(s.target1)}\n🎯 TP2: ${n(s.target2)}\n\n📊 الثقة: ${Math.round(Number(s.confidence ?? s.signalConfidence ?? 0))}%\n🧠 الاستراتيجية: ${s.strategy || '—'}\n💵 السعر الحالي: ${money(s.price)}\n\nهذه تهيئة مبكرة وليست أمر دخول بعد. سيصلك تنبيه تنفيذي منفصل عند تفعيل النطاق.`;
}

async function signalMessage(s) {
  const icon = s.action === 'BUY' ? '🟢' : '🔴';
  let btc='';
  try{ const b=await fetchBitcoin(); btc=`\n\n₿ Bitcoin الآن: ${money(b.price)} • ${b.marketStatus||'—'}`; }catch{}
  return `${icon} XAUUSD — ${s.action}\n\n💵 السعر الحالي: ${money(s.price)}\n📍 الدخول:\nمن: ${n(s.entryHigh)}\nإلى: ${n(s.entryLow)}\n\n🎯 الأهداف:\nTP1: ${n(s.target1)}\nTP2: ${n(s.target2)}\nTP3: ${n(s.target3)}\nTP4: ${n(s.target4)}\n\n🛑 STOP LOSS:\n${n(s.stopLoss)}\n\n📊 الثقة: ${Math.round(Number(s.confidence || s.signalConfidence || 0))}%\n🕒 وقت الإشارة: ${new Date().toLocaleString()}\n📡 المصدر: ${s.provider || 'Capital.com'}${btc}\n\nاختر تأكيد أو رفض الإشارة:`;
}

function confirmKeyboard(){
  return {inline_keyboard:[[{
    text:'✅ تأكيد الإشارة',callback_data:'confirm_signal'
  },{
    text:'❌ رفض',callback_data:'reject_signal'
  }]]};
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
    await processUpdates();
    if (!CHAT_ID) return;

    const r = await fetch(AUTO_URL, {cache:'no-store', signal:AbortSignal.timeout(7000)});
    if (!r.ok) throw new Error(`signal ${r.status}`);
    const s = await r.json();

    if(candidateReady(s) && !activeSignal(s)){
      const key=candidateKey(s),now=Date.now();
      if(key!==lastCandidateKey || now-lastCandidateAt>=CANDIDATE_REPEAT_MS){
        await telegram(candidateMessage(s));
        lastCandidateKey=key;
        lastCandidateAt=now;
      }
    }

    if (activeSignal(s)) {
      currentSignal=s;
      if (sent.signalId !== s.signalId) {
        confirmedSignalId=null; rejectedSignalId=null;
        await telegram(await signalMessage(s),confirmKeyboard());
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
    } else {
      currentSignal=null;
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
