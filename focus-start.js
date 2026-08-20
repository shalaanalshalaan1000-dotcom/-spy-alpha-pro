import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function replaceIfPresent(source,from,to){
  return source.includes(from)?source.replace(from,to):source;
}

function applyFocusPatch(source){
  // Focus the options product on SPY + IWM only. Gold remains separate spot analysis.
  source=replaceIfPresent(source,
    "const STOCK_WATCHLIST = ['SPY','QQQ','IWM','NVDA','AAPL','MSFT','AMZN','META','GOOGL','TSLA','AMD','AVGO'];",
    "const STOCK_WATCHLIST = ['SPY','IWM'];"
  );
  source=replaceIfPresent(source,
    "const WATCHLIST = [...STOCK_WATCHLIST,'SPX'];",
    "const WATCHLIST = [...STOCK_WATCHLIST];"
  );
  source=replaceIfPresent(source,
    "const INDEX_ETFS = new Set(['SPY','QQQ','IWM','SPX']);",
    "const INDEX_ETFS = new Set(['SPY','IWM']);"
  );

  source=replaceIfPresent(source,
    '<p>XAUUSD FOCUS • LEADERS • SPX 0DTE • AUTO OPTIONS RADAR</p>',
    '<p>XAUUSD FOCUS • SPY + IWM OPTIONS RADAR</p>'
  );
  source=replaceIfPresent(source,
    '<section class="toolbar"><span class="stockLabel">الأساسية + SPX + اختيارات الرادار</span>',
    '<section class="toolbar"><span class="stockLabel">SPY + IWM فقط</span>'
  );
  source=replaceIfPresent(source,
    '<p id="instrumentPolicy" class="instrumentPolicy">SPY / QQQ / IWM / NVDA + القياديات تعمل بالقواعد الأساسية. اختر SPX لمسار 0DTE المستقل.</p>',
    '<p id="instrumentPolicy" class="instrumentPolicy">الموقع مخصص لعقود SPY و IWM. مدة العقد ليست شرطًا؛ تتم المفاضلة حسب جودة الفرصة والسيولة وDelta وSpread وRR.</p>'
  );

  const scoreOld="function optionScore(o,symbol,spot){const sp=spreadPct(o),mid=optionPrice(o)||0,absDelta=Math.abs(o.delta||0),dte=o.daysToExpiry??99;let s=0;if(sp!=null){if(sp<=4)s+=22;else if(sp<=7)s+=15;else if(sp<=10)s+=7;else s-=18}else if(mid>0)s+=2;if((o.openInterest||0)>=2000)s+=16;else if((o.openInterest||0)>=750)s+=10;else if((o.openInterest||0)>=200)s+=4;else s-=6;if((o.volume||0)>=1000)s+=14;else if((o.volume||0)>=250)s+=9;else if((o.volume||0)>=50)s+=3;if(symbol==='SPX'){if(absDelta>=.20&&absDelta<=.55)s+=12;if(dte<=1.2)s+=14;else s-=18;if(mid>0&&mid<=1.5)s+=12}else{if(absDelta>=.18&&absDelta<=.45)s+=16;else if(absDelta>=.12&&absDelta<=.55)s+=8;if(dte>=14&&dte<=30)s+=26;else if(dte>=10&&dte<=45)s+=8;else s-=20;if(mid>=.70&&mid<=1.30)s+=28;else if(mid>=.50&&mid<=1.60)s+=18;else if(mid>=.40&&mid<=2.00)s+=7;else s-=12;s+=Math.max(-10,10-Math.abs(mid-1)*10)}const distancePct=Math.abs(o.strike-spot)/spot*100;if(distancePct<=1.2)s+=12;else if(distancePct<=2.5)s+=7;else if(distancePct>6)s-=16;return s}";
  const scoreNew="function optionScore(o,symbol,spot){const sp=spreadPct(o),mid=optionPrice(o)||0,absDelta=Math.abs(o.delta||0);let s=0;if(sp!=null){if(sp<=3)s+=32;else if(sp<=5)s+=25;else if(sp<=8)s+=15;else if(sp<=12)s+=5;else s-=30}else if(mid>0)s+=2;if((o.openInterest||0)>=5000)s+=24;else if((o.openInterest||0)>=2000)s+=20;else if((o.openInterest||0)>=750)s+=14;else if((o.openInterest||0)>=200)s+=7;else if((o.volume||0)<50)s-=10;if((o.volume||0)>=2500)s+=20;else if((o.volume||0)>=1000)s+=16;else if((o.volume||0)>=250)s+=10;else if((o.volume||0)>=50)s+=5;if(absDelta>=.30&&absDelta<=.55)s+=28;else if(absDelta>=.20&&absDelta<=.65)s+=16;else if(absDelta>=.10&&absDelta<=.75)s+=5;else s-=10;const distancePct=Math.abs(o.strike-spot)/spot*100;if(distancePct<=1.5)s+=18;else if(distancePct<=3)s+=10;else if(distancePct<=5)s+=3;else s-=18;return s}";
  source=replaceIfPresent(source,scoreOld,scoreNew);

  const chooseOld="function chooseContract(chain,direction,spot,symbol){\n  if(!chain?.length||!['CALL','PUT'].includes(direction))return null;\n  const type=direction==='CALL'?'call':'put';\n  let candidates=chain.filter(o=>o.type===type&&optionPrice(o)>0&&(spreadPct(o)==null||spreadPct(o)<=15));\n  if(symbol==='SPX'){\n    candidates=candidates.filter(o=>(o.daysToExpiry??99)<=1.2&&optionPrice(o)<=1.5&&(type==='call'?o.strike>spot:o.strike<spot));\n  }else{\n    candidates=candidates.filter(o=>(o.daysToExpiry??0)>=14&&(o.daysToExpiry??99)<=30);\n    const dollarZone=candidates.filter(o=>optionPrice(o)>=.70&&optionPrice(o)<=1.30);\n    const nearDollar=candidates.filter(o=>optionPrice(o)>=.50&&optionPrice(o)<=1.60);\n    candidates=dollarZone.length?dollarZone:(nearDollar.length?nearDollar:candidates.filter(o=>optionPrice(o)>=.40&&optionPrice(o)<=2.00));\n  }\n  if(!candidates.length)return null;\n  let pool=candidates.filter(o=>type==='call'?o.strike>=spot&&o.strike<=spot*1.06:o.strike<=spot&&o.strike>=spot*.94);\n  if(!pool.length)pool=candidates;\n  return pool.sort((a,b)=>optionScore(b,symbol,spot)-optionScore(a,symbol,spot))[0];\n}";
  const chooseNew="function chooseContract(chain,direction,spot,symbol){\n  if(!['SPY','IWM'].includes(symbol)||!chain?.length||!['CALL','PUT'].includes(direction))return null;\n  const type=direction==='CALL'?'call':'put';\n  let candidates=chain.filter(o=>o.type===type&&optionPrice(o)>0&&(spreadPct(o)==null||spreadPct(o)<=12));\n  if(!candidates.length)return null;\n  let pool=candidates.filter(o=>type==='call'?o.strike>=spot*.99&&o.strike<=spot*1.05:o.strike<=spot*1.01&&o.strike>=spot*.95);\n  if(!pool.length)pool=candidates;\n  return pool.sort((a,b)=>optionScore(b,symbol,spot)-optionScore(a,symbol,spot))[0];\n}";
  source=replaceIfPresent(source,chooseOld,chooseNew);

  // Keep the gold numeric-entry upgrade, but never crash deployment if an older UI anchor changed.
  source=replaceIfPresent(source,
    '<div class="goldPlanHead"><h3>توقع الذهب — نموذج 5 دقائق</h3>',
    '<div class="goldPlanHead"><h3>إشارة الذهب — رقم دخول محدد</h3>'
  );
  source=replaceIfPresent(source,
    '<div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div>',
    '<div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div><div class="goldPlanCard"><span>رقم الدخول</span><strong id="goldEntry">—</strong><small id="goldEntryAction">بانتظار اكتمال الإشارة</small></div>'
  );
  source=replaceIfPresent(source,
    "base={state:'COLLECTING',confidence:0,target1:null,target2:null,invalidation:null,eta1:null,eta2:null,sampleCount:n,spanMinutes:fixed(span,1),channel:null};",
    "base={state:'COLLECTING',confidence:0,entry:null,entryStatus:'WAIT',entryTolerance:null,target1:null,target2:null,invalidation:null,eta1:null,eta2:null,sampleCount:n,spanMinutes:fixed(span,1),channel:null};"
  );
  source=replaceIfPresent(source,
    "const move=Math.min(price*.004,Math.max(price*.00025,expected5,rmse*1.35,range*.24)),direction=slope>0?1:-1,target1=price+direction*move,target2=price+direction*move*1.6,channelHalf=Math.max(rmse*1.5,move*.55),invalidation=price-direction*Math.max(move*.7,channelHalf),pace=Math.max(Math.abs(slope),move/12),eta=(distance,min,max)=>{",
    "const move=Math.min(price*.004,Math.max(price*.00025,expected5,rmse*1.35,range*.24)),direction=slope>0?1:-1,entryTolerance=Math.max(price*.00008,rmse*.75,move*.12),rawEntry=predicted,entry=rawEntry,distanceToEntry=Math.abs(price-entry),entryStatus=distanceToEntry<=entryTolerance?'ENTER_NOW':((direction>0&&price>entry)||(direction<0&&price<entry))?'WAIT_ENTRY':'WAIT_RECLAIM',target1=entry+direction*move,target2=entry+direction*move*1.6,channelHalf=Math.max(rmse*1.5,move*.55),invalidation=entry-direction*Math.max(move*.7,channelHalf),pace=Math.max(Math.abs(slope),move/12),eta=(distance,min,max)=>{"
  );
  source=replaceIfPresent(source,
    "return{...base,state:direction>0?'UP':'DOWN',confidence,channel,slopePerMinute:fixed(slope,3),expectedMove5:fixed(move),expectedMovePct:fixed(move/price*100,3),target1:fixed(target1),target2:fixed(target2),invalidation:fixed(invalidation),eta1:eta(move,5,45),eta2:eta(move*1.6,5,90),note:'الحركة المتوقعة خلال 5 دقائق تقريبًا '+fixed(move,2)+'$ ('+fixed(move/price*100,3)+'%). السيناريو احتمالي ويُلغى عند مستوى الإلغاء.'};",
    "return{...base,state:direction>0?'UP':'DOWN',confidence,channel,slopePerMinute:fixed(slope,3),expectedMove5:fixed(move),expectedMovePct:fixed(move/price*100,3),entry:fixed(entry),entryStatus,entryTolerance:fixed(entryTolerance),target1:fixed(target1),target2:fixed(target2),invalidation:fixed(invalidation),eta1:eta(Math.abs(target1-price),5,45),eta2:eta(Math.abs(target2-price),5,90),note:(entryStatus==='ENTER_NOW'?'الدخول الآن قريب من القيمة العادلة القصيرة. ':'لا تطارد السعر؛ انتظر رقم الدخول المحدد. ')+'رقم الدخول مبني على إعادة اختبار خط الحركة القصير، وليس على السعر الحالي تلقائيًا. السيناريو يُلغى عند مستوى الإلغاء.'};"
  );
  source=replaceIfPresent(source,
    "$('#goldPlanStatus').textContent=labels[plan.state]||'انتظار';$('#goldPlanStatus').className='goldPlanStatus '+(classes[plan.state]||'muted');",
    "const executionLabel=active?(plan.entryStatus==='ENTER_NOW'?'ادخل الآن':'انتظر الدخول'):(labels[plan.state]||'انتظار');$('#goldPlanStatus').textContent=executionLabel;$('#goldPlanStatus').className='goldPlanStatus '+(plan.entryStatus==='ENTER_NOW'?'positive':(active?'WATCH':(classes[plan.state]||'muted')));"
  );
  source=replaceIfPresent(source,
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');",
    "$('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د'):('التأكيد '+plan.confidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')');$('#goldEntry').textContent=active?money(plan.entry):'—';$('#goldEntry').className=plan.entryStatus==='ENTER_NOW'?'positive':(active?'WATCH':'');$('#goldEntryAction').textContent=active?(plan.entryStatus==='ENTER_NOW'?'ادخل الآن من هذا الرقم':'انتظر وصول السعر إلى '+money(plan.entry)):'لا دخول قبل تأكيد 75%';"
  );
  source=replaceIfPresent(source,
    'يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.',
    'بعد اكتمال 5 دقائق ووصول التأكيد إلى 75% يظهر رقم دخول محدد. لا تعتبر BUY/SELL دخولًا قبل ظهور «ادخل الآن».'
  );
  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string')data=applyFocusPatch(data);
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./start.js');
