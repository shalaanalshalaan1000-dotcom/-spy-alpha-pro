import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source,before,after,label){
  if(!source.includes(before)) throw new Error('BTC scenario lifecycle target not found: '+label);
  return source.replace(before,()=>after);
}

function applyBtcScenarioLifecycle(source){
  // Server state: once T4 is completed, block the same-side setup until the
  // analyzer first leaves that setup (WAIT or opposite direction).
  source=replaceRequired(
    source,
    "const btcAutoTradeState={signal:null,cooldownUntil:0,history:[]};",
    "const btcAutoTradeState={signal:null,cooldownUntil:0,history:[],blockedSide:null};",
    'BTC execution state'
  );

  source=replaceRequired(
    source,
    "const stopped=active.side==='BUY'?price<=active.stopLoss:price>=active.stopLoss,completed=autoTradeTargetReached(active,price,active.target1),opposite=['BUY','SELL'].includes(candidate)&&candidate!==active.side&&base.confidence>=66,expired=now-active.issuedAtMs>7*60_000;\n    if(stopped||completed||opposite||expired){btcAutoTradeState.signal=null;btcAutoTradeState.cooldownUntil=now+45_000;active=null}",
    "const stopped=active.side==='BUY'?price<=active.stopLoss:price>=active.stopLoss,completed=autoTradeTargetReached(active,price,active.target4),opposite=['BUY','SELL'].includes(candidate)&&candidate!==active.side&&base.confidence>=66,expired=now-active.issuedAtMs>7*60_000;\n    if(stopped||completed||opposite||expired){if(completed)btcAutoTradeState.blockedSide=active.side;btcAutoTradeState.signal=null;btcAutoTradeState.cooldownUntil=now+45_000;active=null}",
    'complete only at T4'
  );

  source=replaceRequired(
    source,
    "if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&base.confidence>=64){",
    "if(btcAutoTradeState.blockedSide&&candidate!==btcAutoTradeState.blockedSide)btcAutoTradeState.blockedSide=null;\n  if(!active&&execute&&now>=btcAutoTradeState.cooldownUntil&&['BUY','SELL'].includes(candidate)&&candidate!==btcAutoTradeState.blockedSide&&base.confidence>=64){",
    'fresh setup gate'
  );

  source=replaceRequired(
    source,
    "return{...base,executionMode:'MT5_USER_CONTROLLED',reason:now<btcAutoTradeState.cooldownUntil?'تهدئة 45 ثانية بعد صفقة BTC قبل البحث عن فرصة جديدة':base.reason};",
    "if(btcAutoTradeState.blockedSide===candidate)return{...base,action:'WAIT',candidateAction:'WAIT',status:'WAIT',executionMode:'MT5_USER_CONTROLLED',reason:'اكتمل الهدف الرابع؛ تم إغلاق السيناريو ولن يعاد استخدامه. انتظار إعداد BTC جديد'};\n  return{...base,executionMode:'MT5_USER_CONTROLLED',reason:now<btcAutoTradeState.cooldownUntil?'تهدئة 45 ثانية بعد صفقة BTC قبل البحث عن فرصة جديدة':base.reason};",
    'blocked scenario response'
  );

  // Client-side locked analysis card: close it at T4 too, and do not relock
  // the same side until the raw analyzer leaves that setup once.
  const clientLifecycle=`const BTC_COMPLETED_SIDE_KEY='spy_alpha_btc_completed_side_v4';
const originalLockBtcSignal=lockBtcSignal;
lockBtcSignal=function(signal){
  try{
    const existing=readBtcLock(),state=existing?.state,hi=Math.max(Number(signal?.price)||-Infinity,Number(signal?.minuteHigh)||-Infinity),lo=Math.min(Number(signal?.price)||Infinity,Number(signal?.minuteLow)||Infinity),t4=Number(existing?.target4),t4Hit=existing&&Number.isFinite(t4)&&(state==='UP'?hi>=t4:state==='DOWN'?lo<=t4:false);
    if(t4Hit){localStorage.setItem(BTC_COMPLETED_SIDE_KEY,state);clearBtcLock();return{...signal,state:'WAIT',locked:false,entry:null,entryRangeLow:null,entryRangeHigh:null,target1:null,target2:null,target3:null,target4:null,invalidation:null,closedReason:'T4',confirmations:{...(signal.confirmations||{}),setup:'اكتمل الهدف الرابع — السيناريو مغلق، بانتظار إشارة جديدة'}}}
    const blocked=localStorage.getItem(BTC_COMPLETED_SIDE_KEY);
    if(blocked&&signal?.state!==blocked)localStorage.removeItem(BTC_COMPLETED_SIDE_KEY);
    else if(blocked&&signal?.state===blocked){clearBtcLock();return{...signal,state:'WAIT',locked:false,entry:null,entryRangeLow:null,entryRangeHigh:null,target1:null,target2:null,target3:null,target4:null,invalidation:null,closedReason:'T4',confirmations:{...(signal.confirmations||{}),setup:'تم إغلاق السيناريو السابق عند T4 — انتظار إعداد جديد'}}}
  }catch{}
  return originalLockBtcSignal(signal);
};
`;
  source=replaceRequired(source,'async function loadBtc(force=false){',clientLifecycle+'async function loadBtc(force=false){','client lifecycle');

  source=source.replace(
    "$('#btcTrigger').textContent=active?(insideRange?'ادخل الآن من '+btcMoney(d.entry):'انتظر عودة السعر إلى Trading Range'):'لا دخول حتى اندفاع مؤكد أو انعكاس ICT + ≥70%';",
    "$('#btcTrigger').textContent=d.closedReason==='T4'?'اكتمل الهدف الرابع — انتظار إشارة جديدة':active?(insideRange?'ادخل الآن من '+btcMoney(d.entry):'انتظر عودة السعر إلى Trading Range'):'لا دخول حتى اندفاع مؤكد أو انعكاس ICT + ≥70%';"
  );

  for(const marker of ['blockedSide:null','active.target4','BTC_COMPLETED_SIDE_KEY','اكتمل الهدف الرابع؛ تم إغلاق السيناريو']){
    if(!source.includes(marker)) throw new Error('BTC scenario lifecycle verification failed: '+marker);
  }
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),source=applyBtcScenarioLifecycle(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args);
};

syncBuiltinESMExports();
await import('./platform-hardening-start.js');
