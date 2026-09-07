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

  return originalWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args);
};

syncBuiltinESMExports();
await import('./gold-only-stable-start.js');
