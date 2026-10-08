import fs from 'node:fs';
import { clockParts } from './runtime-memory-policy.js';
import { telegramSendState, telegramSendingEnabled } from './telegram-send-control.js';
import { goldEntryWindow } from './gold-session-entry-policy.js';

const AUTO_URL=process.env.TELEGRAM_SIGNAL_URL||'http://127.0.0.1:3002/api/auto-trade/signal?observe=1';
const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const CHAT_ID=String(process.env.TELEGRAM_CHAT_ID||'').trim();
const POLL_MS=Math.max(1200,Number(process.env.TELEGRAM_POLL_MS||1500));
const EDIT_MIN_MS=Math.max(3000,Number(process.env.TELEGRAM_EDIT_MIN_MS||5000));
const RECENT_KEY_TTL_MS=Math.max(60_000,Number(process.env.TELEGRAM_RECENT_SIGNAL_TTL_MS||600_000));
// Do not advertise an entry minutes after the site filled its original ICT setup.
const ENTRY_ALERT_MAX_DELAY_MS=Math.max(5000,Math.min(120000,Number(process.env.TELEGRAM_ENTRY_ALERT_MAX_DELAY_MS||60000)));
const CONFIRM_ON_5M_CLOSE=String(process.env.TELEGRAM_CONFIRM_ON_5M_CLOSE||'true').toLowerCase()!=='false';
const FIVE_MIN_MS=300_000;
const BOOT_MS=Date.now();
const XAU_CONTRACT_SIZE=Math.max(1,Number(process.env.XAU_CONTRACT_SIZE||100));
const XAU_LOT_STEP=Math.max(.001,Number(process.env.XAU_LOT_STEP||.01));
const XAU_ACCOUNT_BALANCE_USD=Math.max(1,Number(process.env.XAU_ACCOUNT_BALANCE_USD||155));
const XAU_SAFE_RISK_USD=Math.max(1,Number(process.env.XAU_SAFE_RISK_USD||5));
const BOOT_GRACE_MS=15_000;
const JOURNAL_URL=String(process.env.TELEGRAM_JOURNAL_URL||'http://127.0.0.1:3002/api/performance/journal').trim();
const BTC_JOURNAL_PATH=String(process.env.BTC_TRADE_JOURNAL_PATH||'/tmp/gold-alpha-btc-trades.json').trim();
let telegramUpdateOffset=0;
let lastSendControlEnabled=null;

let ready=false;
const sent={side:null,key:null,above:false,messageId:null,lastText:null,lastEditMs:0,announcedAtMs:0,targets:[false,false,false,false],managedStops:[false,false,false,false],managementKey:null,exitAdvised:false};
const tradeLock={active:false,key:null,side:null,startedAtMs:0};
const recentKeys=new Map();
const sessionAlertKeys=new Set();
const SESSION_LEVEL_ALERTS_ENABLED=String(process.env.TELEGRAM_SESSION_LEVEL_ALERTS_ENABLED||'true').toLowerCase()!=='false';
const TRADE_SIGNALS_ENABLED=String(process.env.TELEGRAM_TRADE_SIGNALS_ENABLED||'true').toLowerCase()!=='false';
const SESSION_BREAK_BUFFER_USD=Math.max(0.05,Number(process.env.TELEGRAM_SESSION_BREAK_BUFFER_USD||0.10));
const SESSION_SWEEP_CLOSE_TOLERANCE_USD=Math.max(SESSION_BREAK_BUFFER_USD,Number(process.env.TELEGRAM_SESSION_SWEEP_CLOSE_TOLERANCE_USD||0.10));
const SESSION_DECISIVE_CLOSE_USD=Math.max(SESSION_BREAK_BUFFER_USD,Number(process.env.TELEGRAM_SESSION_DECISIVE_CLOSE_USD||0.25));
const SESSION_RETEST_TOLERANCE_USD=Math.max(0.10,Number(process.env.TELEGRAM_SESSION_RETEST_TOLERANCE_USD||0.60));
const SESSION_SL_BUFFER_USD=Math.max(0.10,Number(process.env.TELEGRAM_SESSION_SL_BUFFER_USD||0.25));
const FRIDAY_PRIMARY_MAX_DISTANCE_USD=Math.max(1,Number(process.env.TELEGRAM_FRIDAY_PRIMARY_MAX_DISTANCE_USD||25));
const sessionLevelAlertKeys=new Set();
const sessionStatusSeen=new Map();
const sessionBreakState=new Map();
const SESSION_ALERT_FRESH_MS=Math.max(60_000,Number(process.env.TELEGRAM_SESSION_ALERT_FRESH_MS||180_000));
function closedBarIsFresh(bar,spanMs,now=Date.now()){
  const t=Number(bar?.t);
  if(!Number.isFinite(t)||!(spanMs>0))return false;
  const closeAt=t+spanMs;
  return now>=closeAt&&now-closeAt<=SESSION_ALERT_FRESH_MS;
}
const SESSION_OPEN_ALERTS=[
  {
    id:'LONDON',
    timeZone:'Europe/London',
    hour:8,
    minute:0,
    label:'LONDON OPEN',
    icon:'🇬🇧',
    watch:'Asia High/Low external-liquidity event → M5 MSS/displacement → retest/hold; FVG/OB supportive only'
  },
  {
    id:'NEW_YORK_GOLD',
    timeZone:'America/New_York',
    hour:8,
    minute:20,
    label:'NEW YORK GOLD OPEN',
    icon:'🇺🇸',
    watch:'London High/Low external-liquidity event → M5 MSS/displacement → retest/hold; FVG/OB supportive only'
  }
];

