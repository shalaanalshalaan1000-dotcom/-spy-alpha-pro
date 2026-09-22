import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function patchSiteSignalUi(source) {
  const mapper = `function goldSignalReading(raw){
  const base=goldBrowserReading(raw),positive=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
  const side=raw?.side,status=String(raw?.status||'').toUpperCase(),entry=positive(raw?.triggerPrice??raw?.entry),stop=positive(raw?.stopLoss),targets=[1,2,3,4].map(i=>positive(raw?.['target'+i]));
  const age=Number(raw?.quoteAgeMs),stale=Boolean(raw?.degraded)||raw?.liveFeedFresh!==true||raw?.quoteAgeMs==null||!Number.isFinite(age)||age<0||age>20000||Date.now()-Date.parse(raw?.updatedAt)>20000||!Number.isFinite(Date.parse(raw?.updatedAt))||Date.parse(raw?.updatedAt)>Date.now()+5000;
  const presentTargets=targets.filter(v=>v!=null),ordered=entry!=null&&presentTargets.length>=1&&presentTargets.every((v,i)=>side==='BUY'?v>(i?presentTargets[i-1]:entry):v<(i?presentTargets[i-1]:entry));
  const active=!stale&&Boolean(raw?.signalId)&&['ACTIVE','MANAGING'].includes(status)&&raw?.entered===true&&raw?.triggered===true&&['BUY','SELL'].includes(side)&&ordered&&stop!=null;
  const collecting=!stale&&status==='COLLECTING',reason=String(raw?.reason||''),cooldown=/COOLDOWN/i.test(reason),recovering=/DATA_RECOVERING|ENGINE_UNAVAILABLE/i.test(reason),guard=/ENTRY_GUARD|TP1_TOO_CLOSE|WAITING_1M|STOP_TOO_|TP1_OR_SL/i.test(reason);
  const rawConfidence=Math.max(0,Math.min(100,Number(raw?.signalConfidence??raw?.confidence)||0)),confidence=rawConfidence,minConfidence=Math.max(0,Number(raw?.minConfidence)||82);
  const ict=raw?.ict||{},candidateSide=['BUY','SELL'].includes(raw?.candidateAction)?raw.candidateAction:(['BUY','SELL'].includes(raw?.contextBias)?raw.contextBias:null),trendSign=candidateSide==='BUY'?1:candidateSide==='SELL'?-1:0;
  const htfReady=Boolean(trendSign&&ict.dir4===trendSign&&ict.dir1===trendSign),contextReady=Boolean(trendSign&&ict.dir15===trendSign),fvgReady=Boolean(ict.fvg),impulseReady=Boolean(ict.displacement||ict.mss),timingReady=Boolean(ict.sweep||ict.mss||raw?.oneMinuteConfirmed),rrValue=Number(raw?.riskReward),rrReady=Number.isFinite(rrValue)&&rrValue>=1.5;
  const checks=[['HTF',htfReady],['15m',contextReady],['FVG',fvgReady],['Displacement',impulseReady],['Timing',timingReady],['RR≥1.5',rrReady]],done=checks.filter(x=>x[1]).length,setupProgress=active?100:collecting?Math.min(15,Math.round((Number(raw?.sampleCount)||0)/120*15)):Math.round(done/checks.length*100),setupSteps=checks.map(x=>x[0]+' '+(x[1]?'✓':'—')).join(' • ');
  const reasonUpper=String(raw?.reason||'').toUpperCase();let missingCondition='بانتظار اكتمال شروط ICT';
  if(recovering)missingCondition='استعادة بيانات السعر الحي';else if(cooldown)missingCondition='فترة حماية بعد الصفقة السابقة';else if(/4H\/1H BIAS IS NOT ALIGNED/.test(reasonUpper))missingCondition='ينقص توافق اتجاه 4H و1H';else if(/OFF-KILLZONE/.test(reasonUpper))missingCondition='ينقص تأكيد خارج Killzone: MSS أو تأكيد 1m';else if(/NO COMPLETE LIQUIDITY SWEEP|DISPLACEMENT\/FVG/.test(reasonUpper))missingCondition='ينقص FVG أو Displacement/سحب سيولة';else if(/STRUCTURAL INVALIDATION IS TOO CLOSE/.test(reasonUpper))missingCondition='مسافة وقف الهيكل غير مناسبة';else if(/NO OPPOSING LIQUIDITY TARGET/.test(reasonUpper))missingCondition='لا يوجد هدف سيولة يحقق 1.5R';else if(/WAITING_NEXT_5M_CLOSE_WINDOW/.test(reasonUpper))missingCondition='انتظار نافذة إغلاق 5m';else if(/WAITING_1M_CONFIRMATION/.test(reasonUpper))missingCondition='ينقص تأكيد 1m';else if(/USD_NEWS_BLACKOUT|NEWS RISK/.test(reasonUpper))missingCondition='فلتر الأخبار يمنع الدخول مؤقتًا';else if(raw?.status==='CANDIDATE')missingCondition='الإعداد جاهز مبدئيًا وينتظر دخول السعر/فلاتر التنفيذ';
  const scenarioLabel=active?(side==='BUY'?'BUY مؤكد':'SELL مؤكد'):recovering?'استعادة البيانات':cooldown?'انتظار بعد الصفقة':candidateSide?('قيد البناء '+candidateSide):'انتظار';
  const waitReason=recovering?'جاري استعادة بيانات السعر الحي؛ لن تُرسل صفقة حتى تعود البيانات.':cooldown?'فترة حماية قصيرة بعد الصفقة السابقة؛ لا توجد صفقة نشطة.':missingCondition;
  const plan={serverOwned:true,signalId:active?raw.signalId:null,state:stale?'STALE':active?(side==='BUY'?'UP':'DOWN'):collecting?'COLLECTING':'WAIT',scenarioLabel,confidence,minConfidence,setupProgress,setupSteps,missingCondition,locked:active,entry:active?entry:null,invalidation:active?stop:null,target1:active?targets[0]:null,target2:active?targets[1]:null,target3:active?targets[2]:null,target4:active?targets[3]:null,targetLabels:Array.isArray(raw?.targetLabels)?raw.targetLabels:[],lotSizing:raw?.lotSizing||null,ict,entryLow:active?positive(raw.entryLow):null,entryHigh:active?positive(raw.entryHigh):null,tp1Hit:active&&Boolean(raw?.targetHits?.[0]),tp2Hit:active&&Boolean(raw?.targetHits?.[1]),tp3Hit:active&&Boolean(raw?.targetHits?.[2]),tp4Hit:active&&Boolean(raw?.targetHits?.[3]),lockCreatedAt:active?raw.issuedAtMs:null,eta1:null,eta2:null,sampleCount:Number(raw?.sampleCount)||0,spanMinutes:Math.min(5,(Number(raw?.readingCompleteness)||0)/20),channel:active?(side==='BUY'?'RISING':'FALLING'):'FLAT',note:active?('ICT '+String(raw?.strategy||'SETUP')+' • HTF '+String(raw?.contextBias||'—')+' • Draw: '+String(ict.drawOnLiquidity||raw?.targetLabels?.[0]||'opposing liquidity')):waitReason};
  return {...base,stale,direction:active?(side==='BUY'?'UP':'DOWN'):'FLAT',plan};
}`;

  if (!source.includes('function goldSignalReading(raw){') && source.includes('function goldBrowserReading(raw){')) {
    source = source.replace('function goldBrowserReading(raw){', mapper + '\nfunction goldBrowserReading(raw){');
  }

  source = source.replaceAll('const d=goldBrowserReading(raw);', 'const d=goldSignalReading(raw);');
  source = source.replace(
    'توقع الذهب — نموذج 5 دقائق',
    'ICT XAUUSD — HTF + Liquidity + FVG'
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
    '<div class="goldPlanCard"><span>تقدم الإشارة</span><strong id="goldSetupProgress">0%</strong><small id="goldSetupSteps">HTF — • 15m — • FVG — • Displacement — • Timing — • RR —</small></div><div class="goldPlanCard"><span>الشرط الناقص الآن</span><strong id="goldMissingCondition">—</strong><small>يتحدث مع كل قراءة جديدة</small></div><div class="goldPlanCard"><span>اللوت المحسوب</span><strong id="goldLotSize">—</strong><small id="goldLotRisk">حسب مسافة SL</small></div><div class="goldPlanCard"><span>Draw on Liquidity</span><strong id="goldIctDraw">—</strong><small id="goldIctBias">HTF: —</small></div><div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div>'
  );
  source = source.replace(
    "$('#goldScenario').textContent=labels[plan.state]||'انتظار';$('#goldScenario').className=classes[plan.state]||'muted';",
    "$('#goldScenario').textContent=plan.scenarioLabel||(labels[plan.state]||'انتظار');$('#goldScenario').className=plan.expectedDirectionLabel==='صاعد'?'positive':plan.expectedDirectionLabel==='هابط'?'negative':(classes[plan.state]||'muted');const lot=plan.lotSizing||{},lotNode=$('#goldLotSize'),lotRisk=$('#goldLotRisk'),drawNode=$('#goldIctDraw'),biasNode=$('#goldIctBias'),progressNode=$('#goldSetupProgress'),stepsNode=$('#goldSetupSteps'),missingNode=$('#goldMissingCondition');if(progressNode)progressNode.textContent=Number(plan.setupProgress||0)+'%';if(stepsNode)stepsNode.textContent=plan.setupSteps||'—';if(missingNode)missingNode.textContent=plan.missingCondition||'—';if(lotNode)lotNode.textContent=plan.locked&&Number(lot.recommendedLot)>0?Number(lot.recommendedLot).toFixed(2)+' lot':'—';if(lotRisk)lotRisk.textContent=plan.locked&&Number.isFinite(Number(lot.actualRiskUsd))?'Risk USD '+Number(lot.actualRiskUsd).toFixed(2)+' • SL '+Number(lot.stopDistance||0).toFixed(2):'يظهر بعد اعتماد SL';if(drawNode)drawNode.textContent=plan.ict?.drawOnLiquidity||plan.targetLabels?.[0]||(plan.ict?.fvg?'FVG موجود • الهدف قيد التحديد':'—');if(biasNode)biasNode.textContent='HTF: '+(plan.ict?.dir4===1?'4H↑':plan.ict?.dir4===-1?'4H↓':'4H—')+' / '+(plan.ict?.dir1===1?'1H↑':plan.ict?.dir1===-1?'1H↓':'1H—')+' / '+(plan.ict?.dir15===1?'15m↑':plan.ict?.dir15===-1?'15m↓':'15m—')+' • '+(plan.ict?.session||'—');"
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
