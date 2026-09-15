const AUTO_URL = process.env.TELEGRAM_SIGNAL_URL || 'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POLL_MS = Math.max(1500, Number(process.env.TELEGRAM_POLL_MS || 3000));
const EARLY_MIN_CONFIDENCE = Math.max(1, Number(process.env.TELEGRAM_EARLY_MIN_CONFIDENCE || 75));
const CANDIDATE_MIN_CONFIDENCE = Math.max(1, Number(process.env.TELEGRAM_CANDIDATE_MIN_CONFIDENCE || 75));
const REPEAT_MS = Math.max(30_000, Number(process.env.TELEGRAM_CANDIDATE_REPEAT_MS || 180_000));

let bootReady = false;
let bootAnnounced = false;
let currentSignal = null;
let lastEarlyKey = null;
let lastEarlyAt = 0;
let lastCandidateKey = null;
let lastCandidateAt = 0;
let terminalPrimed = false;
const sent = { signalId:null, targets:[false,false,false,false], terminalKey:null };

function validNumber(v){
  if(v === null || v === undefined || v === '') return false;
  const x = Number(v);
  return Number.isFinite(x) && x > 0;
}
function n(v,d=3){ return validNumber(v)?Number(v).toFixed(d):'—'; }
function money(v,d=2){ return validNumber(v)?'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—'; }

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

async function send(text){
  if(!CHAT_ID) throw new Error('TELEGRAM_CHAT_ID missing');
  await tg('sendMessage',{chat_id:CHAT_ID,text,disable_web_page_preview:true});
}

async function startup(){
  if(bootReady) return true;
  if(!BOT_TOKEN){ console.error('[telegram-xau-bot] TELEGRAM_BOT_TOKEN missing'); return false; }
  if(!CHAT_ID){ console.error('[telegram-xau-bot] TELEGRAM_CHAT_ID missing'); return false; }
  try{
    const me=await tg('getMe');
    console.log(`[telegram-xau-bot] send-only mode authenticated as @${me?.result?.username||'unknown'} chat=${CHAT_ID}`);
    bootReady=true;
    if(!bootAnnounced){
      await send('✅ Gold Alpha Telegram worker ACTIVE\n\n🥇 XAUUSD alerts are server-side and always-on.\n📊 EARLY threshold: 75%\n🟡 SETUP ARMED threshold: 75%\n🚫 getUpdates polling disabled to prevent 409 conflicts.');
      bootAnnounced=true;
    }
    return true;
  }catch(e){ console.error('[telegram-xau-bot] startup failed',e?.message||e); return false; }
}

function readSide(s){
  if(['BUY','SELL'].includes(s?.candidateAction)) return s.candidateAction;
  if(['BUY','SELL'].includes(s?.prediction?.side)) return s.prediction.side;
  if(['BUY','SELL'].includes(s?.side)) return s.side;
  if(['BUY','SELL'].includes(s?.action)) return s.action;
  return null;
}
function readConfidence(s){
  return Math.max(Number(s?.signalConfidence)||0,Number(s?.confidence)||0,Number(s?.prediction?.confidence)||0);
}
function activeSignal(s){ return Boolean(s?.signalId&&s?.status==='ACTIVE'&&['BUY','SELL'].includes(s?.candidateAction||s?.side||s?.action)); }
function levelsReady(s){
  const side = readSide(s);
  const vals = [s?.entryLow,s?.entryHigh,s?.stopLoss,s?.target1,s?.target2];
  if(!side || !vals.every(validNumber)) return false;
  const entryLow = Number(s.entryLow), entryHigh = Number(s.entryHigh), stop = Number(s.stopLoss), tp1 = Number(s.target1), tp2 = Number(s.target2);
  if(entryLow > entryHigh) return false;
  if(side === 'BUY') return stop < entryLow && tp1 > entryHigh && tp2 > tp1;
  if(side === 'SELL') return stop > entryHigh && tp1 < entryLow && tp2 < tp1;
  return false;
}
function earlyReady(s){ return Boolean(readSide(s)&&validNumber(s?.price)&&readConfidence(s)>=EARLY_MIN_CONFIDENCE&&s?.degraded!==true); }
function earlyKey(s){ return `${readSide(s)}|${Math.floor(readConfidence(s)/5)*5}`; }
function candidateReady(s){ return Boolean(readSide(s)&&levelsReady(s)&&readConfidence(s)>=CANDIDATE_MIN_CONFIDENCE&&s?.degraded!==true); }
function candidateKey(s){ return [readSide(s),s?.strategy||'',n(s?.entryLow,2),n(s?.entryHigh,2),n(s?.stopLoss,2),n(s?.target1,2)].join('|'); }
function terminalKey(t){ return t?.signalId&&t?.outcome?`${t.signalId}:${t.outcome}:${t.closedAtMs||t.closedAt||''}`:null; }

