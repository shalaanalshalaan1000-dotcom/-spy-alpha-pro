import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchVolumeProfile(source){
  const anchor="function goldAutoTargetHit(s,p,t){return s.side==='BUY'?p>=t:p<=t}";
  if(!source.includes(anchor))throw new Error('Volume profile helper anchor missing');

  const helper=`function goldAutoVolumeProfile(samples,entry,side,atr){
  const rows=(Array.isArray(samples)?samples:[]).filter(x=>Number.isFinite(Number(x?.price)));
  if(rows.length<24)return{ready:false,score:0,poc:null,vah:null,val:null,position:'INSUFFICIENT'};
  const prices=rows.map(x=>Number(x.price)),lo=Math.min(...prices),hi=Math.max(...prices),range=hi-lo;
  if(!(range>0))return{ready:false,score:0,poc:null,vah:null,val:null,position:'FLAT'};
  const bins=Math.max(18,Math.min(40,Math.round(Math.sqrt(rows.length)*2))),step=range/bins,counts=Array(bins).fill(0);
  for(const p of prices){const i=Math.max(0,Math.min(bins-1,Math.floor((p-lo)/step)));counts[i]++}
  let pocI=0;for(let i=1;i<bins;i++)if(counts[i]>counts[pocI])pocI=i;
  const total=counts.reduce((a,b)=>a+b,0),order=counts.map((c,i)=>({c,i})).sort((a,b)=>b.c-a.c);let acc=0,chosen=[];
  for(const x of order){chosen.push(x.i);acc+=x.c;if(acc>=total*.70)break}
  const valI=Math.min(...chosen),vahI=Math.max(...chosen),mid=i=>lo+(i+.5)*step,poc=mid(pocI),val=lo+valI*step,vah=lo+(vahI+1)*step,e=Number(entry),tol=Math.max(step*1.5,Number(atr||0)*.45,.35);
  const near=(x)=>Math.abs(e-x)<=tol,above=e>vah+tol,below=e<val-tol,inValue=e>=val&&e<=vah;
  let score=0,position=inValue?'VALUE_AREA':above?'ABOVE_VALUE':'BELOW_VALUE';
  if(near(poc))score+=2;
  if(near(vah)||near(val))score+=1;
  if(side==='BUY'){if(e>=poc)score+=1;if(above)score+=1;if(below)score-=2}
  if(side==='SELL'){if(e<=poc)score+=1;if(below)score+=1;if(above)score-=2}
  return{ready:true,score,poc:goldAutoRound(poc),vah:goldAutoRound(vah),val:goldAutoRound(val),position,tickCount:total,binSize:goldAutoRound(step,3)};
}`;
  source=source.replace(anchor,anchor+'\n'+helper);

  const old="const direction=setup.direction,side=setup.side,closes=bars.slice(-6).map(x=>x.close),aligned=direction>0?closes.at(-1)>closes[0]:closes.at(-1)<closes[0],displacement=Math.abs(price-setup.sweep.close)>=atr*.7,confidence=Math.min(92,75+(aligned?7:0)+(displacement?5:0)),buffer=Math.max(.35,atr*.35),stop=direction>0?setup.sweep.low-buffer:setup.sweep.high+buffer,half=Math.min(1,Math.max(.25,atr*.2)),entryBase=setup.mssLevel,chaseDistance=Math.abs(price-entryBase),maxChase=Math.max(1.25,atr*.75),risk=Math.abs(entryBase-stop);";
  const replacement="const direction=setup.direction,side=setup.side,closes=bars.slice(-6).map(x=>x.close),aligned=direction>0?closes.at(-1)>closes[0]:closes.at(-1)<closes[0],displacement=Math.abs(price-setup.sweep.close)>=atr*.7,baseConfidence=Math.min(92,75+(aligned?7:0)+(displacement?5:0)),buffer=Math.max(.35,atr*.35),stop=direction>0?setup.sweep.low-buffer:setup.sweep.high+buffer,half=Math.min(1,Math.max(.25,atr*.2)),entryBase=setup.mssLevel,volumeProfile=goldAutoVolumeProfile(recent,entryBase,side,atr),confidence=Math.max(65,Math.min(95,baseConfidence+(volumeProfile.ready?volumeProfile.score:0))),chaseDistance=Math.abs(price-entryBase),maxChase=Math.max(1.25,atr*.75),risk=Math.abs(entryBase-stop);";
  if(!source.includes(old))throw new Error('Volume profile no-chase model anchor missing');
  source=source.replace(old,replacement);

  source=source.replace(
    "riskReward:goldAutoRound(r1/risk,2),reason:'XAU confirmed: fresh MSS retest entry — no chase'}",
    "riskReward:goldAutoRound(r1/risk,2),volumeProfile,profilePOC:volumeProfile.poc,profileVAH:volumeProfile.vah,profileVAL:volumeProfile.val,profileScore:volumeProfile.score,reason:'XAU confirmed: fresh MSS retest + tick-volume profile — no chase'}"
  );
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),patched=patchVolumeProfile(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-no-chase-start.js');
