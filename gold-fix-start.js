import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalReadFileSync = fs.readFileSync.bind(fs);
const originalWriteFileSync = fs.writeFileSync.bind(fs);

fs.readFileSync = function patchedReadFileSync(path, ...args) {
  const data = originalReadFileSync(path, ...args);
  const p = String(path);
  if (!p.endsWith('/server.js') && !p.endsWith('\\server.js')) return data;

  const isBuffer = Buffer.isBuffer(data);
  let source = isBuffer ? data.toString('utf8') : String(data);

  const oldGoldClock = "const normalizedAt=updatedAt.toISOString(),sampleTime=updatedAt.getTime(),last=goldSamples.at(-1);";
  const newGoldClock = "const normalizedAt=updatedAt.toISOString(),sampleTime=now,last=goldSamples.at(-1);";
  const oldGoldMove = "const move=Math.min(price*.004,Math.max(price*.00025,expected5,rmse*1.35,range*.24)),direction=slope>0?1:-1,target1=price+direction*move,target2=price+direction*move*1.6,channelHalf=Math.max(rmse*1.5,move*.55),invalidation=price-direction*Math.max(move*.7,channelHalf),pace=Math.max(Math.abs(slope),move/12),eta=(distance,min,max)=>{const center=distance/pace,round5=value=>Math.max(5,Math.round(value/5)*5),low=Math.max(min,Math.min(max,round5(center*.7))),high=Math.max(low+5,Math.min(max,round5(center*1.5)));return low+'–'+high+' دقيقة'};";
  const newGoldMove = "const rawMove=Math.min(price*.004,Math.max(price*.00025,expected5,rmse*1.35,range*.24)),move=Math.max(price*.00012,Math.min(rawMove,Math.max(expected5*.8,rmse,range*.18))),direction=slope>0?1:-1,target1=price+direction*move,target2=price+direction*move*1.6,channelHalf=Math.max(rmse*1.5,move*.55),invalidation=price-direction*Math.max(move*.7,channelHalf),pace=Math.max(Math.abs(slope),move/12),eta=(distance,min,max)=>{const center=distance/pace,round5=value=>Math.max(5,Math.round(value/5)*5),low=Math.max(min,Math.min(max,round5(center*.7))),high=Math.max(low+5,Math.min(max,round5(center*1.5)));return low+'–'+high+' دقيقة'};";

  if (!source.includes(oldGoldClock)) {
    throw new Error('Gold sampling patch target was not found in server.js');
  }
  if (!source.includes(oldGoldMove)) {
    throw new Error('Gold conservative-target patch target was not found in server.js');
  }

  source = source.replace(oldGoldClock, newGoldClock);
  source = source.replace(oldGoldMove, newGoldMove);
  source = source.replace("symbol:'OANDA:XAUUSD',interval:'15'", "symbol:'OANDA:XAUUSD',interval:'1'");
  source = source.replace("symbol:'OANDA:XAUUSD',interval:'5'", "symbol:'OANDA:XAUUSD',interval:'1'");

  source = source.replace(
    "if(n<6||span<5)return{...base,note:'جمع '+fixed(span,1)+' من 5 دقائق مطلوبة لبناء التوقع وتقدير الحركة.'};",
    "if(n<3||span<1)return{...base,note:'جمع '+fixed(span,1)+' من دقيقة واحدة مطلوبة لبناء الإشارة اللحظية.'};"
  );
  source = source.replace(
    "note:'الحركة المتوقعة خلال 5 دقائق تقريبًا '+fixed(move,2)+'$ ('+fixed(move/price*100,3)+'%). السيناريو احتمالي ويُلغى عند مستوى الإلغاء.'",
    "note:'هدف محافظ مبني على الحركة المؤكدة الحالية: '+fixed(move,2)+'$ ('+fixed(move/price*100,3)+'%). التقدير احتمالي وليس ضمانًا، ويُلغى عند مستوى الإلغاء.'"
  );

  source = source.replace('توقع الذهب — نموذج 5 دقائق', 'إشارة الذهب اللحظية — هدف محافظ');
  source = source.replace('يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.', 'يُعاد تقييم الذهب لحظيًا. لا تظهر BUY / SELL إلا عند اكتمال التأكيد ووجود حركة مدعومة؛ وإلا تبقى NO TRADE.');
  source = source.replace('المطلوب 75% على الأقل', 'تأكيد لحظي • 75%+ • هدف محافظ');
  source = source.replace("(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د')", "(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 1 د')");
  source = source.replace('السعر من Gold API ويُفحص كل 30 ثانية؛ الشارت 5 دقائق من OANDA عبر TradingView وقد يظهر فرق بسيط بين المصدرين.', 'السعر من Gold API ويُفحص كل 20 ثانية؛ الشارت 1 دقيقة من OANDA عبر TradingView. الهدف والمدة تقديران محافظان وليسا ضمانًا.');

  return isBuffer ? Buffer.from(source, 'utf8') : source;
};

fs.writeFileSync = function patchedWriteFileSync(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return originalWriteFileSync(path, data, ...args);
  }

  const isBuffer = Buffer.isBuffer(data);
  let source = isBuffer ? data.toString('utf8') : String(data);
  const lockedEntryCard = '<div class="goldPlanCard"><span>الدخول المقفول</span><strong id="goldEntryLocked">—</strong><small id="goldEntryLockStatus">بانتظار إشارة مكتملة</small></div>';
  const tradingRangeCard = '<div class="goldPlanCard"><span>نطاق الدخول • Trading Range</span><strong id="goldTradeRange">—</strong><small>نفّذ فقط داخل النطاق</small></div>';
  const firstTargetCard = '<div class="goldPlanCard"><span>الهدف الأول</span><strong id="goldTarget1">—</strong><small id="goldEta1">المدة: —</small></div>';

  if (!source.includes('id="goldEntryLocked"')) {
    source = source.replace(firstTargetCard, lockedEntryCard + tradingRangeCard + firstTargetCard);
  } else if (!source.includes('id="goldTradeRange"')) {
    source = source.replace(lockedEntryCard, lockedEntryCard + tradingRangeCard);
  }
  source = source.replace(
    "if(entryStatus)entryStatus.textContent=plan.locked?'LOCKED • لا يتغير مع التحديث':'بانتظار إشارة مكتملة';",
    "if(entryStatus)entryStatus.textContent=plan.locked?'LOCKED • لا يتغير مع التحديث':'بانتظار إشارة مكتملة';const rangeNode=$('#goldTradeRange'),rangeEntry=Number(plan.entry),rangeTarget=Number(plan.target1),rangeHalf=Number.isFinite(rangeEntry)&&Number.isFinite(rangeTarget)?Math.max(.05,Math.abs(rangeTarget-rangeEntry)*.12):null;if(rangeNode)rangeNode.textContent=plan.locked&&Number.isFinite(rangeHalf)?money(rangeEntry-rangeHalf)+' — '+money(rangeEntry+rangeHalf):'—';"
  );
  source = source.replaceAll('setInterval(loadGold,30000)', 'setInterval(loadGold,20000)');
  source = source.replaceAll("setInterval(()=>loadBtc(),30000)", "setInterval(()=>loadBtc(),20000)");

  return originalWriteFileSync(path, isBuffer ? Buffer.from(source, 'utf8') : source, ...args);
};

syncBuiltinESMExports();
await import('./gold-btc-ict-start.js');
