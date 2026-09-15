const AUTO_URL=process.env.TELEGRAM_SIGNAL_URL||'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const CHAT_ID=String(process.env.TELEGRAM_CHAT_ID||'').trim();
const POLL_MS=Math.max(1200,Number(process.env.TELEGRAM_POLL_MS||1500));
const SIGNAL_THRESHOLD=Math.max(1,Math.min(100,Number(process.env.TELEGRAM_DIRECTIONAL_MIN_CONFIDENCE||75)));
const RESET_HOLD_MS=Math.max(5000,Number(process.env.TELEGRAM_SIGNAL_RESET_HOLD_MS||20000));

let ready=false;
const sent={side:null,above:false,sentAtMs:0,belowSinceMs:0};

function num(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function valid(v){const x=num(v);return x!=null&&x>0;}
function n(v,d=3){return valid(v)?Number(v).toFixed(d):'—';}
function money(v,d=2){return valid(v)?'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';}
function sideOf(s){
  return ['BUY','SELL'].find(x=>[s?.side,s?.candidateAction,s?.action].includes(x))
    ||(['BUY','SELL'].includes(s?.entryGuard?.side)?s.entryGuard.side:null)
    ||(['BUY','SELL'].includes(s?.prediction?.side)?s.prediction.side:null);
}
function confidenceOf(s){return Math.max(Number(s?.signalConfidence)||0,Number(s?.confidence)||0,Number(s?.prediction?.confidence)||0);}
function targetOf(s,i){return num(s?.[`target${i}`])??num(s?.entryGuard?.[`target${i}`])??num(s?.prediction?.[`target${i}`]);}
function targetsOf(s){return [1,2,3,4].map(i=>targetOf(s,i));}

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
  await tg('sendMessage',{chat_id:CHAT_ID,text,disable_web_page_preview:true});
}
async function startup(){
  if(ready)return true;
  if(!BOT_TOKEN||!CHAT_ID){console.error('[telegram-xau-targets] token/chat missing');return false;}
  try{
    const me=await tg('getMe');
    ready=true;
    console.log(`[telegram-xau-targets] authenticated @${me?.result?.username||'unknown'} threshold=${SIGNAL_THRESHOLD}`);
    return true;
  }catch(e){
    console.error('[telegram-xau-targets] startup',e?.message||e);
    return false;
  }
}
function targetMessage(s){
  const side=sideOf(s),confidence=Math.round(confidenceOf(s)),icon=side==='BUY'?'🟢':'🔴',price=num(s?.price),t=targetsOf(s);
  return `${icon} XAUUSD — ${side}\n📊 الثقة: ${confidence}%\n💵 السعر: ${money(price)}\n🎯 TP1: ${n(t[0])}\n🎯 TP2: ${n(t[1])}\n🎯 TP3: ${n(t[2])}\n🎯 TP4: ${n(t[3])}`;
}
async function tick(){
  try{
    if(!(await startup()))return;
    const r=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});
    if(!r.ok)throw new Error(`signal ${r.status}`);
    const s=await r.json();
    const now=Date.now(),side=sideOf(s),confidence=confidenceOf(s),targets=targetsOf(s),targetsReady=targets.every(valid);
    const ok=!s?.degraded&&Boolean(side)&&confidence>=SIGNAL_THRESHOLD&&targetsReady&&String(s?.status||'').toUpperCase()!=='COLLECTING';

    if(ok){
      sent.belowSinceMs=0;
      if(!sent.above||sent.side!==side){
        await send(targetMessage(s));
        sent.above=true;
        sent.side=side;
        sent.sentAtMs=now;
        console.log(`[telegram-xau-targets] sent ${side} ${Math.round(confidence)}%`);
      }
      return;
    }

    const clearlyBelow=!side||confidence<=SIGNAL_THRESHOLD-3;
    if(clearlyBelow){
      if(!sent.belowSinceMs)sent.belowSinceMs=now;
      if(now-sent.belowSinceMs>=RESET_HOLD_MS){
        sent.above=false;
        sent.side=null;
        sent.belowSinceMs=0;
      }
    }else{
      sent.belowSinceMs=0;
    }
  }catch(e){console.error('[telegram-xau-targets]',e?.message||e);}
}

console.log(`[telegram-xau-targets] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} targets>=${SIGNAL_THRESHOLD}; dedupe=side-cycle`);
if(process.env.NODE_ENV!=='test')(async function loop(){while(true){await tick();await new Promise(r=>setTimeout(r,POLL_MS));}})();

export {targetMessage};
