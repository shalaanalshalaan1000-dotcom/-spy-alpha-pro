import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source,before,after,label){
  if(!source.includes(before)) throw new Error('BTC micro momentum target not found: '+label);
  return source.replace(before,()=>after);
}

function applyBtcMicroMomentum(source){
  // Expose a very short M1 direction based on the last four 1m closes.
  source=replaceRequired(
    source,
    'impulseRatio:round(impulseRatio,2),sweepLow,sweepHigh,mssBull,mssBear,bullFvg,bearFvg,setup,reasons:reasons.slice(0,8)',
    "impulseRatio:round(impulseRatio,2),microMomentum:(()=>{const a=one.slice(-4).map(x=>Number(x.close)).filter(Number.isFinite);if(a.length<4)return'WAIT';const delta=a.at(-1)-a[0],up=(a[1]>a[0]?1:0)+(a[2]>a[1]?1:0)+(a[3]>a[2]?1:0),down=(a[1]<a[0]?1:0)+(a[2]<a[1]?1:0)+(a[3]<a[2]?1:0),gate=Math.max(8,atr1*.12);return delta>=gate&&up>=2?'UP':delta<=-gate&&down>=2?'DOWN':'WAIT'})(),sweepLow,sweepHigh,mssBull,mssBear,bullFvg,bearFvg,setup,reasons:reasons.slice(0,8)",
    'M1 micro momentum'
  );

  // Let the last few M1 candles veto stale directional bias and, when the
  // short move is strong enough, flip the scalp side instead of repeating it.
  source=replaceRequired(
    source,
    "const candidate=hardCandidate!=='WAIT'?hardCandidate:fastEligible?(fastDirection==='UP'?'BUY':'SELL'):'WAIT';",
    "const candidate0=hardCandidate!=='WAIT'?hardCandidate:fastEligible?(fastDirection==='UP'?'BUY':'SELL'):'WAIT',micro=String(c.microMomentum||'WAIT'),microSide=micro==='UP'?'BUY':micro==='DOWN'?'SELL':'WAIT';const candidate=microSide!=='WAIT'&&rawConfidence>=60?microSide:candidate0;",
    'micro direction candidate'
  );

  // Match the server target/stop geometry to the wider ATR stop used by MT5.
  // Target 1 is at least about $75 while the server stop is at least $60,
  // preventing the old pattern where losing trades were structurally larger
  // than winning scalps after the EA widened the broker stop.
  source=source.replace(
    "const scalpDistance=Number.isFinite(price)&&price>0?Math.min(65,Math.max(20,price*0.00032)):null;",
    "const scalpDistance=Number.isFinite(price)&&price>0?Math.min(120,Math.max(75,price*0.00095)):null;"
  );
  source=source.replace(
    "const scalpDistance=Number.isFinite(price)&&price>0?Math.min(45,Math.max(14,price*0.00022)):null;",
    "const scalpDistance=Number.isFinite(price)&&price>0?Math.min(120,Math.max(75,price*0.00095)):null;"
  );
  source=source.replace(
    "const scalpStopDistance=Number.isFinite(scalpDistance)?Math.max(17,scalpDistance*0.78):null;",
    "const scalpStopDistance=Number.isFinite(scalpDistance)?Math.max(60,scalpDistance*0.72):null;"
  );
  source=source.replace(
    "const scalpStopDistance=Number.isFinite(scalpDistance)?Math.max(13,scalpDistance*0.72):null;",
    "const scalpStopDistance=Number.isFinite(scalpDistance)?Math.max(60,scalpDistance*0.72):null;"
  );

  // After two server-observed STOP results on the same side in 20 minutes,
  // suppress that same side briefly. Opposite-side scalps remain available.
  source=replaceRequired(
    source,
    "if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&candidate!==btcAutoTradeState.blockedSide&&base.confidence>=64){",
    "const sameSideStops=btcAutoTradeState.history.filter(x=>x.side===candidate&&x.result==='STOP'&&now-Number(x.issuedAtMs||0)<=20*60_000).slice(0,2),sameSideLossBlock=sameSideStops.length>=2;\n  if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&candidate!==btcAutoTradeState.blockedSide&&!sameSideLossBlock&&base.confidence>=64){",
    'two-loss same-side brake'
  );

  source=replaceRequired(
    source,
    "if(btcAutoTradeState.blockedSide===candidate)return{...base,action:'WAIT',candidateAction:'WAIT',status:'WAIT',executionMode:'MT5_USER_CONTROLLED',reason:'اكتمل الهدف الرابع؛ تم إغلاق السيناريو ولن يعاد استخدامه. انتظار إعداد BTC جديد'};",
    "if(btcAutoTradeState.blockedSide===candidate)return{...base,action:'WAIT',candidateAction:'WAIT',status:'WAIT',executionMode:'MT5_USER_CONTROLLED',reason:'اكتمل الهدف الرابع؛ تم إغلاق السيناريو ولن يعاد استخدامه. انتظار إعداد BTC جديد'};if(typeof sameSideLossBlock!=='undefined'&&sameSideLossBlock)return{...base,action:'WAIT',candidateAction:'WAIT',status:'WAIT',executionMode:'MT5_USER_CONTROLLED',reason:'تم إيقاف هذا الاتجاه مؤقتًا بعد خسارتين متتاليتين؛ الاتجاه المعاكس ما زال متاحًا'};",
    'loss brake response'
  );

  for(const marker of ['microMomentum:',"rawConfidence>=60?microSide:candidate0",'sameSideLossBlock','Math.max(75,price*0.00095)']){
    if(!source.includes(marker)) throw new Error('BTC micro momentum verification failed: '+marker);
  }
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),source=applyBtcMicroMomentum(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args);
};

syncBuiltinESMExports();
await import('./btc-scenario-lifecycle-start.js');
