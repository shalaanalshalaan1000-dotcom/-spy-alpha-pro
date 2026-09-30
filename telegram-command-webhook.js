import fs from 'node:fs';
import { telegramSendState, setTelegramSendingEnabled } from './telegram-send-control.js';

const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const CHAT_ID=String(process.env.TELEGRAM_CHAT_ID||'').trim();
const WEBHOOK_SECRET=String(process.env.TELEGRAM_WEBHOOK_SECRET||'').trim();
const APP_BASE_URL=String(process.env.APP_BASE_URL||'').trim().replace(/\/$/,'');
const INNER_PORT=Number(process.env.GOLD_ALPHA_INNER_PORT||3100);
const JOURNAL_URL=String(process.env.TELEGRAM_JOURNAL_URL||`http://127.0.0.1:${INNER_PORT}/api/performance/journal`).trim();
const SIGNAL_URL=String(process.env.TELEGRAM_SIGNAL_URL||`http://127.0.0.1:${INNER_PORT}/api/auto-trade/signal?observe=1`).trim();
const TRADE_SIGNALS_ENABLED=String(process.env.TELEGRAM_TRADE_SIGNALS_ENABLED||'true').toLowerCase()!=='false';
const seenUpdates=new Map();

function num(v){if(v==null||v===''||typeof v==='boolean')return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function valid(v){const x=num(v);return x!=null&&x>0;}
function n(v,d=3){return valid(v)?Number(v).toFixed(d):'—';}
function sideOf(s){return ['BUY','SELL'].includes(s?.side)?s.side:['BUY','SELL'].includes(s?.action)?s.action:'—';}
function entryOf(s){return num(s?.triggerPrice)??num(s?.entry)??num(s?.price);}
function targetOf(s,i){return num(s?.[`target${i}`]);}
function confidenceOf(s){return Number(s?.signalConfidence??s?.confidence??0)||0;}
function directionalMove(side,entry,price){const e=num(entry),p=num(price);if(e==null||p==null||!['BUY','SELL'].includes(side))return null;return side==='BUY'?p-e:e-p;}
function targetHitsCount(t){if(Array.isArray(t?.targetHits))return t.targetHits.filter(Boolean).length;let hits=0;for(let i=1;i<=4;i++)if(t?.[`tp${i}`]===true)hits++;return hits;}

async function telegram(method,body){
  if(!BOT_TOKEN)throw new Error('TELEGRAM_BOT_TOKEN missing');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{}),
    cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.ok===false)throw new Error(`${method} ${r.status} ${d?.description||''}`.trim());
  return d;
}

async function send(text,reply_markup){
  if(!CHAT_ID)throw new Error('TELEGRAM_CHAT_ID missing');
  return telegram('sendMessage',{chat_id:CHAT_ID,text,disable_web_page_preview:true,...(reply_markup?{reply_markup}: {})});
}

function tradeReview(t){
  const side=sideOf(t),entry=entryOf(t),exit=num(t?.exitPrice),initialStop=num(t?.originalStopLoss)??num(t?.stopLoss);
  const risk=entry!=null&&initialStop!=null?Math.abs(entry-initialStop):null,tp1=targetOf(t,1);
  const rr=risk&&risk>0&&tp1!=null?(side==='BUY'?(tp1-entry)/risk:(entry-tp1)/risk):num(t?.liveTp1R);
  const realizedR=num(t?.realizedR)??(risk&&risk>0?directionalMove(side,entry,exit)/risk:null);
  const mfe=risk&&risk>0?directionalMove(side,entry,num(t?.bestPrice))/risk:null;
  const conf=confidenceOf(t),hits=targetHitsCount(t),outcome=String(t?.outcome||'—'),result=String(t?.result||'—').toUpperCase();
  let score=50;score+=conf>=80?8:conf>=70?5:conf>=65?3:-5;
  if(rr!=null)score+=rr>=1.25?12:rr>=.8?7:rr>=.5?3:-10;
  score+=result==='WIN'?15:result==='BREAKEVEN'?5:result==='LOSS'?-12:0;score+=Math.min(12,hits*4);
  if(outcome==='MANAGED_STOP')score+=8;if(mfe!=null&&mfe>=1)score+=5;score=Math.max(0,Math.min(100,Math.round(score)));
  const label=score>=80?'ممتاز':score>=70?'جيد':score>=60?'مقبول':'ضعيف',notes=[];
  if(rr!=null&&rr<.5)notes.push('العائد إلى TP1 كان ضيقًا مقارنة بالوقف');
  if(result==='LOSS'&&mfe!=null&&mfe<.35)notes.push('الحركة لم تمتد لصالح الصفقة؛ التوقيت/الاتجاه يحتاج مراجعة');
  else if(result==='LOSS'&&mfe!=null&&mfe>=.8)notes.push('الصفقة تحركت جيدًا ثم انعكست؛ راجع تأمين الربح وإدارة الوقف');
  if(outcome==='MANAGED_STOP')notes.push('إدارة الوقف حمت الصفقة بعد تحقيق هدف');
  if(result==='WIN'&&hits>0)notes.push(`تحققت ${hits} أهداف قبل الإغلاق`);
  if(!notes.length)notes.push(result==='WIN'?'تنفيذ متماسك وفق بيانات الصفقة المسجلة':'لا توجد بيانات كافية لتحديد سبب واحد للفشل');
  return{side,entry,exit,rr,realizedR,conf,hits,result,score,label,notes};
}

