import fs from 'node:fs';

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
const JOURNAL_URL=String(process.env.TELEGRAM_JOURNAL_URL||'http://127.0.0.1:3002/api/performance/journal').trim();
const BTC_JOURNAL_PATH=String(process.env.BTC_TRADE_JOURNAL_PATH||'/tmp/gold-alpha-btc-trades.json').trim();
let telegramUpdateOffset=0;

let ready=false;
const sent={side:null,key:null,above:false,messageId:null,lastText:null,lastEditMs:0,announcedAtMs:0,targets:[false,false,false,false],managedStops:[false,false,false,false]};
const tradeLock={active:false,key:null,side:null,startedAtMs:0};
const recentKeys=new Map();
const sessionAlertKeys=new Set();
const SESSION_OPEN_ALERTS=[
  {
    id:'LONDON',
    timeZone:'Europe/London',
    hour:8,
    minute:0,
    label:'LONDON OPEN',
    icon:'🇬🇧',
    watch:'Asia High/Low sweep → displacement/MSS → 5m confirmation → FVG/OB retest'
  },
  {
    id:'NEW_YORK_GOLD',
    timeZone:'America/New_York',
    hour:8,
    minute:20,
    label:'NEW YORK GOLD OPEN',
    icon:'🇺🇸',
    watch:'London High/Low sweep → displacement/MSS → 5m confirmation → FVG/OB retest'
  }
];

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

function zonedClock(now,timeZone){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',
    hour:'2-digit',minute:'2-digit',hour12:false
  }).formatToParts(new Date(now));
  const get=t=>parts.find(p=>p.type===t)?.value||'';
  return {
    date:`${get('year')}-${get('month')}-${get('day')}`,
    weekday:get('weekday'),
    hour:Number(get('hour')),
    minute:Number(get('minute'))
  };
}
function isTradingWeekday(day){return !['Sat','Sun'].includes(day);}
function sessionOpenMessage(def,now){
  const saudi=new Intl.DateTimeFormat('ar-SA',{
    timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',hour12:true
  }).format(new Date(now));
  return `🔔 XAUUSD — ${def.label}
${def.icon} بدأ افتتاح الجلسة المهمة للذهب
🕒 الآن: ${saudi} بتوقيت السعودية
👀 نراقب: ${def.watch}
✅ حد أقصى فرصتان إذا ظهر إعدادان مستقلان
🚫 لا دخول لمجرد الافتتاح — الإشارة بعد تأكيد المحرك فقط`;
}
async function maybeSendSessionOpenAlert(now=Date.now()){
  for(const def of SESSION_OPEN_ALERTS){
    const clock=zonedClock(now,def.timeZone);
    if(!isTradingWeekday(clock.weekday))continue;
    const current=clock.hour*60+clock.minute,target=def.hour*60+def.minute;
    if(current<target||current>=target+2)continue;
    const key=`${def.id}:${clock.date}`;
    if(sessionAlertKeys.has(key))continue;
    await send(sessionOpenMessage(def,now));
    sessionAlertKeys.add(key);
    console.log(`[telegram-xau-confirmed] session-open alert sent ${key}`);
  }
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
    await tg('setMyCommands',{commands:[
      {command:'evaluate',description:'📊 تقييم صفقات الذهب والبيتكوين'}
    ]});
    ready=true;
    console.log(`[telegram-xau-confirmed] authenticated @${me?.result?.username||'unknown'} siteMirror=true; /evaluate enabled`);
    return true;
  }catch(e){
    console.error('[telegram-xau-confirmed] startup',e?.message||e);
    return false;
  }
}

