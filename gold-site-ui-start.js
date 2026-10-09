import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function patchSiteSignalUi(source) {
  const mapper = `function goldSignalReading(raw){
  const base=goldBrowserReading(raw),positive=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
  const side=raw?.side,status=String(raw?.status||'').toUpperCase(),entry=positive(raw?.triggerPrice??raw?.entry),stop=positive(raw?.stopLoss),targets=[1,2,3,4].map(i=>positive(raw?.['target'+i]));
  const age=Number(raw?.quoteAgeMs),updatedMs=Date.parse(raw?.updatedAt),stale=Boolean(raw?.degraded)||raw?.liveFeedFresh!==true||raw?.quoteAgeMs==null||!Number.isFinite(age)||age<0||age>20000||!Number.isFinite(updatedMs)||Date.now()-updatedMs>20000||updatedMs>Date.now()+5000;
  const presentTargets=targets.filter(v=>v!=null),ordered=entry!=null&&presentTargets.length>=1&&presentTargets.every((v,i)=>side==='BUY'?v>(i?presentTargets[i-1]:entry):v<(i?presentTargets[i-1]:entry));
  const active=Boolean(raw?.signalId)&&['ACTIVE','MANAGING'].includes(status)&&raw?.entered===true&&raw?.triggered===true&&['BUY','SELL'].includes(side)&&ordered&&stop!=null;
  const collecting=!stale&&status==='COLLECTING',reason=String(raw?.reason||''),cooldown=/COOLDOWN/i.test(reason),recovering=/DATA_RECOVERING|ENGINE_UNAVAILABLE/i.test(reason);
  const confidence=Math.max(0,Math.min(100,Number(raw?.signalConfidence??raw?.confidence)||0)),minConfidence=0;
  const ict=raw?.ict||raw?.liquidityContext||{},coreEntryReady=Boolean(ict?.coreIctEntryReady&&ict?.m5MssRetest?.confirmed),cf=raw?.confluence||{},scores=cf?.scores||{},breakdown=cf?.breakdown||{},momentum=cf?.momentum||{},heat=cf?.liquidityMap||raw?.liquidityMap||{},scenarioPlan=null,rsi5=Number(cf?.momentum?.rsi14),structure5=cf?.structure?.m5==='BUY'?1:cf?.structure?.m5==='SELL'?-1:0;
  const watchSweep=ict?.legSweep||ict?.sweep||cf?.liquidity?.externalSweep||null,watchName=String(watchSweep?.name||''),sweepSide=/High|pdh|pwh|h4SwingHigh/i.test(watchName)?'SELL':/Low|pdl|pwl|h4SwingLow/i.test(watchName)?'BUY':null;
  const candidateSide=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(ict?.watchSide)?ict.watchSide:(sweepSide||(['BUY','SELL'].includes(raw?.contextBias)?raw.contextBias:null))),candidate=!stale&&!active&&status==='CANDIDATE'&&['BUY','SELL'].includes(candidateSide),candidateLocked=candidate&&Boolean(raw?.candidateLocked);
  const selected=['BUY','SELL'].includes(cf?.selectedSide)?cf.selectedSide:(candidateSide||raw?.contextBias||null),lead=Number(cf?.lead)||0;

  const snap=active&&raw?.tradeState?.signalId===raw?.signalId?raw.tradeState:null;
  const legacyPlan=active&&raw?.strategy!=='ICT_LIQUIDITY_HUNT_M5_MSS_RETEST';
  const sweepEvidence=snap?{name:snap.sweptName,level:snap.sweptLevel,t:snap.sweptAtMs}:watchSweep,mssEvidence=snap?{level:snap.mssTrigger,t:snap.mssAtMs}:ict?.m5MssEvent,retestEvidence=snap?{confirmed:snap.m5RetestConfirmed,level:snap.retestLevel,t:snap.retestAtMs}:ict?.m5MssRetest;
  const namedExternal=name=>/^(pdh|pdl|pwh|pwl|asiaHigh|asiaLow|londonHigh|londonLow|nyHigh|nyLow)$/i.test(String(name||''));
  const evidence=(label,event,ok)=>label+' '+(ok?'✓':'—')+(positive(event?.level)!=null?' @ '+positive(event.level).toFixed(2):'')+(positive(event?.t)!=null?' • '+new Date(Number(event.t)).toISOString():'');
  const checks=[['External Sweep',namedExternal(sweepEvidence?.name)&&positive(sweepEvidence?.level)!=null],['M5 MSS',snap?positive(mssEvidence?.level)!=null:Boolean(mssEvidence?.mss&&mssEvidence?.structureConfirmed===true)],['M5 Retest/Hold',retestEvidence?.confirmed===true],['Structural SL',stop!=null],['Liquidity Target',presentTargets.length>0],['Entry',active]];
  const setupProgress=active?100:collecting?Math.min(15,Math.round((Number(raw?.sampleCount)||0)/5000*15)):Math.round(checks.filter(x=>x[1]).length/checks.length*100),setupSteps=[evidence(String(sweepEvidence?.name||'External Sweep'),sweepEvidence,checks[0][1]),evidence('M5 MSS',mssEvidence,checks[1][1]),evidence('M5 Retest/Hold',retestEvidence,checks[2][1]),'Entry '+(active?'✓':'—')].join(' • ');
  const liquidityLabel=String(ict?.drawOnLiquidity||raw?.targetLabels?.[0]||''),liquidityDescription=/^(PDH|PDL|PWH|PWL|ASIA_HIGH|ASIA_LOW|LONDON_HIGH|LONDON_LOW|NY_AM_HIGH|NY_AM_LOW)$/.test(liquidityLabel)?'سيولة يومية / أسبوعية / جلسة محددة':/SWING/.test(liquidityLabel)?'Swing سياقي — تصنيفه الخارجي غير مثبت':'مصدر السيولة غير محدد';
  const reasonUpper=reason.toUpperCase();let missingCondition='ICT: ننتظر External Liquidity → M5 MSS → Retest/Hold → Entry';
  if(active)missingCondition=stale?'الصفقة مفعلة — تحديث السعر متوقف؛ مستويات الصفقة مثبتة':'لا يوجد شرط دخول ناقص — الصفقة مفعلة؛ متابعة SL والأهداف';else if(stale)missingCondition='استعادة بيانات السعر الحي';else if(recovering)missingCondition='استعادة بيانات السعر الحي';else if(cooldown)missingCondition='فترة حماية بعد الصفقة السابقة';else if(/TARGET_ROOM_TOO_SMALL|TP1_BELOW_0_5R/.test(reasonUpper))missingCondition='المسافة إلى الهدف أو العائد مقابل المخاطرة غير كافية';else if(/STOP_TOO_|INVALID_MOMENTUM_STOP|MIN_LOT_EXCEEDS/.test(reasonUpper))missingCondition='وقف الخسارة أو حجم المخاطرة غير مناسب';else if(status==='CANDIDATE')missingCondition=coreEntryReady?(candidateLocked?'بوابة ICT مكتملة — الخطة مثبتة؛ FVG/OB/iFVG دعم فقط':'بوابة ICT مكتملة — M5 MSS + Retest/Hold؛ FVG/OB/iFVG دعم فقط'):(candidateLocked?'خطة ICT مثبتة — ننتظر اكتمال بوابة M5 أو التفعيل':'ننتظر اكتمال M5 MSS + Retest/Hold');
  if(legacyPlan)missingCondition='الصفقة مفعلة بخطة سابقة — '+(stale?'تحديث السعر متوقف؛ ':'')+'اصطياد السيولة الجديد يطبق على الإشارات التالية؛ متابعة SL والأهداف';
  const developingSide=candidateSide;
  const scenarioLabel=active?(side+(legacyPlan?' — خطة سابقة':' — اصطياد سيولة مؤكد')+' — ICT '+confidence+'/100'):candidate?((candidateLocked?'مرشح مثبت ':'مرشح ')+candidateSide+' — ICT '+confidence+'/100'):recovering?'استعادة البيانات':cooldown?'انتظار بعد الصفقة':(developingSide?('ICT WATCH — '+developingSide):'انتظار');
  const waitReason=recovering?'جاري استعادة بيانات السعر الحي.':cooldown?'فترة حماية قصيرة بعد الصفقة السابقة.':candidate?(coreEntryReady?'بوابة ICT مكتملة؛ التفعيل لا ينتظر FVG/OB.':(candidateLocked?'الخطة مثبتة؛ ننتظر اكتمال بوابة M5 بدون تغيير Entry/SL/Targets.':'ننتظر M5 MSS + Retest/Hold.')):missingCondition;
  const plan={serverOwned:true,legacyPlan,signalId:active?raw.signalId:null,state:active?(side==='BUY'?'UP':'DOWN'):stale?'STALE':collecting?'COLLECTING':'WAIT',scenarioLabel,confidence,minConfidence,setupProgress,setupSteps,missingCondition,liquidityDescription,locked:active,candidate,candidateLocked,feedPaused:Boolean(active&&stale),entry:(active||candidate)?entry:null,invalidation:(active||candidate)?stop:null,target1:(active||candidate)?targets[0]:null,target2:(active||candidate)?targets[1]:null,target3:(active||candidate)?targets[2]:null,target4:(active||candidate)?targets[3]:null,targetLabels:Array.isArray(raw?.targetLabels)?raw.targetLabels:[],lotSizing:raw?.lotSizing||null,timeframeAgreement:cf?.timeframeAgreement||null,priceAction:raw?.priceAction||null,technicalRead:raw?.technicalRead||null,liquidityMap:heat,scenarioPlan,momentum,ict,entryLow:(active||candidate)?positive(raw.entryLow):null,entryHigh:(active||candidate)?positive(raw.entryHigh):null,tp1Hit:active&&Boolean(raw?.targetHits?.[0]),tp2Hit:active&&Boolean(raw?.targetHits?.[1]),tp3Hit:active&&Boolean(raw?.targetHits?.[2]),tp4Hit:active&&Boolean(raw?.targetHits?.[3]),lockCreatedAt:active?raw.issuedAtMs:null,eta1:null,eta2:null,sampleCount:Number(raw?.sampleCount)||0,spanMinutes:Math.min(60,(Number(raw?.readingCompleteness)||0)*.6),channel:active?(side==='BUY'?'RISING':'FALLING'):'FLAT',note:active?((stale?'DATA PAUSED • confirmed trade remains locked • ':'')+'ICT '+String(raw?.strategy||'SETUP')+' • قوة الإشارة '+confidence+'/100 • '+liquidityDescription):candidate?(candidateLocked?('ICT plan locked • '+candidateSide+' • Entry/SL/Targets ثابتة'):('ICT ready • '+candidateSide+' • '+confidence+'/100')):waitReason};
  return {...base,stale,direction:active?(side==='BUY'?'UP':'DOWN'):'FLAT',plan};
}`;

  if (!source.includes('function goldSignalReading(raw){') && source.includes('function goldBrowserReading(raw){')) {
    source = source.replace('function goldBrowserReading(raw){', mapper + '\nfunction goldBrowserReading(raw){');
  }

  source = source.replaceAll('const d=goldBrowserReading(raw);', 'const d=goldSignalReading(raw);');
  source = source.replace(
    'توقع الذهب — نموذج 5 دقائق',
    'XAUUSD — ICT LIQUIDITY HUNT | External Sweep → M5 MSS → Retest/Hold | FVG/iFVG/OB = Confluence'
  );
  source = source.replace(
    "symbol:'OANDA:XAUUSD',interval:'15'",
    "symbol:'OANDA:XAUUSD',interval:'5'"
  );
  source = source.replace(
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'محرك الذهب ICT فقط: السيولة الخارجية أولًا، ثم قراءة رد الفعل على 1m/5m؛ لا تُنشئ المؤشرات أو Price Action صفقة مستقلة.'
  );

  source = source.replace(
    '<div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>',
    '<div class="goldDecisionSummary"><div><span>الحالة الآن</span><strong id="goldCurrentBias">WAIT</strong></div><div><span>تقدم التفعيل</span><strong id="goldDecisionProgress">0%</strong></div><div class="goldDecisionWide"><span>الشرط المانع الآن</span><strong id="goldBlockingTrigger">—</strong></div><div><span>إلغاء السيناريو</span><strong id="goldDecisionInvalidation">—</strong></div></div><div class="goldPlanCard"><span>تقدم الإشارة</span><strong id="goldSetupProgress">0%</strong><small id="goldSetupSteps">External Sweep — • M5 MSS/CISD — • M5 Retest/Hold — • Structural SL — • External Target — • Entry —</small></div><div class="goldPlanCard"><span>الشرط الناقص الآن</span><strong id="goldMissingCondition">—</strong><small>يتحدث مع كل قراءة جديدة</small></div><div class="goldPlanCard"><span>اللوت المحسوب</span><strong id="goldLotSize">—</strong><small id="goldLotRisk">حسب مسافة SL</small></div><div class="goldPlanCard"><span>Liquidity / Structure Context</span><strong id="goldIctDraw">—</strong><small id="goldIctBias">Context only • not a hard gate</small></div><div class="goldPlanCard"><span>Liquidity Hunt — CHoCH / MSS / Displacement</span><strong id="goldPatternRead">—</strong><small id="goldPatternState">1m/5m confirmation only</small></div><div class="goldPlanCard"><span>POI — FVG / iFVG / Order Block</span><strong id="goldTechnicalRead">—</strong><small id="goldTechnicalState">Entry context / retest only • no separate strategy</small></div><div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>'
  );
  source = source.replace('</style>', '.goldDecisionSummary{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:12px;margin:0 0 12px;border:1px solid #6f5a26;border-radius:15px;background:linear-gradient(145deg,#17160f,#0b1320)}.goldDecisionSummary>div{padding:11px;border:1px solid #33435c;border-radius:11px;background:#0a111d}.goldDecisionSummary span{display:block;font-size:11px;color:#a99b75;margin-bottom:5px}.goldDecisionSummary strong{display:block;font-size:20px;line-height:1.35}.goldDecisionSummary .goldDecisionWide{grid-column:span 2}@media(max-width:760px){.goldDecisionSummary{grid-template-columns:1fr 1fr}.goldDecisionSummary .goldDecisionWide{grid-column:1/-1}.goldDecisionSummary strong{font-size:17px}}</style>');

  source = source.replace(
    '<div class="goldPlanCard"><span>Liquidity / Structure Context</span><strong id="goldIctDraw">—</strong><small id="goldIctBias">Context only • not a hard gate</small></div>',
    '<div class="goldPlanCard"><span>Liquidity Heatmap — FREE</span><strong id="goldLiquidityHeatmap">يجمع المناطق…</strong><small id="goldLiquidityHeatmapState">Free proxy • no Level 2/MBO</small></div><div class="goldPlanCard"><span>Liquidity / Structure Context</span><strong id="goldIctDraw">—</strong><small id="goldIctBias">Context only • not a hard gate</small></div>'
  );
  source = source.replace(
    "$('#goldScenario').textContent=labels[plan.state]||'انتظار';$('#goldScenario').className=classes[plan.state]||'muted';",
    "$('#goldScenario').textContent=plan.scenarioLabel||(labels[plan.state]||'انتظار');$('#goldScenario').className=plan.expectedDirectionLabel==='صاعد'?'positive':plan.expectedDirectionLabel==='هابط'?'negative':(classes[plan.state]||'muted');const lot=plan.lotSizing||{},lotNode=$('#goldLotSize'),lotRisk=$('#goldLotRisk'),drawNode=$('#goldIctDraw'),biasNode=$('#goldIctBias'),progressNode=$('#goldSetupProgress'),stepsNode=$('#goldSetupSteps'),missingNode=$('#goldMissingCondition');if(progressNode)progressNode.textContent=Number(plan.setupProgress||0)+'%';if(stepsNode)stepsNode.textContent=plan.setupSteps||'—';if(missingNode)missingNode.textContent=plan.missingCondition||'—';if(lotNode)lotNode.textContent=(plan.locked||plan.candidate)&&Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—';if(lotRisk)lotRisk.textContent=(plan.locked||plan.candidate)&&Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2):(plan.candidate?'مرشح — لم يعتمد بعد':'يظهر بعد اعتماد SL');const ict=plan.ict||{};if(drawNode)drawNode.textContent=(ict.drawOnLiquidity||plan.targetLabels?.[0]||'External liquidity targets');if(biasNode){const tf=plan.timeframeAgreement||{},aligned=Array.isArray(tf.alignedFrames)?tf.alignedFrames:[],opposed=Array.isArray(tf.opposedFrames)?tf.opposedFrames:[];biasNode.textContent=plan.liquidityDescription+' • 15m '+(ict.dir15===1?'↑':ict.dir15===-1?'↓':'—')+' • 1H '+(ict.dir1===1?'↑':ict.dir1===-1?'↓':'—')+' • TF +'+Number(tf.confidenceBonus||0)+'/6 • '+(aligned.length?'✓ '+aligned.join(','):'no aligned HTF')+(opposed.length?' • ↔ '+opposed.join(',')+' advisory':'')+' • NOT GATE';}"
  );
  source = source.replace(
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=(plan.state==='UP'||plan.state==='DOWN')?'ICT مكتمل':(plan.candidate?(plan.candidateLocked?'خطة ICT مثبتة — Entry/SL/Targets ثابتة':((plan.ict?.coreIctEntryReady&&plan.ict?.m5MssRetest?.confirmed)?'M5 MSS + Retest/Hold مكتمل — بانتظار التفعيل اللحظي':'ICT sequence قيد المتابعة')):(plan.state==='COLLECTING'?'تهيئة بيانات ICT':'ICT sequence قيد المتابعة'));"
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
  if(/MOVE CONSUMED/.test(u))return 'الحركة استُهلكت؛ ننتظر Setup جديد ولا نطارد السعر';
  if(/NO CHASE/.test(u))return 'السعر ابتعد عن منطقة الدخول؛ ننتظر فرصة جديدة';
  if(/STRUCTURAL STOP EXCEEDS/.test(u))return 'SL واسع — معلومة فقط، لا يمنع الصفقة';
  if(/STOP_TOO_|INVALID_MOMENTUM_STOP|MIN_LOT_EXCEEDS/.test(u))return 'وقف الخسارة أو المخاطرة غير مناسب';
  if(/TARGET WAIT|MAIN_TARGET_BELOW_MIN_R|TP1_TOO_CLOSE/.test(u))return 'لا توجد سيولة خارجية مناسبة تبعد 5$ أو أكثر';
  if(/USD_NEWS_BLACKOUT|NEWS RISK/.test(u))return 'فلتر الأخبار يمنع الدخول مؤقتًا';
   if(/ICT CONTEXT WAIT/.test(u))return 'السيولة مرصودة؛ ننتظر MSS/Displacement أو تأكيد بنيوي مكافئ قبل التنفيذ';
   if(/WAITING_ENTRY_RANGE/.test(u)){const g=raw?.entryGuard||{};return Number.isFinite(Number(g.entryLow))&&Number.isFinite(Number(g.entryHigh))?'خطة ICT غير مكتملة بعد — ننتظر نطاق التنفيذ '+Number(g.entryLow).toFixed(2)+' – '+Number(g.entryHigh).toFixed(2):'خطة ICT غير مكتملة بعد — ننتظر نطاق التنفيذ';}
   if(st==='CANDIDATE'&&raw?.ict?.coreIctEntryReady&&raw?.ict?.m5MssRetest?.confirmed)return raw?.candidateLocked?'بوابة ICT مكتملة — الخطة مثبتة؛ FVG/OB/iFVG دعم فقط':'بوابة ICT مكتملة — M5 MSS + Retest/Hold؛ FVG/OB/iFVG دعم فقط';
   if(st==='CANDIDATE')return raw?.candidateLocked?'خطة ICT مثبتة — ننتظر اكتمال بوابة M5 أو التفعيل':'ننتظر M5 MSS + Retest/Hold';
  return 'بانتظار External Sweep ثم M5 MSS + Retest/Hold';
 }
 async function refresh(){
  try{
   const r=await fetch('/api/auto-trade/signal?observe=1&_='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const raw=await r.json();
   const reading=goldSignalReading(raw),plan=reading.plan,status=String(raw?.status||'').toUpperCase(),active=plan.locked,collecting=status==='COLLECTING';
   const ict=raw?.ict||raw?.liquidityContext||{},cf=raw?.confluence||{},sweepEvent=ict?.legSweep||ict?.sweep||cf?.liquidity?.externalSweep||null,sweepName=String(sweepEvent?.name||''),sweepLabel=(sweepName||'Liquidity').replaceAll('_',' '),derivedSweepSide=/High|pdh|pwh|h4SwingHigh/i.test(sweepName)?'SELL':/Low|pdl|pwl|h4SwingLow/i.test(sweepName)?'BUY':null,side=active?raw.side:['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(ict?.watchSide)?ict.watchSide:(derivedSweepSide||(['BUY','SELL'].includes(raw?.side)?raw.side:null)));
   const native=raw?.luxalgo?.frames||{},m1=native?.['1m']||{},m5=native?.['5m']||{},matches=e=>Boolean(e&&(!side||String(e?.side||'').toUpperCase()===side)),contextReady=Number(ict?.dir15)!==0||Number(ict?.dir1)!==0,sweepReady=Boolean(sweepEvent),mssReady=sweepReady&&Boolean(ict?.m5MssEvent?.mss&&ict?.m5MssEvent?.structureConfirmed===true),displacementReady=sweepReady&&Boolean(ict?.hasDisplacement||ict?.displacement||ict?.firstDisplacementEvent||matches(m1?.displacement)||matches(m5?.displacement)),cisdReady=Boolean(ict?.hasCisd||ict?.cisd?.confirmed),shiftReady=mssReady,retestReady=Boolean(ict?.m5MssRetest?.confirmed||ict?.retest===true),continuationReady=Boolean(ict?.coreIctEntryReady&&retestReady||ict?.entryMode==='CONFIRMED_CONTINUATION'||ict?.useDirectContinuation||ict?.directContinuation),confluenceReady=Boolean(ict?.originFvg||ict?.fvg||ict?.inverseFvg||ict?.orderBlock||cf?.originFvg||matches(m1?.fvg)||matches(m5?.fvg)||matches(m1?.orderBlock)||matches(m5?.orderBlock));
   const stopDistance=Number(ict?.proposedStopDistance??raw?.agentStack?.agents?.risk?.stopDistanceUsd),maxStopDistance=Number(ict?.maxStopDistanceUsd??raw?.agentStack?.agents?.risk?.maxStopDistanceUsd??10),stopReady=Number.isFinite(Number(raw?.stopLoss??ict?.proposedStop))&&Number(raw?.stopLoss??ict?.proposedStop)>0,levels=ict?.levels||{},hasExternalTarget=side==='SELL'?[levels.pdl,levels.pwl,levels.asiaLow,levels.londonLow,levels.nyLow,levels.h4SwingLow].some(Number.isFinite):side==='BUY'?[levels.pdh,levels.pwh,levels.asiaHigh,levels.londonHigh,levels.nyHigh,levels.h4SwingHigh].some(Number.isFinite):false,targetReady=Boolean(ict?.mainLiquidity||raw?.target1||hasExternalTarget),triggerReady=active;
   const checks=[[sweepReady?sweepLabel+' swept':'External Sweep',sweepReady],['M5 MSS',shiftReady],['M5 Retest/Hold',retestReady],['Structural SL',stopReady],['External Target',targetReady],['Entry',triggerReady]],done=checks.filter(x=>x[1]).length;
   const progress=active?100:collecting?Math.min(15,Math.max(1,Math.round((Number(raw?.sampleCount)||0)/5000*15))):Math.round(done/checks.length*100);
   const conf=Math.max(0,Math.min(100,Number(raw?.signalConfidence??raw?.confidence)||0)),min=0;
   const cfScores=cf?.scores||{},cfSide=['BUY','SELL'].includes(cf?.selectedSide)?cf.selectedSide:side,cfScore=plan.confidence,cfLead=Math.round(Number(cf?.lead)||0),biasLabel=active?(String(raw?.side||cfSide||'WAIT')+' LIVE'):(side?(side+' ICT WATCH'):'NEUTRAL / WAIT');
   const blocker=active?'لا يوجد مانع — الصفقة مفعلة؛ Entry / SL / Targets مقفولة حتى TP/SL':sweepReady&&!mssReady?'تم حفظ '+sweepLabel+' sweep — ننتظر M5 MSS':sweepReady&&mssReady&&!retestReady?'M5 MSS مؤكد — ننتظر Retest/Hold':sweepReady&&mssReady&&retestReady?'بوابة ICT مكتملة — ننتظر تفعيل Entry':missing(raw,conf,min),keyCandle=raw?.importantCandles?.primary||cf?.importantCandles?.primary||null,conflictLevel=Number(raw?.conflict?.invalidationLevel),stopLevel=Number(raw?.stopLoss),proposedStop=Number(ict?.proposedStop),keyLow=Number(keyCandle?.low),keyHigh=Number(keyCandle?.high);let invalidation='بانتظار تثبيت مستوى بنيوي';if(Number.isFinite(stopLevel)&&stopLevel>0)invalidation='SL '+stopLevel.toFixed(2);else if(Number.isFinite(proposedStop)&&proposedStop>0)invalidation='Proposed SL '+proposedStop.toFixed(2)+' • distance '+(Number.isFinite(stopDistance)?stopDistance.toFixed(2):'—')+' USD / max '+maxStopDistance.toFixed(2)+' USD';else if(Number.isFinite(conflictLevel)&&conflictLevel>0)invalidation='M5 invalidation '+conflictLevel.toFixed(2);else if(side==='BUY'&&Number.isFinite(keyLow)&&keyLow>0)invalidation='M5 close < '+keyLow.toFixed(2);else if(side==='SELL'&&Number.isFinite(keyHigh)&&keyHigh>0)invalidation='M5 close > '+keyHigh.toFixed(2);
   set('goldCurrentBias',biasLabel+((active||status==='CANDIDATE')&&cfSide?' • '+cfScore+'/100':''));set('goldDecisionProgress',plan.setupProgress+'%');set('goldBlockingTrigger',plan.missingCondition);set('goldDecisionInvalidation',invalidation);
   const planVisible=active||plan.candidate,fmtUsd=v=>Number.isFinite(Number(v))&&Number(v)>0?'$'+Number(v).toFixed(2):'—',rawEntry=Number(raw?.triggerPrice??raw?.entry),rawLo=Number(raw?.entryLow),rawHi=Number(raw?.entryHigh),rawSl=Number(raw?.stopLoss??ict?.proposedStop),rawT1=Number(raw?.target1),rawT2=Number(raw?.target2);
   if(!planVisible){set('goldActualEntry','—');set('goldActualEntryState','لا توجد صفقة مفعلة');set('goldEntry','—');set('goldTarget1','—');set('goldTarget2','—');set('goldInvalidation','—');}
   if(planVisible){set('goldEntry',Number.isFinite(rawLo)&&Number.isFinite(rawHi)?fmtUsd(rawLo)+' — '+fmtUsd(rawHi):fmtUsd(rawEntry));set('goldActualEntry',active?fmtUsd(rawEntry):'—');set('goldActualEntryState',active?'✓ تم تفعيل الدخول':'الخطة جاهزة — لم يتفعّل الدخول بعد');set('goldTarget1',(plan.tp1Hit?'✓ تحقق — ':'')+fmtUsd(rawT1));set('goldTarget2',(plan.tp2Hit?'✓ تحقق — ':'')+fmtUsd(rawT2));if(Number.isFinite(rawSl)&&rawSl>0)set('goldInvalidation',fmtUsd(rawSl));}
   set('goldSetupProgress',plan.setupProgress+'%');set('goldSetupSteps',plan.setupSteps);set('goldMissingCondition',plan.missingCondition);
    set('goldConfidence',active?(raw?.degraded||raw?.liveFeedFresh===false?'ICT مكتمل — ENTRY ACTIVE • DATA PAUSED':'ICT مكتمل — ENTRY ACTIVE'):(status==='CANDIDATE'?(raw?.candidateLocked?'خطة ICT مثبتة — بانتظار التفعيل':(continuationReady?'M5 MSS + Retest/Hold مكتمل — بانتظار التفعيل الفعلي':'ICT sequence قيد المتابعة')):(/STRUCTURAL STOP EXCEEDS/.test(String(raw?.reason||'').toUpperCase())?'WAIT — الوقف الهيكلي أوسع من الحد':'ICT sequence قيد المتابعة')));
   const lot=raw?.lotSizing||{};set('goldLotSize',Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—');set('goldLotRisk',Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2)+' • advisory only':'يظهر بعد اعتماد SL');
   const heat=cf?.liquidityMap||raw?.liquidityMap||{},ha=heat?.nearestAbove,hb=heat?.nearestBelow,heatPart=(z,arrow)=>z&&Number.isFinite(Number(z.price))?arrow+' '+Number(z.price).toFixed(2)+' ('+Math.round(Number(z.intensity)||0)+'%)':arrow+' —';set('goldLiquidityHeatmap',heatPart(ha,'↑')+' • '+heatPart(hb,'↓'));set('goldLiquidityHeatmapState',(heat?.mode||'COLLECTING')+' • '+(heat?.volumeAvailable?'TradingView candle volume':'price-action proxy')+' • NO L2/MBO');
   set('goldIctDraw',ict?.drawOnLiquidity||raw?.targetLabels?.[0]||(side==='SELL'?'Sell-side external liquidity':'Buy-side external liquidity'));const tf=cf?.timeframeAgreement||{},tfAligned=Array.isArray(tf?.alignedFrames)?tf.alignedFrames:[],tfOpposed=Array.isArray(tf?.opposedFrames)?tf.opposedFrames:[];set('goldIctBias',plan.liquidityDescription+' • '+(side?('Watch '+side+' • '):'')+'15m '+(ict?.dir15===1?'↑':ict?.dir15===-1?'↓':'—')+' • 1H '+(ict?.dir1===1?'↑':ict?.dir1===-1?'↓':'—')+' • TF +'+Number(tf?.confidenceBonus||0)+'/6 • '+(tfAligned.length?'✓ '+tfAligned.join(','):'no aligned HTF')+(tfOpposed.length?' • ↔ '+tfOpposed.join(',')+' advisory':'')+' • NOT GATE');set('goldPatternRead',(side||'—')+' • CISD '+(cisdReady?'✓':'—')+' • MSS '+(mssReady?'✓':'—')+' • Displacement '+(displacementReady?'✓':'—'));set('goldPatternState',ict?.sequence5?.firstAny?.choch&&!mssReady?'CHoCH — مراقبة؛ ننتظر MSS بإزاحة عبر المستوى الهيكلي':'Liquidity Hunt — سحب سيولة ثم M5 MSS ثم إعادة اختبار');const ifvgReady=Boolean(ict?.hasIfvg||ict?.inverseFvg),ifvgRetest=Boolean(ict?.hasIfvgRetest||ict?.inverseFvg?.retested),obReady=Boolean(ict?.orderBlock||matches(m1?.orderBlock)||matches(m5?.orderBlock));set('goldTechnicalRead','FVG '+(confluenceReady?'✓':'—')+' • iFVG '+(ifvgReady?'✓':'—')+' • OB '+(obReady?'✓':'—'));set('goldTechnicalState',(ifvgReady?('iFVG retest '+(ifvgRetest?'✓':'—')+' • '):'')+'POI is ICT context only; no indicator strategy');
  }catch(e){set('goldMissingCondition','تعذر قراءة محرك الذهب الآن');}
 }
 (async function loop(){await refresh();setTimeout(loop,2000)})();
})();
</script>`;
  if(!source.includes('goldLiveProgressPoller')) source=source.replace('</body>', () => liveProgressScript+'</body>');
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
