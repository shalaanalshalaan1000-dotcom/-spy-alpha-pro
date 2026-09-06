import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source,before,after,label){
  if(!source.includes(before)) throw new Error('BTC aggressive target not found: '+label);
  return source.replace(before,()=>after);
}

function applyAggressiveBtc(source){
  source=replaceRequired(
    source,
    "const fastEligible=hardCandidate==='WAIT'&&fastDirection!=='WAIT'&&!againstHtf&&rawConfidence>=62&&(momentumConfirm||liquidityConfirm);",
    "const fastEligible=hardCandidate==='WAIT'&&fastDirection!=='WAIT'&&rawConfidence>=55&&(momentumConfirm||liquidityConfirm)&&(!againstHtf||Boolean(c.impulseConfirm&&rawConfidence>=62));",
    'fast eligibility'
  );

  source=replaceRequired(
    source,
    "const scalpDistance=Number.isFinite(price)&&price>0?Math.min(65,Math.max(20,price*0.00032)):null;",
    "const scalpDistance=Number.isFinite(price)&&price>0?Math.min(45,Math.max(14,price*0.00022)):null;",
    'scalp target distance'
  );
  source=replaceRequired(
    source,
    "const scalpStopDistance=Number.isFinite(scalpDistance)?Math.max(17,scalpDistance*0.78):null;",
    "const scalpStopDistance=Number.isFinite(scalpDistance)?Math.max(13,scalpDistance*0.72):null;",
    'scalp stop distance'
  );
  source=replaceRequired(
    source,
    "const rawEntry=Number(raw.entry),repriceThreshold=Number.isFinite(scalpDistance)?Math.max(24,scalpDistance*0.85):30;",
    "const rawEntry=Number(raw.entry),repriceThreshold=Number.isFinite(scalpDistance)?Math.max(18,scalpDistance*0.72):22;",
    'reprice threshold'
  );
  source=replaceRequired(
    source,
    "entryHalf=Number.isFinite(scalpDistance)?Math.min(15,Math.max(7,scalpDistance*0.34)):null;",
    "entryHalf=Number.isFinite(scalpDistance)?Math.min(12,Math.max(6,scalpDistance*0.34)):null;",
    'entry window'
  );

  source=replaceRequired(
    source,
    "let confidence=rawConfidence;if(fastEligible){confidence=Math.max(confidence,64)+(c.impulseConfirm?5:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?3:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}",
    "let confidence=rawConfidence;if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}",
    'confidence boost'
  );
  source=source.replaceAll("BTC_MOMENTUM_LIQUIDITY_SCALP","BTC_FAST_AGGRESSIVE_SCALP");
  source=source.replaceAll("انتظار زخم/بنية أو سحب سيولة واضح على BTC","انتظار زخم قصير أو بنية واضحة على BTC");
  source=source.replaceAll("BTC سريع: Momentum/Structure + ICT Liquidity؛ إعادة تسعير الدخول مع الحركة وعدم انتظار الإشارة القديمة","BTC هجومي سريع: زخم قصير + تأكيد واحد؛ إعادة تسعير الدخول مع الحركة");

  source=replaceRequired(
    source,
    "opposite=['BUY','SELL'].includes(candidate)&&candidate!==active.side&&base.confidence>=66,expired=now-active.issuedAtMs>7*60_000;",
    "opposite=['BUY','SELL'].includes(candidate)&&candidate!==active.side&&base.confidence>=62,expired=now-active.issuedAtMs>5*60_000;",
    'active exit sensitivity'
  );
  source=source.replaceAll("btcAutoTradeState.cooldownUntil=now+45_000","btcAutoTradeState.cooldownUntil=now+30_000");

  source=replaceRequired(
    source,
    "if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&base.confidence>=64){",
    "if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&base.confidence>=58&&btcAutoTradeState.history.filter(x=>now-Number(x.issuedAtMs||0)<24*60*60_000).length<12){",
    'entry threshold and daily cap'
  );
  source=source.replaceAll("Math.min(AUTO_TRADE_ENTRY_TTL_MS,90_000)","Math.min(AUTO_TRADE_ENTRY_TTL_MS,60_000)");
  source=source.replaceAll("expiresAtMs:now+90_000,expiresAt:new Date(now+90_000).toISOString()","expiresAtMs:now+60_000,expiresAt:new Date(now+60_000).toISOString()");
  source=source.replaceAll("base.confidence>=64&&Math.abs(price-active.entry)>repriceThreshold","base.confidence>=58&&Math.abs(price-active.entry)>repriceThreshold");
  source=source.replaceAll("تهدئة 45 ثانية بعد صفقة BTC قبل البحث عن فرصة جديدة","تهدئة 30 ثانية بعد صفقة BTC قبل البحث عن فرصة جديدة");

  source=source.replaceAll("BTCUSD — التداول الآلي السريع","BTCUSD — السكالب الهجومي السريع");
  source=source.replaceAll("محرك سكالب مستقل للبيتكوين • لا يتأثر بإغلاق الذهب أو تجميع شموعه","محرك BTC هجومي مضبوط • زخم قصير + تأكيد واحد • حد أقصى 12 صفقة/24س");
  source=source.replaceAll("BTC MT5 READY","BTC FAST READY");

  for(const marker of ['BTC_FAST_AGGRESSIVE_SCALP','rawConfidence>=55','base.confidence>=58','12 صفقة/24س']){
    if(!source.includes(marker)) throw new Error('BTC aggressive verification failed: '+marker);
  }
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),source=applyAggressiveBtc(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args);
};

syncBuiltinESMExports();
await import('./platform-hardening-start.js');
