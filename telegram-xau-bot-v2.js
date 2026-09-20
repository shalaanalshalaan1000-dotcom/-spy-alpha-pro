const AUTO_URL=process.env.TELEGRAM_SIGNAL_URL||'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const CHAT_ID=String(process.env.TELEGRAM_CHAT_ID||'').trim();
const POLL_MS=Math.max(1200,Number(process.env.TELEGRAM_POLL_MS||1500));
const EDIT_MIN_MS=Math.max(3000,Number(process.env.TELEGRAM_EDIT_MIN_MS||5000));
const RECENT_KEY_TTL_MS=Math.max(60_000,Number(process.env.TELEGRAM_RECENT_SIGNAL_TTL_MS||600_000));
const CONFIRM_ON_5M_CLOSE=String(process.env.TELEGRAM_CONFIRM_ON_5M_CLOSE||'true').toLowerCase()!=='false';
const FIVE_MIN_MS=300_000;
const BOOT_MS=Date.now();
const XAU_CONTRACT_SIZE=Math.max(1,Number(process.env.XAU_CONTRACT_SIZE||100));
const XAU_LOT_STEP=Math.max(.001,Number(process.env.XAU_LOT_STEP||.01));
const XAU_ACCOUNT_BALANCE_USD=Math.max(1,Number(process.env.XAU_ACCOUNT_BALANCE_USD||155));
const XAU_SAFE_RISK_USD=Math.max(1,Number(process.env.XAU_SAFE_RISK_USD||5));
const XAU_MAX_RISK_USD=Math.max(XAU_SAFE_RISK_USD,Number(process.env.XAU_MAX_RISK_USD||10));
const BOOT_GRACE_MS=15_000;

let ready=false;
const sent={side:null,key:null,above:false,messageId:null,lastText:null,lastEditMs:0,announcedAtMs:0,targets:[false,false,false,false]};
const tradeLock={active:false,key:null,side:null,startedAtMs:0};
const recentKeys=new Map();

