import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Fast warmup patch target was not found: ' + label);
  return source.replace(before, () => after);
}

function replaceRegexRequired(source, pattern, after, label) {
  if (!pattern.test(source)) throw new Error('Gold trend patch target was not found: ' + label);
  pattern.lastIndex = 0;
  return source.replace(pattern, () => after);
}

function applyFastWarmup(source) {
  // Keep BTC untouched. These replacements affect only the XAUUSD execution model
  // injected by justmarkets-start.js.
  source = source.replace('const AUTO_TRADE_MIN_CONFIDENCE=75,', 'const AUTO_TRADE_MIN_CONFIDENCE=70,');

  const goldModel = `function autoTradeModel(price,now,quoteUpdatedAt){
  const sourceAge=Math.max(0,(now-new Date(quoteUpdatedAt).getTime())/1000),windowed=autoTradeState.samples.filter(x=>x.t>=now-2*60*60_000&&x.t<=now+60_000);let continuousFrom=0;for(let i=1;i<windowed.length;i++)if(windowed[i].t-windowed[i-1].t>3*60_000)continuousFrom=i;const recent=windowed.slice(continuousFrom),n=recent.length,span=n>1?(recent.at(-1).t-recent[0].t)/60_000:0,base={action:'WAIT',candidateAction:'WAIT',status:'COLLECTING',strategy:'XAU_TREND_PULLBACK_V2',confidence:0,price:autoRound(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,sampleCount:n,spanMinutes:autoRound(span,1),riskReward:null,riskPercentMax:1,updatedAt:new Date(now).toISOString()};
  if(sourceAge>120)return{...base,status:'STALE',reason:'سعر الذهب أقدم من دقيقتين'};
  const bars=autoTradeMinuteBars(recent).filter(x=>x.t+60_000<=now);
  if(bars.length<15)return{...base,reason:'تهيئة محرك الذهب: '+bars.length+' من 15 شمعة دقيقة مغلقة'};
  const ema=(values,p)=>{const k=2/(p+1);let e=values[0];for(let i=1;i<values.length;i++)e=values[i]*k+e*(1-k);return e};
  const aggregate=(rows,mins)=>{const map=new Map(),ms=mins*60_000;for(const b of rows){const key=Math.floor(b.t/ms)*ms,old=map.get(key);if(!old)map.set(key,{t:key,open:b.open,high:b.high,low:b.low,close:b.close});else{old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.close=b.close}}return[...map.values()].sort((a,b)=>a.t-b.t)};
  const closes=bars.map(x=>x.close),ema9=ema(closes.slice(-Math.min(30,closes.length)),9),ema20=ema(closes.slice(-Math.min(45,closes.length)),20),m5=aggregate(bars,5),m15=aggregate(bars,15),m15c=m15.map(x=>x.close),m15fast=m15c.length>=2?ema(m15c,Math.min(3,m15c.length)):price,m15slow=m15c.length>=3?ema(m15c,Math.min(6,m15c.length)):price;
  const ranges=bars.slice(-14).map(x=>x.high-x.low).filter(x=>x>0),atr1=ranges.length?ranges.reduce((a,b)=>a+b,0)/ranges.length:price*.00025;
  const trendUp=price>ema9&&ema9>ema20&&m15fast>=m15slow,trendDown=price<ema9&&ema9<ema20&&m15fast<=m15slow;
  if(!trendUp&&!trendDown)return{...base,status:'WAIT',confidence:45,atr1:autoRound(atr1,3),reason:'الاتجاه غير متوافق؛ انتظار وضوح اتجاه الذهب'};
  const direction=trendUp?1:-1,side=trendUp?'BUY':'SELL',last=bars.at(-1),prev=bars.at(-2),recent5=m5.at(-1)||last,prev5=m5.at(-2)||prev;
  const pullbackDistance=Math.abs(price-ema9),nearTrend=pullbackDistance<=Math.max(1.25,atr1*2.2),bullConfirm=last.close>last.open&&last.close>=prev.high,bearConfirm=last.close<last.open&&last.close<=prev.low,breakout=direction>0?price>Math.max(...bars.slice(-4,-1).map(x=>x.high)):price<Math.min(...bars.slice(-4,-1).map(x=>x.low)),m5Aligned=direction>0?recent5.close>=prev5.close:recent5.close<=prev5.close,confirm=direction>0?bullConfirm:bearConfirm;
  if(!((nearTrend&&confirm)||breakout))return{...base,status:'WAIT',candidateAction:'WAIT',confidence:60,atr1:autoRound(atr1,3),reason:nearTrend?'الاتجاه واضح؛ انتظار شمعة تأكيد أو كسر قصير على M1/M5':'السعر ممتد بعيدًا عن المتوسط؛ انتظار Pullback بدل مطاردة الحركة'};
  const volatilityTooLow=atr1<0.18,volatilityTooHigh=atr1>4.5;
  if(volatilityTooLow||volatilityTooHigh)return{...base,status:'WAIT',confidence:62,atr1:autoRound(atr1,3),reason:volatilityTooLow?'تذبذب الذهب ضعيف جدًا حاليًا':'تذبذب الذهب عنيف جدًا؛ انتظار هدوء قبل الدخول'};
  const recentSwing=direction>0?Math.min(...bars.slice(-6).map(x=>x.low)):Math.max(...bars.slice(-6).map(x=>x.high)),buffer=Math.max(.30,atr1*.35),structStop=direction>0?recentSwing-buffer:recentSwing+buffer,maxStop=Math.max(2.2,Math.min(6.5,atr1*3.2)),fallbackStop=price-direction*maxStop,stop=direction>0?Math.max(structStop,fallbackStop):Math.min(structStop,fallbackStop),risk=Math.abs(price-stop);
  if(risk<0.8||risk>6.5)return{...base,status:'WAIT',confidence:65,atr1:autoRound(atr1,3),reason:risk<0.8?'الوقف قريب جدًا؛ لا توجد مساحة كافية للصفقة':'الوقف المطلوب أكبر من 6.5$؛ انتظار دخول أفضل'};
  let confidence=70+(m5Aligned?6:0)+(nearTrend?5:0)+(breakout?5:0)+(confirm?4:0);confidence=Math.min(90,confidence);
  const entryHalf=Math.min(1.2,Math.max(.30,atr1*.28)),reward1=Math.max(3.0,risk*1.25),target1=price+direction*reward1,target2=price+direction*Math.max(risk*1.7,reward1*1.35),target3=price+direction*Math.max(risk*2.2,reward1*1.75),target4=price+direction*Math.max(risk*2.8,reward1*2.2);
  return{...base,status:'CANDIDATE',confidence,candidateAction:side,entry:autoRound(price),entryLow:autoRound(price-entryHalf),entryHigh:autoRound(price+entryHalf),stopLoss:autoRound(stop),target1:autoRound(target1),target2:autoRound(target2),target3:autoRound(target3),target4:autoRound(target4),riskReward:autoRound(reward1/risk,2),atr1:autoRound(atr1,3),confirmations:{trend:true,pullback:nearTrend,m1Confirm:confirm,m5Aligned,breakout},reason:'Trend + Pullback/Breakout: اتجاه M15/M1 متوافق مع تأكيد M5/M1 • بدون شرط ICT Sweep/MSS'}}`;

  source = replaceRegexRequired(
    source,
    /function autoTradeModel\(price,now,quoteUpdatedAt\)\{[\s\S]*?\}\nfunction autoTradeTargetReached/,
    goldModel + '\nfunction autoTradeTargetReached',
    'XAU autoTradeModel'
  );

  source = source.replaceAll('ICT: سحب سيولة ثم Reclaim وMSS • التنفيذ حسب إعدادات EA', 'Trend + Pullback/Breakout • فلتر اتجاه وتذبذب • التنفيذ حسب إعدادات EA');
  source = source.replaceAll('لا دخول من الميل وحده. الإشارة لا تصدر إلا بعد Sweep + Reclaim + MSS، والوقف خلف قمة/قاع السحب مع هامش تذبذب.', 'الذهب: اتجاه متوافق ثم Pullback أو Breakout مع تأكيد قصير. لا مطاردة للسعر، والوقف يتكيف مع ATR والبنية القريبة.');
  source = source.replaceAll('R:R أدنى 1:2', 'وقف متكيف مع ATR');
  source = source.replaceAll('لا يقل عن 5$ عند صدور الإشارة', 'هدف أول ديناميكي');

  if (!source.includes('XAU_TREND_PULLBACK_V2') || !source.includes('بدون شرط ICT Sweep/MSS')) {
    throw new Error('Gold trend/pullback patch verification failed');
  }
  return source;
}

fs.writeFileSync = function patchedWriteFileSync(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return originalWriteFileSync(path, data, ...args);
  }
  const isBuffer = Buffer.isBuffer(data);
  const source = applyFastWarmup(isBuffer ? data.toString('utf8') : String(data));
  return originalWriteFileSync(path, isBuffer ? Buffer.from(source, 'utf8') : source, ...args);
};

syncBuiltinESMExports();
await import('./multi-asset-start.js');
