import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Multi-asset patch target was not found: ' + label);
  return source.replace(before, () => after);
}

function applyMultiAssetExecution(source) {
  const serverAnchor = 'const server=http.createServer(async(req,res)=>{';
  const btcExecution = `const btcAutoTradeState={signal:null,cooldownUntil:0};
async function getBtcAutoTradeSignal(execute=false){
  const raw=await fetchBtcICT(false),now=Date.now(),price=Number(raw.price),updatedAt=new Date(raw.updatedAt).getTime(),c=raw.confirmations||{};
  const hardCandidate=raw.state==='UP'?'BUY':raw.state==='DOWN'?'SELL':'WAIT';
  const fastDirection=['UP','DOWN'].includes(c.impulseDirection)?c.impulseDirection:['UP','DOWN'].includes(c.scoreDirection)?c.scoreDirection:'WAIT';
  const momentumConfirm=Boolean(c.rsiMomentum||c.structureMomentum||c.impulseConfirm);
  const liquidityConfirm=Boolean(c.liquiditySweep||c.sweep||c.reclaim||c.mss||c.structureMomentum||c.hourTrendConfirm);
  const againstHtf=Boolean(c.againstHtf);
  const rawConfidence=Number(raw.confidence||0);
  const fastEligible=hardCandidate==='WAIT'&&fastDirection!=='WAIT'&&!againstHtf&&rawConfidence>=62&&(momentumConfirm||liquidityConfirm);
  const candidate=hardCandidate!=='WAIT'?hardCandidate:fastEligible?(fastDirection==='UP'?'BUY':'SELL'):'WAIT';
  const direction=candidate==='BUY'?1:candidate==='SELL'?-1:0;
  const scalpDistance=Number.isFinite(price)&&price>0?Math.min(65,Math.max(20,price*0.00032)):null;
  const scalpStopDistance=Number.isFinite(scalpDistance)?Math.max(17,scalpDistance*0.78):null;
  const rawEntry=Number(raw.entry),repriceThreshold=Number.isFinite(scalpDistance)?Math.max(24,scalpDistance*0.85):30;
  const scalpEntry=Number.isFinite(rawEntry)&&rawEntry>0&&Number.isFinite(price)&&Math.abs(rawEntry-price)<=repriceThreshold?rawEntry:price;
  const scalpTarget1=direction&&Number.isFinite(scalpDistance)?scalpEntry+direction*scalpDistance:Number(raw.target1),scalpTarget2=direction&&Number.isFinite(scalpDistance)?scalpEntry+direction*scalpDistance*1.55:Number(raw.target2),scalpTarget3=direction&&Number.isFinite(scalpDistance)?scalpEntry+direction*scalpDistance*2.15:Number(raw.target3),scalpTarget4=direction&&Number.isFinite(scalpDistance)?scalpEntry+direction*scalpDistance*2.9:Number(raw.target4),rawStop=Number(raw.invalidation),scalpStop=direction&&Number.isFinite(scalpStopDistance)?scalpEntry-direction*scalpStopDistance:rawStop,entryHalf=Number.isFinite(scalpDistance)?Math.min(15,Math.max(7,scalpDistance*0.34)):null;
  let confidence=rawConfidence;if(fastEligible){confidence=Math.max(confidence,64)+(c.impulseConfirm?5:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?3:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}
  const mode=fastEligible?'BTC_MOMENTUM_LIQUIDITY_SCALP':String(raw.signalMode||'BTC_ICT_MOMENTUM')+'_SCALP';
  const base={asset:'BTCUSD',action:'WAIT',candidateAction:candidate,status:candidate==='WAIT'?'WAIT':'CANDIDATE',strategy:mode,confidence:autoRound(confidence,0),price:autoRound(price),entry:autoRound(scalpEntry),entryLow:autoRound(Number.isFinite(entryHalf)?scalpEntry-entryHalf:raw.entryRangeLow),entryHigh:autoRound(Number.isFinite(entryHalf)?scalpEntry+entryHalf:raw.entryRangeHigh),stopLoss:autoRound(scalpStop),target1:autoRound(scalpTarget1),target2:autoRound(scalpTarget2),target3:autoRound(scalpTarget3),target4:autoRound(scalpTarget4),riskReward:Number.isFinite(scalpTarget1)&&Number.isFinite(scalpStop)&&Math.abs(scalpEntry-scalpStop)>0?autoRound(Math.abs(scalpTarget1-scalpEntry)/Math.abs(scalpEntry-scalpStop),2):null,updatedAt:new Date(now).toISOString(),provider:String(raw.provider||'COINBASE'),reason:candidate==='WAIT'?'انتظار زخم/بنية أو سحب سيولة واضح على BTC':fastEligible?'BTC سريع: Momentum/Structure + ICT Liquidity؛ إعادة تسعير الدخول مع الحركة وعدم انتظار الإشارة القديمة':String(raw.setup||'BTC scalp جاهز؛ الهدف الأول قريب لخروج سريع')};
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(updatedAt)||now-updatedAt>60_000)return{...base,action:'WAIT',candidateAction:'WAIT',status:'STALE',reason:'بيانات البيتكوين أقدم من 60 ثانية'};
  let active=btcAutoTradeState.signal;
  if(active){
    const stopped=active.side==='BUY'?price<=active.stopLoss:price>=active.stopLoss,completed=autoTradeTargetReached(active,price,active.target1),opposite=['BUY','SELL'].includes(candidate)&&candidate!==active.side&&base.confidence>=66,expired=now-active.issuedAtMs>7*60_000;
    if(stopped||completed||opposite||expired){btcAutoTradeState.signal=null;btcAutoTradeState.cooldownUntil=now+45_000;active=null}
  }
  if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&base.confidence>=64){
    active={signalId:'BTC-'+now+'-'+candidate,asset:'BTCUSD',side:candidate,confidence:base.confidence,entry:base.entry,entryLow:base.entryLow,entryHigh:base.entryHigh,stopLoss:base.stopLoss,target1:base.target1,target2:base.target2,target3:base.target3,target4:base.target4,riskReward:base.riskReward,strategy:base.strategy,issuedAtMs:now,issuedAt:new Date(now).toISOString(),expiresAtMs:now+Math.min(AUTO_TRADE_ENTRY_TTL_MS,90_000),expiresAt:new Date(now+Math.min(AUTO_TRADE_ENTRY_TTL_MS,90_000)).toISOString()};btcAutoTradeState.signal=active;
  }
  if(active){
    const entryOpen=now<=active.expiresAtMs,inRange=price>=Math.min(active.entryLow,active.entryHigh)&&price<=Math.max(active.entryLow,active.entryHigh);
    if(!inRange&&entryOpen&&['BUY','SELL'].includes(candidate)&&candidate===active.side&&base.confidence>=64&&Math.abs(price-active.entry)>repriceThreshold){
      active={...active,confidence:base.confidence,entry:base.entry,entryLow:base.entryLow,entryHigh:base.entryHigh,stopLoss:base.stopLoss,target1:base.target1,target2:base.target2,target3:base.target3,target4:base.target4,riskReward:base.riskReward,strategy:base.strategy,issuedAtMs:now,issuedAt:new Date(now).toISOString(),expiresAtMs:now+90_000,expiresAt:new Date(now+90_000).toISOString()};btcAutoTradeState.signal=active;
      return{...active,action:execute?active.side:'WAIT',candidateAction:active.side,status:'ACTIVE',price:autoRound(price),provider:base.provider,updatedAt:new Date(now).toISOString(),reason:'تم تحديث نطاق دخول BTC تلقائيًا مع استمرار الزخم بدل انتظار النطاق القديم'};
    }
    return{...active,action:execute&&entryOpen&&inRange?active.side:'WAIT',candidateAction:active.side,status:entryOpen?'ACTIVE':'MANAGING',price:autoRound(price),provider:base.provider,updatedAt:new Date(now).toISOString(),reason:entryOpen?(inRange?'إشارة BTC سريعة جاهزة للتنفيذ على MT5':'انتظار Pullback قصير أو إعادة تسعير عند استمرار الزخم'):'انتهت نافذة الدخول؛ إدارة الصفقة القائمة فقط'}
  }
  return{...base,executionMode:'MT5_USER_CONTROLLED',reason:now<btcAutoTradeState.cooldownUntil?'تهدئة 45 ثانية بعد صفقة BTC قبل البحث عن فرصة جديدة':base.reason};
}
`;
  source = replaceRequired(source, serverAnchor, btcExecution + serverAnchor, 'server anchor');

  const oldRoute = "if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){try{return sendJSON(res,200,await getAutoTradeSignal(url.searchParams.get('observe')!=='1'))}catch(error){return sendJSON(res,503,{error:'Auto-trade signal unavailable'})}}";
  const newRoute = "if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){try{const execute=url.searchParams.get('observe')!=='1',asset=String(url.searchParams.get('asset')||'XAUUSD').toUpperCase(),result=asset.startsWith('BTC')?await getBtcAutoTradeSignal(execute):await getAutoTradeSignal(execute);return sendJSON(res,200,result)}catch(error){return sendJSON(res,503,{error:'Auto-trade signal unavailable'})}}";
  source = replaceRequired(source, oldRoute, newRoute, 'signal route');
  source = source.replaceAll('MT5_DEMO_ONLY', 'MT5_USER_CONTROLLED');
  source = source.replaceAll('إشارة جاهزة للتنفيذ على MT5 Demo', 'إشارة جاهزة للتنفيذ على MT5');
  source = source.replaceAll('JustMarkets MT5 — التنفيذ الآلي', 'XM MT5 — التنفيذ الآلي');
  source = source.replaceAll('ICT: سحب سيولة ثم Reclaim وMSS • التنفيذ محصور بحساب Demo', 'Trend + Pullback/Breakout • التنفيذ حسب إعدادات EA');
  source = source.replaceAll('MT5 DEMO', 'MT5 READY');

  for (const marker of ['function getBtcAutoTradeSignal', "asset.startsWith('BTC')", 'BTC_MOMENTUM_LIQUIDITY_SCALP', 'بيانات البيتكوين أقدم من 60 ثانية', 'إعادة تسعير الدخول']) {
    if (!source.includes(marker)) throw new Error('Multi-asset patch failed: ' + marker);
  }
  return source;
}

fs.writeFileSync = function patchedWriteFileSync(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return originalWriteFileSync(path, data, ...args);
  }
  const isBuffer = Buffer.isBuffer(data);
  const source = applyMultiAssetExecution(isBuffer ? data.toString('utf8') : String(data));
  return originalWriteFileSync(path, isBuffer ? Buffer.from(source, 'utf8') : source, ...args);
};

syncBuiltinESMExports();
await import('./justmarkets-start.js');
