import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source,before,after,label){
  if(!source.includes(before)) throw new Error('BTC micro momentum target not found: '+label);
  return source.replace(before,()=>after);
}

function applyBtcMicroMomentum(source){
  // Expose 1m, 3m and 5m rolling direction horizons from the live M1 feed.
  // M1 = latest close-to-close impulse, M3 = net move over 3 minutes with
  // 2-of-3 agreement, M5 = net move over 5 minutes with 3-of-5 agreement.
  source=replaceRequired(
    source,
    'impulseRatio:round(impulseRatio,2),sweepLow,sweepHigh,mssBull,mssBear,bullFvg,bearFvg,setup,reasons:reasons.slice(0,8)',
    "impulseRatio:round(impulseRatio,2),microMomentum:(()=>{const a=one.slice(-2).map(x=>Number(x.close)).filter(Number.isFinite);if(a.length<2)return'WAIT';const delta=a[1]-a[0],gate=Math.max(3,atr1*.04);return delta>=gate?'UP':delta<=-gate?'DOWN':'WAIT'})(),trend3m:(()=>{const a=one.slice(-4).map(x=>Number(x.close)).filter(Number.isFinite);if(a.length<4)return'WAIT';const delta=a.at(-1)-a[0],up=(a[1]>a[0]?1:0)+(a[2]>a[1]?1:0)+(a[3]>a[2]?1:0),down=(a[1]<a[0]?1:0)+(a[2]<a[1]?1:0)+(a[3]<a[2]?1:0),gate=Math.max(5,atr1*.07);return delta>=gate&&up>=2?'UP':delta<=-gate&&down>=2?'DOWN':'WAIT'})(),trend5m:(()=>{const a=one.slice(-6).map(x=>Number(x.close)).filter(Number.isFinite);if(a.length<6)return'WAIT';const delta=a.at(-1)-a[0];let up=0,down=0;for(let i=1;i<a.length;i++){if(a[i]>a[i-1])up++;else if(a[i]<a[i-1])down++;}const gate=Math.max(7,atr1*.10);return delta>=gate&&up>=3?'UP':delta<=-gate&&down>=3?'DOWN':'WAIT'})(),sweepLow,sweepHigh,mssBull,mssBear,bullFvg,bearFvg,setup,reasons:reasons.slice(0,8)",
    'M1 M3 M5 direction horizons'
  );

  // Build the execution side from the short horizons. Normal entry requires
  // agreement from at least two horizons. A strong M1 impulse may override
  // alone only when the existing impulse confirmation is also present.
  source=replaceRequired(
    source,
    "const candidate=hardCandidate!=='WAIT'?hardCandidate:fastEligible?(fastDirection==='UP'?'BUY':'SELL'):'WAIT';",
    "const candidate0=hardCandidate!=='WAIT'?hardCandidate:fastEligible?(fastDirection==='UP'?'BUY':'SELL'):'WAIT',micro=String(c.microMomentum||'WAIT'),trend3=String(c.trend3m||'WAIT'),trend5=String(c.trend5m||'WAIT'),microSide=micro==='UP'?'BUY':micro==='DOWN'?'SELL':'WAIT',trend3Side=trend3==='UP'?'BUY':trend3==='DOWN'?'SELL':'WAIT',trend5Side=trend5==='UP'?'BUY':trend5==='DOWN'?'SELL':'WAIT';const buyVotes=(microSide==='BUY'?1:0)+(trend3Side==='BUY'?1:0)+(trend5Side==='BUY'?1:0),sellVotes=(microSide==='SELL'?1:0)+(trend3Side==='SELL'?1:0)+(trend5Side==='SELL'?1:0),mtfSide=buyVotes>=2?'BUY':sellVotes>=2?'SELL':'WAIT',mtfConfirm=mtfSide==='BUY'?buyVotes:mtfSide==='SELL'?sellVotes:0,m1Override=microSide!=='WAIT'&&c.impulseConfirm&&rawConfidence>=52;const candidate=mtfConfirm>=2&&rawConfidence>=40?mtfSide:m1Override?microSide:candidate0;",
    '1m 3m 5m candidate vote'
  );

  // Match the server target/stop geometry to the wider ATR stop used by MT5.
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

  for(const marker of ['microMomentum:','trend3m:','trend5m:','mtfConfirm>=2','m1Override','sameSideLossBlock','Math.max(75,price*0.00095)']){
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
