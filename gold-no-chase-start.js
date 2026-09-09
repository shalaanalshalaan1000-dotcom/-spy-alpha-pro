import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchNoChase(source){
  const oldModel="const direction=setup.direction,side=setup.side,closes=bars.slice(-6).map(x=>x.close),aligned=direction>0?closes.at(-1)>closes[0]:closes.at(-1)<closes[0],displacement=Math.abs(price-setup.sweep.close)>=atr*.7,confidence=Math.min(92,75+(aligned?7:0)+(displacement?5:0)),buffer=Math.max(.35,atr*.35),stop=direction>0?setup.sweep.low-buffer:setup.sweep.high+buffer,risk=Math.abs(price-stop);if(risk<.8||risk>GOLD_AUTO_MAX_STOP_USD)return{...base,status:'WAIT',confidence,reason:risk<.8?'Structural stop too close':'NO TRADE: structural stop wider than 3 USD'};const r1=Math.max(5,risk*2),half=Math.min(1,Math.max(.25,atr*.2));return{...base,status:'CANDIDATE',confidence,candidateAction:side,entry:goldAutoRound(price),entryLow:goldAutoRound(price-half),entryHigh:goldAutoRound(price+half),stopLoss:goldAutoRound(stop),target1:goldAutoRound(price+direction*r1),target2:goldAutoRound(price+direction*Math.max(risk*2.7,r1*1.35)),target3:goldAutoRound(price+direction*Math.max(risk*3.3,r1*1.65)),target4:goldAutoRound(price+direction*Math.max(risk*4,r1*2)),riskReward:goldAutoRound(r1/risk,2),reason:'XAU confirmed: Sweep + Reclaim + MSS'}";
  const newModel="const direction=setup.direction,side=setup.side,closes=bars.slice(-6).map(x=>x.close),aligned=direction>0?closes.at(-1)>closes[0]:closes.at(-1)<closes[0],displacement=Math.abs(price-setup.sweep.close)>=atr*.7,confidence=Math.min(92,75+(aligned?7:0)+(displacement?5:0)),buffer=Math.max(.35,atr*.35),stop=direction>0?setup.sweep.low-buffer:setup.sweep.high+buffer,half=Math.min(1,Math.max(.25,atr*.2)),entryBase=setup.mssLevel,chaseDistance=Math.abs(price-entryBase),maxChase=Math.max(1.25,atr*.75),risk=Math.abs(entryBase-stop);if(chaseDistance>maxChase)return{...base,status:'WAIT',confidence,reason:'NO CHASE: price already moved too far beyond the MSS entry; waiting for a fresh setup'};if(risk<.8||risk>GOLD_AUTO_MAX_STOP_USD)return{...base,status:'WAIT',confidence,reason:risk<.8?'Structural stop too close':'NO TRADE: structural stop wider than 3 USD'};const r1=Math.max(5,risk*2);return{...base,status:'CANDIDATE',confidence,candidateAction:side,entry:goldAutoRound(entryBase),entryLow:goldAutoRound(entryBase-half),entryHigh:goldAutoRound(entryBase+half),stopLoss:goldAutoRound(stop),target1:goldAutoRound(entryBase+direction*r1),target2:goldAutoRound(entryBase+direction*Math.max(risk*2.7,r1*1.35)),target3:goldAutoRound(entryBase+direction*Math.max(risk*3.3,r1*1.65)),target4:goldAutoRound(entryBase+direction*Math.max(risk*4,r1*2)),riskReward:goldAutoRound(r1/risk,2),reason:'XAU confirmed: fresh MSS retest entry — no chase'}";
  if(!source.includes(oldModel)) throw new Error('No-chase model anchor missing');
  source=source.replace(oldModel,newModel);

  source=source.replace(
    "q('#goldAutoEntryState').textContent=status==='ACTIVE'?'النطاق جاهز للدخول':status==='MANAGING'?'تم تفعيل الدخول':status==='CANDIDATE'?'مرشح للدخول':status==='COLLECTING'?'يجمع شموع M1':'لا توجد إشارة فعالة';",
    "q('#goldAutoEntryState').textContent=status==='ACTIVE'&&!entered?'بانتظار لمس نطاق دخول جديد':status==='MANAGING'?'تم تفعيل الدخول':status==='CANDIDATE'?'مرشح جديد — غير منفذ':status==='COLLECTING'?'يجمع شموع M1':'لا توجد إشارة فعالة';"
  );
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data);
  const patched=patchNoChase(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-entry-guard-start.js');