function directionalMove(side,entry,price){
  const e=num(entry),p=num(price);
  if(e==null||p==null||!['BUY','SELL'].includes(side))return null;
  return side==='BUY'?p-e:e-p;
}
function targetHitsCount(t){
  if(Array.isArray(t?.targetHits))return t.targetHits.filter(Boolean).length;
  let hits=0;for(let i=1;i<=4;i++)if(t?.[`tp${i}`]===true)hits++;return hits;
}
function tradeReview(t){
  const side=sideOf(t)||String(t?.side||'—'),entry=entryOf(t),exit=num(t?.exitPrice),initialStop=num(t?.originalStopLoss)??num(t?.stopLoss);
  const risk=entry!=null&&initialStop!=null?Math.abs(entry-initialStop):null;
  const tp1=targetOf(t,1);
  const rr=risk&&risk>0&&tp1!=null?(side==='BUY'?(tp1-entry)/risk:(entry-tp1)/risk):num(t?.liveTp1R);
  const realizedR=num(t?.realizedR)??(risk&&risk>0?directionalMove(side,entry,exit)/risk:null);
  const mfe=risk&&risk>0?directionalMove(side,entry,num(t?.bestPrice))/risk:null;
  const conf=confidenceOf(t),hits=targetHitsCount(t),outcome=String(t?.outcome||'—'),result=String(t?.result||'—').toUpperCase();
  let score=50;
  score+=conf>=80?8:conf>=70?5:conf>=65?3:-5;
  if(rr!=null)score+=rr>=1.25?12:rr>=.8?7:rr>=.5?3:-10;
  score+=result==='WIN'?15:result==='BREAKEVEN'?5:result==='LOSS'?-12:0;
  score+=Math.min(12,hits*4);
  if(outcome==='MANAGED_STOP')score+=8;
  if(mfe!=null&&mfe>=1)score+=5;
  score=Math.max(0,Math.min(100,Math.round(score)));
  const label=score>=80?'ممتاز':score>=70?'جيد':score>=60?'مقبول':'ضعيف';
  const notes=[];
  if(rr!=null&&rr<.5)notes.push('العائد إلى TP1 كان ضيقًا مقارنة بالوقف');
  if(result==='LOSS'&&mfe!=null&&mfe<.35)notes.push('الحركة لم تمتد لصالح الصفقة؛ التوقيت/الاتجاه يحتاج مراجعة');
  else if(result==='LOSS'&&mfe!=null&&mfe>=.8)notes.push('الصفقة تحركت جيدًا ثم انعكست؛ راجع تأمين الربح وإدارة الوقف');
  if(outcome==='MANAGED_STOP')notes.push('إدارة الوقف حمت الصفقة بعد تحقيق هدف');
  if(result==='WIN'&&hits>0)notes.push(`تحققت ${hits} أهداف قبل الإغلاق`);
  if(!notes.length)notes.push(result==='WIN'?'تنفيذ متماسك وفق بيانات الصفقة المسجلة':'لا توجد بيانات كافية لتحديد سبب واحد للفشل');
  return {side,entry,exit,risk,rr,realizedR,mfe,conf,hits,outcome,result,score,label,notes};
}
function reviewLine(t,index){
  const r=tradeReview(t);
  const when=t?.closedAt?new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(t.closedAt)):'—';
  const rr=r.rr==null?'—':r.rr.toFixed(2)+'R';
  const real=r.realizedR==null?'—':(r.realizedR>0?'+':'')+r.realizedR.toFixed(2)+'R';
  return `${index+1}) ${r.side} • ${r.result} • ${r.score}/100 (${r.label})
🕒 ${when} | Entry ${n(r.entry)} → Exit ${n(r.exit)}
📐 TP1 RR: ${rr} | Realized: ${real} | TP hits: ${r.hits}
🔎 ${r.notes.join(' • ')}`;
}
async function fetchJournal(){
  const r=await fetch(JOURNAL_URL,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw new Error(`journal HTTP ${r.status}`);
  const d=await r.json();
  if(!d||!Array.isArray(d.trades))throw new Error('journal payload invalid');
  return d;
}
function assetEvaluationMessage(assetLabel,trades,emptyNote='لا توجد صفقات مغلقة مسجلة حتى الآن.'){
  const closed=(Array.isArray(trades)?trades:[]).filter(t=>String(t?.status||'').toUpperCase()==='CLOSED').sort((a,b)=>Number(b?.closedAtMs||Date.parse(b?.closedAt)||0)-Number(a?.closedAtMs||Date.parse(a?.closedAt)||0));
  if(!closed.length)return `📊 ${assetLabel} — تقييم الصفقات المنتهية\n\n${emptyNote}`;
  const wins=closed.filter(t=>String(t?.result||'').toUpperCase()==='WIN').length;
  const losses=closed.filter(t=>String(t?.result||'').toUpperCase()==='LOSS').length;
  const be=closed.filter(t=>String(t?.result||'').toUpperCase()==='BREAKEVEN').length;
  const rs=closed.map(t=>num(t?.realizedR)).filter(v=>v!=null);
  const netR=rs.reduce((a,b)=>a+b,0),avgR=rs.length?netR/rs.length:null;
  const winRate=closed.length?wins/closed.length*100:0;
  const recent=closed.slice(0,3);
  return `📊 ${assetLabel} — تقييم الصفقات المنتهية
عدد الصفقات: ${closed.length}
✅ فوز: ${wins} | ❌ خسارة: ${losses} | ⚪ تعادل: ${be}
🎯 Win rate: ${winRate.toFixed(1)}%
📈 Net R: ${netR>=0?'+':''}${netR.toFixed(2)}R | Avg: ${avgR==null?'—':(avgR>=0?'+':'')+avgR.toFixed(2)+'R'}

آخر ${recent.length} صفقات:
${recent.map(reviewLine).join('\n\n')}

ملاحظة: التقييم مبني على بيانات الصفقة المسجلة، وليس ضمانًا لجودة أي صفقة مستقبلية.`;
}
function evaluationMessage(journal){
  return assetEvaluationMessage('XAUUSD',journal?.trades||[]);
}
function readBtcClosedTrades(){
  try{
    const rows=JSON.parse(fs.readFileSync(BTC_JOURNAL_PATH,'utf8'));
    return Array.isArray(rows)?rows:[];
  }catch{return [];}
}
async function sendBotMenu(){
  await tg('sendMessage',{
    chat_id:CHAT_ID,
    text:'اختر من البوت:',
    disable_web_page_preview:true,
    reply_markup:{keyboard:[[{text:'📊 تقييم الصفقات'}]],resize_keyboard:true,persistent:true}
  });
}
async function handleBotUpdate(update){
  const msg=update?.message;
  if(!msg)return;
  if(String(msg.chat?.id)!==String(CHAT_ID))return;
  const text=String(msg.text||'').trim();
  if(/^\/start(?:@\w+)?$/i.test(text)){await sendBotMenu();return;}
  if(/^\/evaluate(?:@\w+)?$/i.test(text)||text==='📊 تقييم الصفقات'){
    try{
      const journal=await fetchJournal();
      const btcTrades=readBtcClosedTrades();
      await tg('sendMessage',{chat_id:CHAT_ID,text:assetEvaluationMessage('XAUUSD',journal?.trades||[]),disable_web_page_preview:true});
      await tg('sendMessage',{
        chat_id:CHAT_ID,
        text:assetEvaluationMessage(
          'BTCUSD',
          btcTrades,
          'لا توجد صفقة BTC مغلقة محفوظة منذ تفعيل سجل البيتكوين. أول صفقة تنتهي بـ TP أو SL ستظهر هنا تلقائيًا.'
        ),
        disable_web_page_preview:true
      });
    }catch(e){
      await tg('sendMessage',{chat_id:CHAT_ID,text:`⚠️ تعذر قراءة سجل الصفقات الآن: ${String(e?.message||e)}`,disable_web_page_preview:true});
    }
  }
}
async function botCommandLoop(){
  while(true){
    try{
      if(!(await startup())){await new Promise(r=>setTimeout(r,5000));continue;}
      const d=await tg('getUpdates',{offset:telegramUpdateOffset||undefined,timeout:5,allowed_updates:['message']});
      const updates=Array.isArray(d?.result)?d.result:[];
      for(const update of updates){
        telegramUpdateOffset=Math.max(telegramUpdateOffset,Number(update?.update_id||0)+1);
        await handleBotUpdate(update);
      }
    }catch(e){
      console.error('[telegram-xau-commands]',e?.message||e);
      await new Promise(r=>setTimeout(r,1500));
    }
  }
}
function targetMessage(s){
  const side=sideOf(s),confidence=Math.round(confidenceOf(s)),icon=side==='BUY'?'🟢':'🔴',entry=entryOf(s),sl=stopOf(s),t=targetsOf(s),sizing=lotSizingLines(entry,sl);
  return `${icon} XAUUSD — ${side}\n✅ CONFIRMED\n📊 الثقة: ${confidence}%\n💵 الدخول: ${money(entry)}\n🛑 SL: ${n(sl)}\n🎯 TP1: ${n(t[0])}\n🎯 TP2: ${n(t[1])}\n🎯 TP3: ${n(t[2])}\n🎯 TP4: ${n(t[3])}${sizing.length?'\n\n'+sizing.join('\n'):''}`;
}
function tpHitMessage(i,target){
  return `✅ XAUUSD — TP${i+1} HIT / تم ضرب الهدف ${i+1}\n🎯 TP${i+1}: ${n(target)}`;
}
function managedStopMessage(i,managed){
  return `🔒 XAUUSD — بعد TP${i+1}\n⬆️ ارفع وقف الخسارة إلى: ${n(managed)}`;
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
  const managed=num(s?.managedStopLoss);
  const limit=includeTp4?4:3;
  for(let i=0;i<limit;i++){
    const hitAt=num(hitTimes[i]);
    const provenAfterAlert=hitAt!=null&&hitAt>=sent.announcedAtMs;
    const hitProven=Boolean(hits[i]&&provenAfterAlert);
    if(hitProven&&!sent.targets[i]&&valid(targets[i])){
      await send(tpHitMessage(i,targets[i]));
      sent.targets[i]=true;
      console.log(`[telegram-xau-confirmed] TP${i+1} hit key=${sent.key} target=${n(targets[i])}`);
    }
    if(i<3&&hitProven&&valid(managed)&&!sent.managedStops[i]){
      await send(managedStopMessage(i,managed));
      sent.managedStops[i]=true;
      console.log(`[telegram-xau-confirmed] TP${i+1} managed-stop=${n(managed)} key=${sent.key}`);
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
  sent.managedStops=[false,false,false,false];
}
async function tick(){
  try{
    if(!(await startup()))return;
    await maybeSendSessionOpenAlert(Date.now());
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
  sent.managedStops=[false,false,false,false];
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
if(process.env.NODE_ENV!=='test'){
  (async function loop(){while(true){await tick();await new Promise(r=>setTimeout(r,POLL_MS));}})();
  (async function commands(){await botCommandLoop();})();
}

export {targetMessage,canSendSignal,fiveMinuteCloseConfirmed,terminalMatchesLock,lockAllowsSignal,signalKey,tpHitMessage,terminalMessage,tradeReview,evaluationMessage,assetEvaluationMessage,readBtcClosedTrades};
