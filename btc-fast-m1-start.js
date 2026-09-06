import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source,before,after,label){
  if(!source.includes(before)) throw new Error('BTC fast M1 target not found: '+label);
  return source.replace(before,()=>after);
}

function applyBtcFastM1(source){
  // Faster M1 detector for BTC scalping. It still requires directional
  // agreement across at least 2 of the last 3 price moves.
  source=replaceRequired(
    source,
    "gate=Math.max(8,atr1*.12);return delta>=gate&&up>=2?'UP':delta<=-gate&&down>=2?'DOWN':'WAIT'",
    "gate=Math.max(4,atr1*.06);return delta>=gate&&up>=2?'UP':delta<=-gate&&down>=2?'DOWN':'WAIT'",
    'micro momentum sensitivity'
  );

  // Let a clear short M1 move override stale/MIXED higher-timeframe bias sooner.
  // The 2-of-3 directional test above is still mandatory.
  source=replaceRequired(
    source,
    "const candidate=microSide!=='WAIT'&&rawConfidence>=60?microSide:candidate0;",
    "const candidate=microSide!=='WAIT'&&rawConfidence>=40?microSide:candidate0;",
    'micro candidate threshold'
  );

  // Lift a valid micro-momentum setup to an executable confidence band.
  const oldConfidence="let confidence=rawConfidence;if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  const newConfidence="let confidence=rawConfidence;if(microSide!=='WAIT'&&candidate===microSide){confidence=Math.max(confidence,54)+(c.structureMomentum?4:0)+(c.rsiMomentum?3:0)+(c.impulseConfirm?3:0);confidence=Math.min(88,confidence)}else if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  source=replaceRequired(source,oldConfidence,newConfidence,'micro confidence floor');

  // Dynamic entry threshold: 54% for confirmed M1 micro momentum, 64% for
  // other BTC setups. Existing loss brakes and lifecycle protections remain.
  source=replaceRequired(
    source,
    "!sameSideLossBlock&&base.confidence>=64){",
    "!sameSideLossBlock&&base.confidence>=(microSide!=='WAIT'&&candidate===microSide?54:64)){",
    'adaptive entry threshold'
  );

  // Repricing uses the same adaptive threshold.
  source=source.replaceAll(
    "candidate===active.side&&base.confidence>=58&&Math.abs(price-active.entry)>repriceThreshold",
    "candidate===active.side&&base.confidence>=(microSide!=='WAIT'&&candidate===microSide?54:64)&&Math.abs(price-active.entry)>repriceThreshold"
  );

  for(const marker of ["rawConfidence>=40?microSide:candidate0","Math.max(confidence,54)","microSide!=='WAIT'&&candidate===microSide?54:64","gate=Math.max(4,atr1*.06)"]){
    if(!source.includes(marker)) throw new Error('BTC fast M1 verification failed: '+marker);
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
