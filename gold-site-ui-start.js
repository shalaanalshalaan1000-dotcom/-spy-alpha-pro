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
  const candidateSide=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.contextBias)?raw.contextBias:null),candidate=!stale&&!active&&status==='CANDIDATE'&&['BUY','SELL'].includes(candidateSide),candidateLocked=candidate&&Boolean(raw?.candidateLocked);
  const ict=raw?.ict||{},momentum={},scenarioPlan=null,rsi5=NaN,structure5=Number(ict?.dm5?.mss?1:ict?.dm5?.displacement?1:0);
  const sweepEvent=ict?.legSweep||ict?.sweep||null,sweepLabel=String(sweepEvent?.name||'Liquidity').replaceAll('_',' ');
  const contextReady=Number(ict?.dir15)!==0||Number(ict?.dir1)!==0;
  const sweepReady=Boolean(sweepEvent);
  const mssReady=sweepReady&&Boolean(ict?.hasShift||ict?.mss||ict?.firstMssEvent);
  const displacementReady=sweepReady&&Boolean(ict?.hasDisplacement||ict?.displacement||ict?.firstDisplacementEvent);
  const shiftReady=mssReady||displacementReady;
  const continuationReady=Boolean(ict?.entryMode==='CONFIRMED_CONTINUATION'||ict?.useDirectContinuation||ict?.directContinuation);
  const fvgReady=shiftReady&&Boolean(ict?.originFvg||ict?.poi);
  const setupTriggerReady=shiftReady&&Boolean(fvgReady||continuationReady);
  const targetReady=setupTriggerReady&&Boolean(ict?.mainLiquidity||raw?.target1);
  const triggerReady=active;
  const checks=[['Context',contextReady],[sweepReady?sweepLabel+' swept':'Liquidity Sweep',sweepReady],['MSS أو Displacement',shiftReady],[continuationReady?'Continuation':'FVG / OB',continuationReady||fvgReady],['External Liquidity',targetReady],['Entry',triggerReady]],done=checks.filter(x=>x[1]).length,setupProgress=active?100:collecting?Math.min(15,Math.round((Number(raw?.sampleCount)||0)/5000*15)):Math.round(done/checks.length*100),setupSteps=checks.map(x=>x[0]+' '+(x[1]?'✓':'—')).join(' • ');
  const reasonUpper=reason.toUpperCase();let missingCondition='بانتظار تسلسل ICT: سحب سيولة → MSS أو Displacement قوي → أول FVG/OB → سيولة خارجية مناسبة';
  if(recovering)missingCondition='استعادة بيانات السعر الحي';else if(cooldown)missingCondition='فترة حماية بعد الصفقة السابقة';else if(/MOVE CONSUMED/.test(reasonUpper))missingCondition='الحركة استُهلكت؛ ممنوع مطاردة آخرها وننتظر بداية جديدة';else if(/TARGET WAIT/.test(reasonUpper))missingCondition='لا توجد سيولة خارجية مناسبة تبعد 5$ أو أكثر عن منطقة الدخول';else if(/NO CHASE/.test(reasonUpper))missingCondition='السعر ابتعد عن منطقة الدخول؛ ننتظر عودة أو إعدادًا جديدًا';else if(/STOP_TOO_|INVALID_MOMENTUM_STOP|MIN_LOT_EXCEEDS/.test(reasonUpper))missingCondition='وقف الخسارة أو حجم المخاطرة غير مناسب';else if(/USD_NEWS_BLACKOUT|NEWS RISK/.test(reasonUpper))missingCondition='فلتر الأخبار يمنع الدخول مؤقتًا';else if(sweepReady&&!shiftReady)missingCondition=sweepLabel+' swept ✓ — ننتظر MSS أو Displacement قوي';else if(shiftReady&&!fvgReady&&!continuationReady)missingCondition=sweepLabel+' swept ✓ • trigger ✓ — ننتظر أول FVG/OB أو استمرار مؤكد';else if((fvgReady||continuationReady)&&!targetReady)missingCondition=(continuationReady?'Continuation ✓':'Origin FVG ✓')+' — نبحث عن سيولة خارجية مناسبة';else if(/ICT CONTEXT WAIT/.test(reasonUpper))missingCondition='نحفظ الـSweep وننتظر MSS أو Displacement قوي؛ لا نطلب الاثنين معًا';else if(status==='CANDIDATE')missingCondition=candidateLocked?'خطة ICT مثبتة — Entry / SL / Targets ثابتة؛ ننتظر دخول السعر منطقة التنفيذ':(continuationReady?'Continuation confirmed — ننتظر تثبيت خطة الدخول':'Origin FVG محددة؛ ننتظر رجوع السعر إليها للدخول');
  const developingSide=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:null;
  const scenarioLabel=active?(side==='BUY'?'BUY مؤكد — ICT Context':'SELL مؤكد — ICT Context'):candidate?((candidateLocked?'مرشح مثبت ':'مرشح ')+candidateSide+' — ICT Context'):recovering?'استعادة البيانات':cooldown?'انتظار بعد الصفقة':(sweepReady&&developingSide?(developingSide+' REVERSAL BUILDING — '+sweepLabel):(['BUY','SELL'].includes(raw?.contextBias)?('HTF Context '+raw.contextBias):'انتظار'));
  const waitReason=recovering?'جاري استعادة بيانات السعر الحي.':cooldown?'فترة حماية قصيرة بعد الصفقة السابقة.':candidate?(candidateLocked?'الخطة مثبتة؛ ننتظر دخول السعر منطقة التنفيذ بدون تغيير Entry/SL/Targets.':(continuationReady?'Continuation confirmed — ننتظر تثبيت خطة الدخول.':'Origin FVG محددة — ننتظر retracement إلى منطقة الدخول.')):missingCondition;
  const plan={serverOwned:true,signalId:active?raw.signalId:null,state:stale?'STALE':active?(side==='BUY'?'UP':'DOWN'):collecting?'COLLECTING':'WAIT',scenarioLabel,confidence,minConfidence,setupProgress,setupSteps,missingCondition,locked:active,candidate,candidateLocked,entry:(active||candidate)?entry:null,invalidation:(active||candidate)?stop:null,target1:(active||candidate)?targets[0]:null,target2:(active||candidate)?targets[1]:null,target3:(active||candidate)?targets[2]:null,target4:(active||candidate)?targets[3]:null,targetLabels:Array.isArray(raw?.targetLabels)?raw.targetLabels:[],lotSizing:raw?.lotSizing||null,priceAction:raw?.priceAction||null,technicalRead:raw?.technicalRead||null,scenarioPlan,momentum,ict,entryLow:(active||candidate)?positive(raw.entryLow):null,entryHigh:(active||candidate)?positive(raw.entryHigh):null,tp1Hit:active&&Boolean(raw?.targetHits?.[0]),tp2Hit:active&&Boolean(raw?.targetHits?.[1]),tp3Hit:active&&Boolean(raw?.targetHits?.[2]),tp4Hit:active&&Boolean(raw?.targetHits?.[3]),lockCreatedAt:active?raw.issuedAtMs:null,eta1:null,eta2:null,sampleCount:Number(raw?.sampleCount)||0,spanMinutes:Math.min(60,(Number(raw?.readingCompleteness)||0)*.6),channel:active?(side==='BUY'?'RISING':'FALLING'):'FLAT',note:active?('ICT Context '+String(raw?.strategy||'SETUP')+' • 15m '+String(raw?.contextBias||'—')+' • '+String(ict?.session||'—')):candidate?(candidateLocked?('ICT plan locked • '+candidateSide+' • Entry/SL/Targets ثابتة'):('تسلسل ICT مكتمل • '+candidateSide+' • '+(continuationReady?'confirmed continuation entry':'ننتظر retracement إلى Origin FVG'))):waitReason};
  return {...base,stale,direction:active?(side==='BUY'?'UP':'DOWN'):'FLAT',plan};
}`;

  if (!source.includes('function goldSignalReading(raw){') && source.includes('function goldBrowserReading(raw){')) {
    source = source.replace('function goldBrowserReading(raw){', mapper + '\nfunction goldBrowserReading(raw){');
  }

  source = source.replaceAll('const d=goldBrowserReading(raw);', 'const d=goldSignalReading(raw);');
  source = source.replace(
    'توقع الذهب — نموذج 5 دقائق',
    'XAUUSD — ICT — ORIGIN TO LIQUIDITY | Sweep + MSS OR Displacement + FVG/OB'
  );
  source = source.replace(
    "symbol:'OANDA:XAUUSD',interval:'15'",
    "symbol:'OANDA:XAUUSD',interval:'5'"
  );
  source = source.replace(
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'ICT: بعد سحب السيولة يكفي MSS أو Displacement قوي، ثم أول FVG/OB صالح للدخول؛ الـKillzone وHTF سياق فقط.'
  );

  source = source.replace(
    '<div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>',
    '<div class="goldPlanCard"><span>تقدم الإشارة</span><strong id="goldSetupProgress">0%</strong><small id="goldSetupSteps">HTF Context — • Sweep — • MSS أو Displacement — • FVG/OB — • Entry —</small></div><div class="goldPlanCard"><span>الشرط الناقص الآن</span><strong id="goldMissingCondition">—</strong><small>يتحدث مع كل قراءة جديدة</small></div><div class="goldPlanCard"><span>اللوت المحسوب</span><strong id="goldLotSize">—</strong><small id="goldLotRisk">حسب مسافة SL</small></div><div class="goldPlanCard"><span>ICT Origin Setup</span><strong id="goldIctDraw">—</strong><small id="goldIctBias">15m context • 1m/5m execution</small></div><div class="goldPlanCard"><span>Price Action / Reversal</span><strong id="goldPatternRead">—</strong><small id="goldPatternState">Wedge • Triangle • H&S • HH/HL • LH/LL</small></div><div class="goldPlanCard"><span>Technical Confluence</span><strong id="goldTechnicalRead">—</strong><small id="goldTechnicalState">MA50/200 • RSI14 • MACD • Stoch 5,3,3 • Candle</small></div><div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>'
  );
  source = source.replace(
    "$('#goldScenario').textContent=labels[plan.state]||'انتظار';$('#goldScenario').className=classes[plan.state]||'muted';",
    "$('#goldScenario').textContent=plan.scenarioLabel||(labels[plan.state]||'انتظار');$('#goldScenario').className=plan.expectedDirectionLabel==='صاعد'?'positive':plan.expectedDirectionLabel==='هابط'?'negative':(classes[plan.state]||'muted');const lot=plan.lotSizing||{},lotNode=$('#goldLotSize'),lotRisk=$('#goldLotRisk'),drawNode=$('#goldIctDraw'),biasNode=$('#goldIctBias'),progressNode=$('#goldSetupProgress'),stepsNode=$('#goldSetupSteps'),missingNode=$('#goldMissingCondition');if(progressNode)progressNode.textContent=Number(plan.setupProgress||0)+'%';if(stepsNode)stepsNode.textContent=plan.setupSteps||'—';if(missingNode)missingNode.textContent=plan.missingCondition||'—';if(lotNode)lotNode.textContent=(plan.locked||plan.candidate)&&Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—';if(lotRisk)lotRisk.textContent=(plan.locked||plan.candidate)&&Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2):(plan.candidate?'مرشح — لم يعتمد بعد':'يظهر بعد اعتماد SL');const ict=plan.ict||{};if(drawNode)drawNode.textContent=(ict.drawOnLiquidity||plan.targetLabels?.[0]||'External liquidity targets');if(biasNode)biasNode.textContent='15m '+(ict.dir15===1?'↑':ict.dir15===-1?'↓':'—')+' • 1H '+(ict.dir1===1?'↑':ict.dir1===-1?'↓':'—')+' • '+String(ict.session||'—');"
  );
  source = source.replace(
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=(plan.state==='UP'||plan.state==='DOWN')?'سياق ICT مكتمل':(plan.candidate?(plan.candidateLocked?'خطة ICT مثبتة — Entry/SL/Targets ثابتة':(plan.ict?.entryMode==='CONFIRMED_CONTINUATION'?'Continuation confirmed — ننتظر تثبيت الدخول':'Origin FVG محددة — انتظار retracement')):(plan.state==='COLLECTING'?'تهيئة بيانات ICT':'بانتظار اكتمال سياق ICT'));"
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
   if(/ICT CONTEXT WAIT/.test(u))return 'الـSweep محفوظ؛ ننتظر MSS أو Displacement قوي ثم أول FVG/OB';
   if(st==='CANDIDATE')return raw?.candidateLocked?'خطة ICT مثبتة — Entry / SL / Targets ثابتة؛ ننتظر منطقة التنفيذ':(raw?.ict?.entryMode==='CONFIRMED_CONTINUATION'?'Continuation confirmed — ننتظر تثبيت خطة الدخول':'Origin FVG محددة؛ ننتظر رجوع السعر إلى منطقة الدخول');
  return 'بانتظار MSS أو Displacement قوي ثم FVG/OB على 1m/5m';
 }
 async function refresh(){
  try{
   const r=await fetch('/api/auto-trade/signal?observe=1&_='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const raw=await r.json();
   const status=String(raw?.status||'').toUpperCase(),active=Boolean(raw?.signalId)&&['ACTIVE','MANAGING'].includes(status),collecting=status==='COLLECTING',side=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.contextBias)?raw.contextBias:null);
    const ict=raw?.ict||{},sweepEvent=ict?.legSweep||ict?.sweep||null,sweepLabel=String(sweepEvent?.name||'Liquidity').replaceAll('_',' '),contextReady=Number(ict?.dir15)!==0||Number(ict?.dir1)!==0,sweepReady=Boolean(sweepEvent),mssReady=sweepReady&&Boolean(ict?.hasShift||ict?.mss||ict?.firstMssEvent),displacementReady=sweepReady&&Boolean(ict?.hasDisplacement||ict?.displacement||ict?.firstDisplacementEvent),shiftReady=mssReady||displacementReady,continuationReady=Boolean(ict?.entryMode==='CONFIRMED_CONTINUATION'||ict?.useDirectContinuation||ict?.directContinuation),fvgReady=shiftReady&&Boolean(ict?.originFvg),setupTriggerReady=shiftReady&&Boolean(fvgReady||continuationReady),targetReady=setupTriggerReady&&Boolean(ict?.mainLiquidity||raw?.target1),triggerReady=active;
    const checks=[['Context',contextReady],[sweepReady?sweepLabel+' swept':'Sweep',sweepReady],['MSS أو Displacement',shiftReady],[continuationReady?'Continuation':'FVG / OB',continuationReady||fvgReady],['External Liquidity',targetReady],['Entry',triggerReady]],done=checks.filter(x=>x[1]).length;
   const progress=active?100:collecting?Math.min(15,Math.max(1,Math.round((Number(raw?.sampleCount)||0)/5000*15))):Math.round(done/checks.length*100);
   const conf=Math.max(0,Math.min(100,Number(raw?.signalConfidence??raw?.confidence)||0)),min=0;
   set('goldSetupProgress',progress+'%');set('goldSetupSteps',checks.map(x=>x[0]+' '+(x[1]?'✓':'—')).join(' • '));set('goldMissingCondition',missing(raw,conf,min));
    set('goldConfidence',active?'سياق ICT مكتمل':(status==='CANDIDATE'?(raw?.candidateLocked?'خطة ICT مثبتة — Entry/SL/Targets ثابتة':(continuationReady?'Continuation confirmed — ننتظر تثبيت الدخول':'Origin FVG محددة — انتظار retracement')):'بانتظار اكتمال سياق ICT'));
   const lot=raw?.lotSizing||{};set('goldLotSize',Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—');set('goldLotRisk',Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2):'يظهر بعد اعتماد SL');
   set('goldIctDraw',ict?.drawOnLiquidity||raw?.targetLabels?.[0]||'External liquidity targets');set('goldIctBias',(side?('Execution '+side+' • '):'')+'15m '+(ict?.dir15===1?'↑':ict?.dir15===-1?'↓':'—')+' • 1H '+(ict?.dir1===1?'↑':ict?.dir1===-1?'↓':'—')+' • '+String(ict?.session||'—'));const tr=raw?.technicalRead||null,pa=tr?.primary||raw?.priceAction?.primary||raw?.priceAction?.m5||null,paNames={FALLING_WEDGE:'Falling Wedge ↗',RISING_WEDGE:'Rising Wedge ↘',DESCENDING_CHANNEL:'Descending Channel',ASCENDING_CHANNEL:'Ascending Channel',SYMMETRICAL_TRIANGLE:'Symmetrical Triangle',ASCENDING_TRIANGLE:'Ascending Triangle ↗',DESCENDING_TRIANGLE:'Descending Triangle ↘',HEAD_AND_SHOULDERS:'Head & Shoulders ↘',INVERSE_HEAD_AND_SHOULDERS:'Inverse H&S ↗',LOWER_HIGHS_LOWER_LOWS:'LH + LL',HIGHER_HIGHS_HIGHER_LOWS:'HH + HL',COMPRESSION_LH_HL:'LH + HL Compression',EXPANSION_HH_LL:'HH + LL Expansion'};set('goldPatternRead',pa?((paNames[pa.pattern]||String(pa.pattern||'MIXED').replaceAll('_',' '))+(pa.confirmed?' ✓ BREAKOUT':' • forming')):'—');set('goldPatternState',pa?((String(pa.structure||'MIXED').replaceAll('_',' '))+' • '+(pa.breakoutSide?('break '+pa.breakoutSide):('bias '+String(pa.bias||'NEUTRAL')))+' • '+String(pa.timeframe||'5m')):'5m / 15m price action');const ind=tr?.indicators||{},cndl=tr?.candle||{},fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(1):'—';set('goldTechnicalRead',tr?('TA '+String(ind.bias||'NEUTRAL')+' • RSI '+fmt(ind.rsi14)+' • MACD '+String(ind.macd?.bias||'—')):'—');set('goldTechnicalState',tr?('MA50 '+fmt(ind.ma50)+' / MA200 '+fmt(ind.ma200)+' • Stoch '+fmt(ind.stochastic533?.k)+'/'+fmt(ind.stochastic533?.d)+' • '+String(cndl.pattern||'NONE').replaceAll('_',' ')):'MA50/200 • RSI14 • MACD • Stoch 5,3,3 • Candle');
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
