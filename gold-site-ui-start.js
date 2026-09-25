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
  const confidence=Math.max(0,Math.min(100,Number(raw?.signalConfidence??raw?.confidence)||0)),minConfidence=0;
  const candidateSide=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.contextBias)?raw.contextBias:null),candidate=!stale&&!active&&status==='CANDIDATE'&&['BUY','SELL'].includes(candidateSide);
  const ict=raw?.ict||{},momentum={},scenarioPlan=null,rsi5=NaN,structure5=Number(ict?.dm5?.mss?1:ict?.dm5?.displacement?1:0);
  const contextReady=Number(ict?.dir15)!==0||Number(ict?.dir1)!==0;
  const sweepReady=contextReady&&Boolean(ict?.legSweep||ict?.sweep);
  const mssReady=sweepReady&&Boolean(ict?.hasShift||ict?.mss||ict?.firstMssEvent);
  const displacementReady=sweepReady&&Boolean(ict?.hasDisplacement||ict?.displacement||ict?.firstDisplacementEvent);
  const shiftReady=mssReady&&displacementReady;
  const fvgReady=shiftReady&&Boolean(ict?.originFvg);
  const targetReady=fvgReady&&Boolean(ict?.mainLiquidity||raw?.target1);
  const triggerReady=targetReady&&(active||candidate||Boolean(ict?.executionReady));
  const checks=[['Context',contextReady],['Liquidity Sweep',sweepReady],['MSS + Displacement',shiftReady],['Origin FVG',fvgReady],['External Liquidity',targetReady],['Entry',triggerReady]],done=checks.filter(x=>x[1]).length,setupProgress=active?100:collecting?Math.min(15,Math.round((Number(raw?.sampleCount)||0)/5000*15)):Math.round(done/checks.length*100),setupSteps=checks.map(x=>x[0]+' '+(x[1]?'✓':'—')).join(' • ');
  const reasonUpper=reason.toUpperCase();let missingCondition='بانتظار تسلسل ICT: سحب سيولة → MSS/Displacement → أول FVG → سيولة خارجية مناسبة';
  if(recovering)missingCondition='استعادة بيانات السعر الحي';else if(cooldown)missingCondition='فترة حماية بعد الصفقة السابقة';else if(/MOVE CONSUMED/.test(reasonUpper))missingCondition='الحركة استُهلكت؛ ممنوع مطاردة آخرها وننتظر بداية جديدة';else if(/TARGET WAIT/.test(reasonUpper))missingCondition='لا توجد سيولة خارجية مناسبة تبعد 5$ أو أكثر عن منطقة الدخول';else if(/NO CHASE/.test(reasonUpper))missingCondition='السعر ابتعد عن منطقة الدخول؛ ننتظر عودة أو إعدادًا جديدًا';else if(/STOP_TOO_|INVALID_MOMENTUM_STOP|MIN_LOT_EXCEEDS/.test(reasonUpper))missingCondition='وقف الخسارة أو حجم المخاطرة غير مناسب';else if(/USD_NEWS_BLACKOUT|NEWS RISK/.test(reasonUpper))missingCondition='فلتر الأخبار يمنع الدخول مؤقتًا';else if(/ICT CONTEXT WAIT/.test(reasonUpper))missingCondition='السياق لم يكتمل بعد؛ ننتظر بداية ICT جديدة بدل دخول متأخر';else if(status==='CANDIDATE')missingCondition='بداية الحركة مكتملة؛ ينتظر لمس منطقة Origin FVG للدخول';
  const scenarioLabel=active?(side==='BUY'?'BUY مؤكد — ICT Context':'SELL مؤكد — ICT Context'):candidate?('مرشح '+candidateSide+' — ICT Context'):recovering?'استعادة البيانات':cooldown?'انتظار بعد الصفقة':(['BUY','SELL'].includes(raw?.contextBias)?('ICT Context '+raw.contextBias):'انتظار');
  const waitReason=recovering?'جاري استعادة بيانات السعر الحي.':cooldown?'فترة حماية قصيرة بعد الصفقة السابقة.':candidate?'تأكيد المنطقة جاهز — ينتظر اعتماد الخادم.':missingCondition;
  const plan={serverOwned:true,signalId:active?raw.signalId:null,state:stale?'STALE':active?(side==='BUY'?'UP':'DOWN'):collecting?'COLLECTING':'WAIT',scenarioLabel,confidence,minConfidence,setupProgress,setupSteps,missingCondition,locked:active,candidate,entry:(active||candidate)?entry:null,invalidation:(active||candidate)?stop:null,target1:(active||candidate)?targets[0]:null,target2:(active||candidate)?targets[1]:null,target3:(active||candidate)?targets[2]:null,target4:(active||candidate)?targets[3]:null,targetLabels:Array.isArray(raw?.targetLabels)?raw.targetLabels:[],lotSizing:raw?.lotSizing||null,scenarioPlan,momentum,ict,entryLow:(active||candidate)?positive(raw.entryLow):null,entryHigh:(active||candidate)?positive(raw.entryHigh):null,tp1Hit:active&&Boolean(raw?.targetHits?.[0]),tp2Hit:active&&Boolean(raw?.targetHits?.[1]),tp3Hit:active&&Boolean(raw?.targetHits?.[2]),tp4Hit:active&&Boolean(raw?.targetHits?.[3]),lockCreatedAt:active?raw.issuedAtMs:null,eta1:null,eta2:null,sampleCount:Number(raw?.sampleCount)||0,spanMinutes:Math.min(60,(Number(raw?.readingCompleteness)||0)*.6),channel:active?(side==='BUY'?'RISING':'FALLING'):'FLAT',note:active?('ICT Context '+String(raw?.strategy||'SETUP')+' • 15m '+String(raw?.contextBias||'—')+' • '+String(ict?.session||'—')):candidate?('بداية ICT جاهزة • '+candidateSide+' • ننتظر Origin FVG'):waitReason};
  return {...base,stale,direction:active?(side==='BUY'?'UP':'DOWN'):'FLAT',plan};
}`;

  if (!source.includes('function goldSignalReading(raw){') && source.includes('function goldBrowserReading(raw){')) {
    source = source.replace('function goldBrowserReading(raw){', mapper + '\nfunction goldBrowserReading(raw){');
  }

  source = source.replaceAll('const d=goldBrowserReading(raw);', 'const d=goldSignalReading(raw);');
  source = source.replace(
    'توقع الذهب — نموذج 5 دقائق',
    'XAUUSD — ICT — ORIGIN TO LIQUIDITY | Liquidity Sweep + MSS/Displacement + Origin FVG'
  );
  source = source.replace(
    "symbol:'OANDA:XAUUSD',interval:'15'",
    "symbol:'OANDA:XAUUSD',interval:'5'"
  );
  source = source.replace(
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'ICT: يبحث عن بداية الحركة من سحب السيولة ثم MSS/Displacement وأول FVG صالح، ويستهدف السيولة الخارجية بدل مطاردة آخر الحركة.'
  );

  source = source.replace(
    '<div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>',
    '<div class="goldPlanCard"><span>تقدم الإشارة</span><strong id="goldSetupProgress">0%</strong><small id="goldSetupSteps">15m Context — • 1m/5m FVG — • MSS / Displacement — • Entry —</small></div><div class="goldPlanCard"><span>الشرط الناقص الآن</span><strong id="goldMissingCondition">—</strong><small>يتحدث مع كل قراءة جديدة</small></div><div class="goldPlanCard"><span>اللوت المحسوب</span><strong id="goldLotSize">—</strong><small id="goldLotRisk">حسب مسافة SL</small></div><div class="goldPlanCard"><span>ICT Origin Setup</span><strong id="goldIctDraw">—</strong><small id="goldIctBias">15m context • 1m/5m execution</small></div><div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>'
  );
  source = source.replace(
    "$('#goldScenario').textContent=labels[plan.state]||'انتظار';$('#goldScenario').className=classes[plan.state]||'muted';",
    "$('#goldScenario').textContent=plan.scenarioLabel||(labels[plan.state]||'انتظار');$('#goldScenario').className=plan.expectedDirectionLabel==='صاعد'?'positive':plan.expectedDirectionLabel==='هابط'?'negative':(classes[plan.state]||'muted');const lot=plan.lotSizing||{},lotNode=$('#goldLotSize'),lotRisk=$('#goldLotRisk'),drawNode=$('#goldIctDraw'),biasNode=$('#goldIctBias'),progressNode=$('#goldSetupProgress'),stepsNode=$('#goldSetupSteps'),missingNode=$('#goldMissingCondition');if(progressNode)progressNode.textContent=Number(plan.setupProgress||0)+'%';if(stepsNode)stepsNode.textContent=plan.setupSteps||'—';if(missingNode)missingNode.textContent=plan.missingCondition||'—';if(lotNode)lotNode.textContent=(plan.locked||plan.candidate)&&Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—';if(lotRisk)lotRisk.textContent=(plan.locked||plan.candidate)&&Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2):(plan.candidate?'مرشح — لم يعتمد بعد':'يظهر بعد اعتماد SL');const ict=plan.ict||{};if(drawNode)drawNode.textContent=(ict.drawOnLiquidity||plan.targetLabels?.[0]||'External liquidity targets');if(biasNode)biasNode.textContent='15m '+(ict.dir15===1?'↑':ict.dir15===-1?'↓':'—')+' • 1H '+(ict.dir1===1?'↑':ict.dir1===-1?'↓':'—')+' • '+String(ict.session||'—');"
  );
  source = source.replace(
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=(plan.state==='UP'||plan.state==='DOWN')?'سياق ICT مكتمل':(plan.candidate?'بداية ICT جاهزة — انتظار Origin FVG':(plan.state==='COLLECTING'?'تهيئة بيانات ICT':'بانتظار اكتمال سياق ICT'));"
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
  const s=String(raw?.reason||''),u=s.toUpperCase(),st=String(raw?.status||'').toUpperCase();
  if(/DATA_RECOVERING|ENGINE_UNAVAILABLE/.test(u)||raw?.degraded)return 'استعادة بيانات السعر الحي';
  if(st==='COLLECTING')return 'يجمع بيانات 1m / 5m / 15m';
  if(/COOLDOWN/.test(u))return 'فترة حماية قصيرة بعد الصفقة السابقة';
  if(/MOVE CONSUMED/.test(u))return 'الحركة استُهلكت؛ ننتظر بداية ICT جديدة ولا نطارد السعر';
  if(/NO CHASE/.test(u))return 'السعر ابتعد عن منطقة الدخول؛ ننتظر فرصة جديدة';
  if(/STOP_TOO_|INVALID_MOMENTUM_STOP|MIN_LOT_EXCEEDS/.test(u))return 'وقف الخسارة أو المخاطرة غير مناسب';
  if(/TARGET WAIT|MAIN_TARGET_BELOW_MIN_R|TP1_TOO_CLOSE/.test(u))return 'لا توجد سيولة خارجية مناسبة تبعد 5$ أو أكثر';
  if(/USD_NEWS_BLACKOUT|NEWS RISK/.test(u))return 'فلتر الأخبار يمنع الدخول مؤقتًا';
  if(/ICT CONTEXT WAIT/.test(u))return 'السياق لم يكتمل بعد؛ ننتظر Sweep → MSS/Displacement → Origin FVG';
  if(st==='CANDIDATE')return 'ICT Context مرشح؛ الخادم يتحقق من سعر الدخول والمخاطرة';
  return 'بانتظار FVG + MSS/Displacement على 1m/5m';
 }
 async function refresh(){
  try{
   const r=await fetch('/api/auto-trade/signal?observe=1&_='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const raw=await r.json();
   const status=String(raw?.status||'').toUpperCase(),active=Boolean(raw?.signalId)&&['ACTIVE','MANAGING'].includes(status),collecting=status==='COLLECTING',side=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.contextBias)?raw.contextBias:null);
   const ict=raw?.ict||{},contextReady=Number(ict?.dir15)!==0||Number(ict?.dir1)!==0,sweepReady=contextReady&&Boolean(ict?.legSweep||ict?.sweep),mssReady=sweepReady&&Boolean(ict?.hasShift||ict?.mss||ict?.firstMssEvent),displacementReady=sweepReady&&Boolean(ict?.hasDisplacement||ict?.displacement||ict?.firstDisplacementEvent),shiftReady=mssReady&&displacementReady,fvgReady=shiftReady&&Boolean(ict?.originFvg),targetReady=fvgReady&&Boolean(ict?.mainLiquidity||raw?.target1),triggerReady=targetReady&&(active||status==='CANDIDATE'||Boolean(ict?.executionReady));
   const checks=[['Context',contextReady],['Sweep',sweepReady],['MSS + Displacement',shiftReady],['Origin FVG',fvgReady],['External Liquidity',targetReady],['Entry',triggerReady]],done=checks.filter(x=>x[1]).length;
   const progress=active?100:collecting?Math.min(15,Math.max(1,Math.round((Number(raw?.sampleCount)||0)/5000*15))):Math.round(done/checks.length*100);
   const conf=Math.max(0,Math.min(100,Number(raw?.signalConfidence??raw?.confidence)||0)),min=0;
   set('goldSetupProgress',progress+'%');set('goldSetupSteps',checks.map(x=>x[0]+' '+(x[1]?'✓':'—')).join(' • '));set('goldMissingCondition',missing(raw,conf,min));
   set('goldConfidence',active?'سياق ICT مكتمل':(status==='CANDIDATE'?'بداية ICT جاهزة — انتظار Origin FVG':'بانتظار اكتمال سياق ICT'));
   const lot=raw?.lotSizing||{};set('goldLotSize',Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—');set('goldLotRisk',Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2):'يظهر بعد اعتماد SL');
   set('goldIctDraw',ict?.drawOnLiquidity||raw?.targetLabels?.[0]||'External liquidity targets');set('goldIctBias','15m '+(ict?.dir15===1?'↑':ict?.dir15===-1?'↓':'—')+' • 1H '+(ict?.dir1===1?'↑':ict?.dir1===-1?'↓':'—')+' • '+String(ict?.session||'—'));
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
