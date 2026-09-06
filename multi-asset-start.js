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
  const rawEntry=Number(raw.entry),direction=candidate==='BUY'?1:candidate==='SELL'?-1:0,scalpDistance=Number.isFinite(rawEntry)&&rawEntry>0?Math.min(65,Math.max(25,rawEntry*0.0004)):null,scalpStopDistance=Number.isFinite(scalpDistance)?Math.max(20,scalpDistance*0.8):null,scalpEntry=Number.isFinite(rawEntry)?rawEntry:price,scalpTarget1=direction&&Number.isFinite(scalpDistance)?scalpEntry+direction*scalpDistance:Number(raw.target1),scalpTarget2=direction&&Number.isFinite(scalpDistance)?scalpEntry+direction*scalpDistance*1.6:Number(raw.target2),scalpTarget3=direction&&Number.isFinite(scalpDistance)?scalpEntry+direction*scalpDistance*2.2:Number(raw.target3),scalpTarget4=direction&&Number.isFinite(scalpDistance)?scalpEntry+direction*scalpDistance*3:Number(raw.target4),rawStop=Number(raw.invalidation),scalpStop=direction&&Number.isFinite(scalpStopDistance)?scalpEntry-direction*scalpStopDistance:rawStop,entryHalf=Number.isFinite(scalpDistance)?Math.min(18,Math.max(8,scalpDistance*0.35)):null;
  const base={asset:'BTCUSD',action:'WAIT',candidateAction:candidate,status:candidate==='WAIT'?'WAIT':'CANDIDATE',strategy:String(raw.signalMode||'BTC_ICT_MOMENTUM')+'_SCALP',confidence:Number(raw.confidence||0),price:autoRound(price),entry:autoRound(scalpEntry),entryLow:autoRound(Number.isFinite(entryHalf)?scalpEntry-entryHalf:raw.entryRangeLow),entryHigh:autoRound(Number.isFinite(entryHalf)?scalpEntry+entryHalf:raw.entryRangeHigh),stopLoss:autoRound(scalpStop),target1:autoRound(scalpTarget1),target2:autoRound(scalpTarget2),target3:autoRound(scalpTarget3),target4:autoRound(scalpTarget4),riskReward:Number.isFinite(scalpTarget1)&&Number.isFinite(scalpStop)&&Math.abs(scalpEntry-scalpStop)>0?autoRound(Math.abs(scalpTarget1-scalpEntry)/Math.abs(scalpEntry-scalpStop),2):null,updatedAt:new Date(now).toISOString(),provider:String(raw.provider||'COINBASE'),reason:candidate==='WAIT'?'انتظار اندفاع أو انعكاس واضح للبيتكوين':String(raw.confirmations?.setup||'BTC scalp جاهز؛ الهدف الأول قريب لخروج سريع')};
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(updatedAt)||now-updatedAt>300_000)return{...base,action:'WAIT',candidateAction:'WAIT',status:'STALE',reason:'بيانات البيتكوين أقدم من خمس دقائق'};
  let active=btcAutoTradeState.signal;
  if(active){
    const stopped=active.side==='BUY'?price<=active.stopLoss:price>=active.stopLoss,completed=autoTradeTargetReached(active,price,active.target1),opposite=['BUY','SELL'].includes(candidate)&&candidate!==active.side&&base.confidence>=AUTO_TRADE_MIN_CONFIDENCE,expired=now-active.issuedAtMs>10*60_000;
    if(stopped||completed||opposite||expired){btcAutoTradeState.signal=null;btcAutoTradeState.cooldownUntil=now+5*60_000;active=null}
  }
  if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&base.confidence>=70){
    active={signalId:'BTC-'+now+'-'+candidate,asset:'BTCUSD',side:candidate,confidence:base.confidence,entry:base.entry,entryLow:base.entryLow,entryHigh:base.entryHigh,stopLoss:base.stopLoss,target1:base.target1,target2:base.target2,target3:base.target3,target4:base.target4,riskReward:base.riskReward,issuedAtMs:now,issuedAt:new Date(now).toISOString(),expiresAtMs:now+AUTO_TRADE_ENTRY_TTL_MS,expiresAt:new Date(now+AUTO_TRADE_ENTRY_TTL_MS).toISOString()};btcAutoTradeState.signal=active;
  }
  if(active){const entryOpen=now<=active.expiresAtMs,inRange=price>=Math.min(active.entryLow,active.entryHigh)&&price<=Math.max(active.entryLow,active.entryHigh);return{...active,action:execute&&entryOpen&&inRange?active.side:'WAIT',candidateAction:active.side,status:entryOpen?'ACTIVE':'MANAGING',price:autoRound(price),provider:base.provider,updatedAt:new Date(now).toISOString(),reason:entryOpen?(inRange?'إشارة BTC سكالب جاهزة للتنفيذ على MT5؛ الهدف الأول مصمم لخروج سريع':'انتظار عودة BTC إلى نطاق الدخول'):'انتهت نافذة الدخول؛ إدارة الصفقة القائمة فقط'}}
  return{...base,executionMode:'MT5_USER_CONTROLLED',reason:now<btcAutoTradeState.cooldownUntil?'تهدئة 5 دقائق بعد صفقة BTC قبل البحث عن فرصة جديدة':base.reason};
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
