import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceOneOf(source,variants,after,label){
  for(const before of variants){
    if(source.includes(before)) return source.replace(before,()=>after);
  }
  throw new Error('BTC fast M1 target not found: '+label);
}

function applyBtcFastM1(source){
  // This layer runs after the other runtime patchers, so accept both the
  // original 64% confidence form and the aggressive 58% form.
  const confidence58="let confidence=rawConfidence;if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  const confidence64="let confidence=rawConfidence;if(fastEligible){confidence=Math.max(confidence,64)+(c.impulseConfirm?5:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?3:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  const newConfidence="let confidence=rawConfidence;if(mtfConfirm>=2&&candidate===mtfSide){confidence=Math.max(confidence,56)+(mtfConfirm>=3?5:2)+(c.structureMomentum?4:0)+(c.rsiMomentum?3:0)+(c.impulseConfirm?3:0);confidence=Math.min(91,confidence)}else if(m1Override&&candidate===microSide){confidence=Math.max(confidence,52)+(c.structureMomentum?3:0)+(c.rsiMomentum?2:0)+(c.impulseConfirm?4:0);confidence=Math.min(86,confidence)}else if(fastEligible){confidence=Math.max(confidence,58)+(c.impulseConfirm?7:0)+(c.structureMomentum?5:0)+(c.rsiMomentum?4:0)+(liquidityConfirm?3:0);confidence=Math.min(91,confidence)}";
  source=replaceOneOf(source,[confidence58,confidence64],newConfidence,'multi-horizon confidence');

  source=replaceOneOf(
    source,
    [
      "!sameSideLossBlock&&base.confidence>=64){",
      "!sameSideLossBlock&&base.confidence>=58){"
    ],
    "!sameSideLossBlock&&base.confidence>=(mtfConfirm>=2&&candidate===mtfSide?52:m1Override&&candidate===microSide?50:58)){",
    'multi-horizon entry threshold'
  );

  const repriceNew="candidate===active.side&&base.confidence>=(mtfConfirm>=2&&candidate===mtfSide?52:m1Override&&candidate===microSide?50:58)&&Math.abs(price-active.entry)>repriceThreshold";
  source=source.replaceAll("candidate===active.side&&base.confidence>=58&&Math.abs(price-active.entry)>repriceThreshold",repriceNew);
  source=source.replaceAll("candidate===active.side&&base.confidence>=64&&Math.abs(price-active.entry)>repriceThreshold",repriceNew);

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
