import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function replaceRequired(source,from,to,label){
  if(!source.includes(from))throw new Error('Gold entry patch anchor missing: '+label);
  return source.replace(from,to);
}

function applyGoldEntryPatch(source){
  source=replaceRequired(
    source,
    '<div class="goldPlanHead"><h3>توقع الذهب — نموذج 5 دقائق</h3>',
    '<div class="goldPlanHead"><h3>إشارة الذهب — 1m تنفيذ • 5m تأكيد • 15m سياق</h3>',
    'gold heading'
  );

  source=replaceRequired(
    source,
    '<div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div>',
    '<div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div><div class="goldPlanCard"><span>رقم الدخول</span><strong id="goldEntry">—</strong><small id="goldEntryAction">بانتظار اكتمال الإشارة</small></div>',
    'gold entry card'
  );

  source=replaceRequired(
    source,
    '<p id="goldPlanNote" class="goldPlanNote">يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.</p>',
    '<div class="goldMtf"><div><span>1m التنفيذ</span><strong id="goldMtf1">—</strong></div><div><span>5m التأكيد</span><strong id="goldMtf5">—</strong></div><div><span>15m السياق</span><strong id="goldMtf15">—</strong></div><div><span>التوافق</span><strong id="goldMtfGate">جمع البيانات</strong></div></div><p id="goldPlanNote" class="goldPlanNote">15m يحدد السياق، 5m يؤكد الاتجاه، و1m يحدد لحظة التنفيذ.</p>',
    'gold mtf cards'
  );

  source=replaceRequired(
    source,
    '</style></head>',
    '.goldMtf{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}.goldMtf>div{padding:10px;border:1px solid #393a33;border-radius:11px;background:#0d1421}.goldMtf span{display:block;color:#9b977f;font-size:11px}.goldMtf strong{display:block;margin-top:5px;font-size:15px}.goldMtf .positive{color:#52e5a5}.goldMtf .negative{color:#ff718c}.goldMtf .WATCH{color:#ffd166}@media(max-width:760px){.goldMtf{grid-template-columns:repeat(2,1fr)}}</style></head>',
    'gold mtf css'
  );

  source=replaceRequired(
    source,
    "base={state:'COLLECTING',confidence:0,target1:null,target2:null,invalidation:null,eta1:null,eta2:null,sampleCount:n,spanMinutes:fixed(span,1),channel:null};",
    "base={state:'COLLECTING',confidence:0,entry:null,entryStatus:'WAIT',entryTolerance:null,target1:null,target2:null,invalidation:null,eta1:null,eta2:null,sampleCount:n,spanMinutes:fixed(span,1),channel:null};",
    'gold plan base'
  );

  source=replaceRequired(
    source,
    "const move=Math.min(price*.004,Math.max(price*.00025,expected5,rmse*1.35,range*.24)),direction=slope>0?1:-1,target1=price+direction*move,target2=price+direction*move*1.6,channelHalf=Math.max(rmse*1.5,move*.55),invalidation=price-direction*Math.max(move*.7,channelHalf),pace=Math.max(Math.abs(slope),move/12),eta=(distance,min,max)=>{",
    "const move=Math.min(price*.004,Math.max(price*.00025,expected5,rmse*1.35,range*.24)),direction=slope>0?1:-1,entryTolerance=Math.max(price*.00008,rmse*.75,move*.12),rawEntry=predicted,entry=rawEntry,distanceToEntry=Math.abs(price-entry),entryStatus=distanceToEntry<=entryTolerance?'ENTER_NOW':((direction>0&&price>entry)||(direction<0&&price<entry))?'WAIT_ENTRY':'WAIT_RECLAIM',target1=entry+direction*move,target2=entry+direction*move*1.6,channelHalf=Math.max(rmse*1.5,move*.55),invalidation=entry-direction*Math.max(move*.7,channelHalf),pace=Math.max(Math.abs(slope),move/12),eta=(distance,min,max)=>{",
    'gold entry calculation'
  );

  source=replaceRequired(
    source,
    "return{...base,state:direction>0?'UP':'DOWN',confidence,channel,slopePerMinute:fixed(slope,3),expectedMove5:fixed(move),expectedMovePct:fixed(move/price*100,3),target1:fixed(target1),target2:fixed(target2),invalidation:fixed(invalidation),eta1:eta(move,5,45),eta2:eta(move*1.6,5,90),note:'الحركة المتوقعة خلال 5 دقائق تقريبًا '+fixed(move,2)+'$ ('+fixed(move/price*100,3)+'%). السيناريو احتمالي ويُلغى عند مستوى الإلغاء.'};",
    "return{...base,state:direction>0?'UP':'DOWN',confidence,channel,slopePerMinute:fixed(slope,3),expectedMove5:fixed(move),expectedMovePct:fixed(move/price*100,3),entry:fixed(entry),entryStatus,entryTolerance:fixed(entryTolerance),target1:fixed(target1),target2:fixed(target2),invalidation:fixed(invalidation),eta1:eta(Math.abs(target1-price),5,45),eta2:eta(Math.abs(target2-price),5,90),note:(entryStatus==='ENTER_NOW'?'الدخول الآن قريب من القيمة العادلة القصيرة. ':'لا تطارد السعر؛ انتظر رقم الدخول المحدد. ')+'رقم الدخول مبني على إعادة اختبار خط الحركة القصير، وليس على السعر الحالي تلقائيًا.'};",
    'gold entry return'
  );

  const mtfEngine=`function goldTfSignal(samples,price,now,windowMinutes){const rows=(samples||[]).filter(x=>x.t>=now-windowMinutes*60_000&&x.t<=now+60_000);if(rows.length<3)return{ready:false,direction:'WAIT',span:0,movePct:null};const span=(rows.at(-1).t-rows[0].t)/60000,minSpan=windowMinutes===1?.6:windowMinutes===5?3.5:9;if(span<minSpan)return{ready:false,direction:'WAIT',span:Number(span.toFixed(1)),movePct:null};const t0=rows[0].t,t=rows.map(x=>(x.t-t0)/60000),mt=t.reduce((a,b)=>a+b,0)/t.length,mp=rows.reduce((a,b)=>a+b.price,0)/rows.length,vt=t.reduce((s,x)=>s+(x-mt)*(x-mt),0),slope=vt>0?rows.reduce((s,x,i)=>s+(t[i]-mt)*(x.price-mp),0)/vt:0,movePct=price>0?slope*span/price*100:0,threshold=windowMinutes===1?.006:windowMinutes===5?.012:.02,direction=Math.abs(movePct)<threshold?'FLAT':slope>0?'UP':'DOWN';return{ready:true,direction,span:Number(span.toFixed(1)),movePct:Number(movePct.toFixed(3))}}\nfunction goldMtfState(samples,price,now){const one=goldTfSignal(samples,price,now,1),five=goldTfSignal(samples,price,now,5),fifteen=goldTfSignal(samples,price,now,15);let gate='COLLECTING',bias='WAIT';if(five.ready&&fifteen.ready){const fd=five.direction,td=fifteen.direction;if(['UP','DOWN'].includes(fd)&&['UP','DOWN'].includes(td)&&fd!==td)gate='BLOCK';else{bias=['UP','DOWN'].includes(td)?td:fd;if(['UP','DOWN'].includes(bias)){gate=one.ready&&['UP','DOWN'].includes(one.direction)&&one.direction!==bias?'PULLBACK':'PASS'}else gate='WAIT'}}return{one,five,fifteen,gate,bias}}\nfunction applyGoldMtfGate(plan,samples,price,now,stale){const mtf=goldMtfState(samples,price,now),out={...plan,mtf};if(stale)return out;if(mtf.gate==='BLOCK')return{...out,state:'WAIT',entryStatus:'WAIT_MTF',target1:null,target2:null,invalidation:null,eta1:null,eta2:null,note:'لا دخول: 5m يعاكس 15m.'};if(['UP','DOWN'].includes(plan.state)&&['UP','DOWN'].includes(mtf.bias)&&plan.state!==mtf.bias)return{...out,state:'WAIT',entryStatus:'WAIT_MTF',target1:null,target2:null,invalidation:null,eta1:null,eta2:null,note:'لا دخول: نموذج 5m لا يتوافق مع سياق 15m.'};if(['UP','DOWN'].includes(plan.state)&&mtf.gate==='PULLBACK')return{...out,entryStatus:'WAIT_PULLBACK',note:'5m و15m متوافقان، لكن 1m عكس الاتجاه الآن. انتظر انتهاء الـ pullback.'};return out}\n`;
  source=replaceRequired(source,'function computeGoldPlan(samples,price,now,stale){',mtfEngine+'function computeGoldPlan(samples,price,now,stale){','gold mtf engine');

  source=replaceRequired(source,'plan:computeGoldPlan(goldSamples,price,now,stale)','plan:applyGoldMtfGate(computeGoldPlan(goldSamples,price,now,stale),goldSamples,price,now,stale)','gold mtf plan gate');

  source=replaceRequired(
    source,
    "$('#goldPlanStatus').textContent=labels[plan.state]||'انتظار';$('#goldPlanStatus').className='goldPlanStatus '+(classes[plan.state]||'muted');",
    "const executionLabel=active?(plan.entryStatus==='ENTER_NOW'?'ادخل الآن':plan.entryStatus==='WAIT_PULLBACK'?'انتظر 1m':'انتظر الدخول'):(labels[plan.state]||'انتظار');$('#goldPlanStatus').textContent=executionLabel;$('#goldPlanStatus').className='goldPlanStatus '+(plan.entryStatus==='ENTER_NOW'?'positive':(active?'WATCH':(classes[plan.state]||'muted')));",
    'gold execution status'
  );

  source=replaceRequired(
    source,
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');$('#goldEntry').textContent=active?money(plan.entry):'—';$('#goldEntry').className=plan.entryStatus==='ENTER_NOW'?'positive':(active?'WATCH':'');$('#goldEntryAction').textContent=active?(plan.entryStatus==='ENTER_NOW'?'ادخل الآن من هذا الرقم':plan.entryStatus==='WAIT_PULLBACK'?'انتظر عودة 1m مع الاتجاه':'انتظر وصول السعر إلى '+money(plan.entry)):'لا دخول قبل التوافق';",
    'gold entry render'
  );

  const renderMtf=`function renderGoldMtf(mtf){if(!mtf)return;const label=x=>x==='UP'?'صاعد':x==='DOWN'?'هابط':x==='FLAT'?'متوازن':'جمع',cls=x=>x==='UP'?'positive':x==='DOWN'?'negative':x==='FLAT'?'WATCH':'muted',set=(id,obj)=>{const n=$(id);if(!n)return;n.textContent=label(obj.direction)+(obj.ready&&obj.movePct!=null?' • '+obj.movePct+'%':'');n.className=cls(obj.direction)};set('#goldMtf1',mtf.one);set('#goldMtf5',mtf.five);set('#goldMtf15',mtf.fifteen);const g=$('#goldMtfGate');if(g){g.textContent=mtf.gate==='PASS'?'متوافق':mtf.gate==='PULLBACK'?'انتظر 1m':mtf.gate==='BLOCK'?'تعارض':'جمع البيانات';g.className=mtf.gate==='PASS'?'positive':mtf.gate==='BLOCK'?'negative':'WATCH'}}\n`;
  source=replaceRequired(source,'function renderGoldPlan(plan){',renderMtf+'function renderGoldPlan(plan){','gold mtf render function');
  source=replaceRequired(source,"$('#goldModelWindow').textContent=channelLabel+' • رصد '+plan.spanMinutes+' د';$('#goldPlanNote').textContent=plan.note;","$('#goldModelWindow').textContent=channelLabel+' • رصد '+plan.spanMinutes+' د';$('#goldPlanNote').textContent=plan.note;renderGoldMtf(plan.mtf);",'gold mtf render call');

  source=replaceIfPresent(source,"symbol:'OANDA:XAUUSD',interval:'15'","symbol:'OANDA:XAUUSD',interval:'1'");

  source=replaceRequired(
    source,
    'بعد اكتمال 5 دقائق ووصول التأكيد إلى 75% يظهر رقم دخول محدد. لا تعتبر BUY/SELL دخولًا قبل ظهور «ادخل الآن».',
    'الدخول النهائي يحتاج توافق 15m و5m، ثم 1m للتنفيذ. الأخبار عالية التأثير تبقى طبقة منع مستقلة فوق التحليل الفني.',
    'gold plan note'
  );

  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string')data=applyGoldEntryPatch(data);
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./start.js');
