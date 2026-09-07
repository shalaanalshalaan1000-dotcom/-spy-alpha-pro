import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return originalWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data);
  let source=isBuffer?data.toString('utf8'):String(data);

  // No time-based protection after TP completion. The old scenario is still
  // consumed and cannot be reused; a materially new structure can be accepted immediately.
  source=source.replace('setGoldCompleted(lock);clearGoldTradeLock();setGoldCooldown();return{...plan,entry:null,locked:false,consumed:true,cooling:true,tradeCompleted:true',
    'setGoldCompleted(lock);clearGoldTradeLock();return{...plan,entry:null,locked:false,consumed:true,cooling:false,tradeCompleted:true');
  source=source.replace('const completed=readGoldCompleted(),cooling=Date.now()<readGoldCooldown(),fresh=isFreshAfterCompleted(plan,completed);if(!lock&&!cooling&&fresh&&active',
    'const completed=readGoldCompleted(),cooling=false,fresh=isFreshAfterCompleted(plan,completed);if(!lock&&fresh&&active');
  source=source.replace("plan.cooling?'حماية بعد الإغلاق • إعادة تقييم…':",'');

  // Hard safety rule for the 5-minute gold setup: if the structural invalidation
  // is more than $3 from current price, do not lock or present it as tradable.
  source=source.replace(
    "function lockGoldPlan(plan,price){const p=Number(price),active=['UP','DOWN'].includes(plan?.state);let lock=readGoldTradeLock();",
    "function lockGoldPlan(plan,price){const p=Number(price),active=['UP','DOWN'].includes(plan?.state),proposedRisk=Math.abs(p-Number(plan?.invalidation)),stopTooWide=active&&Number.isFinite(proposedRisk)&&proposedRisk>3.0;let lock=readGoldTradeLock();"
  );
  source=source.replace(
    "if(!lock&&!cooling&&fresh&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){",
    "if(!lock&&!cooling&&fresh&&active&&!stopTooWide&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){"
  );
  source=source.replace(
    "if(!lock&&fresh&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){",
    "if(!lock&&fresh&&active&&!stopTooWide&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){"
  );
  source=source.replace(
    "if(!lock){const consumed=Boolean(completed&&!fresh);return{...plan,entry:null,locked:false,cooling,consumed,tradeCompleted:Boolean(completed)",
    "if(!lock){if(stopTooWide)return{...plan,state:'WAIT',entry:null,locked:false,cooling:false,consumed:false,tradeCompleted:false,tp1Hit:false,tp2Hit:false,note:'NO TRADE — الوقف البنيوي أكبر من 3$؛ ننتظر دخولًا أقرب أو بنية جديدة.'};const consumed=Boolean(completed&&!fresh);return{...plan,entry:null,locked:false,cooling,consumed,tradeCompleted:Boolean(completed)"
  );

  // A stop-out consumes that exact structure too. Re-entry is blocked until the
  // direction changes or the structural levels shift materially.
  source=source.replace(
    "function setGoldCompleted(lock){try{localStorage.setItem(GOLD_TRADE_COMPLETED_KEY,JSON.stringify({state:lock.state,entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,tp1Hit:true,tp2Hit:true,completedAt:Date.now()}))}catch{}}",
    "function setGoldCompleted(lock){try{localStorage.setItem(GOLD_TRADE_COMPLETED_KEY,JSON.stringify({state:lock.state,entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,tp1Hit:true,tp2Hit:true,result:'TP2',completedAt:Date.now()}))}catch{}}function setGoldStopped(lock){try{localStorage.setItem(GOLD_TRADE_COMPLETED_KEY,JSON.stringify({state:lock.state,entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,tp1Hit:Boolean(lock.tp1Hit),tp2Hit:false,result:'STOPPED',completedAt:Date.now()}))}catch{}}"
  );
  source=source.replace(
    "if(invalidated||opposite||expired){clearGoldTradeLock();lock=null}else writeGoldTradeLock(lock)",
    "if(invalidated){setGoldStopped(lock);clearGoldTradeLock();lock=null}else if(opposite||expired){clearGoldTradeLock();lock=null}else writeGoldTradeLock(lock)"
  );

  // Fast target-hit monitoring for LIVE/MASSIVE. The previous 5-second cycle could
  // miss a quick wick through TP1 before price bounced. Refresh once per second and
  // keep the hit sticky in localStorage as soon as a sampled live price touches it.
  source=source.replaceAll('GOLD_LIVE_MASSIVE_CACHE_MS=4500','GOLD_LIVE_MASSIVE_CACHE_MS=900');
  source=source.replaceAll('setInterval(loadGold,5000)','setInterval(loadGold,1000)');
  source=source.replaceAll('setInterval(loadGold,30000)','setInterval(loadGold,1000)');
  source=source.replaceAll('setInterval(loadGold,20000)','setInterval(loadGold,1000)');

  // Make hit feedback explicit immediately after render.
  source=source.replace(
    "if(t1){t1.classList.toggle('goldHit',!!plan.tp1Hit);if(plan.tp1Hit&&!t1.textContent.includes('✓'))t1.textContent='✓ '+t1.textContent}",
    "if(t1){t1.classList.toggle('goldHit',!!plan.tp1Hit);if(plan.tp1Hit){t1.textContent=t1.textContent.replace(/^✓\\s*/,'');t1.textContent='✓ تحقق الهدف الأول • '+t1.textContent}}"
  );
  source=source.replace(
    "if(t2){t2.classList.toggle('goldHit',!!plan.tp2Hit);if(plan.tp2Hit&&!t2.textContent.includes('✓'))t2.textContent='✓ '+t2.textContent}",
    "if(t2){t2.classList.toggle('goldHit',!!plan.tp2Hit);if(plan.tp2Hit){t2.textContent=t2.textContent.replace(/^✓\\s*/,'');t2.textContent='✓ تحقق الهدف الثاني • '+t2.textContent}}"
  );

  return originalWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args);
};

syncBuiltinESMExports();
await import('./gold-only-stable-start.js');