function reviewLine(t,index){
  const r=tradeReview(t);
  const when=t?.closedAt?new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(t.closedAt)):'—';
  const rr=r.rr==null?'—':r.rr.toFixed(2)+'R',real=r.realizedR==null?'—':(r.realizedR>0?'+':'')+r.realizedR.toFixed(2)+'R';
  return `${index+1}) ${r.side} • ${r.result} • ${r.score}/100 (${r.label})
🕒 ${when} | Entry ${n(r.entry)} → Exit ${n(r.exit)}
📐 TP1 RR: ${rr} | Realized: ${real} | TP hits: ${r.hits}
🔎 ${r.notes.join(' • ')}`;
}

function evaluationMessage(assetLabel,trades,emptyNote='لا توجد صفقات مغلقة مسجلة حتى الآن.'){
  const closed=(Array.isArray(trades)?trades:[]).filter(t=>String(t?.status||'').toUpperCase()==='CLOSED')
    .sort((a,b)=>Number(b?.closedAtMs||Date.parse(b?.closedAt)||0)-Number(a?.closedAtMs||Date.parse(a?.closedAt)||0));
  if(!closed.length)return `📊 ${assetLabel} — تقييم الصفقات المنتهية\n\n${emptyNote}`;
  const wins=closed.filter(t=>String(t?.result||'').toUpperCase()==='WIN').length;
  const losses=closed.filter(t=>String(t?.result||'').toUpperCase()==='LOSS').length;
  const be=closed.filter(t=>String(t?.result||'').toUpperCase()==='BREAKEVEN').length;
  const rs=closed.map(t=>num(t?.realizedR)).filter(v=>v!=null),netR=rs.reduce((a,b)=>a+b,0),avgR=rs.length?netR/rs.length:null,winRate=closed.length?wins/closed.length*100:0,recent=closed.slice(0,3);
  return `📊 ${assetLabel} — تقييم الصفقات المنتهية
عدد الصفقات: ${closed.length}
✅ فوز: ${wins} | ❌ خسارة: ${losses} | ⚪ تعادل: ${be}
🎯 Win rate: ${winRate.toFixed(1)}%
📈 Net R: ${netR>=0?'+':''}${netR.toFixed(2)}R | Avg: ${avgR==null?'—':(avgR>=0?'+':'')+avgR.toFixed(2)+'R'}

آخر ${recent.length} صفقات:
${recent.map(reviewLine).join('\n\n')}

ملاحظة: التقييم مبني على بيانات الصفقة المسجلة، وليس ضمانًا لجودة أي صفقة مستقبلية.`;
}


