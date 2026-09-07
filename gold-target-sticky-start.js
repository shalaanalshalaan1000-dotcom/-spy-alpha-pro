import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchStickyGoldTargets(source){
  const oldFn="function renderGoldTargetProgress(plan){const targets=[plan.target1,plan.target2,plan.target3,plan.target4],etas=[plan.eta1,plan.eta2,null,null],price=Number(plan.currentPrice),hits=targets.map(t=>goldTargetReached(plan.state,price,t)),next=hits.findIndex(x=>!x);for(let i=0;i<4;i++){const node=$('#goldEta'+(i+1));if(!node)continue;if(!plan.locked||targets[i]==null||!Number.isFinite(Number(targets[i]))){node.textContent='—';node.className='';continue}if(hits[i]){node.textContent='✓ تحقق';node.className='targetHit';continue}if(i===next){node.textContent=(etas[i]?'المدة: '+etas[i]+' • ':'')+'الهدف الحالي';node.className='targetCurrent'}else{node.textContent=i===3?'الامتداد الأخير للإشارة':'امتداد بعد الهدف '+i;node.className=''}}}";
  const newFn="function renderGoldTargetProgress(plan){const targets=[plan.target1,plan.target2,plan.target3,plan.target4],etas=[plan.eta1,plan.eta2,null,null],price=Number(plan.currentPrice),lock=readGoldTradeLock(),since=Number(plan.lockCreatedAt||lock?.createdAt||0),rows=(typeof goldSamples!=='undefined'&&Array.isArray(goldSamples)?goldSamples:[]).filter(x=>Number(x.t)>=since).map(x=>Number(x.price)).filter(Number.isFinite);rows.push(price);const stored=Array.isArray(lock?.tpHits)?lock.tpHits:[false,false,false,false],entryTouched=Boolean(plan.entryTouched||lock?.entryTouched),hits=targets.map((t,i)=>entryTouched&&(Boolean(stored[i])||rows.some(v=>goldTargetReached(plan.state,v,t))));if(lock&&plan.locked&&entryTouched&&hits.some((v,i)=>v!==Boolean(stored[i]))){lock.tpHits=hits;writeGoldTradeLock(lock)}const next=hits.findIndex(x=>!x);for(let i=0;i<4;i++){const node=$('#goldEta'+(i+1));if(!node)continue;if(!plan.locked||targets[i]==null||!Number.isFinite(Number(targets[i]))){node.textContent='—';node.className='';continue}if(!entryTouched){node.textContent='بانتظار دخول النطاق';node.className='';continue}if(hits[i]){node.textContent='✓ تحقق';node.className='targetHit';continue}if(i===next){node.textContent=(etas[i]?'المدة: '+etas[i]+' • ':'')+'الهدف الحالي';node.className='targetCurrent'}else{node.textContent=i===3?'الامتداد الأخير للإشارة':'امتداد بعد الهدف '+i;node.className=''}}}";
  if(source.includes(oldFn))source=source.replace(oldFn,newFn);
  source=source.replaceAll('GOLD_LIVE_MASSIVE_CACHE_MS=4500','GOLD_LIVE_MASSIVE_CACHE_MS=900');
  source=source.replaceAll('setInterval(loadGold,5000)','setInterval(loadGold,1000)');
  source=source.replaceAll('setInterval(loadGold,20000)','setInterval(loadGold,1000)');
  source=source.replaceAll('setInterval(loadGold,30000)','setInterval(loadGold,1000)');
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),patched=patchStickyGoldTargets(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-entry-range-start.js');
