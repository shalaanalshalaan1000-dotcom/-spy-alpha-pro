const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
let offset=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function tg(method,body=null){
  if(!BOT_TOKEN)throw new Error('TELEGRAM_BOT_TOKEN missing');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:body?'POST':'GET',
    headers:body?{'content-type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,
    cache:'no-store',signal:AbortSignal.timeout(15000)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.ok===false)throw new Error(`${method} ${r.status} ${d?.description||''}`.trim());
  return d;
}

async function poll(){
  const d=await tg(`getUpdates?timeout=10&allowed_updates=%5B%22message%22%5D&offset=${offset}`);
  for(const u of d?.result||[]){
    offset=Math.max(offset,Number(u.update_id||0)+1);
    const m=u.message;
    const chat=m?.chat;
    if(!chat)continue;
    const type=String(chat.type||'');
    const text=String(m.text||'').trim().toLowerCase();
    if(type==='group'||type==='supergroup'){
      console.log(`[telegram-group-id] title=${JSON.stringify(chat.title||'')} chat_id=${chat.id} type=${type}`);
      if(text==='getid123'||text==='/getid123'){
        await tg('sendMessage',{chat_id:chat.id,text:`Gold Alpha Group ID: ${chat.id}`});
        console.log(`[telegram-group-id] replied chat_id=${chat.id}`);
      }
    }
  }
}

console.log('[telegram-group-id] discovery listener started');
if(BOT_TOKEN)(async()=>{while(true){try{await poll();}catch(e){console.error('[telegram-group-id]',e?.message||e);await sleep(5000);}}})();
else console.error('[telegram-group-id] TELEGRAM_BOT_TOKEN missing');
