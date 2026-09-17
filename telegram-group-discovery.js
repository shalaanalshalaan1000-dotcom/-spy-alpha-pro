const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const CHAT_ID=String(process.env.TELEGRAM_CHAT_ID||'').trim();
const AUTO_URL=process.env.TELEGRAM_SIGNAL_URL||'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const POLL_MS=Math.max(1200,Number(process.env.TELEGRAM_POLL_MS||1500));
const BOOT_MS=Date.now();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let activeKey=null;
let sent=[false,false,false,false];

function num(v){if(v==null||v===''||typeof v==='boolean')return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function valid(v){const x=num(v);return x!=null&&x>0;}
function n(v){return valid(v)?Number(v).toFixed(3):'—';}
function keyOf(s){return String(s?.signalId||s?.setupId||'');}

async function tgSend(text){
  if(!BOT_TOKEN||!CHAT_ID)throw new Error('Telegram token/chat missing');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:CHAT_ID,text,disable_web_page_preview:true}),
    cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.ok===false)throw new Error(`sendMessage ${r.status} ${d?.description||''}`.trim());
}

async function tick(){
  const r=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw new Error(`signal ${r.status}`);
  const s=await r.json();
  const key=keyOf(s);
  if(!key||String(s?.status||'').toUpperCase()!=='ACTIVE')return;
  if(activeKey!==key){activeKey=key;sent=[false,false,false,false];}
  const hits=Array.isArray(s?.targetHits)?s.targetHits:[];
  const hitTimes=Array.isArray(s?.targetHitAt)?s.targetHitAt:[];
  const managed=num(s?.managedStopLoss);
  if(!valid(managed))return;
  for(let i=0;i<3;i++){
    const hitAt=num(hitTimes[i]);
    if(hits[i]&&!sent[i]&&hitAt!=null&&hitAt>=BOOT_MS){
      await tgSend(`🔒 XAUUSD — بعد TP${i+1}\n⬆️ ارفع وقف الخسارة إلى: ${n(managed)}`);
      sent[i]=true;
      console.log(`[telegram-managed-stop] TP${i+1} raise-stop=${n(managed)} key=${key}`);
    }
  }
}

console.log('[telegram-managed-stop] notifier started; uses site managedStopLoss only');
if(BOT_TOKEN&&CHAT_ID)(async()=>{while(true){try{await tick();}catch(e){console.error('[telegram-managed-stop]',e?.message||e);}await sleep(POLL_MS);}})();
else console.error('[telegram-managed-stop] Telegram token/chat missing');
