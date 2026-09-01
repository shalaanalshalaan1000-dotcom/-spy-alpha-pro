import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function patchedReadFileSync(path, ...args) {
  const data = originalReadFileSync(path, ...args);
  const p = String(path);
  if (!p.endsWith('/server.js') && !p.endsWith('\\server.js')) return data;

  const isBuffer = Buffer.isBuffer(data);
  let source = isBuffer ? data.toString('utf8') : String(data);

  const oldGoldClock = "const normalizedAt=updatedAt.toISOString(),sampleTime=updatedAt.getTime(),last=goldSamples.at(-1);";
  const newGoldClock = "const normalizedAt=updatedAt.toISOString(),sampleTime=now,last=goldSamples.at(-1);";
  const oldGoldMove = "const move=Math.min(price*.004,Math.max(price*.00025,expected5,rmse*1.35,range*.24)),direction=slope>0?1:-1,target1=price+direction*move,target2=price+direction*move*1.6,channelHalf=Math.max(rmse*1.5,move*.55),invalidation=price-direction*Math.max(move*.7,channelHalf),pace=Math.max(Math.abs(slope),move/12),eta=(distance,min,max)=>{const center=distance/pace,round5=value=>Math.max(5,Math.round(value/5)*5),low=Math.max(min,Math.min(max,round5(center*.7))),high=Math.max(low+5,Math.min(max,round5(center*1.5)));return low+'–'+high+' دقيقة'};";
  const newGoldMove = "const rawMove=Math.min(price*.004,Math.max(price*.00025,expected5,rmse*1.35,range*.24));if(rawMove<5)return{...base,state:'WAIT',confidence,channel,slopePerMinute:fixed(slope,3),expectedMove5:fixed(rawMove),expectedMovePct:fixed(rawMove/price*100,3),note:'NO TRADE — الحركة المدعومة حاليًا '+fixed(rawMove,2)+'$ فقط. المطلوب مساحة متوقعة لا تقل عن 5.00$ قبل إظهار BUY / SELL.'};const move=rawMove,direction=slope>0?1:-1,target1=price+direction*move,target2=price+direction*Math.max(move*1.6,8),channelHalf=Math.max(rmse*1.5,move*.55),invalidation=price-direction*Math.max(move*.7,channelHalf),pace=Math.max(Math.abs(slope),move/12),eta=(distance,min,max)=>{const center=distance/pace,round5=value=>Math.max(5,Math.round(value/5)*5),low=Math.max(min,Math.min(max,round5(center*.7))),high=Math.max(low+5,Math.min(max,round5(center*1.5)));return low+'–'+high+' دقيقة'};";

  if (!source.includes(oldGoldClock)) {
    throw new Error('Gold sampling patch target was not found in server.js');
  }
  if (!source.includes(oldGoldMove)) {
    throw new Error('Gold minimum-target patch target was not found in server.js');
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
    "note:'إشارة معتمدة بهدف أول لا يقل عن 5$. الحركة المقدرة '+fixed(move,2)+'$ ('+fixed(move/price*100,3)+'%). إذا هبطت المساحة المتوقعة دون 5$ تعود القراءة إلى NO TRADE.'"
  );

  source = source.replace('توقع الذهب — نموذج 5 دقائق', 'إشارة الذهب اللحظية — هدف ≥ 5$');
  source = source.replace('يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.', 'يُعاد تقييم الذهب لحظيًا. لا تظهر BUY / SELL إلا عند اكتمال التأكيد ووجود حركة مدعومة لا تقل عن 5$؛ وإلا تبقى NO TRADE.');
  source = source.replace('المطلوب 75% على الأقل', 'تأكيد لحظي • 75%+ • هدف ≥ 5$');
  source = source.replace("(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 5 د')", "(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 1 د')");
  source = source.replace('السعر من Gold API ويُفحص كل 30 ثانية؛ الشارت 5 دقائق من OANDA عبر TradingView وقد يظهر فرق بسيط بين المصدرين.', 'السعر من Gold API ويُفحص كل 30 ثانية؛ الشارت 1 دقيقة من OANDA عبر TradingView. لا تُعرض إشارة تداول إذا كانت الحركة المقدرة أقل من 5$.');

  return isBuffer ? Buffer.from(source, 'utf8') : source;
};

syncBuiltinESMExports();
await import('./gold-ict-history-start.js');
