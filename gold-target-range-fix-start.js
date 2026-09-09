import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchTargetTracking(source){
  const old="lock.tp1Hit=Boolean(lock.tp1Hit)||reachedGoldLevel(lock.state,p,lock.target1);lock.tp2Hit=Boolean(lock.tp2Hit)||reachedGoldLevel(lock.state,p,lock.target2);";
  const next="const observedRows=(typeof goldSamples!=='undefined'&&Array.isArray(goldSamples)?goldSamples:[]).filter(x=>Number(x.t)>=Number(lock.createdAt||0)).map(x=>Number(x.price)).filter(Number.isFinite);if(Number.isFinite(p))observedRows.push(p);const observedLow=observedRows.length?Math.min(...observedRows):p,observedHigh=observedRows.length?Math.max(...observedRows):p;lock.minSeen=Number.isFinite(Number(lock.minSeen))?Math.min(Number(lock.minSeen),observedLow):observedLow;lock.maxSeen=Number.isFinite(Number(lock.maxSeen))?Math.max(Number(lock.maxSeen),observedHigh):observedHigh;lock.tp1Hit=Boolean(lock.tp1Hit)||(lock.state==='UP'?Number(lock.maxSeen)>=Number(lock.target1):Number(lock.minSeen)<=Number(lock.target1));lock.tp2Hit=Boolean(lock.tp2Hit)||(lock.state==='UP'?Number(lock.maxSeen)>=Number(lock.target2):Number(lock.minSeen)<=Number(lock.target2));";
  if(source.includes(old))source=source.replace(old,next);

  // Target progression is operational state, so poll the gold reader every second.
  source=source.replaceAll('setInterval(loadGold,30000)','setInterval(loadGold,1000)');
  source=source.replaceAll('setInterval(loadGold,5000)','setInterval(loadGold,1000)');
  source=source.replaceAll('setInterval(loadGold,20000)','setInterval(loadGold,1000)');

  // Make target completion visually explicit before the next scenario is generated.
  source=source.replace(
    "note:'✓ اكتملت الصفقة السابقة — بانتظار سيناريو جديد.'",
    "note:'✓ اكتملت الأهداف السابقة وتم إغلاق السيناريو — يجري الآن البحث عن سيناريو جديد.'"
  );
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data);
  const patched=patchTargetTracking(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-news-start.js');
