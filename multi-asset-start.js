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
  const raw=await fetchBtcICT(false),now=Date.now(),price=Number(raw.price),updatedAt=new Date(raw.updatedAt).getTime(),candidate=raw.state==='UP'?'BUY':raw.state==='DOWN'?'SELL':'WAIT';
  const base={asset:'BTCUSD',action:'WAIT',candidateAction:candidate,status:candidate==='WAIT'?'WAIT':'CANDIDATE',strategy:String(raw.signalMode||'BTC_ICT_MOMENTUM'),confidence:Number(raw.confidence||0),price:autoRound(price),entry:autoRound(raw.entry),entryLow:autoRound(raw.entryRangeLow),entryHigh:autoRound(raw.entryRangeHigh),stopLoss:autoRound(raw.invalidation),target1:autoRound(raw.target1),target2:autoRound(raw.target2),target3:autoRound(raw.target3),target4:autoRound(raw.target4),riskReward:Number.isFinite(Number(raw.entry))&&Number.isFinite(Number(raw.invalidation))&&Number.isFinite(Number(raw.target1))&&Math.abs(Number(raw.entry)-Number(raw.invalidation))>0?autoRound(Math.abs(Number(raw.target1)-Number(raw.entry))/Math.abs(Number(raw.entry)-Number(raw.invalidation)),2):null,updatedAt:new Date(now).toISOString(),provider:String(raw.provider||'COINBASE'),reason:candidate==='WAIT'?'انتظار اكتمال اندفاع مؤكد أو انعكاس ICT للبيتكوين':String(raw.confirmations?.setup||'إشارة BTC مكتملة')};
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(updatedAt)||now-updatedAt>180_000)return{...base,action:'WAIT',candidateAction:'WAIT',status:'STALE',reason:'بيانات البيتكوين أقدم من ثلاث دقائق'};
  let active=btcAutoTradeState.signal;
  if(active){
    const stopped=active.side==='BUY'?price<=active.stopLoss:price>=active.stopLoss,completed=autoTradeTargetReached(active,price,active.target4),opposite=['BUY','SELL'].includes(candidate)&&candidate!==active.side&&base.confidence>=AUTO_TRADE_MIN_CONFIDENCE,expired=now-active.issuedAtMs>AUTO_TRADE_LOCK_MS;
    if(stopped||completed||opposite||expired){btcAutoTradeState.signal=null;btcAutoTradeState.cooldownUntil=now+90*60_000;active=null}
  }
  if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&base.confidence>=70){
    active={signalId:'BTC-'+now+'-'+candidate,asset:'BTCUSD',side:candidate,confidence:base.confidence,entry:base.entry,entryLow:base.entryLow,entryHigh:base.entryHigh,stopLoss:base.stopLoss,target1:base.target1,target2:base.target2,target3:base.target3,target4:base.target4,riskReward:base.riskReward,issuedAtMs:now,issuedAt:new Date(now).toISOString(),expiresAtMs:now+AUTO_TRADE_ENTRY_TTL_MS,expiresAt:new Date(now+AUTO_TRADE_ENTRY_TTL_MS).toISOString()};btcAutoTradeState.signal=active;
  }
  if(active){const entryOpen=now<=active.expiresAtMs,inRange=price>=Math.min(active.entryLow,active.entryHigh)&&price<=Math.max(active.entryLow,active.entryHigh);return{...active,action:execute&&entryOpen&&inRange?active.side:'WAIT',candidateAction:active.side,status:entryOpen?'ACTIVE':'MANAGING',price:autoRound(price),provider:base.provider,updatedAt:new Date(now).toISOString(),reason:entryOpen?(inRange?'إشارة BTC جاهزة للتنفيذ على MT5':'انتظار عودة BTC إلى نطاق الدخول'):'انتهت نافذة الدخول؛ إدارة الصفقة القائمة فقط'}}
  return{...base,executionMode:'MT5_USER_CONTROLLED',reason:now<btcAutoTradeState.cooldownUntil?'فترة تهدئة بعد انتهاء إشارة BTC':base.reason};
}
`;
  source = replaceRequired(source, serverAnchor, btcExecution + serverAnchor, 'server anchor');

  const oldRoute = "if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){try{return sendJSON(res,200,await getAutoTradeSignal(url.searchParams.get('observe')!=='1'))}catch(error){return sendJSON(res,503,{error:'Auto-trade signal unavailable'})}}";
  const newRoute = "if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){try{const execute=url.searchParams.get('observe')!=='1',asset=String(url.searchParams.get('asset')||'XAUUSD').toUpperCase(),result=asset.startsWith('BTC')?await getBtcAutoTradeSignal(execute):await getAutoTradeSignal(execute);return sendJSON(res,200,result)}catch(error){return sendJSON(res,503,{error:'Auto-trade signal unavailable'})}}";
  source = replaceRequired(source, oldRoute, newRoute, 'signal route');
  source = source.replaceAll('MT5_DEMO_ONLY', 'MT5_USER_CONTROLLED');
  source = source.replaceAll('إشارة جاهزة للتنفيذ على MT5 Demo', 'إشارة جاهزة للتنفيذ على MT5');
  source = source.replaceAll('JustMarkets MT5 — التنفيذ الآلي', 'XM MT5 — التنفيذ الآلي');
  source = source.replaceAll('ICT: سحب سيولة ثم Reclaim وMSS • التنفيذ محصور بحساب Demo', 'ICT: سحب سيولة ثم Reclaim وMSS • التنفيذ حسب إعدادات EA');
  source = source.replaceAll('MT5 DEMO', 'MT5 READY');

  for (const marker of ['function getBtcAutoTradeSignal', "asset.startsWith('BTC')", 'MT5_USER_CONTROLLED']) {
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