function num(v){if(v==null||v===''||typeof v==='boolean')return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function valid(v){const x=num(v);return x!=null&&x>0;}
function n(v,d=3){return valid(v)?Number(v).toFixed(d):'—';}
function money(v,d=2){return valid(v)?'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';}
function lotForRisk(entry,sl,riskUsd){const distance=Math.abs(Number(entry)-Number(sl));if(!(distance>0)||!(riskUsd>0))return null;const raw=riskUsd/(distance*XAU_CONTRACT_SIZE);if(!(raw>0))return null;const stepped=Math.floor((raw+1e-12)/XAU_LOT_STEP)*XAU_LOT_STEP;return stepped>=XAU_LOT_STEP?Number(stepped.toFixed(3)):0;}
function lotSizingLines(entry,sl){const distance=Math.abs(Number(entry)-Number(sl));if(!(distance>0))return [];const safeLot=lotForRisk(entry,sl,XAU_SAFE_RISK_USD),suggestedLot=safeLot&&safeLot>0?safeLot:XAU_LOT_STEP,actualRisk=distance*XAU_CONTRACT_SIZE*suggestedLot,safePct=XAU_SAFE_RISK_USD/XAU_ACCOUNT_BALANCE_USD*100;return[`💼 الرصيد المرجعي: ${XAU_ACCOUNT_BALANCE_USD.toFixed(0)}`,`📏 مسافة الوقف الهيكلي: ${distance.toFixed(2)}`,`✅ اللوت المرجعي: ${suggestedLot.toFixed(2)} lot (هدف مخاطرة مرجعي ≈ ${XAU_SAFE_RISK_USD.toFixed(0)} / ${safePct.toFixed(1)}%)`,`📊 الخطر الفعلي عند هذا اللوت والوقف: ≈ ${actualRisk.toFixed(2)}`,'ℹ️ لا يوجد سقف $10 مفروض على الصفقة؛ الوقف الهيكلي هو المرجع.'];}
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
  const status=String(s?.status||'').toUpperCase(),snapshotActive=s?.tradeState?.active===true;
  return Boolean(['ACTIVE','MANAGING','CONFIRMED'].includes(status)&&s?.signalId&&s?.entered===true&&s?.triggered===true&&['BUY','SELL'].includes(s?.side));
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
function mirrorWindowOpen(s,now=Date.now()){
  const issued=issuedAtOf(s);
  return issued!=null&&issued<=now+5000&&now-issued<=RECENT_KEY_TTL_MS;
}
function entryNoticeFresh(s,now=Date.now()){
  const issued=issuedAtOf(s);
  return issued!=null && issued<=now+5000 && now-issued<=ENTRY_ALERT_MAX_DELAY_MS
    && !s?.tp1 && !(Array.isArray(s?.targetHits)&&s.targetHits.some(Boolean));
}
function signalAfterSendEnable(s){
  const st=telegramSendState();
  if(!st.enabled)return false;
  const enabledAt=Date.parse(st.updatedAt||'');
  if(!Number.isFinite(enabledAt))return true;
  const issued=issuedAtOf(s);
  return issued!=null&&issued>=enabledAt-2000;
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
  const parts=clockParts(now,timeZone);
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


function sessionLevelsOf(s){
  const x=s?.sessionLevels?.sessions;
  return x&&typeof x==='object'?Object.values(x):[];
}
function sessionCandle(s,key){
  const b=s?.sessionLevels?.[key];
  if(!b||!valid(b.open)||!valid(b.high)||!valid(b.low)||!valid(b.close)||!Number.isFinite(Number(b.t)))return null;
  return {t:Number(b.t),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)};
}
function sessionModelSide(s){
  if(['BUY','SELL'].includes(s?.candidateAction))return s.candidateAction;
  if(['BUY','SELL'].includes(s?.action))return s.action;
  if(['BUY','SELL'].includes(s?.side))return s.side;
  return null;
}
function sessionIctReversalGate({phase,structureShift=false,retestTouch=false,held=false}={}){
  if(phase==='MSS')return Boolean(structureShift);
  if(phase==='RETEST')return Boolean(retestTouch&&held);
  return false;
}
function sessionIctContinuationGate({retestTouch=false,held=false,momentumAccepted=false}={}){
  return Boolean((retestTouch&&held)||momentumAccepted);
}
function sessionMomentumArm({side,level,bar}={}){
  const buy=side==='BUY',sell=side==='SELL',px=Number(level);
  if((!buy&&!sell)||!Number.isFinite(px)||!bar)return false;
  const open=Number(bar.open),close=Number(bar.close);
  if(!Number.isFinite(open)||!Number.isFinite(close))return false;
  const decisive=buy?close>px+SESSION_DECISIVE_CLOSE_USD:close<px-SESSION_DECISIVE_CLOSE_USD;
  const directional=buy?close>=open:close<=open;
  return Boolean(decisive&&directional);
}
function sessionMomentumAcceptance({side,level,bar,armedAt=0}={}){
  const buy=side==='BUY',sell=side==='SELL',px=Number(level);
  if((!buy&&!sell)||!Number.isFinite(px)||!bar||Number(bar.t)<=Number(armedAt||0))return false;
  const open=Number(bar.open),high=Number(bar.high),low=Number(bar.low),close=Number(bar.close);
  if(![open,high,low,close].every(Number.isFinite))return false;
  const held=buy?close>px:close<px;
  const noReclaim=buy?low>px:high<px;
  const directional=buy?close>=open:close<=open;
  return Boolean(held&&noReclaim&&directional);
}
function sessionLevelSummaryMessage(s){
  const rows=sessionLevelsOf(s);
  if(!rows.length)return '📍 XAUUSD — مستويات الجلسات\nلا توجد بيانات جلسات كافية حتى الآن.';
  const lines=rows.map(x=>`${x.icon||'📍'} ${x.label||x.id} • ${x.status||'—'}\n⬆️ High: ${n(x.high)}\n⬇️ Low: ${n(x.low)}\n📏 Range: ${n(x.range)} • M15`);
  return `📍 XAUUSD — SESSION HIGH / LOW\n${lines.join('\n\n')}\n\nالمستويات محسوبة من M15 وبالتوقيت المحلي لكل سوق.`;
}
function sessionFinalMessage(x){
  return `${x.icon||'📍'} XAUUSD — ${x.label||x.id} RANGE FINAL\n✅ تم تثبيت قمة وقاع الجلسة\n⬆️ High: ${n(x.high)}\n⬇️ Low: ${n(x.low)}\n📏 Range: ${n(x.range)}\n🗓️ ${x.date||'—'} • M15 (${x.startLocal||'—'}–${x.endLocal||'—'} ${x.timeZone||''})`;
}
function sessionBreakMessage(x,side,bar){
  const high=side==='HIGH',level=Number(high?x.high:x.low),distance=Math.abs(Number(bar.close)-level);
  return `${high?'🚨⬆️':'🚨⬇️'} XAUUSD — ${x.label||x.id} DECISIVE LEVEL BREAK — NO ENTRY YET\n✅ M15 أغلق ${high?'فوق القمة':'تحت القاع'} بإغلاق واضح عند سيولة خارجية\n📍 المستوى: ${n(level)}\n🕯️ M15 close: ${n(bar.close)} • مسافة الإغلاق: ${distance.toFixed(2)}\n🧭 ICT context: decisive close distance ≥ ${SESSION_DECISIVE_CLOSE_USD.toFixed(2)}\n⏳ ننتظر M5 retest/hold، أو decisive M5 close ثم شمعة M5 لاحقة تثبت no-reclaim hold.\n🧩 Model / OB / FVG / iFVG / BOS عوامل دعم فقط ولا تمنع الإشارة إذا اكتملت بوابة التنفيذ.\n🚫 لا دخول ولا SL لمجرد الكسر.`;
}
function sessionSweepMessage(x,side,bar){
  const high=side==='HIGH',level=Number(high?x.high:x.low),distance=Math.abs(Number(bar.close)-level),reversal=high?'SELL':'BUY';
  return `🧹 XAUUSD — ${x.label||x.id} LIQUIDITY SWEEP\n${high?'أخذ سيولة فوق القمة ثم عاد إغلاق M15 إلى نطاق المستوى':'أخذ سيولة تحت القاع ثم عاد إغلاق M15 إلى نطاق المستوى'}\n📍 المستوى: ${n(level)}\n🕯️ High/Low: ${n(high?bar.high:bar.low)} • Close: ${n(bar.close)} • فرق الإغلاق: ${distance.toFixed(2)}\n🧮 Sweep close tolerance: ±${SESSION_SWEEP_CLOSE_TOLERANCE_USD.toFixed(2)}\n🚫 ليس Breakout مؤكدًا؛ لا نستخدم خطة retest breakout.\n⏳ REVERSAL WATCH: ننتظر ${reversal} M5 MSS/structure shift ثم retest قبل أي دخول.`;
}
function sessionRetestMessage(x,side,bar,st,rows=[],now=Date.now()){
  const buy=side==='HIGH',tradeSide=buy?'BUY':'SELL',level=Number(st.level),range=Math.max(0,bar.high-bar.low),buffer=Math.max(SESSION_SL_BUFFER_USD,Math.min(.75,range*.15));
  const sl=buy?bar.low-buffer:bar.high+buffer;
  const entry=bar.close,risk=Math.abs(entry-sl);
  const zoneLo=level-SESSION_RETEST_TOLERANCE_USD;
  const zoneHi=level+SESSION_RETEST_TOLERANCE_USD;
  const targets=sessionTradeTargets(rows,tradeSide,entry,now);
  const targetLines=sessionTargetLines(targets,tradeSide);
  const momentum=st.continuationMode==='MOMENTUM_ACCEPTANCE';
  const title=momentum?'MOMENTUM ACCEPTANCE CONFIRMED':'RETEST CONFIRMED';
  const sequence=momentum?'external level event → decisive M5 close → next M5 no-reclaim hold':'external level event → M5 retest/hold';
  const gate=momentum?'external level event + decisive M5 close + next M5 no-reclaim hold':'external level event + M5 retest/hold';
  return `${buy?'🟢':'🔴'} XAUUSD — ${x.label||x.id} ${title}\n✅ ${tradeSide} continuation: ${sequence}\n📍 المستوى المكسور: ${n(level)}\n🎯 منطقة إعادة الاختبار المرجعية: ${n(zoneLo)} – ${n(zoneHi)}\n💵 Entry reference: ${n(entry)}\n🛑 SL: ${n(sl)}\n📏 مسافة الوقف: ${risk.toFixed(2)}\n${targetLines.join('\n')}\n📊 Advisory model: ${st.continuationModelSide||'WAIT'} • confidence ${Math.round(Number(st.continuationConfidence)||0)}% • ${st.continuationModelAligned?'aligned':'not gating'}\n🧠 Execution gate: ${gate}.\n🧩 OB / FVG / iFVG / BOS + model alignment = confluence only; لا تفتح الصفقة وحدها ولا تمنعها.\n🧱 الوقف خلف ${buy?'قاع':'قمة'} شمعة تأكيد M5 + buffer\n⚠️ لا تطارد الدخول إذا ابتعد السعر بعد شمعة التأكيد.`;
}
function sessionFailedBreakMessage(x,side,bar,st){
  const failedHighBreak=side==='HIGH',reversal=failedHighBreak?'SELL':'BUY';
  return `🧹 XAUUSD — ${x.label||x.id} FALSE BREAK / LIQUIDITY SWEEP DETECTED\n✅ M15 كسر ${failedHighBreak?'القمة':'القاع'} لكن M5 استعاد المستوى وأغلق ${failedHighBreak?'تحته':'فوقه'}.\n📍 المستوى: ${n(st.level)} • M5 close: ${n(bar.close)}\n❌ تم إلغاء خطة ${failedHighBreak?'BUY':'SELL'} breakout بالكامل.\n⏳ REVERSAL WATCH: ننتظر ${reversal} M5 structure shift/MSS ثم retest.\n🚫 لا Entry ولا SL حتى يكتمل التأكيد.`;
}
// Exit management is independent of the advisory AI model. A confirmed failed
// external-session breakout is enough to warn about a *currently tracked* trade;
// it is NOT permission to enter a new reverse trade or proof of broker execution.
function sessionEarlyExitMessage(s,lock,delivery,{session,side,bar,level,now=Date.now()}={}){
  if(!lock?.active||!delivery?.above||delivery?.exitAdvised||!lock.key||delivery.key!==lock.key)return null;
  if(!isConfirmedActive(s)||s?.tradeState?.active!==true||signalKey(s)!==lock.key)return null;
  if(terminalMatchesLock(lock,s)||s?.degraded||s?.liveFeedFresh!==true)return null;
  const age=num(s?.quoteAgeMs),updated=Date.parse(s?.updatedAt||'');
  if(age==null||age<0||age>20_000||!Number.isFinite(updated)||updated>now+5000||now-updated>20_000)return null;
  if(!['HIGH','LOW'].includes(side)||!closedBarIsFresh(bar,FIVE_MIN_MS,now))return null;
  const tradeSide=side==='HIGH'?'BUY':'SELL';
  if(sideOf(s)!==tradeSide||lock.side!==tradeSide)return null;
  const barCloseAt=Number(bar.t)+FIVE_MIN_MS,issued=issuedAtOf(s);
  if(issued==null||issued>=barCloseAt||issued>now)return null;
  const px=num(bar.close),boundary=num(level),stop=stopOf(s);
  if(px==null||boundary==null||!valid(stop)||!stopValid(tradeSide,entryOf(s),stop))return null;
  const rejected=tradeSide==='BUY'?px<boundary-SESSION_BREAK_BUFFER_USD:px>boundary+SESSION_BREAK_BUFFER_USD;
  const stillBeforeStop=tradeSide==='BUY'?px>stop:px<stop;
  const live=num(s?.price),liveBeforeStop=live!=null&&(tradeSide==='BUY'?live>stop:live<stop);
  if(!rejected||!stillBeforeStop||!liveBeforeStop)return null;
  return `🚨 XAUUSD — EXIT ${tradeSide} / خروج مبكر من الصفقة
🚪 اخرج من صفقة ${tradeSide} الحالية لحماية رأس المال؛ لا تنتظر ضرب SL إذا كنت لا تزال داخلها.
🧹 ${session?.label||session?.id||'EXTERNAL SESSION'} false break / liquidity sweep
📍 المستوى: ${n(boundary)} • إغلاق M5: ${n(px)}
🛑 وقف الصفقة الأصلي: ${n(stop)}
🧠 إبطال اختراق السيولة الخارجية، مستقل عن رأي النموذج ونسبة ثقته.
🚫 ليس دخول ${tradeSide==='BUY'?'SELL':'BUY'} ولا يعني أن الوسيط أغلق الصفقة.
⚠️ تنبيه خروج يدوي مبكر مبني على إغلاق M5 مؤكد.`;
}
async function maybeSendSessionEarlyExit(s,x,side,bar,st,now=Date.now()){
  if(!TRADE_SIGNALS_ENABLED||!telegramSendState().enabled)return false;
  const message=sessionEarlyExitMessage(s,tradeLock,sent,{session:x,side,bar,level:st?.level,now});
  if(!message)return false;
  await send(withTradeId(message,s.signalId));
  sent.exitAdvised=true;
  sent.managementKey='STOP|SESSION_FALSE_BREAK';
  console.log(`[telegram-xau-confirmed] early EXIT ${side==='HIGH'?'BUY':'SELL'} on M5 session false-break level=${n(st.level)} signal=${sent.key}`);
  return true;
}
function sessionReversalMssMessage(x,side,bar,st){
  const buy=side==='LOW',expected=buy?'BUY':'SELL',trigger=buy?bar.high:bar.low;
  return `🔄 XAUUSD — ${x.label||x.id} ${expected} STRUCTURE SHIFT DETECTED\n✅ بعد false break ظهر M5 shift موافق للانعكاس\n📍 Session level: ${n(st.level)}\n🧭 MSS trigger: ${n(trigger)}\n📊 Advisory model: ${st.reversalModelSide||'WAIT'} • confidence ${Math.round(Number(st.reversalConfidence)||0)}% • ${st.reversalModelAligned?'aligned':'not gating'}\n🧠 ICT execution gate: external sweep + M5 MSS; model/confidence are advisory only\n⏳ WAIT FOR M5 RETEST — لا دخول قبل إعادة الاختبار.`;
}
function sessionTradeTargets(rows,tradeSide,entry,now=Date.now()){
  const buy=tradeSide==='BUY',price=Number(entry);
  if(!['BUY','SELL'].includes(tradeSide)||!Number.isFinite(price))return {primary:null,secondary:null,runner:null,friday:false,primaryFiltered:false};
  const candidates=[];
  for(const row of Array.isArray(rows)?rows:[]){
    if(String(row?.status||'').toUpperCase()!=='CLOSED')continue;
    const level=Number(buy?row?.high:row?.low);
    if(!Number.isFinite(level)||(buy?level<=price:level>=price))continue;
    if(candidates.some(c=>Math.abs(c.level-level)<=SESSION_BREAK_BUFFER_USD))continue;
    candidates.push({
      level,
      label:`${row?.label||row?.id||'session'} ${buy?'high':'low'}`,
      distance:Math.abs(level-price)
    });
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  const friday=zonedClock(now,'Asia/Riyadh').weekday==='Fri';
  const secondary=candidates[0]||null;
  const strategic=candidates.find(c=>!secondary||c.distance>secondary.distance+SESSION_BREAK_BUFFER_USD)||secondary||null;
  const primary=strategic&&(!friday||strategic.distance<=FRIDAY_PRIMARY_MAX_DISTANCE_USD)?strategic:null;
  const secondaryDistinct=secondary&&primary&&Math.abs(secondary.level-primary.level)<=SESSION_BREAK_BUFFER_USD?null:secondary;
  const reserved=[secondaryDistinct?.level,primary?.level??strategic?.level].filter(Number.isFinite);
  const runner=candidates.find(c=>!reserved.some(level=>Math.abs(c.level-level)<=SESSION_BREAK_BUFFER_USD))||null;
  return {
    primary,
    secondary:secondaryDistinct,
    runner,
    friday,
    primaryFiltered:Boolean(strategic&&!primary),
    strategicCandidate:strategic
  };
}
function sessionLiquidityTargets(rows,side,entry,now=Date.now()){
  return sessionTradeTargets(rows,side==='LOW'?'BUY':'SELL',entry,now);
}
function sessionTargetLines(targets,tradeSide){
  const liquidityType=tradeSide==='BUY'?'BSL':'SSL',lines=[];
  const tp1=targets.secondary||targets.primary||null;
  const tp2=targets.secondary&&targets.primary?targets.primary:null;
  if(tp1)lines.push(`🎯 TP1 — ${targets.secondary?'Secondary':'Primary'} ${liquidityType}: ${n(tp1.level)} (${tp1.label})`);
  if(tp2)lines.push(`🎯 TP2 — Primary ${liquidityType}: ${n(tp2.level)} (${tp2.label})`);
  else if(targets.friday&&targets.primaryFiltered)lines.push(`🎯 TP2 — Primary ${liquidityType}: — (Friday: strategic external draw is beyond ${FRIDAY_PRIMARY_MAX_DISTANCE_USD.toFixed(0)} USD)`);
  if(targets.runner)lines.push(`🎯 Runner — External ${liquidityType}: ${n(targets.runner.level)} (${targets.runner.label}) • reference only`);
  if(targets.friday)lines.push(`🗓️ Friday filter: Primary max distance = ${FRIDAY_PRIMARY_MAX_DISTANCE_USD.toFixed(0)} USD from entry`);
  if(!lines.length)lines.push('🎯 External liquidity target: N/A — لا يوجد مستوى جلسة خارجي صالح بعد الدخول');
  return lines;
}
function sessionReversalSetupMessage(x,side,bar,st,rows=[],now=Date.now()){
  const buy=side==='LOW',expected=buy?'BUY':'SELL',range=Math.max(0,bar.high-bar.low),buffer=Math.max(SESSION_SL_BUFFER_USD,Math.min(.75,range*.15));
  const sweepExtreme=Number(st.sweepExtreme),entry=bar.close;
  const sl=buy?Math.min(Number.isFinite(sweepExtreme)?sweepExtreme:bar.low,bar.low)-buffer:Math.max(Number.isFinite(sweepExtreme)?sweepExtreme:bar.high,bar.high)+buffer;
  const risk=Math.abs(entry-sl),targets=sessionLiquidityTargets(rows,side,entry,now);
  const targetLines=sessionTargetLines(targets,expected);
  return `${buy?'🟢':'🔴'} XAUUSD — ${x.label||x.id} FALSE-BREAK REVERSAL SETUP\n✅ ${expected} confirmed: external liquidity sweep → M5 MSS → retest/hold\n📍 Swept level: ${n(st.level)}\n🧭 MSS trigger: ${n(st.reversalTrigger)}\n💵 Entry reference: ${n(entry)}\n🛑 Structural SL: ${n(sl)}\n📏 مسافة الوقف: ${risk.toFixed(2)} USD\n${targetLines.join('\n')}\n🧠 Execution gate ثابت: External Liquidity Sweep → M5 MSS → Retest/Hold → Entry.\n🧩 OB / FVG / iFVG / BOS + model alignment = confluence only; لا تفتح الصفقة وحدها ولا تمنعها.\n🧱 BUY يستهدف BSL وSELL يستهدف SSL. TP1 = الأقرب؛ TP2 = الهدف الاستراتيجي التالي؛ Runner = سيولة خارجية أبعد عند توفرها.\n🧱 SL خلف sweep extreme / retest structure، وليس رقمًا ثابتًا عند لحظة الكسر.`;
}
function sessionExecutionWatchMessage(x,side,bar,st,mode='REVERSAL'){
  const reversal=mode==='REVERSAL',expected=reversal?(side==='LOW'?'BUY':'SELL'):(side==='HIGH'?'BUY':'SELL');
  const level=Number(st?.level);
  const trigger=Number(st?.reversalTrigger);
  const sequence=reversal?'external liquidity sweep → M5 MSS → retest/hold':'external liquidity event → M5 continuation confirmation';
  return `🟡 XAUUSD — ${x.label||x.id} ICT SESSION SETUP COMPLETE
✅ ${expected} context complete: ${sequence}
📍 External level: ${n(level)}
${reversal?`🧭 MSS trigger: ${n(trigger)}\n`:''}🕯️ M5 close: ${n(bar?.close)}
⏳ WAIT FOR AUTHORITATIVE SITE SIGNAL
🚫 هذا تنبيه جلسة فقط، وليس صفقة دخول مستقلة.
🔒 Entry / SL / Targets تُعتمد فقط من /api/auto-trade/signal عندما تكون الحالة ACTIVE أو MANAGING وبـ signalId واحد.`;
}
async function maybeSendSessionLevelAlerts(s,now=Date.now()){
  if(!SESSION_LEVEL_ALERTS_ENABLED)return;
  const rows=sessionLevelsOf(s),m15=sessionCandle(s,'lastClosedM15'),m5=sessionCandle(s,'lastClosedM5');
  for(const x of rows){
    if(!x?.id||!x?.date||!valid(x.high)||!valid(x.low))continue;
    const status=String(x.status||'').toUpperCase(),statusKey=`${x.id}:${x.date}`,previousStatus=sessionStatusSeen.get(statusKey)||null;
    if(status==='OPEN')sessionStatusSeen.set(statusKey,'OPEN');
    if(status!=='CLOSED')continue;

    const finalKey=`FINAL:${x.id}:${x.date}`;
    if(previousStatus==='OPEN'&&!sessionLevelAlertKeys.has(finalKey)){
      await send(sessionFinalMessage(x));
      sessionLevelAlertKeys.add(finalKey);
      console.log(`[telegram-session-level] final ${finalKey} H=${n(x.high)} L=${n(x.low)}`);
    }
    sessionStatusSeen.set(statusKey,'CLOSED');

    if(m15&&closedBarIsFresh(m15,900000,now)){
      const allClosed=rows.filter(r=>String(r?.status||'').toUpperCase()==='CLOSED'&&valid(r.high)&&valid(r.low));
      const reclaimedLowerLow=allClosed.some(r=>Number(r.low)<Number(x.low)&&m15.low<Number(r.low)-SESSION_BREAK_BUFFER_USD&&m15.close>=Number(r.low)-SESSION_BREAK_BUFFER_USD);
      const reclaimedHigherHigh=allClosed.some(r=>Number(r.high)>Number(x.high)&&m15.high>Number(r.high)+SESSION_BREAK_BUFFER_USD&&m15.close<=Number(r.high)+SESSION_BREAK_BUFFER_USD);
      for(const side of ['HIGH','LOW']){
        const key=`${x.id}:${x.date}:${side}`,seenKey=`M15:${key}:${m15.t}`;
        if(sessionLevelAlertKeys.has(seenKey))continue;
        const level=Number(side==='HIGH'?x.high:x.low),threshold=side==='HIGH'?level+SESSION_BREAK_BUFFER_USD:level-SESSION_BREAK_BUFFER_USD;
        const rawBreak=side==='HIGH'?m15.close>level+SESSION_BREAK_BUFFER_USD:m15.close<level-SESSION_BREAK_BUFFER_USD;
        const decisiveBreak=side==='HIGH'?m15.close>level+SESSION_DECISIVE_CLOSE_USD:m15.close<level-SESSION_DECISIVE_CLOSE_USD;
        const conflicted=side==='LOW'?reclaimedLowerLow:reclaimedHigherHigh;
        const broke=decisiveBreak&&!conflicted;
        const swept=side==='HIGH'?(m15.high>threshold&&m15.close<=level+SESSION_SWEEP_CLOSE_TOLERANCE_USD):(m15.low<threshold&&m15.close>=level-SESSION_SWEEP_CLOSE_TOLERANCE_USD);
        if(rawBreak&&conflicted){
          const mixKey=`MIXED:${key}:${m15.t}`;
          if(!sessionLevelAlertKeys.has(mixKey)){
            await send(`⚠️ XAUUSD — MULTI-SESSION MIXED RECLAIM\n${side==='LOW'?'تم كسر مستوى جلسة أعلى لكن مستوى جلسة أدنى تم سحبه ثم استعادته':'تم كسر مستوى جلسة أدنى لكن مستوى جلسة أعلى تم سحبه ثم استعادته'}\n📍 ${x.label||x.id}: ${n(level)}\n🕯️ M15 close: ${n(m15.close)}\n🚫 لا SELL/BUY continuation من هذا المستوى وحده\n⏳ انتظر M5 confirmation + reclaim/rejection واضح قبل أي دخول.`);
            sessionLevelAlertKeys.add(mixKey);
          }
        }else if(broke){
          const breakKey=`BREAK:${key}`;
          if(!sessionLevelAlertKeys.has(breakKey)){
            await send(sessionBreakMessage(x,side,m15));
            sessionLevelAlertKeys.add(breakKey);
            sessionBreakState.set(key,{side,level,breakBarT:m15.t,breakCloseAt:m15.t+900000,breakHigh:m15.high,breakLow:m15.low,sweepExtreme:side==='HIGH'?m15.high:m15.low,retestSent:false,failed:false,reversalMss:false,reversalSent:false});
            console.log(`[telegram-session-level] M15 break ${key} close=${n(m15.close)}`);
          }
        }else if(swept){
          const sweepKey=`SWEEP:${key}:${m15.t}`;
          if(!sessionLevelAlertKeys.has(sweepKey)){
            await send(sessionSweepMessage(x,side,m15));
            sessionLevelAlertKeys.add(sweepKey);
            sessionBreakState.set(key,{side,level,breakBarT:m15.t,breakCloseAt:m15.t+900000,breakHigh:m15.high,breakLow:m15.low,sweepExtreme:side==='HIGH'?m15.high:m15.low,retestSent:false,failed:true,failedBarT:m15.t,failedBarHigh:m15.high,failedBarLow:m15.low,failedAtMs:now,reversalMss:false,reversalSent:false,directSweep:true});
            console.log(`[telegram-session-level] direct sweep / reversal watch ${key} close=${n(m15.close)}`);
          }
        }
        sessionLevelAlertKeys.add(seenKey);
      }
    }

    if(m5){
      for(const side of ['HIGH','LOW']){
        const key=`${x.id}:${x.date}:${side}`,st=sessionBreakState.get(key);
        if(!st||st.retestSent||m5.t<st.breakCloseAt)continue;
        const level=Number(st.level),continuationBuy=side==='HIGH';

        if(st.failed){
          if(st.failedBar)await maybeSendSessionEarlyExit(s,x,side,st.failedBar,st,now);
          const reversalBuy=side==='LOW',expected=reversalBuy?'BUY':'SELL',modelSide=sessionModelSide(s),conf=confidenceOf(s),minConf=Math.max(75,Number(process.env.GOLD_TELEGRAM_MIN_CONFIDENCE||process.env.TELEGRAM_MIN_CONFIDENCE||75));
          if(!st.reversalMss){
            if(m5.t<=Number(st.failedBarT||0))continue;
            const structureShift=reversalBuy?m5.close>Number(st.failedBarHigh)+SESSION_BREAK_BUFFER_USD:m5.close<Number(st.failedBarLow)-SESSION_BREAK_BUFFER_USD;
            const advisoryAligned=modelSide===expected&&conf>=minConf;
            if(sessionIctReversalGate({phase:'MSS',structureShift})){
              st.reversalMss=true;
              st.reversalMssBarT=m5.t;
              st.reversalTrigger=reversalBuy?m5.high:m5.low;
              st.reversalConfidence=conf;
              st.reversalModelSide=modelSide;
              st.reversalModelAligned=advisoryAligned;
              sessionBreakState.set(key,st);
              await send(sessionReversalMssMessage(x,side,m5,st));
              console.log(`[telegram-session-level] reversal MSS ${key} side=${expected} trigger=${n(st.reversalTrigger)} advisory=${modelSide||'WAIT'}/${Math.round(conf)}`);
            }
            continue;
          }
          if(st.reversalSent||m5.t<=Number(st.reversalMssBarT||0))continue;
          const trigger=Number(st.reversalTrigger);
          const retestTouch=reversalBuy?m5.low<=trigger+SESSION_RETEST_TOLERANCE_USD:m5.high>=trigger-SESSION_RETEST_TOLERANCE_USD;
          const held=reversalBuy?m5.close>trigger:m5.close<trigger;
          if(sessionIctReversalGate({phase:'RETEST',retestTouch,held})){
            st.reversalConfidence=conf;
            st.reversalModelSide=modelSide;
            st.reversalModelAligned=modelSide===expected&&conf>=minConf;
            await send(sessionExecutionWatchMessage(x,side,m5,st,'REVERSAL'));
            st.reversalSent=true;st.retestSent=true;st.reversalRetestBarT=m5.t;sessionBreakState.set(key,st);
            console.log(`[telegram-session-level] reversal setup ${key} side=${expected} entry=${n(m5.close)} advisory=${modelSide||'WAIT'}/${Math.round(conf)}`);
          }
          continue;
        }

        const retestTouch=continuationBuy?m5.low<=level+SESSION_RETEST_TOLERANCE_USD:m5.high>=level-SESSION_RETEST_TOLERANCE_USD;
        const held=continuationBuy?m5.close>level:m5.close<level;
        const failed=continuationBuy?m5.close<level-SESSION_BREAK_BUFFER_USD:m5.close>level+SESSION_BREAK_BUFFER_USD;
        const expected=continuationBuy?'BUY':'SELL',modelSide=sessionModelSide(s),conf=confidenceOf(s),minConf=Math.max(75,Number(process.env.GOLD_TELEGRAM_MIN_CONFIDENCE||process.env.TELEGRAM_MIN_CONFIDENCE||75));
        const advisoryAligned=modelSide===expected&&conf>=minConf;
        const momentumAccepted=Boolean(st.momentumAcceptanceArmed&&sessionMomentumAcceptance({side:expected,level,bar:m5,armedAt:st.momentumAcceptanceBarT}));
        if(sessionIctContinuationGate({retestTouch,held,momentumAccepted})){
          st.continuationConfidence=conf;
          st.continuationModelSide=modelSide;
          st.continuationModelAligned=advisoryAligned;
          st.continuationMode=momentumAccepted&&!retestTouch?'MOMENTUM_ACCEPTANCE':'RETEST';
          await send(sessionExecutionWatchMessage(x,side,m5,st,'CONTINUATION'));
          st.retestSent=true;st.retestBarT=m5.t;sessionBreakState.set(key,st);
          console.log(`[telegram-session-level] M5 continuation ${key} mode=${st.continuationMode} side=${expected} advisory=${modelSide||'WAIT'}/${Math.round(conf)} entry=${n(m5.close)}`);
        }else if(failed){
          st.failed=true;
          st.failedBarT=m5.t;
          st.failedBar={...m5};
          st.failedBarHigh=m5.high;
          st.failedBarLow=m5.low;
          st.failedAtMs=now;
          st.sweepExtreme=side==='HIGH'?Math.max(Number(st.sweepExtreme)||m5.high,m5.high):Math.min(Number(st.sweepExtreme)||m5.low,m5.low);
          sessionBreakState.set(key,st);
          await send(sessionFailedBreakMessage(x,side,m5,st));
          await maybeSendSessionEarlyExit(s,x,side,m5,st,now);
          console.log(`[telegram-session-level] false break / reversal watch ${key} close=${n(m5.close)}`);
        }else if(!st.momentumAcceptanceArmed&&!retestTouch&&sessionMomentumArm({side:expected,level,bar:m5})){
          st.momentumAcceptanceArmed=true;
          st.momentumAcceptanceBarT=m5.t;
          st.momentumAcceptanceClose=m5.close;
          sessionBreakState.set(key,st);
          console.log(`[telegram-session-level] M5 momentum acceptance armed ${key} side=${expected} close=${n(m5.close)}; waiting next M5 no-reclaim hold`);
        }
      }
    }
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
      {command:'evaluate',description:'📊 تقييم صفقات الذهب والبيتكوين'},
      {command:'snr',description:'🧱 SNR الذهب: دعم/مقاومة كعامل مساعد'},
      {command:'sessions',description:'📍 قمم وقيعان طوكيو ولندن ونيويورك'},
      {command:'signals_off',description:'⏸ إيقاف إرسال التنبيهات'},
      {command:'signals_on',description:'▶️ تشغيل إرسال التنبيهات'},
      {command:'signals_status',description:'ℹ️ حالة إرسال البوت'}
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
    reply_markup:{keyboard:[[{text:'📊 تقييم الصفقات'}],[{text:'⏸ إيقاف الإرسال'},{text:'▶️ تشغيل الإرسال'}],[{text:'ℹ️ حالة الإرسال'}]],resize_keyboard:true,persistent:true}
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
function withTradeId(message,signalId){
  return message && signalId ? `${message}\n🆔 ${signalId}` : message;
}
function tpHitMessage(i,target){
  return `✅ XAUUSD — TP${i+1} HIT / تم ضرب الهدف ${i+1}\n🎯 TP${i+1}: ${n(target)}`;
}
function managedStopMessage(i,managed){
  return `🔒 XAUUSD — بعد TP${i+1}\n⬆️ ارفع وقف الخسارة إلى: ${n(managed)}`;
}
function managementDecisionOf(s){
  const d=s?.agentStack?.agents?.tradeManager?.managementDecision||s?.agents?.tradeManager?.managementDecision||s?.tradeManagement||null;
  if(!d||d.confirmed!==true||!['CONTINUE','STOP'].includes(String(d.action||'').toUpperCase()))return null;
  return {...d,action:String(d.action).toUpperCase()};
}
function tradeManagementMessage(s){
  const d=managementDecisionOf(s);
  if(!d)return null;
  const side=sideOf(s)||'TRADE',confidence=Math.round(Number(d.confidence)||0),live=n(s?.price),modelSide=String(d.modelSide||side);
  const structure=String(d.structureState||'UNKNOWN').toUpperCase(),m5=String(d.m5Side||'—');
  if(d.action==='STOP'){
    const sweep=d.reversalSweep||{},mss=d.reversalMss||{},retest=d.reversalRetest||{};
    const reversalLine=d.earlyExit
      ? `🔄 انعكاس ICT مؤكد إلى ${d.reversalSide||modelSide}: External Sweep ${sweep.name?String(sweep.name).toUpperCase():''} ${valid(sweep.level)?n(sweep.level):''} → M5 MSS → Retest/Hold ${valid(retest.level)?n(retest.level):''}`
      : '🛑 السعر وصل إلى وقف الخسارة.';
    return `🚨 XAUUSD — EXIT TRADE NOW
🚪 اخرج يدويًا من صفقة ${side}${d.earlyExit?' قبل انتظار SL':''}
${reversalLine}
💵 السعر الآن: ${live}
🧱 Trade structure: ${structure}
📊 Model confidence: ${confidence}% • advisory only
🧠 ${d.reason||'تم تأكيد انعكاس بنيوي ضد الصفقة.'}
⚠️ هذا تنبيه خروج للصفقة الحالية فقط — لا يفتح صفقة عكسية ولا يرسل أمر MT5 تلقائيًا.`;
  }
  return `✅ XAUUSD — CONTINUE TRADE
📌 استمر في صفقة ${side}
🧱 M5/ICT structure: ${structure} • M5 ${m5}
📊 Advisory model: ${modelSide} • ${confidence}%
💵 السعر الآن: ${live}
🧠 ${d.reason||'بنية ICT/M5 ما زالت صالحة؛ ثقة النموذج عامل مساعد فقط.'}
🛡️ حافظ على SL / managed stop الحالي حتى يصدر تحديث جديد.`;
}
async function sendTradeManagement(s){
  if(sent.exitAdvised)return false; // Never contradict an already-delivered manual EXIT with CONTINUE.
  if(!sent.above||sent.key!==signalKey(s))return false;
  const d=managementDecisionOf(s);
  if(!d)return false;
  const key=`${d.action}|${d.exitTrigger||''}|${d.reversalSide||d.modelSide||''}|${d.reversalRetest?.t||''}`;
  if(sent.managementKey===key)return false;
  const message=tradeManagementMessage(s);
  if(!message)return false;
  await send(withTradeId(message,s.signalId));
  sent.managementKey=key;
  console.log(`[telegram-xau-confirmed] trade-management ${key} confidence=${Math.round(Number(d.confidence)||0)} signal=${sent.key}`);
  return true;
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
      await send(withTradeId(tpHitMessage(i,targets[i]),sent.key));
      sent.targets[i]=true;
      console.log(`[telegram-xau-confirmed] TP${i+1} hit key=${sent.key} target=${n(targets[i])}`);
    }
    if(i<3&&hitProven&&valid(managed)&&!sent.managedStops[i]){
      await send(withTradeId(managedStopMessage(i,managed),sent.key));
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
  sent.managementKey=null;
  sent.exitAdvised=false;
}
async function tick(){
  try{
    if(!(await startup()))return;
    const now=Date.now();
    let s=null;
    if(SESSION_LEVEL_ALERTS_ENABLED){
      const sessionResponse=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});
      if(!sessionResponse.ok)throw new Error(`signal ${sessionResponse.status}`);
      s=await sessionResponse.json();
      await maybeSendSessionLevelAlerts(s,now);
    }
    const sendControl=telegramSendState();
    if(!sendControl.enabled){
      if(lastSendControlEnabled!==false){
        resetSent();
        clearTradeLock();
        console.log('[telegram-xau-confirmed] trade alerts muted by bot control; session-level alerts remain active');
      }
      lastSendControlEnabled=false;
      return;
    }
    if(lastSendControlEnabled===false)console.log('[telegram-xau-confirmed] trade alerts resumed by bot control');
    lastSendControlEnabled=true;
    if(!s&&TRADE_SIGNALS_ENABLED){
      const r=await fetch(AUTO_URL,{cache:'no-store',signal:AbortSignal.timeout(7000)});
      if(!r.ok)throw new Error(`signal ${r.status}`);
      s=await r.json();
    }
    await maybeSendSessionOpenAlert(now);
    if(!TRADE_SIGNALS_ENABLED)return;
    cleanupRecent(now);

    if(terminalMatchesLock(tradeLock,s)){
      if(!sent.above||sent.key!==tradeLock.key){resetSent();clearTradeLock();return;}
      const terminal=s.terminalEvent;
      await sendTargetHits(terminal,{includeTp4:false});
      const closeText=terminalMessage(terminal);
      if(closeText)await send(withTradeId(closeText,terminal.signalId));
      console.log(`[telegram-xau-confirmed] trade lock released ${tradeLock.side} key=${tradeLock.key} outcome=${terminal?.outcome||terminal?.result||'CLOSED'}`);
      resetSent();
      clearTradeLock();
      return;
    }

    const active=isConfirmedActive(s),side=sideOf(s),confidence=confidenceOf(s),entry=entryOf(s),sl=stopOf(s),key=signalKey(s);
    const sameLockedTrade=tradeLock.active&&tradeLock.key===key;
    // A deployment/restart must not make Telegram miss a trade that the site has
    // already promoted to ACTIVE. Mirror recent confirmed lifecycle state, but do
    // not resurrect stale trades after the configured recent-signal window.
    // Asian/off-session analysis must never become a fresh Telegram BUY/SELL.
    // Apply the session check both to the entry issue time and to delivery time.
    // Locked trades still receive TP/SL and STOP/CONTINUE management off-hours.
    const eligibleNewTrade=!tradeLock.active&&goldEntryWindow(now).allowed&&goldEntryWindow(issuedAtOf(s)??now).allowed&&mirrorWindowOpen(s,now)&&entryNoticeFresh(s,now)&&signalAfterSendEnable(s);
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
        sent.managementKey=null;
        sent.exitAdvised=false;
        recentKeys.set(key,now);
        console.log(`[telegram-xau-confirmed] sent+locked ${side} ${Math.round(confidence)}% entry=${n(entry)} SL=${n(sl)} key=${key} msg=${messageId||'na'}`);
      }else if(sameLockedTrade&&sent.above&&sent.key===key&&sent.messageId&&text!==sent.lastText&&now-sent.lastEditMs>=EDIT_MIN_MS){
        await edit(sent.messageId,text);
        sent.lastText=text;
        sent.lastEditMs=now;
        console.log(`[telegram-xau-confirmed] edited locked ${side} ${Math.round(confidence)}% key=${key} msg=${sent.messageId}`);
      }
      if(sameLockedTrade||tradeLock.key===key){
        await sendTargetHits(s);
        await sendTradeManagement(s);
      }
      return;
    }

    if(sameLockedTrade&&sent.above){
      await sendTargetHits(s);
      await sendTradeManagement(s);
      return;
    }
    if(tradeLock.active&&active&&key!==tradeLock.key){
      console.warn(`[telegram-xau-confirmed] blocked overlapping ${side} key=${key}; locked=${tradeLock.side} ${tradeLock.key}`);
      return;
    }
    if(active&&!tradeLock.active&&!eligibleNewTrade){
      // A restored or already-consumed trade was not announced to this chat.
      // Never forge a delivery receipt: TP/SL/management must follow a successfully sent entry.
      if(!recentKeys.has(key)){
        recentKeys.set(key,now);
        console.warn(`[telegram-xau-confirmed] suppressed orphan lifecycle alerts: entry not delivered key=${key} ageMs=${now-(issuedAtOf(s)||now)}`);
      }
      return;
    }
  }catch(e){console.error('[telegram-xau-confirmed]',e?.message||e);}
}

