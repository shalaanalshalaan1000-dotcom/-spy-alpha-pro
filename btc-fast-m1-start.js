import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source,before,after,label){
  if(!source.includes(before)) throw new Error('BTC fast M1 target not found: '+label);
  return source.replace(before,()=>after);
}

function applyBtcFastM1(source){
  // The micro layer now exposes rolling M1/M3/M5 direction and mtfConfirm.
  // Prefer two-horizon agreement; allow M1 alone only with the pre-existing
  // impulse confirmation so the executor stays responsive without chasing noise.

  const oldConfidence="let confidence=rawConfidence;if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  const newConfidence="let confidence=rawConfidence;if(mtfConfirm>=2&&candidate===mtfSide){confidence=Math.max(confidence,58)+(mtfConfirm>=3?5:2)+(c.structureMomentum?4:0)+(c.rsiMomentum?3:0)+(c.impulseConfirm?3:0);confidence=Math.min(91,confidence)}else if(m1Override&&candidate===microSide){confidence=Math.max(confidence,54)+(c.structureMomentum?3:0)+(c.rsiMomentum?2:0)+(c.impulseConfirm?4:0);confidence=Math.min(86,confidence)}else if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  source=replaceRequired(source,oldConfidence,newConfidence,'multi-horizon confidence');

  // Entry thresholds: 56% when at least two of M1/M3/M5 agree, 54% for a
  // strong M1 impulse override, otherwise preserve the original 64% gate.
  source=replaceRequired(
    source,
    "!sameSideLossBlock&&base.confidence>=64){",
    "!sameSideLossBlock&&base.confidence>=(mtfConfirm>=2&&candidate===mtfSide?56:m1Override&&candidate===microSide?54:64)){",
    'multi-horizon entry threshold'
  );

  // Repricing uses the same threshold, so a live short-horizon scalp follows
  // current price while its directional agreement remains valid.
  source=source.replaceAll(
    "candidate===active.side&&base.confidence>=58&&Math.abs(price-active.entry)>repriceThreshold",
    "candidate===active.side&&base.confidence>=(mtfConfirm>=2&&candidate===mtfSide?56:m1Override&&candidate===microSide?54:64)&&Math.abs(price-active.entry)>repriceThreshold"
  );

  for(const marker of ['trend3m:','trend5m:','mtfConfirm>=2',"Math.max(confidence,58)","m1Override&&candidate===microSide?54:64"]){
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
