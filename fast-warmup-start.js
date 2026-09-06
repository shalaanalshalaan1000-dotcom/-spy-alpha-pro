import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Fast warmup patch target was not found: ' + label);
  return source.replace(before, () => after);
}

function applyFastWarmup(source) {
  source = replaceRequired(
    source,
    "if(span<15||bars.length<12)return{...base,reason:'جمع شموع دقيقة مغلقة: '+bars.length+' من 12 على الأقل'};",
    "if(bars.length<5)return{...base,reason:'جمع شموع دقيقة مغلقة: '+bars.length+' من 5 على الأقل'};",
    'minimum closed candles'
  );

  source = replaceRequired(
    source,
    'const ranges=bars.slice(-12).map(x=>x.high-x.low)',
    'const ranges=bars.slice(-5).map(x=>x.high-x.low)',
    'ATR warmup window'
  );

  source = replaceRequired(
    source,
    'for(let i=Math.max(8,bars.length-6);i<bars.length-1;i++){const prior=bars.slice(i-8,i)',
    'for(let i=Math.max(3,bars.length-4);i<bars.length-1;i++){const prior=bars.slice(i-3,i)',
    'ICT sweep lookback'
  );

  source = replaceRequired(
    source,
    'closes=bars.slice(-8).map(x=>x.close)',
    'closes=bars.slice(-5).map(x=>x.close)',
    'trend alignment window'
  );

  if (!source.includes("من 5 على الأقل") || !source.includes('bars.slice(i-3,i)')) {
    throw new Error('Fast warmup patch verification failed');
  }
  return source;
}

fs.writeFileSync = function patchedWriteFileSync(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return originalWriteFileSync(path, data, ...args);
  }
  const isBuffer = Buffer.isBuffer(data);
  const source = applyFastWarmup(isBuffer ? data.toString('utf8') : String(data));
  return originalWriteFileSync(path, isBuffer ? Buffer.from(source, 'utf8') : source, ...args);
};

syncBuiltinESMExports();
await import('./multi-asset-start.js');
