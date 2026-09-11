import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchTargetTracking(source){
  const old="lock.tp1Hit=Boolean(lock.tp1Hit)||reachedGoldLevel(lock.state,p,lock.target1);lock.tp2Hit=Boolean(lock.tp2Hit)||reachedGoldLevel(lock.state,p,lock.target2);";
  const next="const observedRows=(typeof goldSamples!=='undefined'&&Array.isArray(goldSamples)?goldSamples:[]).filter(x=>Number(x.t)>=Number(lock.createdAt||0)).map(x=>Number(x.price)).filter(Number.isFinite);if(Number.isFinite(p))observedRows.push(p);const observedLow=observedRows.length?Math.min(...observedRows):p,observedHigh=observedRows.length?Math.max(...observedRows):p;lock.minSeen=Number.isFinite(Number(lock.minSeen))?Math.min(Number(lock.minSeen),observedLow):observedLow;lock.maxSeen=Number.isFinite(Number(lock.maxSeen))?Math.max(Number(lock.maxSeen),observedHigh):observedHigh;lock.tp1Hit=Boolean(lock.tp1Hit)||(lock.state==='UP'?Number(lock.maxSeen)>=Number(lock.target1):Number(lock.minSeen)<=Number(lock.target1));lock.tp2Hit=Boolean(lock.tp2Hit)||(lock.state==='UP'?Number(lock.maxSeen)>=Number(lock.target2):Number(lock.minSeen)<=Number(lock.target2));";
  if(source.includes(old))source=source.replace(old,next);

  // Prefer the auto engine quote so the UI and execution path agree. If that engine is
  // temporarily recovering, keep the visible quote alive with Gold API instead of blanking
  // the whole panel. Trading signals remain fail-closed inside the auto engine.
  const resilientQuote="let raw;try{const r=await fetch('/api/auto-trade/signal?observe=1&_='+Date.now(),{cache:'no-store'});raw=await r.json();if(!r.ok||!Number.isFinite(Number(raw?.price))||!raw?.updatedAt||raw?.degraded===true)throw new Error(raw?.reason||'engine quote unavailable')}catch(_e){const fr=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store'}),fd=await fr.json();if(!fr.ok||!Number.isFinite(Number(fd?.price))||Number(fd.price)<=0)throw new Error('تعذر تحميل سعر الذهب');raw={...fd,updatedAt:fd.updatedAt||new Date().toISOString(),provider:'GOLD_API_FALLBACK',degraded:true}}const d=goldBrowserReading(raw);";
  source=source.replace(
    "const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store'}),raw=await r.json(),d=goldBrowserReading(raw);",
    resilientQuote
  );
  source=source.replace(
    "const r=await fetch('/api/gold-live',{cache:'no-store'}),raw=await r.json(),d=goldBrowserReading(raw);",
    resilientQuote
  );
  source=source.replace(
    "const r=await fetch('/api/auto-trade/signal?observe=1&_='+Date.now(),{cache:'no-store'}),raw=await r.json();if(!r.ok||!Number.isFinite(Number(raw?.price))||!raw?.updatedAt)throw new Error(raw?.reason||'مصدر الذهب غير جاهز');const d=goldBrowserReading(raw);",
    resilientQuote
  );
  source=source.replace(
    'السعر من Gold API ويُفحص كل 30 ثانية؛ الشارت 5 دقائق من OANDA عبر TradingView وقد يظهر فرق بسيط بين المصدرين.',
    'السعر الأساسي من محرك Gold Alpha بمرجعية MT5 عند الاتصال؛ وعند تعطل المصدر مؤقتًا يظهر سعر احتياطي للعرض فقط بينما تبقى الإشارات متوقفة حتى عودة بيانات التنفيذ.'
  );
  source=source.replace(
    'السعر من محرك Gold Alpha بمرجعية MT5 عند الاتصال، ويُحدّث كل ثانية؛ الشارت 5 دقائق من TradingView للمقارنة البصرية.',
    'السعر الأساسي من محرك Gold Alpha بمرجعية MT5 عند الاتصال؛ وعند تعطل المصدر مؤقتًا يظهر سعر احتياطي للعرض فقط بينما تبقى الإشارات متوقفة حتى عودة بيانات التنفيذ.'
  );
  source=source.replace(
    'السعر من نفس محرك Gold Alpha المستخدم للإشارات، بمرجعية MT5 عند الاتصال، ويُحدّث كل ثانية؛ الشارت من TradingView للمقارنة البصرية.',
    'السعر الأساسي من محرك Gold Alpha بمرجعية MT5 عند الاتصال؛ وعند تعطل المصدر مؤقتًا يظهر سعر احتياطي للعرض فقط بينما تبقى الإشارات متوقفة حتى عودة بيانات التنفيذ.'
  );

  // Never create a fresh locked entry after price has already reached/passed TP1.
  const oldLockCreate="if(!lock&&!cooling&&fresh&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){lock={state:plan.state,entry:p,target1:Number(plan.target1),target2:Number(plan.target2),invalidation:Number(plan.invalidation),confidence:Number(plan.confidence||0),createdAt:Date.now(),tp1Hit:false,tp2Hit:false};writeGoldTradeLock(lock)}";
  const newLockCreate="if(!lock&&!cooling&&fresh&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){const t1=Number(plan.target1),late=plan.state==='UP'?p>=t1:p<=t1;if(late){return{...plan,state:'WAIT',entry:null,target1:null,target2:null,invalidation:null,locked:false,consumed:true,cooling:false,tradeCompleted:false,tp1Hit:false,tp2Hit:false,note:'NO LATE ENTRY — السعر وصل الهدف الأول قبل ظهور الدخول؛ أُلغي السيناريو وننتظر فرصة جديدة.'}}lock={state:plan.state,entry:p,target1:t1,target2:Number(plan.target2),invalidation:Number(plan.invalidation),confidence:Number(plan.confidence||0),createdAt:Date.now(),tp1Hit:false,tp2Hit:false};writeGoldTradeLock(lock)}";
  if(source.includes(oldLockCreate))source=source.replace(oldLockCreate,newLockCreate);

  source=source.replaceAll('setInterval(loadGold,30000)','setInterval(loadGold,1000)');
  source=source.replaceAll('setInterval(loadGold,5000)','setInterval(loadGold,1000)');
  source=source.replaceAll('setInterval(loadGold,20000)','setInterval(loadGold,1000)');

  source=source.replace(
    "note:'✓ اكتملت الصفقة السابقة — بانتظار سيناريو جديد.'",
    "note:'✓ اكتملت الأهداف السابقة وتم إغلاق السيناريو — يجري الآن البحث عن سيناريو جديد.'"
  );
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data);
  const patched=patchTargetTracking(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-news-start.js');