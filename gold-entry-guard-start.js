import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchEntryGuard(source){
  // Auto engine: a setup is not considered entered until price actually touches the entry range.
  source=source.replace(
    "const goldAutoState={samples:[],signal:null,cooldownUntil:0,lastStopped:null};",
    "const goldAutoState={samples:[],signal:null,cooldownUntil:0,lastStopped:null};"
  );

  // Persist entry confirmation on the active signal.
  source=source.replace(
    "expiresAt:new Date(sample.now+GOLD_AUTO_ENTRY_TTL_MS).toISOString()};goldAutoState.signal=active",
    "expiresAt:new Date(sample.now+GOLD_AUTO_ENTRY_TTL_MS).toISOString(),entered:false,enteredAtMs:null};goldAutoState.signal=active"
  );

  // Before entry: if target 1 is reached first, the setup is stale/missed and must be discarded.
  source=source.replace(
    "if(active){const entryOpen=sample.now<=active.expiresAtMs,inRange=sample.price>=active.entryLow&&sample.price<=active.entryHigh;return{...active,action:execute&&entryOpen&&inRange?active.side:'WAIT',candidateAction:active.side,status:entryOpen?'ACTIVE':'MANAGING',price:goldAutoRound(sample.price),sampleCount:goldAutoState.samples.length,provider:quote.provider,updatedAt:new Date(sample.now).toISOString(),reason:entryOpen?(inRange?'Ready for MT5 execution':'Waiting for price to return to entry range'):'Managing existing XAU position'}}",
    "if(active){const entryOpen=sample.now<=active.expiresAtMs,inRange=sample.price>=active.entryLow&&sample.price<=active.entryHigh,missedBeforeEntry=!active.entered&&goldAutoTargetHit(active,sample.price,active.target1);if(missedBeforeEntry){goldAutoState.signal=null;goldAutoState.cooldownUntil=sample.now+30_000;return{...model,action:'WAIT',candidateAction:'WAIT',status:'WAIT',price:goldAutoRound(sample.price),provider:quote.provider,updatedAt:new Date(sample.now).toISOString(),reason:'MISSED ENTRY: target reached before entry range; setup cancelled'}}if(!active.entered&&entryOpen&&inRange){active.entered=true;active.enteredAtMs=sample.now;goldAutoState.signal=active}const executable=active.entered&&entryOpen&&inRange;return{...active,action:execute&&executable?active.side:'WAIT',candidateAction:active.side,status:active.entered?'MANAGING':'ACTIVE',price:goldAutoRound(sample.price),sampleCount:goldAutoState.samples.length,provider:quote.provider,updatedAt:new Date(sample.now).toISOString(),reason:active.entered?'Entry confirmed — managing XAU position':entryOpen?'Waiting for price to touch entry range':'Entry window expired'}}"
  );

  // Main gold forecast card: display a range around the locked entry instead of a single number.
  source=source.replace(
    "$('#goldEntry').textContent=money(plan.entry);",
    "$('#goldEntry').textContent=(plan.entryLow!=null&&plan.entryHigh!=null)?(money(plan.entryLow)+' — '+money(plan.entryHigh)):money(plan.entry);"
  );

  // If the legacy lock only has one entry price, synthesize the same narrow range used by the execution engine.
  source=source.replace(
    "return{...plan,entry:p,locked:true",
    "return{...plan,entry:p,entryLow:Number((p-0.50).toFixed(2)),entryHigh:Number((p+0.50).toFixed(2)),locked:true"
  );

  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data);
  const patched=patchEntryGuard(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-auto-ui-safe-start.js');