console.log(`[telegram-xau-confirmed] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} session-level-alerts=${SESSION_LEVEL_ALERTS_ENABLED?'on':'off'}; trade-signals=${TRADE_SIGNALS_ENABLED?'on':'off'}; gold-snr=advisory-only; one-active-trade lock; TP/SL + STOP/CONTINUE management alerts=on`);
if(process.env.NODE_ENV!=='test'){
  (async function loop(){while(true){await tick();await new Promise(r=>setTimeout(r,POLL_MS));}})();
  (async function commands(){await botCommandLoop();})();
}

export {targetMessage,canSendSignal,entryNoticeFresh,withTradeId,fiveMinuteCloseConfirmed,mirrorWindowOpen,terminalMatchesLock,lockAllowsSignal,signalKey,tpHitMessage,terminalMessage,tradeManagementMessage,tradeReview,evaluationMessage,assetEvaluationMessage,readBtcClosedTrades,sessionLevelSummaryMessage,sessionFinalMessage,sessionBreakMessage,sessionSweepMessage,sessionTradeTargets,sessionLiquidityTargets,sessionRetestMessage,sessionReversalSetupMessage,sessionIctReversalGate,sessionIctContinuationGate,sessionMomentumArm,sessionMomentumAcceptance,sessionExecutionWatchMessage,sessionEarlyExitMessage};
