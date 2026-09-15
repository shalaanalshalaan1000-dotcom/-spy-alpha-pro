const AUTO_URL=process.env.TELEGRAM_SIGNAL_URL||'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const CHAT_ID=String(process.env.TELEGRAM_CHAT_ID||'').trim();
const POLL_MS=Math.max(1200,Number(process.env.TELEGRAM_POLL_MS||1500));
const MAX_NEW_SIGNAL_AGE_MS=Math.max(2000,Number(process.env.TELEGRAM_MAX_NEW_SIGNAL_AGE_MS||6000));
const SIGNAL_THRESHOLD=Math.max(1,Math.min(100,Number(process.env.TELEGRAM_DIRECTIONAL_MIN_CONFIDENCE||75)));

let ready=false,bootAnnounced=false,terminalPrimed=false;
const sent={signalId:null,announced:false,announcedAtMs:0,targets:[false,false,false,false],managementEventId:0,terminalKey:null,directionalSide:null,directionalAbove:false,directionalAtMs:0};

function num(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function valid(v){const x=num(v);return x!=null&&x>0;}
function n(v,d=3){return valid(v)?Number(v).toFixed(d):'—';}
function money(v,d=2){return valid(v)?'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';}
function sideOf(s){return ['BUY','SELL'].find(x=>[s?.side,s?.candidateAction,s?.action].includes(x))||null;}
function directionalSide(s){return sideOf(s)||(['BUY','SELL'].includes(s?.entryGuard?.side)?s.entryGuard.side:null)||(['BUY','SELL'].includes(s?.prediction?.side)?s.prediction.side:null);}
function directionalConfidence(s){return Math.max(Number(s?.signalConfidence)||0,Number(s?.confidence)||0,Number(s?.prediction?.confidence)||0);}
function issuedMs(s){const direct=num(s?.issuedAtMs);if(direct&&direct>0)return direct;const p=Date.parse(String(s?.issuedAt||''));return Number.isFinite(p)?p:Date.now();}
async function tg(method,body=null){
 if(!BOT_TOKEN)throw new Error('TELEGRAM_BOT_TOKEN missing');
 const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(8000)});
 const d=await r.json().catch(()=>({}));if(!r.ok||d?.ok===false)throw new Error(`${method} ${r.status} ${d?.description||''}`.trim());return d;
}
async function send(text){if(!CHAT_ID)throw new Error('TELEGRAM_CHAT_ID missing');await tg('sendMessage',{chat_id:CHAT_ID,text,disable_web_page_preview:true});}
async function startup(){
 if(ready)return true;
 if(!BOT_TOKEN||!CHAT_ID){console.error('[telegram-xau-v2] token/chat missing');return false;}
 try{
  const me=await tg('getMe');ready=true;console.log(`[telegram-xau-v2] authenticated @${me?.result?.username||'unknown'} chat=${CHAT_ID}`);
  if(!bootAnnounced){await send(`✅ Gold Alpha Telegram ACTIVE\n\n🥇 XAUUSD directional signal starts at ${SIGNAL_THRESHOLD}% confidence.\n📍 Confirmed entry alerts remain separate when executable levels pass.\n🛡️ Managed trade mode ACTIVE for confirmed entries.`);bootAnnounced=true;}
  return true;
 }catch(e){console.error('[telegram-xau-v2] startup',e?.message||e);return false;}
}
function active(s){return Boolean(s?.signalId&&['ACTIVE','MANAGING'].includes(s?.status)&&['BUY','SELL'].includes(sideOf(s)));}
function levelsReady(s){
 const side=sideOf(s),lo=num(s?.entryLow),hi=num(s?.entryHigh),sl=num(s?.stopLoss),t1=num(s?.target1),t2=num(s?.target2);
 if(!side||[lo,hi,sl,t1,t2].some(x=>x==null)||lo>hi)return false;
 return side==='BUY'?sl<Math.max(hi,t1)&&t1>hi&&t2>t1:sl>Math.min(lo,t1)&&t1<lo&&t2<t1;
}
function viability(s,now=Date.now()){
 const side=sideOf(s),price=side==='BUY'?num(s?.ask??s?.price):num(s?.bid??s?.price),sl=num(s?.originalStopLoss??s?.stopLoss),tp1=num(s?.target1),lo=num(s?.entryLow),hi=num(s?.entryHigh);
 const age=Math.max(0,now-issuedMs(s));if(!side||[price,sl,tp1,lo,hi].some(x=>x==null))return{ok:false,reason:'INVALID_LEVELS'};
 if(age>MAX_NEW_SIGNAL_AGE_MS)return{ok:false,reason:'STALE',age};
 if(price<Math.min(lo,hi)||price>Math.max(lo,hi))return{ok:false,reason:'LEFT_ENTRY_ZONE',age};
 const risk=side==='BUY'?price-sl:sl-price,reward=side==='BUY'?tp1-price:price-tp1,rr=risk>0?reward/risk:0;
 const p=s?.volatilityPolicy||{},minRisk=num(p.minRisk)??.7,minTp1=num(p.minTp1Usd)??.75,minR=num(p.minTp1R)??1.2,maxRisk=num(p.maxRisk)??5;
 if(risk<minRisk)return{ok:false,reason:'RISK_TOO_TIGHT',risk,reward,rr};
 if(risk>maxRisk)return{ok:false,reason:'RISK_TOO_WIDE',risk,reward,rr};
 if(reward<minTp1)return{ok:false,reason:'TP1_TOO_CLOSE',risk,reward,rr};
 if(rr<minR)return{ok:false,reason:'RR_TOO_LOW',risk,reward,rr};
 return{ok:true,age,risk,reward,rr};
}
function directionMessage(s){
 const side=directionalSide(s),confidence=Math.round(directionalConfidence(s)),icon=side==='BUY'?'🟢':'🔴',g=s?.entryGuard||{},room=num(g.rewardToTp1),rr=num(g.liveTp1R),price=num(s?.price);
 const details=[];if(room!=null)details.push(`الحركة المقدرة إلى TP1: ${room.toFixed(2)}$`);if(rr!=null)details.push(`RR الحالي: ${rr.toFixed(2)}R`);
 return `${icon} XAUUSD — ${side} SIGNAL\n📊 الثقة: ${confidence}%\n💵 السعر: ${money(price)}\n⚡ حد الإشارة: ${SIGNAL_THRESHOLD}%${details.length?'\n'+details.join('\n'):''}\nℹ️ هذه إشارة اتجاهية؛ رسالة CONFIRMED ENTRY تصل منفصلة إذا اعتمد محرك التنفيذ مستويات الدخول.`;
}
function entryMessage(s){
 const side=sideOf(s),icon=side==='BUY'?'🟢':'🔴',v=viability(s),at=issuedMs(s);
 const time=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date(at));
 const p=s?.volatilityPolicy||{};
 return `${icon} XAUUSD — CONFIRMED ${side} ENTRY\n🆔 ${s.signalId}\n💵 السعر الحالي: ${money(s.price)}\n📍 الدخول: ${n(s.entryLow)} — ${n(s.entryHigh)}\n🛑 SL: ${n(s.originalStopLoss??s.stopLoss)}\n🎯 TP1: ${n(s.target1)}\n🎯 TP2: ${n(s.target2)}\n🎯 TP3: ${n(s.target3)}\n🎯 TP4: ${n(s.target4)}\n📊 درجة الإشارة: ${Math.round(Number(s.signalConfidence??s.confidence??0))}/100\n🛡️ TP1 room: ${Number(v.rr).toFixed(2)}R / ${Number(v.reward).toFixed(2)}$\n🌊 ATR1: ${num(p.atr1)!=null?Number(p.atr1).toFixed(2):'—'}$\n🕒 ${time} بتوقيت السعودية`;
}
function tpMessage(i,p){return `✅ XAUUSD — TP${i+1} HIT\n🎯 TP${i+1}: ${n(p)}`;}
function managementMessage(s,e){
 const labels={1:'TP1 → حماية Structure',2:'TP2 → تثبيت ربح',3:'TP3 → M1 Trailing'};
 return `🛡️ XAUUSD — TRADE MANAGEMENT\n${labels[e.stage]||`Stage ${e.stage}`}\n🛑 SL الجديد: ${n(e.newStop)}\n📍 SL الأصلي: ${n(s.originalStopLoss)}\n🌊 ATR1: ${num(e?.policy?.atr1)!=null?Number(e.policy.atr1).toFixed(2):'—'}$`;
}
function terminalKey(t){return t?.signalId&&t?.outcome?`${t.signalId}:${t.outcome}:${t.closedAtMs||t.closedAt||''}`:null;}
function terminalMessage(t){
 if(t.outcome==='TP4')return `🏁 XAUUSD — ALL TARGETS COMPLETED\nTP4: ${n(t.target4)}\n📈 Result: ${Number(t.realizedR??0).toFixed(2)}R`;
 if(t.outcome==='MANAGED_STOP'){
  const icon=t.result==='WIN'?'✅':t.result==='BREAKEVEN'?'⚪':'🛑';
  return `${icon} XAUUSD — MANAGED EXIT\nExit: ${n(t.exitPrice)}\nManaged SL: ${n(t.stopLoss)}\nResult: ${t.result||'—'}\nR: ${Number(t.realizedR??0).toFixed(2)}R\nMove: ${Number(t.realizedUsd??0).toFixed(2)}$`;
 }
 if(t.outcome==='SL')return `🛑 XAUUSD — STOP LOSS HIT\nSL: ${n(t.stopLoss)}\nExit: ${n(t.exitPrice)}\nResult: ${Number(t.realizedR??-1).toFixed(2)}R`;
 return null;
}
async function tick(){
 try{
  if(!(await startup()))return;
  const r=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)throw new Error(`signal ${r.status}`);const s=await r.json();const now=Date.now();
  const dSide=directionalSide(s),dConfidence=directionalConfidence(s),directionalOk=!s?.degraded&&Boolean(dSide)&&dConfidence>=SIGNAL_THRESHOLD&&String(s?.status||'').toUpperCase()!=='COLLECTING';
  if(directionalOk&&(!sent.directionalAbove||sent.directionalSide!==dSide)){
    await send(directionMessage(s));sent.directionalAbove=true;sent.directionalSide=dSide;sent.directionalAtMs=now;
  }else if(!directionalOk&&dConfidence<=SIGNAL_THRESHOLD-3){sent.directionalAbove=false;sent.directionalSide=null;}
  if(active(s)&&levelsReady(s)){
   if(sent.signalId!==s.signalId){
    sent.signalId=s.signalId;sent.announced=false;sent.announcedAtMs=0;sent.targets=[false,false,false,false];sent.managementEventId=0;
    const v=viability(s,now),alreadyHit=Array.isArray(s.targetHits)&&s.targetHits.some(Boolean);
    if(v.ok&&!alreadyHit){await send(entryMessage(s));sent.announced=true;sent.announcedAtMs=Date.now();}
    else console.warn(`[telegram-xau-v2] skipped ${s.signalId} ${alreadyHit?'TARGET_ALREADY_HIT':v.reason}`);
   }
   if(sent.announced){
    const hits=Array.isArray(s.targetHits)?s.targetHits:[],times=Array.isArray(s.targetHitAt)?s.targetHitAt:[],targets=[s.target1,s.target2,s.target3,s.target4];
    for(let i=0;i<4;i++){const ht=num(times[i]);if(hits[i]&&!sent.targets[i]&&valid(targets[i])&&ht!=null&&ht>=sent.announcedAtMs){await send(tpMessage(i,targets[i]));sent.targets[i]=true;}}
    const e=s.lastManagementEvent,id=num(e?.id)||0;if(e&&id>sent.managementEventId&&num(e.atMs)>=sent.announcedAtMs){await send(managementMessage(s,e));sent.managementEventId=id;}
   }
  }
  const t=s.terminalEvent,key=terminalKey(t);
  if(!terminalPrimed){sent.terminalKey=key;terminalPrimed=true;}
  else if(key&&key!==sent.terminalKey){
   if(sent.announced&&sent.signalId===t?.signalId){const msg=terminalMessage(t);if(msg)await send(msg);sent.signalId=null;sent.announced=false;sent.targets=[false,false,false,false];sent.managementEventId=0;}
   sent.terminalKey=key;
  }
 }catch(e){console.error('[telegram-xau-v2]',e?.message||e);}
}
console.log(`[telegram-xau-v2] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} directional>=${SIGNAL_THRESHOLD}`);
if(process.env.NODE_ENV!=='test')(async function loop(){while(true){await tick();await new Promise(r=>setTimeout(r,POLL_MS));}})();

export {active,levelsReady,viability,directionMessage,entryMessage,terminalMessage};
