import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function patchSiteSignalUi(source) {
  const mapper = `function goldSignalReading(raw){
  const base=goldBrowserReading(raw),positive=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
  const side=raw?.side,status=String(raw?.status||'').toUpperCase(),entry=positive(raw?.triggerPrice??raw?.entry),stop=positive(raw?.stopLoss),targets=[1,2,3,4].map(i=>positive(raw?.['target'+i]));
  const age=Number(raw?.quoteAgeMs),updatedMs=Date.parse(raw?.updatedAt),stale=Boolean(raw?.degraded)||raw?.liveFeedFresh!==true||raw?.quoteAgeMs==null||!Number.isFinite(age)||age<0||age>20000||!Number.isFinite(updatedMs)||Date.now()-updatedMs>20000||updatedMs>Date.now()+5000;
  const presentTargets=targets.filter(v=>v!=null),ordered=entry!=null&&presentTargets.length>=1&&presentTargets.every((v,i)=>side==='BUY'?v>(i?presentTargets[i-1]:entry):v<(i?presentTargets[i-1]:entry));
  const active=!stale&&Boolean(raw?.signalId)&&['ACTIVE','MANAGING'].includes(status)&&raw?.entered===true&&raw?.triggered===true&&['BUY','SELL'].includes(side)&&ordered&&stop!=null;
  const collecting=!stale&&status==='COLLECTING',reason=String(raw?.reason||''),cooldown=/COOLDOWN/i.test(reason),recovering=/DATA_RECOVERING|ENGINE_UNAVAILABLE/i.test(reason);
  const confidence=Math.max(0,Math.min(100,Number(raw?.signalConfidence??raw?.confidence)||0)),minConfidence=Math.max(0,Number(raw?.minConfidence)||82);
  const candidateSide=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.contextBias)?raw.contextBias:null),candidate=!stale&&!active&&status==='CANDIDATE'&&['BUY','SELL'].includes(candidateSide);
  const momentum=raw?.momentum||raw?.prediction||{},wr=Number(momentum?.williamsR5??raw?.prediction?.williamsR5),expansion=Number(momentum?.volatilityExpansion??raw?.prediction?.volatilityExpansion),structure5=Number(momentum?.structure5m??raw?.prediction?.structure5m??0);
  const trendReady=['BUY','SELL'].includes(raw?.contextBias),volatilityReady=candidate||active||(Number.isFinite(expansion)&&expansion>=.35),wrReady=!Number.isFinite(wr)?candidate:(candidateSide==='BUY'?wr>-55:candidateSide==='SELL'?wr<-45:false),entryReady=active||candidate;
  const checks=[['15m Trend',trendReady],['Volatility',volatilityReady],['Williams %R',wrReady],['Entry Zone',entryReady]],done=checks.filter(x=>x[1]).length,setupProgress=active?100:collecting?Math.min(15,Math.round((Number(raw?.sampleCount)||0)/120*15)):Math.round(done/checks.length*100),setupSteps=checks.map(x=>x[0]+' '+(x[1]?'✓':'—')).join(' • ');
  const reasonUpper=reason.toUpperCase();let missingCondition='بانتظار اتجاه + توسع تقلب حسب Williams';
  if(recovering)missingCondition='استعادة بيانات السعر الحي';else if(cooldown)missingCondition='فترة حماية بعد الصفقة السابقة';else if(confidence>0&&confidence<minConfidence)missingCondition='الثقة '+Math.round(confidence)+'% أقل من المطلوب '+Math.round(minConfidence)+'%';else if(/NO CHASE/.test(reasonUpper))missingCondition='السعر ابتعد عن منطقة الدخول؛ ننتظر فرصة جديدة';else if(/STOP_TOO_|INVALID_MOMENTUM_STOP|MIN_LOT_EXCEEDS/.test(reasonUpper))missingCondition='وقف الخسارة أو حجم المخاطرة غير مناسب';else if(/MAIN_TARGET_BELOW_MIN_R|TP1_TOO_CLOSE/.test(reasonUpper))missingCondition='المسافة إلى الهدف الأول غير كافية';else if(/USD_NEWS_BLACKOUT|NEWS RISK/.test(reasonUpper))missingCondition='فلتر الأخبار يمنع الدخول مؤقتًا';else if(status==='CANDIDATE')missingCondition='إعداد Williams جاهز وينتظر دخول السعر داخل منطقة التنفيذ';
  const scenarioLabel=active?(side==='BUY'?'BUY مؤكد — Williams':'SELL مؤكد — Williams'):candidate?('مرشح '+candidateSide+' — Larry Williams'):recovering?'استعادة البيانات':cooldown?'انتظار بعد الصفقة':candidateSide?('قيد البناء '+candidateSide):'انتظار';
  const waitReason=recovering?'جاري استعادة بيانات السعر الحي.':cooldown?'فترة حماية قصيرة بعد الصفقة السابقة.':candidate?'مرشح Larry Williams — ينتظر منطقة التنفيذ واعتماد الخادم.':missingCondition;
  const plan={serverOwned:true,signalId:active?raw.signalId:null,state:stale?'STALE':active?(side==='BUY'?'UP':'DOWN'):collecting?'COLLECTING':'WAIT',scenarioLabel,confidence,minConfidence,setupProgress,setupSteps,missingCondition,locked:active,candidate,entry:(active||candidate)?entry:null,invalidation:(active||candidate)?stop:null,target1:(active||candidate)?targets[0]:null,target2:(active||candidate)?targets[1]:null,target3:(active||candidate)?targets[2]:null,target4:(active||candidate)?targets[3]:null,targetLabels:Array.isArray(raw?.targetLabels)?raw.targetLabels:[],lotSizing:raw?.lotSizing||null,momentum,entryLow:(active||candidate)?positive(raw.entryLow):null,entryHigh:(active||candidate)?positive(raw.entryHigh):null,tp1Hit:active&&Boolean(raw?.targetHits?.[0]),tp2Hit:active&&Boolean(raw?.targetHits?.[1]),tp3Hit:active&&Boolean(raw?.targetHits?.[2]),tp4Hit:active&&Boolean(raw?.targetHits?.[3]),lockCreatedAt:active?raw.issuedAtMs:null,eta1:null,eta2:null,sampleCount:Number(raw?.sampleCount)||0,spanMinutes:Math.min(5,(Number(raw?.readingCompleteness)||0)/20),channel:active?(side==='BUY'?'RISING':'FALLING'):'FLAT',note:active?('Larry Williams '+String(raw?.strategy||'SETUP')+' • 15m '+String(raw?.contextBias||'—')+' • %R '+(Number.isFinite(wr)?wr.toFixed(1):'—')+' • Expansion '+(Number.isFinite(expansion)?expansion.toFixed(2)+'×':'—')):candidate?('مرشح '+candidateSide+' '+confidence+' • %R '+(Number.isFinite(wr)?wr.toFixed(1):'—')+' • Expansion '+(Number.isFinite(expansion)?expansion.toFixed(2)+'×':'—')):waitReason};
  return {...base,stale,direction:active?(side==='BUY'?'UP':'DOWN'):'FLAT',plan};
}`;

  if (!source.includes('function goldSignalReading(raw){') && source.includes('function goldBrowserReading(raw){')) {
    source = source.replace('function goldBrowserReading(raw){', mapper + '\nfunction goldBrowserReading(raw){');
  }

  source = source.replaceAll('const d=goldBrowserReading(raw);', 'const d=goldSignalReading(raw);');
  source = source.replace(
    'توقع الذهب — نموذج 5 دقائق',
    'Larry Williams XAUUSD — Trend + Volatility'
  );
  source = source.replace(
    "symbol:'OANDA:XAUUSD',interval:'15'",
    "symbol:'OANDA:XAUUSD',interval:'5'"
  );
  source = source.replace(
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'لا يظهر دخول أو أهداف إلا بعد اعتماد إشارة BUY/SELL مؤكدة من محرك الخادم.'
  );

  source = source.replace(
    '<div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>',
    '<div class="goldPlanCard"><span>تقدم الإشارة</span><strong id="goldSetupProgress">0%</strong><small id="goldSetupSteps">15m Trend — • Volatility — • Williams %R — • Entry Zone —</small></div><div class="goldPlanCard"><span>الشرط الناقص الآن</span><strong id="goldMissingCondition">—</strong><small>يتحدث مع كل قراءة جديدة</small></div><div class="goldPlanCard"><span>اللوت المحسوب</span><strong id="goldLotSize">—</strong><small id="goldLotRisk">حسب مسافة SL</small></div><div class="goldPlanCard"><span>Larry Williams Framework</span><strong id="goldIctDraw">—</strong><small id="goldIctBias">15m trend / volatility / %R</small></div><div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>'
  );
  source = source.replace(
    "$('#goldScenario').textContent=labels[plan.state]||'انتظار';$('#goldScenario').className=classes[plan.state]||'muted';",
    "$('#goldScenario').textContent=plan.scenarioLabel||(labels[plan.state]||'انتظار');$('#goldScenario').className=plan.expectedDirectionLabel==='صاعد'?'positive':plan.expectedDirectionLabel==='هابط'?'negative':(classes[plan.state]||'muted');const lot=plan.lotSizing||{},lotNode=$('#goldLotSize'),lotRisk=$('#goldLotRisk'),drawNode=$('#goldIctDraw'),biasNode=$('#goldIctBias'),progressNode=$('#goldSetupProgress'),stepsNode=$('#goldSetupSteps'),missingNode=$('#goldMissingCondition');if(progressNode)progressNode.textContent=Number(plan.setupProgress||0)+'%';if(stepsNode)stepsNode.textContent=plan.setupSteps||'—';if(missingNode)missingNode.textContent=plan.missingCondition||'—';if(lotNode)lotNode.textContent=(plan.locked||plan.candidate)&&Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—';if(lotRisk)lotRisk.textContent=(plan.locked||plan.candidate)&&Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2):(plan.candidate?'مرشح — لم يعتمد بعد':'يظهر بعد اعتماد SL');const mom=plan.momentum||{},wr=Number(mom.williamsR5),exp=Number(mom.volatilityExpansion);if(drawNode)drawNode.textContent='%R '+(Number.isFinite(wr)?wr.toFixed(1):'—')+' • Expansion '+(Number.isFinite(exp)?exp.toFixed(2)+'×':'—');if(biasNode)biasNode.textContent='15m: '+(plan.candidate||plan.locked?(plan.scenarioLabel||'—'):'—')+' • 5m structure '+(Number.isFinite(Number(mom.structure5m))?Number(mom.structure5m):'—');"
  );
  source = source.replace(
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=(plan.state==='UP'||plan.state==='DOWN')?('التأكيد '+plan.confidence+'%'):(plan.state==='COLLECTING'?'بانتظار اكتمال بيانات 5 دقائق':(plan.confidence>0?'درجة الإعداد '+plan.confidence+'% • المطلوب '+plan.minConfidence+'%':'لم يبدأ حساب الثقة بعد'));"
  );
  source = source.replace(
    "lock={state:plan.state,entry:p,target1:t1",
    "lock={state:plan.state,entry:Number.isFinite(Number(plan.entry))?Number(plan.entry):p,target1:t1"
  );
  source = source.replace(
    "$('#goldModelWindow').textContent=channelLabel+' • رصد '+plan.spanMinutes+' د';",
    "$('#goldModelWindow').textContent=(plan.state==='COLLECTING'?'تهيئة بيانات الخادم':channelLabel+' • محرك الموقع');"
  );
  source = source.replaceAll("$('#mode').textContent=cfg.mode+' / '+cfg.provider;", "$('#mode').textContent='XAUUSD / SIGNALS';");
  source = source.replaceAll("$('#mode').textContent=d.mode+' / '+d.provider;", "$('#mode').textContent='XAUUSD / SIGNALS';");
  const liveProgressScript = `<script id="goldLiveProgressPoller">
(function(){
 const el=id=>document.getElementById(id),set=(id,v)=>{const n=el(id);if(n)n.textContent=v;};
 function missing(raw,conf,min){
  const s=String(raw?.reason||'').toUpperCase(),st=String(raw?.status||'').toUpperCase();
  if(/DATA_RECOVERING|ENGINE_UNAVAILABLE/.test(s)||raw?.degraded)return 'استعادة بيانات السعر الحي';
  if(st==='COLLECTING')return 'يجمع بيانات 1m / 5m / 15m';
  if(/COOLDOWN/.test(s))return 'فترة حماية قصيرة بعد الصفقة السابقة';
  if(conf>0&&conf<min)return 'الثقة '+Math.round(conf)+'% أقل من المطلوب '+Math.round(min)+'%';
  if(/NO CHASE/.test(s))return 'السعر ابتعد عن منطقة الدخول؛ ننتظر فرصة جديدة';
  if(/STOP_TOO_|INVALID_MOMENTUM_STOP|MIN_LOT_EXCEEDS/.test(s))return 'وقف الخسارة أو المخاطرة غير مناسب';
  if(/MAIN_TARGET_BELOW_MIN_R|TP1_TOO_CLOSE/.test(s))return 'المسافة إلى الهدف الأول غير كافية';
  if(/USD_NEWS_BLACKOUT|NEWS RISK/.test(s))return 'فلتر الأخبار يمنع الدخول مؤقتًا';
  if(st==='CANDIDATE')return 'مرشح Larry Williams وينتظر دخول منطقة التنفيذ';
  return 'بانتظار اتجاه + توسع تقلب حسب Williams';
 }
 async function refresh(){
  try{
   const r=await fetch('/api/auto-trade/signal?observe=1&_='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const raw=await r.json();
   const status=String(raw?.status||'').toUpperCase(),active=Boolean(raw?.signalId)&&['ACTIVE','MANAGING'].includes(status),collecting=status==='COLLECTING',side=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.contextBias)?raw.contextBias:null);
   const mom=raw?.momentum||raw?.prediction||{},wr=Number(mom?.williamsR5??raw?.prediction?.williamsR5),expansion=Number(mom?.volatilityExpansion??raw?.prediction?.volatilityExpansion),structure5=Number(mom?.structure5m??raw?.prediction?.structure5m??0);
   const trendReady=['BUY','SELL'].includes(raw?.contextBias),volatilityReady=active||status==='CANDIDATE'||(Number.isFinite(expansion)&&expansion>=.35),wrReady=!Number.isFinite(wr)?status==='CANDIDATE':(side==='BUY'?wr>-55:side==='SELL'?wr<-45:false),entryReady=active||status==='CANDIDATE';
   const checks=[['15m Trend',trendReady],['Volatility',volatilityReady],['Williams %R',wrReady],['Entry Zone',entryReady]],done=checks.filter(x=>x[1]).length;
   const progress=active?100:collecting?Math.min(15,Math.max(1,Math.round((Number(raw?.sampleCount)||0)/120*15))):Math.round(done/checks.length*100);
   const conf=Math.max(0,Math.min(100,Number(raw?.signalConfidence??raw?.confidence)||0)),min=Math.max(0,Number(raw?.minConfidence)||82);
   set('goldSetupProgress',progress+'%');set('goldSetupSteps',checks.map(x=>x[0]+' '+(x[1]?'✓':'—')).join(' • '));set('goldMissingCondition',missing(raw,conf,min));
   set('goldConfidence',active?'التأكيد '+Math.round(conf)+'%':(conf>0?'درجة الإعداد '+Math.round(conf)+'% • المطلوب '+Math.round(min)+'%':'لم يبدأ حساب الثقة بعد'));
   const lot=raw?.lotSizing||{};set('goldLotSize',Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—');set('goldLotRisk',Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2):'يظهر بعد اعتماد SL');
   set('goldIctDraw','%R '+(Number.isFinite(wr)?wr.toFixed(1):'—')+' • Expansion '+(Number.isFinite(expansion)?expansion.toFixed(2)+'×':'—'));set('goldIctBias','15m: '+String(raw?.contextBias||'NEUTRAL')+' • 5m structure '+(Number.isFinite(structure5)?structure5:'—'));
  }catch(e){set('goldMissingCondition','تعذر قراءة محرك الذهب الآن');}
 }
 (async function loop(){await refresh();setTimeout(loop,2000)})();
})();
</script>`;
  if(!source.includes('goldLiveProgressPoller')) source=source.replace('</body>', liveProgressScript+'</body>');
  // Server lifecycle is authoritative; never revive a browser-local trade.
  source = source.replace('function lockGoldPlan(plan,price){', 'function lockGoldPlan(plan,price){if(plan?.serverOwned)return plan;');
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