function earlyMessage(s){
  const side=readSide(s),conf=Math.round(readConfidence(s)),icon=side==='BUY'?'🟢':'🔴';
  return `⚡ XAUUSD — EARLY ${side}\n${icon} اتجاه القراءة: ${side}\n📊 الثقة: ${conf}%\n💵 السعر: ${money(s.price)}\n🧠 الحالة: ${s.status||'READING'}\n\nوصلت القراءة إلى حد 75%. هذه قراءة مبكرة وليست دخولًا نهائيًا.`;
}
function candidateMessage(s){
  const side=readSide(s),icon=side==='BUY'?'🟢':'🔴';
  return `🟡 XAUUSD — SETUP ARMED\n${icon} الاتجاه: ${side}\n📍 نطاق الدخول: ${n(s.entryLow)} — ${n(s.entryHigh)}\n🛑 SL: ${n(s.stopLoss)}\n🎯 TP1: ${n(s.target1)}\n🎯 TP2: ${n(s.target2)}\n📊 الثقة: ${Math.round(readConfidence(s))}%\n🧠 الاستراتيجية: ${s.strategy||'—'}\n💵 السعر: ${money(s.price)}\n\nالتهيئة مكتملة؛ انتظر تفعيل النطاق.`;
}
function signalMessage(s){
  const side=s.side||s.candidateAction||s.action,icon=side==='BUY'?'🟢':'🔴';
  return `${icon} XAUUSD — ${side} ACTIVE\n💵 السعر الحالي: ${money(s.price)}\n📍 الدخول: ${n(s.entryLow)} — ${n(s.entryHigh)}\n🛑 SL: ${n(s.stopLoss)}\n🎯 TP1: ${n(s.target1)}\n🎯 TP2: ${n(s.target2)}\n🎯 TP3: ${n(s.target3)}\n🎯 TP4: ${n(s.target4)}\n📊 الثقة: ${Math.round(readConfidence(s))}%\n🕒 ${new Date().toLocaleString()}`;
}
function tpMessage(i,price){ return `✅ XAUUSD — TP${i+1} HIT\n🎯 TP${i+1}: ${n(price)}`; }

async function tick(){
  try{
    if(!(await startup())) return;
    const r=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});
    if(!r.ok) throw new Error(`signal ${r.status}`);
    const s=await r.json();
    const now=Date.now();

    if(earlyReady(s)&&!activeSignal(s)){
      const key=earlyKey(s);
      if(key!==lastEarlyKey||now-lastEarlyAt>=REPEAT_MS){
        await send(earlyMessage(s));
        lastEarlyKey=key; lastEarlyAt=now;
      }
    }else if(readConfidence(s)<EARLY_MIN_CONFIDENCE){
      lastEarlyKey=null;
    }

    if(candidateReady(s)&&!activeSignal(s)){
      const key=candidateKey(s);
      if(key!==lastCandidateKey||now-lastCandidateAt>=REPEAT_MS){
        await send(candidateMessage(s));
        lastCandidateKey=key; lastCandidateAt=now;
      }
    }else if(!levelsReady(s)){
      lastCandidateKey=null;
    }

    if(activeSignal(s)&&levelsReady(s)){
      currentSignal=s;
      if(sent.signalId!==s.signalId){
        await send(signalMessage(s));
        sent.signalId=s.signalId;
        sent.targets=[false,false,false,false];
      }
      const hits=Array.isArray(s.targetHits)?s.targetHits:[];
      const targets=[s.target1,s.target2,s.target3,s.target4];
      for(let i=0;i<4;i++) if(hits[i]&&!sent.targets[i]&&validNumber(targets[i])){ await send(tpMessage(i,targets[i])); sent.targets[i]=true; }
    }else currentSignal=null;

    const t=s.terminalEvent,key=terminalKey(t);
    if(!terminalPrimed){
      sent.terminalKey=key;
      terminalPrimed=true;
    }else if(key&&key!==sent.terminalKey){
      const belongsToAnnouncedSignal = Boolean(sent.signalId && t?.signalId === sent.signalId);
      if(!belongsToAnnouncedSignal){
        // Never announce SL/TP completion for a scenario that was not first announced as ACTIVE.
        sent.terminalKey=key;
      }else{
        if(t.outcome==='SL'&&validNumber(t.stopLoss)&&validNumber(t.exitPrice)) await send(`🛑 XAUUSD — STOP LOSS HIT\nSL: ${n(t.stopLoss)}\nExit: ${n(t.exitPrice)}`);
        else if(t.outcome==='TP4'&&validNumber(t.target4)) await send(`🏁 XAUUSD — ALL TARGETS COMPLETED\nTP4: ${n(t.target4)}`);
        else if(t.outcome==='PREENTRY_INVALIDATED') await send('⚪ XAUUSD — SETUP CANCELLED BEFORE ENTRY\nالسيناريو فقد صلاحيته قبل تنفيذ الدخول.');
        else if(t.outcome==='EXPIRED') await send('⌛ XAUUSD — SETUP EXPIRED\nانتهت صلاحية السيناريو بدون دخول.');
        sent.terminalKey=key;
      }
    }
  }catch(e){
    console.error('[telegram-xau-bot]',e?.message||e);
  }
}

console.log(`[telegram-xau-bot] ${BOT_TOKEN&&CHAT_ID?'send-only worker enabled':'disabled: token/chat id missing'}`);
(async function loop(){ while(true){ await tick(); await new Promise(r=>setTimeout(r,POLL_MS)); } })();
