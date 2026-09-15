import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function patchSiteSignalUi(source) {
  const mapper = `function goldSignalReading(raw){
  const base=goldBrowserReading(raw),now=Date.now(),confidence=Math.max(Number(raw?.signalConfidence)||0,Number(raw?.confidence)||0),side=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.side)?raw.side:null),active=Boolean(raw?.signalId&&['ACTIVE','MANAGING'].includes(raw?.status)&&side),stale=Boolean(raw?.degraded)||base.stale,complete=Math.max(0,Math.min(100,Number(raw?.readingCompleteness)||0)),collecting=!stale&&!active&&String(raw?.status||'').toUpperCase()==='COLLECTING',candidate=!stale&&!active&&Boolean(side)&&String(raw?.status||'').toUpperCase()==='CANDIDATE',entry=Number.isFinite(Number(raw?.entry))?Number(raw.entry):(Number.isFinite(Number(raw?.entryLow))&&Number.isFinite(Number(raw?.entryHigh))?(Number(raw.entryLow)+Number(raw.entryHigh))/2:Number(base.price)),entryLow=Number(raw?.entryLow),entryHigh=Number(raw?.entryHigh),live=Number(base.price),target1=Number(raw?.target1),target2=Number(raw?.target2),stop=Number(raw?.stopLoss),expected=(active||candidate)&&Number.isFinite(target1)&&Number.isFinite(entry)?Math.abs(target1-entry):null,inCandidateRange=candidate&&Number.isFinite(live)&&Number.isFinite(entryLow)&&Number.isFinite(entryHigh)&&live>=Math.min(entryLow,entryHigh)&&live<=Math.max(entryLow,entryHigh),oneMinuteConfirmed=Boolean(raw?.oneMinuteConfirmed);
  const planState=stale?'STALE':active?(side==='BUY'?'UP':'DOWN'):collecting?'COLLECTING':'WAIT';
  let waitingNote=raw?.reason||'بانتظار إشارة مؤكدة من محرك الموقع.';
  if(candidate){
    const sideLabel=side==='BUY'?'BUY صاعد':'SELL هابط';
    if(!oneMinuteConfirmed)waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% — الاتجاه موجود لكن تأكيد شمعة 1m لم يكتمل بعد؛ لا توجد صفقة مؤكدة.';
    else if(!inCandidateRange)waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% وتأكيد 1m مكتمل، لكن السعر خارج نطاق الدخول المقبول '+(Number.isFinite(entryLow)&&Number.isFinite(entryHigh)?Number(Math.min(entryLow,entryHigh).toFixed(2))+'–'+Number(Math.max(entryLow,entryHigh).toFixed(2)):'')+'. ننتظر Retest بدل مطاردة الحركة.';
    else waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% والسعر داخل نطاق الدخول؛ محرك الموقع يفحص الآن التقلب وRR وحماية ما بعد الخسارة قبل اعتماد الصفقة.';
  }
  const plan={state:planState,confidence:Math.round(confidence),target1:active&&Number.isFinite(target1)?target1:null,target2:active&&Number.isFinite(target2)?target2:null,invalidation:active&&Number.isFinite(stop)?stop:null,entry:active&&Number.isFinite(entry)?entry:null,entryLow:active&&Number.isFinite(entryLow)?entryLow:null,entryHigh:active&&Number.isFinite(entryHigh)?entryHigh:null,eta1:null,eta2:null,sampleCount:Number(raw?.sampleCount)||0,spanMinutes:complete>=100?5:Number((complete/20).toFixed(1)),channel:side==='BUY'?'RISING':side==='SELL'?'FALLING':'FLAT',expectedMove5:Number.isFinite(expected)?Number(expected.toFixed(2)):null,expectedMovePct:Number.isFinite(expected)&&entry>0?Number((expected/entry*100).toFixed(3)):null,note:stale?'بيانات السعر غير حديثة؛ الإشارات متوقفة حتى عودة المصدر.':active?'CONFIRMED SITE SIGNAL — تم اعتماد الصفقة من محرك الموقع وإرسالها إلى تيليغرام.':collecting?(raw?.reason||'تحميل تاريخ السوق من الخادم…'):waitingNote};
  return {...base,direction:active?(side==='BUY'?'UP':'DOWN'):(collecting?'COLLECTING':'FLAT'),plan};
}`;

  if (!source.includes('function goldSignalReading(raw){') && source.includes('function goldBrowserReading(raw){')) {
    source = source.replace('function goldBrowserReading(raw){', mapper + '\nfunction goldBrowserReading(raw){');
  }

  source = source.replaceAll('const d=goldBrowserReading(raw);', 'const d=goldSignalReading(raw);');
  source = source.replace(
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'لا تُعرض صفقة إلا بعد اعتمادها من محرك الموقع ولمس نطاق الدخول؛ أثناء الانتظار تُعرض الحركة المتوقعة وسبب عدم الاعتماد بدون إرسال دخول مبكر. لا يوجد AI في قرار الإشارة.'
  );
  source = source.replace(
    "lock={state:plan.state,entry:p,target1:t1",
    "lock={state:plan.state,entry:Number.isFinite(Number(plan.entry))?Number(plan.entry):p,target1:t1"
  );
  source = source.replace(
    "$('#goldModelWindow').textContent=channelLabel+' • رصد '+plan.spanMinutes+' د';",
    "$('#goldModelWindow').textContent=(plan.state==='COLLECTING'?'تهيئة بيانات الخادم':channelLabel+' • محرك الموقع');"
  );
  return source;
}

fs.writeFileSync = function(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) return previousWriteFileSync(path, data, ...args);
  const isBuffer = Buffer.isBuffer(data);
  const patched = patchSiteSignalUi(isBuffer ? data.toString('utf8') : String(data));
  return previousWriteFileSync(path, isBuffer ? Buffer.from(patched, 'utf8') : patched, ...args);
};

syncBuiltinESMExports();
await import('./gold-target-range-fix-start.js');
