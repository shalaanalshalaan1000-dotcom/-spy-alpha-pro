import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function patchSiteSignalUi(source) {
  const mapper = `function goldSignalReading(raw){
  const base=goldBrowserReading(raw),now=Date.now(),confidence=Math.max(Number(raw?.signalConfidence)||0,Number(raw?.confidence)||0),rawStatus=String(raw?.status||'').toUpperCase(),primarySide=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.side)?raw.side:null),guardSide=['BUY','SELL'].includes(raw?.entryGuard?.side)?raw.entryGuard.side:null,predictedSide=['BUY','SELL'].includes(raw?.prediction?.side)?raw.prediction.side:null,displaySide=primarySide||guardSide||predictedSide,active=Boolean(raw?.signalId&&['ACTIVE','MANAGING'].includes(rawStatus)&&primarySide),stale=Boolean(raw?.degraded)||base.stale,complete=Math.max(0,Math.min(100,Number(raw?.readingCompleteness)||0)),collecting=!stale&&!active&&rawStatus==='COLLECTING',candidate=!stale&&!active&&Boolean(primarySide)&&rawStatus==='CANDIDATE',guarded=!stale&&!active&&!candidate&&Boolean(guardSide)&&rawStatus==='WAIT',predictive=!stale&&!active&&!candidate&&!guarded&&Boolean(predictedSide)&&confidence>=70,signal75=!stale&&!active&&Boolean(displaySide)&&confidence>=75,entry=Number.isFinite(Number(raw?.entry))?Number(raw.entry):(Number.isFinite(Number(raw?.entryLow))&&Number.isFinite(Number(raw?.entryHigh))?(Number(raw.entryLow)+Number(raw.entryHigh))/2:Number(base.price)),entryLow=Number(raw?.entryLow),entryHigh=Number(raw?.entryHigh),live=Number(base.price),target1=Number(raw?.target1),target2=Number(raw?.target2),stop=Number(raw?.stopLoss),expected=(active||candidate||guarded)&&Number.isFinite(target1)&&Number.isFinite(entry)?Math.abs(target1-entry):(guarded&&Number.isFinite(Number(raw?.entryGuard?.rewardToTp1))?Math.abs(Number(raw.entryGuard.rewardToTp1)):null),inCandidateRange=candidate&&Number.isFinite(live)&&Number.isFinite(entryLow)&&Number.isFinite(entryHigh)&&live>=Math.min(entryLow,entryHigh)&&live<=Math.max(entryLow,entryHigh),oneMinuteConfirmed=Boolean(raw?.oneMinuteConfirmed),directionLabel=displaySide==='BUY'?'صاعد':displaySide==='SELL'?'هابط':null;
  const planState=stale?'STALE':active?(primarySide==='BUY'?'UP':'DOWN'):signal75?(displaySide==='BUY'?'UP':'DOWN'):collecting?'COLLECTING':'WAIT';
  const scenarioLabel=active?(primarySide==='BUY'?'BUY مؤكد':'SELL مؤكد'):signal75?(displaySide==='BUY'?'BUY إشارة':'SELL إشارة'):candidate?(primarySide==='BUY'?'مرشح صاعد':'مرشح هابط'):guarded?(guardSide==='BUY'?'متوقع صاعد':'متوقع هابط'):predictive?(predictedSide==='BUY'?'متوقع صاعد':'متوقع هابط'):null;
  let waitingNote=raw?.reason||'بانتظار إشارة مؤكدة من محرك الموقع.';
  if(signal75&&!active){
    waitingNote='إشارة '+(displaySide==='BUY'?'BUY صاعدة':'SELL هابطة')+' معتمدة للعرض من حد 75% — الثقة الحالية '+Math.round(confidence)+'%. الدخول التنفيذي والأهداف النهائية تبقى منفصلة حتى تمر شروط التنفيذ.';
  } else if(candidate){
    const sideLabel=primarySide==='BUY'?'BUY صاعد':'SELL هابط';
    if(!oneMinuteConfirmed)waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% — الاتجاه موجود لكن تأكيد شمعة 1m لم يكتمل بعد؛ لا توجد صفقة مؤكدة.';
    else if(!inCandidateRange)waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% وتأكيد 1m مكتمل، لكن السعر خارج نطاق الدخول المقبول '+(Number.isFinite(entryLow)&&Number.isFinite(entryHigh)?Number(Math.min(entryLow,entryHigh).toFixed(2))+'–'+Number(Math.max(entryLow,entryHigh).toFixed(2)):'')+'. ننتظر Retest بدل مطاردة الحركة.';
    else waitingNote='مرشح '+sideLabel+' بثقة '+Math.round(confidence)+'% والسعر داخل نطاق الدخول؛ محرك الموقع يفحص الآن التقلب وRR وحماية ما بعد الخسارة قبل اعتماد الصفقة.';
  } else if(guarded){
    const g=raw?.entryGuard||{},sideLabel=guardSide==='BUY'?'BUY صاعد':'SELL هابط',rr=Number(g.liveTp1R),risk=Number(g.risk),room=Number(g.rewardToTp1),reason=String(g.reason||'ENTRY_GUARD');
    if(reason==='STOP_TOO_WIDE_FOR_VOLATILITY')waitingNote='اتجاه '+sideLabel+' بثقة '+Math.round(confidence)+'% — الحركة موجودة لكن الدخول غير معتمد: وقف الخسارة واسع مقارنة بالتذبذب'+(Number.isFinite(rr)?' وRR إلى TP1 = '+rr.toFixed(2)+'R':'')+(Number.isFinite(room)?'؛ الحركة المتوقعة ≈ '+room.toFixed(2)+'$ '+directionLabel:'')+'.';
    else if(reason==='TP1_TOO_CLOSE_R')waitingNote='اتجاه '+sideLabel+' بثقة '+Math.round(confidence)+'% — لم يعتمد الدخول لأن العائد إلى TP1 غير كافٍ'+(Number.isFinite(rr)?' ('+rr.toFixed(2)+'R)':'')+'.';
    else if(reason==='TP1_TOO_CLOSE_FOR_VOLATILITY')waitingNote='اتجاه '+sideLabel+' بثقة '+Math.round(confidence)+'% — لم يعتمد الدخول لأن المسافة المتبقية إلى TP1 صغيرة مقارنة بالتذبذب.';
    else if(reason==='WAITING_1M_CONFIRMATION')waitingNote='اتجاه '+sideLabel+' بثقة '+Math.round(confidence)+'% — ينتظر فقط تأكيد 1m قبل اعتماد الدخول.';
    else waitingNote='اتجاه '+sideLabel+' بثقة '+Math.round(confidence)+'% — الحركة مرصودة لكن بوابة الدخول أوقفت التنفيذ مؤقتًا: '+reason+'.';
  } else if(predictive){
    waitingNote='الاتجاه المتوقع '+directionLabel+' بثقة '+Math.round(confidence)+'% — قراءة حركة فقط وليست دخولًا مؤكدًا حتى تكتمل شروط التنفيذ.';
  }
  const plan={state:planState,scenarioLabel,expectedDirectionLabel:directionLabel,confidence:Math.round(confidence),directionalSignal:signal75,target1:active&&Number.isFinite(target1)?target1:null,target2:active&&Number.isFinite(target2)?target2:null,invalidation:active&&Number.isFinite(stop)?stop:null,entry:active&&Number.isFinite(entry)?entry:null,entryLow:active&&Number.isFinite(entryLow)?entryLow:null,entryHigh:active&&Number.isFinite(entryHigh)?entryHigh:null,eta1:null,eta2:null,sampleCount:Number(raw?.sampleCount)||0,spanMinutes:complete>=100?5:Number((complete/20).toFixed(1)),channel:displaySide==='BUY'?'RISING':displaySide==='SELL'?'FALLING':'FLAT',expectedMove5:Number.isFinite(expected)?Number(expected.toFixed(2)):null,expectedMovePct:Number.isFinite(expected)&&entry>0?Number((expected/entry*100).toFixed(3)):null,note:stale?'بيانات السعر غير حديثة؛ الإشارات متوقفة حتى عودة المصدر.':active?'CONFIRMED SITE SIGNAL — تم اعتماد الصفقة من محرك الموقع وإرسالها إلى تيليغرام.':collecting?(raw?.reason||'تحميل تاريخ السوق من الخادم…'):waitingNote};
  return {...base,direction:(active||signal75)?(displaySide==='BUY'?'UP':'DOWN'):(collecting?'COLLECTING':'FLAT'),plan};
}`;

  if (!source.includes('function goldSignalReading(raw){') && source.includes('function goldBrowserReading(raw){')) {
    source = source.replace('function goldBrowserReading(raw){', mapper + '\nfunction goldBrowserReading(raw){');
  }

  source = source.replaceAll('const d=goldBrowserReading(raw);', 'const d=goldSignalReading(raw);');
  source = source.replace(
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'من 75% تظهر إشارة BUY/SELL مباشرة كقراءة اتجاهية. الدخول التنفيذي والأهداف النهائية تبقى منفصلة حتى تكتمل شروط التنفيذ.'
  );
  source = source.replace(
    "$('#goldScenario').textContent=labels[plan.state]||'انتظار';$('#goldScenario').className=classes[plan.state]||'muted';",
    "$('#goldScenario').textContent=plan.scenarioLabel||(labels[plan.state]||'انتظار');$('#goldScenario').className=plan.expectedDirectionLabel==='صاعد'?'positive':plan.expectedDirectionLabel==='هابط'?'negative':(classes[plan.state]||'muted');"
  );
  source = source.replace(
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):(plan.expectedDirectionLabel?('التأكيد '+plan.confidence+'% • '+(plan.expectedMove5!=null?('الحركة المتوقعة '+money(plan.expectedMove5)+' '+plan.expectedDirectionLabel+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')'):('الاتجاه المتوقع '+plan.expectedDirectionLabel))):('التأكيد '+plan.confidence+'% • الحركة المتوقعة — (—)'));"
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
