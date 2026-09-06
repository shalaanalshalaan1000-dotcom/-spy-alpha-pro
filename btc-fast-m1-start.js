import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source,before,after,label){
  if(!source.includes(before)) throw new Error('BTC fast M1 target not found: '+label);
  return source.replace(before,()=>after);
}

function applyBtcFastM1(source){
  // Fast BTC execution: use the 1m/3m/5m direction layer with only two
  // short-horizon confirmations for normal entries. A strong M1 impulse can
  // enter alone at a slightly lower threshold, while the fallback path stays
  // stricter so we do not turn every small tick into a trade.

  const oldConfidence="let confidence=rawConfidence;if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  const newConfidence="let confidence=rawConfidence;if(mtfConfirm>=2&&candidate===mtfSide){confidence=Math.max(confidence,56)+(mtfConfirm>=3?5:2)+(c.structureMomentum?4:0)+(c.rsiMomentum?3:0)+(c.impulseConfirm?3:0);confidence=Math.min(91,confidence)}else if(m1Override&&candidate===microSide){confidence=Math.max(confidence,52)+(c.structureMomentum?3:0)+(c.rsiMomentum?2:0)+(c.impulseConfirm?4:0);confidence=Math.min(86,confidence)}else if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  source=replaceRequired(source,oldConfidence,newConfidence,'multi-horizon confidence');

  // Entry thresholds: 52% when at least two of M1/M3/M5 agree, 50% for a
  // strong M1 impulse override, otherwise keep a 58% fallback gate.
  source=replaceRequired(
    source,
    "!sameSideLossBlock&&base.confidence>=64){",
    "!sameSideLossBlock&&base.confidence>=(mtfConfirm>=2&&candidate===mtfSide?52:m1Override&&candidate===microSide?50:58)){",
    'multi-horizon entry threshold'
  );

  // Repricing follows the same threshold so a valid scalp stays responsive.
  source=source.replaceAll(
    "candidate===active.side&&base.confidence>=58&&Math.abs(price-active.entry)>repriceThreshold",
    "candidate===active.side&&base.confidence>=(mtfConfirm>=2&&candidate===mtfSide?52:m1Override&&candidate===microSide?50:58)&&Math.abs(price-active.entry)>repriceThreshold"
  );

  for(const marker of ['trend3m:','trend5m:','mtfConfirm>=2',"Math.max(confidence,56)","m1Override&&candidate===microSide?50:58"]){
    if(!source.includes(marker)) throw new Error('BTC 1m/3m/5m verification failed: '+marker);
  }
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),source=applyBtcFastM1(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args);
};

syncBuiltinESMExports();
await import('./btc-micro-momentum-start.js');
