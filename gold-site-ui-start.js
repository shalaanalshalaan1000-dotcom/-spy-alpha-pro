import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function patchSiteSignalUi(source) {
  const mapper = `function goldSignalReading(raw){
  const base=goldBrowserReading(raw),now=Date.now(),confidence=Math.max(Number(raw?.signalConfidence)||0,Number(raw?.confidence)||0),rawStatus=String(raw?.status||'').toUpperCase(),primarySide=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.side)?raw.side:null),guardSide=['BUY','SELL'].includes(raw?.entryGuard?.side)?raw.entryGuard.side:null,predictedSide=['BUY','SELL'].includes(raw?.prediction?.side)?raw.prediction.side:null,displaySide=primarySide||guardSide||predictedSide,active=Boolean(raw?.signalId&&['ACTIVE','MANAGING'].includes(rawStatus)&&primarySide),stale=Boolean(raw?.degraded)||base.stale,complete=Math.max(0,Math.min(100,Number(raw?.readingCompleteness)||0)),collecting=!stale&&!active&&rawStatus==='COLLECTING',candidate=!stale&&!active&&Boolean(primarySide)&&rawStatus==='CANDIDATE',guarded=!stale&&!active&&!candidate&&Boolean(guardSide)&&rawStatus==='WAIT',predictive=!stale&&!active&&!candidate&&!guarded&&Boolean(predictedSide)&&confidence>=70,signal75=!stale&&!active&&Boolean(displaySide)&&confidence>=75,entry=Number.isFinite(Number(raw?.entry))?Number(raw.entry):(Number.isFinite(Number(raw?.entryLow))&&Number.isFinite(Number(raw?.entryHigh))?(Number(raw.entryLow)+Number(raw.entryHigh))/2:Number(base.price)),entryLow=Number(raw?.entryLow),entryHigh=Number(raw?.entryHigh),live=Number(base.price),target1=Number(raw?.target1),target2=Number(raw?.target2),target3=Number(raw?.target3),target4=Number(raw?.target4),stop=Number(raw?.stopLoss),expected=(active||candidate||guarded||signal75)&&Number.isFinite(target1)&&Number.isFinite(entry)?Math.abs(target1-entry):(guarded&&Number.isFinite(Number(raw?.entryGuard?.rewardToTp1))?Math.abs(Number(raw.entryGuard.rewardToTp1)):null),inCandidateRange=candidate&&Number.isFinite(live)&&Number.isFinite(entryLow)&&Number.isFinite(entryHigh)&&live>=Math.min(entryLow,entryHigh)&&live<=Math.max(entryLow,entryHigh),oneMinuteConfirmed=Boolean(raw?.oneMinuteConfirmed),directionLabel=displaySide==='BUY'?'صاعد':displaySide==='SELL'?'هابط':null;
  const planState=stale?'STALE':active?(primarySide==='BUY'?'UP':'DOWN'):signal75?(displaySide==='BUY'?'UP':'DOWN'):collecting?'COLLECTING':'WAIT';
  const scenarioLabel=active?(primarySide==='BUY'?'BUY مؤكد':'SELL مؤكد'):signal75?(displaySide==='BUY'?'BUY إشارة':'SELL إشارة'):candidate?(primarySide==='BUY'?'مرشح صاعد':'مرشح هابط'):guarded?(guardSide==='BUY'?'متوقع صاعد':'متوقع هابط'):predictive?(predictedSide==='BUY'?'متوقع صاعد':'متوقع هابط'):null;
  let waitingNote=raw?.reason||'بانتظار إشارة مؤكدة من محرك الموقع.';
  if(signal75&&!active){
    waitingNote='إشارة '+(displaySide==='BUY'?'BUY':'SELL')+' من حد 75% — الأهداف معروضة مباشرة ولا ننتظر Entry Guard لإظهارها.';
  } else if(candidate){
    const sideLabel=primarySide==='BUY'?'BUY صاعد':'SELL هابط';
    if(!oneMinuteConfirmed)waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% — الاتجاه موجود لكن تأكيد شمعة 1m لم يكتمل بعد.';
    else if(!inCandidateRange)waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% لكن السعر خارج نطاق الدخول المقبول '+(Number.isFinite(entryLow)&&Number.isFinite(entryHigh)?Number(Math.min(entryLow,entryHigh).toFixed(2))+'–'+Number(Math.max(entryLow,entryHigh).toFixed(2)):'')+'.';
    else waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% والسعر داخل نطاق الدخول.';
  } else if(guarded){
    waitingNote='إشارة '+(guardSide==='BUY'?'BUY':'SELL')+' مرصودة؛ Entry Guard يعمل داخليًا فقط ولا يمنع عرض الأهداف من 75%.';
  } else if(predictive){
    waitingNote='الاتجاه المتوقع '+directionLabel+' بثقة '+Math.round(confidence)+'%.';
  }
  const showTargets=active||signal75;
  const plan={state:planState,scenarioLabel,expectedDirectionLabel:directionLabel,confidence:Math.round(confidence),directionalSignal:signal75,target1:showTargets&&Number.isFinite(target1)?target1:null,target2:showTargets&&Number.isFinite(target2)?target2:null,target3:showTargets&&Number.isFinite(target3)?target3:null,target4:showTargets&&Number.isFinite(target4)?target4:null,invalidation:active&&Number.isFinite(stop)?stop:null,entry:active&&Number.isFinite(entry)?entry:null,entryLow:active&&Number.isFinite(entryLow)?entryLow:null,entryHigh:active&&Number.isFinite(entryHigh)?entryHigh:null,eta1:null,eta2:null,sampleCount:Number(raw?.sampleCount)||0,spanMinutes:complete>=100?5:Number((complete/20).toFixed(1)),channel:displaySide==='BUY'?'RISING':displaySide==='SELL'?'FALLING':'FLAT',expectedMove5:Number.isFinite(expected)?Number(expected.toFixed(2)):null,expectedMovePct:Number.isFinite(expected)&&entry>0?Number((expected/entry*100).toFixed(3)):null,note:stale?'بيانات السعر غير حديثة؛ الإشارات متوقفة حتى عودة المصدر.':active?'CONFIRMED SITE SIGNAL — تم اعتماد الصفقة من محرك الموقع وإرسالها إلى تيليغرام.':collecting?(raw?.reason||'تحميل تاريخ السوق من الخادم…'):waitingNote};
  return {...base,direction:(active||signal75)?(displaySide==='BUY'?'UP':'DOWN'):(collecting?'COLLECTING':'FLAT'),plan};
}`;

  if (!source.includes('function goldSignalReading(raw){') && source.includes('function goldBrowserReading(raw){')) {
    source = source.replace('function goldBrowserReading(raw){', mapper + '\nfunction goldBrowserReading(raw){');
  }

  source = source.replaceAll('const d=goldBrowserReading(raw);', 'const d=goldSignalReading(raw);');
  source = source.replace(
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'من 75% تظهر إشارة BUY/SELL مع الأهداف مباشرة. Entry Guard لا يؤخر عرض الأهداف.'
  );
  source = source.replace(
    "$('#goldScenario').textContent=labels[plan.state]||'انتظار';$('#goldScenario').className=classes[plan.state]||'muted';",
    "$('#goldScenario').textContent=plan.scenarioLabel||(labels[plan.state]||'انتظار');$('#goldScenario').className=plan.expectedDirectionLabel==='صاعد'?'positive':plan.expectedDirectionLabel==='هابط'?'negative':(classes[plan.state]||'muted');"
  );
  source = source.replace(
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'%');"
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