function num(v){if(v==null||v===''||typeof v==='boolean')return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function valid(v){const x=num(v);return x!=null&&x>0;}
function n(v,d=3){return valid(v)?Number(v).toFixed(d):'—';}
function money(v,d=2){return valid(v)?'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';}
function lotForRisk(entry,sl,riskUsd){const distance=Math.abs(Number(entry)-Number(sl));if(!(distance>0)||!(riskUsd>0))return null;const raw=riskUsd/(distance*XAU_CONTRACT_SIZE);if(!(raw>0))return null;const stepped=Math.floor((raw+1e-12)/XAU_LOT_STEP)*XAU_LOT_STEP;return stepped>=XAU_LOT_STEP?Number(stepped.toFixed(3)):0;}
function lotSizingLines(entry,sl){const distance=Math.abs(Number(entry)-Number(sl));if(!(distance>0))return [];const safeLot=lotForRisk(entry,sl,XAU_SAFE_RISK_USD),maxLot=lotForRisk(entry,sl,XAU_MAX_RISK_USD),minLotRisk=distance*XAU_CONTRACT_SIZE*XAU_LOT_STEP;const safePct=XAU_SAFE_RISK_USD/XAU_ACCOUNT_BALANCE_USD*100,maxPct=XAU_MAX_RISK_USD/XAU_ACCOUNT_BALANCE_USD*100;const fmt=lot=>lot&&lot>0?`${lot.toFixed(2)} lot`:`أقل من ${XAU_LOT_STEP.toFixed(2)} lot`;const lines=[`💼 الرصيد المرجعي: $${XAU_ACCOUNT_BALANCE_USD.toFixed(0)}`,`📏 مسافة الوقف: $${distance.toFixed(2)}`,`✅ اللوت المقترح (خطر ≈ $${XAU_SAFE_RISK_USD.toFixed(0)} / ${safePct.toFixed(1)}%): ${fmt(safeLot)}`,`⛔ أقصى لوت (خطر ≈ $${XAU_MAX_RISK_USD.toFixed(0)} / ${maxPct.toFixed(1)}%): ${fmt(maxLot)}`];if(maxLot===0)lines.push(`🚫 تخطَّ الصفقة: أقل لوت ${XAU_LOT_STEP.toFixed(2)} قد يخسر ≈ $${minLotRisk.toFixed(2)} عند SL`);else lines.push('⚠️ لا تتجاوز اللوت الأقصى لهذه الصفقة');return lines;}
function sideOf(s){return ['BUY','SELL'].includes(s?.side)?s.side:null;}
function confidenceOf(s){return Number(s?.signalConfidence??s?.confidence??0)||0;}
function targetOf(s,i){return num(s?.[`target${i}`]);}
function targetsOf(s){return [1,2,3,4].map(i=>targetOf(s,i));}
function stopOf(s){return num(s?.stopLoss)??num(s?.managedStopLoss)??num(s?.originalStopLoss);}
function entryOf(s){return num(s?.triggerPrice)??num(s?.entry)??num(s?.price);}
function issuedAtOf(s){const ms=num(s?.issuedAtMs);if(ms!=null)return ms;const parsed=Date.parse(s?.issuedAt);return Number.isFinite(parsed)?parsed:null;}
function stopValid(side,entry,sl){return valid(sl)&&valid(entry)&&(side==='BUY'?sl<entry:sl>entry);}
function reached(side,price,target){return valid(price)&&valid(target)&&(side==='BUY'?price>=target:price<=target);}
function signalKey(s){
  const side=sideOf(s),entry=entryOf(s),issued=issuedAtOf(s);
  if(s?.signalId)return String(s.signalId);
  if(s?.setupId)return String(s.setupId);
  return `${side||'NA'}|${issued||'NA'}|${entry||'NA'}`;
}
function cleanupRecent(now=Date.now()){
  for(const [key,at] of recentKeys.entries())if(now-at>RECENT_KEY_TTL_MS)recentKeys.delete(key);
}
function isConfirmedActive(s){
  return String(s?.status||'').toUpperCase()==='ACTIVE'&&Boolean(s?.signalId)&&s?.entered===true&&s?.triggered===true&&['BUY','SELL'].includes(s?.side);
}
function tp1AlreadyGone(s,side,livePrice,tp1){
  return Boolean(s?.tp1||s?.targetHits?.[0])||reached(side,livePrice,tp1);
}
function fiveMinuteCloseConfirmed(s,now=Date.now()){
  if(!CONFIRM_ON_5M_CLOSE)return true;
  const issued=issuedAtOf(s);
  if(issued==null||issued>now)return false;
  const firstClose=(Math.floor(issued/FIVE_MIN_MS)+1)*FIVE_MIN_MS;
  return now>=firstClose;
}
function startedThisRun(s){
  const issued=issuedAtOf(s);
  return issued!=null&&issued>=BOOT_MS-BOOT_GRACE_MS;
}
function terminalMatchesLock(lock,s){
  if(!lock?.active||!lock?.key||!s?.terminalEvent)return false;
  const closedAt=num(s.terminalEvent?.closedAtMs)??Date.parse(s.terminalEvent?.closedAt);
  if(!Number.isFinite(closedAt)||closedAt<lock.startedAtMs)return false;
  return signalKey(s.terminalEvent)===lock.key;
}
function lockAllowsSignal(lock,s){
  if(!lock?.active)return true;
  return signalKey(s)===lock.key;
}
function setTradeLock(s,now=Date.now()){
  tradeLock.active=true;
  tradeLock.key=signalKey(s);
  tradeLock.side=sideOf(s);
  tradeLock.startedAtMs=now;
}
function clearTradeLock(){
  tradeLock.active=false;
  tradeLock.key=null;
  tradeLock.side=null;
  tradeLock.startedAtMs=0;
}

function canSendSignal(s,now=Date.now()){
  const side=sideOf(s),entry=entryOf(s),sl=stopOf(s),p=num(s?.price),t=targetsOf(s),age=num(s?.quoteAgeMs),at=Date.parse(s?.updatedAt);
  if(s?.degraded||s?.liveFeedFresh!==true||age==null||age<0||age>20000||!Number.isFinite(at)||now-at>20000||at>now+5000)return false;
  if(!isConfirmedActive(s)||!valid(p)||!valid(entry)||!stopValid(side,entry,sl))return false;
  if(side==='BUY'?p<=sl:p>=sl)return false;
  return t.every((v,i)=>valid(v)&&(side==='BUY'?v>(i?t[i-1]:entry):v<(i?t[i-1]:entry)));
}

async function tg(method,body=null){
  if(!BOT_TOKEN)throw new Error('TELEGRAM_BOT_TOKEN missing');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:body?'POST':'GET',
    headers:body?{'content-type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,
    cache:'no-store',
    signal:AbortSignal.timeout(8000)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.ok===false)throw new Error(`${method} ${r.status} ${d?.description||''}`.trim());
  return d;
}
async function send(text){
  if(!CHAT_ID)throw new Error('TELEGRAM_CHAT_ID missing');
  const d=await tg('sendMessage',{chat_id:CHAT_ID,text,disable_web_page_preview:true});
  return Number(d?.result?.message_id)||null;
}
async function edit(messageId,text){
  if(!CHAT_ID||!messageId)return false;
  try{
    await tg('editMessageText',{chat_id:CHAT_ID,message_id:messageId,text,disable_web_page_preview:true});
    return true;
  }catch(e){
    const m=String(e?.message||e);
    if(m.includes('message is not modified'))return true;
    throw e;
  }
}
async function startup(){
  if(ready)return true;
  if(!BOT_TOKEN||!CHAT_ID){console.error('[telegram-xau-confirmed] token/chat missing');return false;}
  try{
    const me=await tg('getMe');
    ready=true;
    console.log(`[telegram-xau-confirmed] authenticated @${me?.result?.username||'unknown'} siteMirror=true`);
    return true;
  }catch(e){
    console.error('[telegram-xau-confirmed] startup',e?.message||e);
    return false;
  }
}
function targetMessage(s){
  const side=sideOf(s),confidence=Math.round(confidenceOf(s)),icon=side==='BUY'?'🟢':'🔴',entry=entryOf(s),sl=stopOf(s),t=targetsOf(s),sizing=lotSizingLines(entry,sl);
  return `${icon} XAUUSD — ${side}\n✅ CONFIRMED\n📊 الثقة: ${confidence}%\n💵 الدخول: ${money(entry)}\n🛑 SL: ${n(sl)}\n🎯 TP1: ${n(t[0])}\n🎯 TP2: ${n(t[1])}\n🎯 TP3: ${n(t[2])}\n🎯 TP4: ${n(t[3])}${sizing.length?'\n\n'+sizing.join('\n'):''}`;
}
function tpHitMessage(i,target){
  return `✅ XAUUSD — TP${i+1} HIT / تم ضرب الهدف ${i+1}\n🎯 TP${i+1}: ${n(target)}`;
}
function terminalMessage(t){
  const outcome=String(t?.outcome||'').toUpperCase();
  if(['SL','MANAGED_STOP'].includes(outcome)){
    const managed=outcome==='MANAGED_STOP'?' (Managed Stop)':'';
    return `🛑 XAUUSD — STOP LOSS HIT${managed} / تم ضرب وقف الخسارة\n🛑 SL: ${n(t?.stopLoss??t?.managedStopLoss??t?.originalStopLoss)}\n📍 Exit: ${n(t?.exitPrice)}`;
  }
  if(outcome==='TP4')return `🏁 XAUUSD — ALL TARGETS COMPLETED / تم تحقيق جميع الأهداف\n🎯 TP4: ${n(t?.target4)}`;
  return null;
}
async function sendTargetHits(s,{includeTp4=true}={}){
  if(!sent.above||!sent.announcedAtMs)return;
  const hits=Array.isArray(s?.targetHits)?s.targetHits:[];
  const hitTimes=Array.isArray(s?.targetHitAt)?s.targetHitAt:[];
  const targets=targetsOf(s);
  const limit=includeTp4?4:3;
  for(let i=0;i<limit;i++){
    const hitAt=num(hitTimes[i]);
    const provenAfterAlert=hitAt!=null&&hitAt>=sent.announcedAtMs;
    if(hits[i]&&!sent.targets[i]&&valid(targets[i])&&provenAfterAlert){
      await send(tpHitMessage(i,targets[i]));
      sent.targets[i]=true;
      console.log(`[telegram-xau-confirmed] TP${i+1} hit key=${sent.key} target=${n(targets[i])}`);
    }
  }
}
function resetSent(){
  sent.above=false;
  sent.side=null;
  sent.key=null;
  sent.messageId=null;
  sent.lastText=null;
  sent.lastEditMs=0;
  sent.announcedAtMs=0;
  sent.targets=[false,false,false,false];
}
async function tick(){
  try{
    if(!(await startup()))return;
    const r=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});
    if(!r.ok)throw new Error(`signal ${r.status}`);
    const s=await r.json();
    const now=Date.now();cleanupRecent(now);

    if(terminalMatchesLock(tradeLock,s)){
      const terminal=s.terminalEvent;
      await sendTargetHits(terminal,{includeTp4:false});
      const closeText=terminalMessage(terminal);
      if(closeText)await send(closeText);
      console.log(`[telegram-xau-confirmed] trade lock released ${tradeLock.side} key=${tradeLock.key} outcome=${terminal?.outcome||terminal?.result||'CLOSED'}`);
      resetSent();
      clearTradeLock();
      return;
    }

    const active=isConfirmedActive(s),side=sideOf(s),confidence=confidenceOf(s),entry=entryOf(s),sl=stopOf(s),key=signalKey(s);
    const sameLockedTrade=tradeLock.active&&tradeLock.key===key;
    const eligibleNewTrade=!tradeLock.active&&startedThisRun(s);
    const ok=canSendSignal(s,now)&&lockAllowsSignal(tradeLock,s)&&(sameLockedTrade||eligibleNewTrade);

    if(ok){
      const text=targetMessage(s);
      if(!tradeLock.active&&!sent.above&&!recentKeys.has(key)){
        const messageId=await send(text);
        setTradeLock(s,now);
        sent.above=true;
        sent.side=side;
        sent.key=key;
        sent.messageId=messageId;
        sent.lastText=text;
        sent.lastEditMs=now;
        sent.announcedAtMs=now;
        sent.targets=[false,false,false,false];
        recentKeys.set(key,now);
        console.log(`[telegram-xau-confirmed] sent+locked ${side} ${Math.round(confidence)}% entry=${n(entry)} SL=${n(sl)} key=${key} msg=${messageId||'na'}`);
      }else if(sameLockedTrade&&sent.above&&sent.key===key&&sent.messageId&&text!==sent.lastText&&now-sent.lastEditMs>=EDIT_MIN_MS){
        await edit(sent.messageId,text);
        sent.lastText=text;
        sent.lastEditMs=now;
        console.log(`[telegram-xau-confirmed] edited locked ${side} ${Math.round(confidence)}% key=${key} msg=${sent.messageId}`);
      }
      if(sameLockedTrade||tradeLock.key===key)await sendTargetHits(s);
      return;
    }

    if(sameLockedTrade&&sent.above){
      await sendTargetHits(s);
      return;
    }
    if(tradeLock.active&&active&&key!==tradeLock.key){
      console.warn(`[telegram-xau-confirmed] blocked overlapping ${side} key=${key}; locked=${tradeLock.side} ${tradeLock.key}`);
      return;
    }
    if(active&&!tradeLock.active&&!startedThisRun(s)){
      console.warn(`[telegram-xau-confirmed] skipped pre-existing active signal key=${key}; bot will wait for a new lifecycle signal`);
      return;
    }
  }catch(e){console.error('[telegram-xau-confirmed]',e?.message||e);}
}

console.log(`[telegram-xau-confirmed] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} one-active-trade lock; site-mirror=on; confidence-filter=off; TP/SL lifecycle alerts=on`);
if(process.env.NODE_ENV!=='test')(async function loop(){while(true){await tick();await new Promise(r=>setTimeout(r,POLL_MS));}})();

export {targetMessage,canSendSignal,fiveMinuteCloseConfirmed,terminalMatchesLock,lockAllowsSignal,signalKey,tpHitMessage,terminalMessage};
