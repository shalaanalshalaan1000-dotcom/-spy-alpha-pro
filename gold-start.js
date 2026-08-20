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
    '<div class="goldPlanHead"><h3>إشارة الذهب — رقم دخول محدد</h3>',
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
    "return{...base,state:direction>0?'UP':'DOWN',confidence,channel,slopePerMinute:fixed(slope,3),expectedMove5:fixed(move),expectedMovePct:fixed(move/price*100,3),entry:fixed(entry),entryStatus,entryTolerance:fixed(entryTolerance),target1:fixed(target1),target2:fixed(target2),invalidation:fixed(invalidation),eta1:eta(Math.abs(target1-price),5,45),eta2:eta(Math.abs(target2-price),5,90),note:(entryStatus==='ENTER_NOW'?'الدخول الآن قريب من القيمة العادلة القصيرة. ':'لا تطارد السعر؛ انتظر رقم الدخول المحدد. ')+'رقم الدخول مبني على إعادة اختبار خط الحركة القصير، وليس على السعر الحالي تلقائيًا. السيناريو يُلغى عند مستوى الإلغاء.'};",
    'gold entry return'
  );

  source=replaceRequired(
    source,
    "$('#goldPlanStatus').textContent=labels[plan.state]||'انتظار';$('#goldPlanStatus').className='goldPlanStatus '+(classes[plan.state]||'muted');",
    "const executionLabel=active?(plan.entryStatus==='ENTER_NOW'?'ادخل الآن':'انتظر الدخول'):(labels[plan.state]||'انتظار');$('#goldPlanStatus').textContent=executionLabel;$('#goldPlanStatus').className='goldPlanStatus '+(plan.entryStatus==='ENTER_NOW'?'positive':(active?'WATCH':(classes[plan.state]||'muted')));",
    'gold execution status'
  );

  source=replaceRequired(
    source,
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');$('#goldEntry').textContent=active?money(plan.entry):'—';$('#goldEntry').className=plan.entryStatus==='ENTER_NOW'?'positive':(active?'WATCH':'');$('#goldEntryAction').textContent=active?(plan.entryStatus==='ENTER_NOW'?'ادخل الآن من هذا الرقم':'انتظر وصول السعر إلى '+money(plan.entry)):'لا دخول قبل تأكيد 75%';",
    'gold entry render'
  );

  source=replaceRequired(
    source,
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'بعد اكتمال 5 دقائق ووصول التأكيد إلى 75% يظهر رقم دخول محدد. لا تعتبر BUY/SELL دخولًا قبل ظهور «ادخل الآن».',
    'gold plan note'
  );

  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string'){
    data=applyGoldEntryPatch(data);
  }
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./start.js');
