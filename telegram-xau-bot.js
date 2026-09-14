const AUTO_URL = process.env.TELEGRAM_SIGNAL_URL || 'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BITCOIN_URL = process.env.TELEGRAM_BITCOIN_URL || 'http://127.0.0.1:3004/api/capital/bitcoin';
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
let CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POLL_MS = Math.max(1500, Number(process.env.TELEGRAM_POLL_MS || 3000));
const EARLY_MIN_CONFIDENCE = Math.max(1, Number(process.env.TELEGRAM_EARLY_MIN_CONFIDENCE || 70));
const CANDIDATE_MIN_CONFIDENCE = Math.max(1, Number(process.env.TELEGRAM_CANDIDATE_MIN_CONFIDENCE || process.env.MIN_CONFIDENCE || 55));
const REPEAT_MS = Math.max(30_000, Number(process.env.TELEGRAM_CANDIDATE_REPEAT_MS || 180_000));

let updateOffset = 0;
let bootReady = false;
let boundAnnounced = false;
let currentSignal = null;
let lastEarlyKey = null;
let lastEarlyAt = 0;
let lastCandidateKey = null;
let lastCandidateAt = 0;

const sent = { signalId:null, targets:[false,false,false,false], terminalKey:null };

function n(v,d=3){ const x=Number(v); return Number.isFinite(x)?x.toFixed(d):'—'; }
function money(v,d=2){ const x=Number(v); return Number.isFinite(x)?'$'+x.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—'; }

async function tg(method,body=null){
  if(!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:body?'POST':'GET',
    headers:body?{'content-type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,
    cache:'no-store',
    signal:AbortSignal.timeout(8000)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.ok===false) throw new Error(`${method} ${r.status} ${d?.description||''}`.trim());
  return d;
}

async function sendDirect(chatId,text,replyMarkup=null){
  if(!chatId) return false;
  const body={chat_id:chatId,text,disable_web_page_preview:true};
  if(replyMarkup) body.reply_markup=replyMarkup;
  await tg('sendMessage',body);
  return true;
}

async function startup(){
  if(bootReady) return true;
  if(!BOT_TOKEN){ console.error('[telegram-xau-bot] TELEGRAM_BOT_TOKEN missing'); return false; }
  try{
    const me=await tg('getMe');
    console.log(`[telegram-xau-bot] authenticated as @${me?.result?.username||'unknown'}`);
    await tg('deleteWebhook',{drop_pending_updates:false});
    bootReady=true;
    return true;
  }catch(e){ console.error('[telegram-xau-bot] startup failed',e?.message||e); return false; }
}

async function announceBound(chatId){
  if(!chatId||boundAnnounced) return;
  await sendDirect(chatId,'✅ تم ربط البوت بمنصة Gold Alpha Pro.\n\n🥇 سيرسل تنبيهًا مبكرًا فور وصول قراءة الذهب إلى 70% مع اتجاه BUY/SELL، ثم SETUP ARMED عند اكتمال النطاق، ثم الإشارة التنفيذية عند التفعيل.');
  boundAnnounced=true;
}

async function fetchBitcoin(){
  const r=await fetch(BITCOIN_URL+(BITCOIN_URL.includes('?')?'&':'?')+'force=1',{cache:'no-store',signal:AbortSignal.timeout(7000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!Number.isFinite(Number(d?.price))) throw new Error(d?.error||`bitcoin ${r.status}`);
  return d;
}

function bitcoinMessage(b){
  return `₿ BTCUSD — Capital.com LIVE\n\n💵 السعر: ${money(b.price)}\nBid: ${money(b.bid)}\nAsk: ${money(b.ask)}\n📈 السوق: ${b.marketStatus||'—'}\n🕒 التحديث: ${b.updatedAt?new Date(b.updatedAt).toLocaleString():'—'}`;
}

async function processUpdates(){
  if(!(await startup())) return;
  try{
    const u=new URL(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
    u.searchParams.set('timeout','0');
    if(updateOffset) u.searchParams.set('offset',String(updateOffset));
    const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(8000)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d?.ok===false) throw new Error(`getUpdates ${r.status} ${d?.description||''}`.trim());
    for(const row of Array.isArray(d.result)?d.result:[]){
      updateOffset=Math.max(updateOffset,Number(row.update_id||0)+1);
      const msg=row.message||row.edited_message||null;
      const chat=msg?.chat;
      if(chat?.type==='private'&&!CHAT_ID){ CHAT_ID=String(chat.id); await announceBound(CHAT_ID); }
      if(msg?.text&&chat?.type==='private'){
        const text=String(msg.text).trim().toLowerCase();
        if(text==='/start') await announceBound(String(chat.id));
        if(text==='/bitcoin'||text==='/btc'){
          try{ await sendDirect(String(chat.id),bitcoinMessage(await fetchBitcoin())); }
          catch(e){ await sendDirect(String(chat.id),`⚠️ تعذر جلب Bitcoin الآن: ${String(e?.message||e)}`); }
        }
      }
      const cb=row.callback_query;
      if(cb){
        const cbChat=String(cb.message?.chat?.id||'');
        if(!CHAT_ID&&cbChat) CHAT_ID=cbChat;
        if(cb.data==='confirm_signal'){
          await tg('answerCallbackQuery',{callback_query_id:cb.id,text:currentSignal?.signalId?'تم تأكيد الإشارة':'لا توجد إشارة فعالة الآن',show_alert:!currentSignal?.signalId});
          if(currentSignal?.signalId) await sendDirect(cbChat,`✅ تم تأكيد الإشارة يدويًا\n${currentSignal.side||currentSignal.action} XAUUSD\nEntry: ${n(currentSignal.entryLow)} — ${n(currentSignal.entryHigh)}\nSL: ${n(currentSignal.stopLoss)}\nTP1: ${n(currentSignal.target1)}\nTP2: ${n(currentSignal.target2)}\nTP3: ${n(currentSignal.target3)}\nTP4: ${n(currentSignal.target4)}`);
        }else if(cb.data==='reject_signal'){
          await tg('answerCallbackQuery',{callback_query_id:cb.id,text:'تم رفض الإشارة'});
          await sendDirect(cbChat,'❌ تم رفض الإشارة الحالية.');
        }
      }
    }
  }catch(e){ console.error('[telegram-xau-bot] update poll failed',e?.message||e); }
}

async function telegram(text,replyMarkup=null){
  if(!CHAT_ID) await processUpdates();
  if(!CHAT_ID) return false;
  return sendDirect(CHAT_ID,text,replyMarkup);
}

function readSide(s){
  if(['BUY','SELL'].includes(s?.candidateAction)) return s.candidateAction;
  if(['BUY','SELL'].includes(s?.prediction?.side)) return s.prediction.side;
  if(['BUY','SELL'].includes(s?.side)) return s.side;
  if(['BUY','SELL'].includes(s?.action)) return s.action;
  return null;
}
function readConfidence(s){
  return Math.max(
    Number(s?.signalConfidence)||0,
    Number(s?.confidence)||0,
    Number(s?.prediction?.confidence)||0
  );
}
function activeSignal(s){ return Boolean(s?.signalId&&s?.status==='ACTIVE'&&['BUY','SELL'].includes(s?.candidateAction||s?.side||s?.action)); }
function levelsReady(s){ return [s?.entryLow,s?.entryHigh,s?.stopLoss,s?.target1,s?.target2].every(v=>Number.isFinite(Number(v))); }

function earlyReady(s){ return Boolean(readSide(s)&&readConfidence(s)>=EARLY_MIN_CONFIDENCE&&s?.degraded!==true); }
function earlyKey(s){ return `${readSide(s)}|${Math.floor(readConfidence(s)/5)*5}`; }
function earlyMessage(s){
  const side=readSide(s),conf=Math.round(readConfidence(s)),icon=side==='BUY'?'🟢':'🔴';
  return `⚡ XAUUSD — EARLY ${side}\n${icon} اتجاه القراءة: ${side}\n📊 الثقة: ${conf}%\n💵 السعر: ${money(s.price)}\n🧠 الحالة: ${s.status||'READING'}\n\nوصلت القراءة إلى حد التنبيه 70%. هذه قراءة مبكرة وليست دخولًا نهائيًا؛ عند اكتمال نطاق الدخول سيصلك SETUP ARMED.`;
}

function candidateReady(s){ return Boolean(readSide(s)&&levelsReady(s)&&readConfidence(s)>=CANDIDATE_MIN_CONFIDENCE&&s?.degraded!==true); }
function candidateKey(s){ return [readSide(s),s?.strategy||'',n(s?.entryLow,2),n(s?.entryHigh,2),n(s?.stopLoss,2),n(s?.target1,2)].join('|'); }
function candidateMessage(s){
  const side=readSide(s),icon=side==='BUY'?'🟢':'🔴';
  return `🟡 XAUUSD — SETUP ARMED\n${icon} الاتجاه: ${side}\n📍 نطاق الدخول: ${n(s.entryLow)} — ${n(s.entryHigh)}\n🛑 SL: ${n(s.stopLoss)}\n🎯 TP1: ${n(s.target1)}\n🎯 TP2: ${n(s.target2)}\n📊 الثقة: ${Math.round(readConfidence(s))}%\n🧠 الاستراتيجية: ${s.strategy||'—'}\n💵 السعر: ${money(s.price)}\n\nالتهيئة مكتملة؛ سيصلك تنبيه تنفيذي منفصل عند تفعيل النطاق.`;
}

function confirmKeyboard(){ return {inline_keyboard:[[{text:'✅ تأكيد الإشارة',callback_data:'confirm_signal'},{text:'❌ رفض',callback_data:'reject_signal'}]]}; }
function signalMessage(s){
  const side=s.side||s.candidateAction||s.action,icon=side==='BUY'?'🟢':'🔴';
  return `${icon} XAUUSD — ${side}\n💵 السعر الحالي: ${money(s.price)}\n📍 الدخول: ${n(s.entryLow)} — ${n(s.entryHigh)}\n🛑 SL: ${n(s.stopLoss)}\n🎯 TP1: ${n(s.target1)}\n🎯 TP2: ${n(s.target2)}\n🎯 TP3: ${n(s.target3)}\n🎯 TP4: ${n(s.target4)}\n📊 الثقة: ${Math.round(readConfidence(s))}%\n🕒 ${new Date().toLocaleString()}\n\nاختر تأكيد أو رفض الإشارة:`;
}
function tpMessage(i,price){ return `✅ XAUUSD — TP${i+1} HIT\n🎯 TP${i+1}: ${n(price)}`; }
function terminalKey(t){ return t?.signalId&&t?.outcome?`${t.signalId}:${t.outcome}:${t.closedAtMs||t.closedAt||''}`:null; }

async function tick(){
  try{
    if(!(await startup())) return;
    await processUpdates();
    if(!CHAT_ID) return;
    const r=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});
    if(!r.ok) throw new Error(`signal ${r.status}`);
    const s=await r.json();
    const now=Date.now();

    if(earlyReady(s)&&!activeSignal(s)){
      const key=earlyKey(s);
      if(key!==lastEarlyKey||now-lastEarlyAt>=REPEAT_MS){
        await telegram(earlyMessage(s));
        lastEarlyKey=key; lastEarlyAt=now;
      }
    }else if(readConfidence(s)<EARLY_MIN_CONFIDENCE){
      lastEarlyKey=null;
    }

    if(candidateReady(s)&&!activeSignal(s)){
      const key=candidateKey(s);
      if(key!==lastCandidateKey||now-lastCandidateAt>=REPEAT_MS){
        await telegram(candidateMessage(s));
        lastCandidateKey=key; lastCandidateAt=now;
      }
    }

    if(activeSignal(s)){
      currentSignal=s;
      if(sent.signalId!==s.signalId){
        await telegram(signalMessage(s),confirmKeyboard());
        sent.signalId=s.signalId;
        sent.targets=[false,false,false,false];
      }
      const hits=Array.isArray(s.targetHits)?s.targetHits:[];
      const targets=[s.target1,s.target2,s.target3,s.target4];
      for(let i=0;i<4;i++) if(hits[i]&&!sent.targets[i]){ await telegram(tpMessage(i,targets[i])); sent.targets[i]=true; }
    }else currentSignal=null;

    const t=s.terminalEvent,key=terminalKey(t);
    if(key&&key!==sent.terminalKey){
      if(t.outcome==='SL') await telegram(`🛑 XAUUSD — STOP LOSS HIT\nSL: ${n(t.stopLoss)}\nExit: ${n(t.exitPrice)}`);
      if(t.outcome==='TP4') await telegram(`🏁 XAUUSD — ALL TARGETS COMPLETED\nTP4: ${n(t.target4)}`);
      sent.terminalKey=key;
    }
  }catch(e){ console.error('[telegram-xau-bot]',e?.message||e); }
}

console.log(`[telegram-xau-bot] ${BOT_TOKEN?(CHAT_ID?'enabled with configured chat':'enabled; waiting for first private message'):'disabled: TELEGRAM_BOT_TOKEN missing'}`);
(async function loop(){ while(true){ await tick(); await new Promise(r=>setTimeout(r,POLL_MS)); } })();
