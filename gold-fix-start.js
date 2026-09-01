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

  if (!source.includes(oldGoldClock)) {
    throw new Error('Gold sampling patch target was not found in server.js');
  }

  source = source.replace(oldGoldClock, newGoldClock);
  source = source.replace("symbol:'OANDA:XAUUSD',interval:'15'", "symbol:'OANDA:XAUUSD',interval:'1'");
  source = source.replace("symbol:'OANDA:XAUUSD',interval:'5'", "symbol:'OANDA:XAUUSD',interval:'1'");

  source = source.replace(
    "if(n<6||span<5)return{...base,note:'جمع '+fixed(span,1)+' من 5 دقائق مطلوبة لبناء التوقع وتقدير الحركة.'};",
    "if(n<3||span<1)return{...base,note:'جمع '+fixed(span,1)+' من دقيقة واحدة مطلوبة لبناء الإشارة اللحظية.'};"
  );
  source = source.replace(
    "note:'الحركة المتوقعة خلال 5 دقائق تقريبًا '+fixed(move,2)+'$ ('+fixed(move/price*100,3)+'%). السيناريو احتمالي ويُلغى عند مستوى الإلغاء.'",
    "note:'إشارة لحظية مبنية على نافذة الدقيقة الأخيرة. الحركة المقدرة '+fixed(move,2)+'$ ('+fixed(move/price*100,3)+'%). السيناريو احتمالي ويُلغى عند مستوى الإلغاء.'"
  );

  source = source.replace('توقع الذهب — نموذج 5 دقائق', 'إشارة الذهب اللحظية — نموذج 1 دقيقة');
  source = source.replace('يُعرض السيناريو المتوقع بعد اكتمال 5 دقائق من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.', 'يُعاد تقييم الذهب لحظيًا من نافذة دقيقة واحدة. لا تظهر BUY / SELL إلا عند اكتمال شروط التأكيد؛ وإلا تبقى NO TRADE.');
  source = source.replace('المطلوب 75% على الأقل', 'تأكيد لحظي • 75%+');
  source = source.replace('السعر من Gold API ويُفحص كل 30 ثانية؛ الشارت 5 دقائق من OANDA عبر TradingView وقد يظهر فرق بسيط بين المصدرين.', 'السعر من Gold API ويُفحص كل 30 ثانية؛ الشارت 1 دقيقة من OANDA عبر TradingView. نموذج الإشارة يُعاد بناؤه من أحدث نافذة دقيقة.');

  return isBuffer ? Buffer.from(source, 'utf8') : source;
};

syncBuiltinESMExports();
await import('./gold-ict-history-start.js');
