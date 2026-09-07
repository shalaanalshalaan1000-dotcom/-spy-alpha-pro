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