function sessionLevelSummaryMessage(s){
  const sessions=s?.sessionLevels?.sessions;
  const rows=sessions&&typeof sessions==='object'?Object.values(sessions):[];
  if(!rows.length)return '📍 XAUUSD — مستويات الجلسات\nلا توجد بيانات كافية بعد.';
  const lines=rows.map(x=>`${x.icon||'📍'} ${x.label||x.id} • ${x.status||'—'}\n⬆️ High: ${n(x.high)}\n⬇️ Low: ${n(x.low)}\n📏 Range: ${n(x.range)} • M15\n🕒 ${x.startLocal||'—'}–${x.endLocal||'—'} ${x.timeZone||''}`);
  return `📍 XAUUSD — SESSION HIGH / LOW\n\n${lines.join('\n\n')}\n\nهذه مستويات سيولة/مرجع وليست إشارة دخول بحد ذاتها.`;
}
async function fetchGoldSignal(){
  const r=await fetch(SIGNAL_URL,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw new Error(`signal HTTP ${r.status}`);
  return r.json();
}

async function fetchGoldJournal(){
  const r=await fetch(JOURNAL_URL,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw new Error(`journal HTTP ${r.status}`);
  const d=await r.json();if(!d||!Array.isArray(d.trades))throw new Error('journal payload invalid');return d.trades;
}

async function handleUpdate(update){
  const id=Number(update?.update_id);
  if(Number.isFinite(id)){if(seenUpdates.has(id))return;seenUpdates.set(id,Date.now());for(const [k,t] of seenUpdates)if(Date.now()-t>15*60_000)seenUpdates.delete(k);}
  const msg=update?.message;if(!msg||String(msg.chat?.id)!==String(CHAT_ID))return;
  const text=String(msg.text||'').trim();
  if(/^\/start(?:@\w+)?$/i.test(text)){
    const st=telegramSendState();
    await send(`اختر من البوت:\nحالة الإرسال: ${st.enabled?'🟢 يعمل':'⏸ متوقف'}`,{keyboard:[[{text:'📍 مستويات الجلسات'}],[{text:'📊 تقييم الصفقات'}],[{text:'⏸ إيقاف الإرسال'},{text:'▶️ تشغيل الإرسال'}],[{text:'ℹ️ حالة الإرسال'}]],resize_keyboard:true,persistent:true});
    return;
  }
  if(/^\/signals_off(?:@\w+)?$/i.test(text)||text==='⏸ إيقاف الإرسال'){
    const st=setTelegramSendingEnabled(false,'telegram-command');
    await send('⏸ تم إيقاف إرسال تنبيهات الذهب من البوت. التحليل والموقع مستمران، ولن تُرسل إشارات دخول أو أهداف/وقف أو تنبيهات جلسات حتى تعيد التشغيل.');
    return;
  }
  if(/^\/signals_on(?:@\w+)?$/i.test(text)||text==='▶️ تشغيل الإرسال'){
    const st=setTelegramSendingEnabled(true,'telegram-command');
    await send(`▶️ تم تشغيل تنبيهات البوت.${TRADE_SIGNALS_ENABLED?'':'\n📍 تنبيهات الجلسات تعمل، بينما إشارات الدخول ما زالت موقوفة حسب إعداد المشروع.'}`);
    return;
  }
  if(/^\/signals_status(?:@\w+)?$/i.test(text)||text==='ℹ️ حالة الإرسال'){
    const st=telegramSendState();
    await send(`حالة إرسال البوت: ${st.enabled?'🟢 يعمل':'⏸ متوقف'}\n📍 مستويات الجلسات: ${st.enabled?'مفعلة':'متوقفة'}\n📈 إشارات الدخول: ${TRADE_SIGNALS_ENABLED?'مفعلة':'موقوفة من إعداد المشروع'}${st.updatedAt?'\nآخر تغيير: '+new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'}).format(new Date(st.updatedAt)):''}`);
    return;
  }
  if(/^\/sessions(?:@\w+)?$/i.test(text)||text==='📍 مستويات الجلسات'){
    try{const s=await fetchGoldSignal();await send(sessionLevelSummaryMessage(s));}
    catch(e){await send(`⚠️ تعذر قراءة مستويات الجلسات الآن: ${String(e?.message||e)}`);}
    return;
  }
  if(/^\/evaluate(?:@\w+)?$/i.test(text)||text==='📊 تقييم الصفقات'){
    try{
      const gold=await fetchGoldJournal();
      await send(evaluationMessage('XAUUSD',gold));
    }catch(e){await send(`⚠️ تعذر قراءة سجل الصفقات الآن: ${String(e?.message||e)}`);}
  }
}

export async function configureTelegramWebhook(){
  if(!BOT_TOKEN||!CHAT_ID||!WEBHOOK_SECRET||!APP_BASE_URL){console.warn('[telegram-webhook] disabled: missing token/chat/secret/base URL');return false;}
  await telegram('setMyCommands',{commands:[{command:'sessions',description:'📍 قمم وقيعان طوكيو ولندن ونيويورك'},{command:'evaluate',description:'📊 تقييم صفقات الذهب'},{command:'signals_off',description:'⏸ إيقاف إرسال التنبيهات'},{command:'signals_on',description:'▶️ تشغيل إرسال التنبيهات'},{command:'signals_status',description:'ℹ️ حالة إرسال البوت'}]});
  await telegram('setWebhook',{
    url:`${APP_BASE_URL}/api/telegram/webhook`,
    secret_token:WEBHOOK_SECRET,
    allowed_updates:['message'],
    drop_pending_updates:false,
    max_connections:1
  });
  console.log('[telegram-webhook] configured; getUpdates long polling disabled');
  return true;
}

export function handleTelegramWebhook(req,res){
  if(!BOT_TOKEN||!CHAT_ID||!WEBHOOK_SECRET){res.writeHead(503,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,error:'telegram webhook not configured'}));}
  const supplied=String(req.headers['x-telegram-bot-api-secret-token']||'');
  if(supplied!==WEBHOOK_SECRET){res.writeHead(403,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,error:'forbidden'}));}
  const chunks=[];let size=0;
  req.on('data',chunk=>{size+=chunk.length;if(size<=262144)chunks.push(chunk);});
  req.on('end',()=>{
    if(size>262144){res.writeHead(413,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,error:'payload too large'}));}
    let update=null;try{update=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:true}));
    if(update)void handleUpdate(update).catch(e=>console.error('[telegram-webhook]',e?.message||e));
  });
  req.on('error',()=>{if(!res.headersSent){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({ok:false}));}});
}
