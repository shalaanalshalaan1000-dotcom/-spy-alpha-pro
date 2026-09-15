const AUTO_URL = process.env.TELEGRAM_SIGNAL_URL || 'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POLL_MS = Math.max(1500, Number(process.env.TELEGRAM_POLL_MS || 3000));

let bootReady = false;
let bootAnnounced = false;
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
      await send('✅ Gold Alpha Telegram worker ACTIVE\n\n🥇 XAUUSD alerts are server-side and always-on.\n✅ CONFIRMED ENTRY alerts only.\n🚫 EARLY and SETUP ARMED alerts are disabled.');
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
function activeSignal(s){
  return Boolean(
    s?.signalId &&
    ['ACTIVE','MANAGING'].includes(s?.status) &&
    ['BUY','SELL'].includes(s?.candidateAction||s?.side||s?.action)
  );
}
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
function terminalKey(t){ return t?.signalId&&t?.outcome?`${t.signalId}:${t.outcome}:${t.closedAtMs||t.closedAt||''}`:null; }

function signalMessage(s){
  const side=s.side||s.candidateAction||s.action,icon=side==='BUY'?'🟢':'🔴';
  return `${icon} XAUUSD — CONFIRMED ${side} ENTRY\n🆔 ${s.signalId}\n💵 السعر الحالي: ${money(s.price)}\n📍 الدخول: ${n(s.entryLow)} — ${n(s.entryHigh)}\n🛑 SL: ${n(s.stopLoss)}\n🎯 TP1: ${n(s.target1)}\n🎯 TP2: ${n(s.target2)}\n🎯 TP3: ${n(s.target3)}\n🎯 TP4: ${n(s.target4)}\n📊 الثقة: ${Math.round(readConfidence(s))}%\n🕒 ${new Date().toLocaleString()}`;
}
function tpMessage(i,price){ return `✅ XAUUSD — TP${i+1} HIT\n🎯 TP${i+1}: ${n(price)}`; }

async function tick(){
  try{
    if(!(await startup())) return;
    const r=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});
    if(!r.ok) throw new Error(`signal ${r.status}`);
    const s=await r.json();

    if(activeSignal(s)&&levelsReady(s)){
      if(sent.signalId!==s.signalId){
        await send(signalMessage(s));
        sent.signalId=s.signalId;
        sent.targets=[false,false,false,false];
      }
      const hits=Array.isArray(s.targetHits)?s.targetHits:[];
      const targets=[s.target1,s.target2,s.target3,s.target4];
      for(let i=0;i<4;i++) if(hits[i]&&!sent.targets[i]&&validNumber(targets[i])){ await send(tpMessage(i,targets[i])); sent.targets[i]=true; }
    }

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
        sent.signalId=null;
        sent.targets=[false,false,false,false];
      }
    }
  }catch(e){
    console.error('[telegram-xau-bot]',e?.message||e);
  }
}

console.log(`[telegram-xau-bot] ${BOT_TOKEN&&CHAT_ID?'send-only worker enabled':'disabled: token/chat id missing'}`);
if(process.env.NODE_ENV!=='test'){
  (async function loop(){ while(true){ await tick(); await new Promise(r=>setTimeout(r,POLL_MS)); } })();
}

export { activeSignal, levelsReady, signalMessage };
