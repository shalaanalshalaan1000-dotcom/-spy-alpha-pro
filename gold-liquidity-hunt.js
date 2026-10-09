// Operational interpretation of liquidity sweep -> protected swing break -> retest.
// CHoCH without displacement is observation; it never authorizes an entry.
const validSide = side => ['BUY', 'SELL'].includes(side);
export function liquidityHuntSequence(bars, side, sweepCloseT, atrValue, spanMs=300000) {
  const blank={firstAny:null,firstMss:null,firstDisplacement:null,complete:false,completeAt:null,protectedSwing:null};
  if(!validSide(side)||!Number.isFinite(sweepCloseT))return blank;
  const rows=bars.slice(-192),before=rows.filter(b=>b.t+spanMs<=sweepCloseT);
  // Two bars on either side confirm the swing using only evidence available at the sweep.
  let pivot=null;
  for(let i=2;i<before.length-2;i++){
    const b=before[i],neighbors=[before[i-2],before[i-1],before[i+1],before[i+2]];
    const price=side==='BUY'?b.high:b.low;
    const isPivot=neighbors.every(x=>side==='BUY'?price>x.high:price<x.low);
    if(isPivot)pivot={t:b.t,price,confirmedAt:before[i+2].t+spanMs};
  }
  if(!pivot)return blank;
  let firstAny=null,firstMss=null,firstDisplacement=null,broken=false;
  const level=pivot.price;
  for(const b of rows.filter(b=>b.t>=sweepCloseT)){
    const range=Math.max(.0001,b.high-b.low),body=Math.abs(b.close-b.open);
    const directional=side==='BUY'?b.close>b.open:b.close<b.open;
    const displacement=directional&&body>=Math.max((atrValue||1)*.45,.45)&&
      (side==='BUY'?b.close>=b.low+range*.72:b.close<=b.high-range*.72);
    const through=side==='BUY'?b.close>level:b.close<level;
    const choch=through&&!broken;
    // A later displacement after a weak CHoCH must cross the swing anew.
    const mss=choch&&displacement;
    const event={side,mss,choch,displacement,classification:mss?'MSS':choch?'CHOCH':'DISPLACEMENT',
      level,protectedSwingT:pivot.t,priorHigh:side==='BUY'?level:null,priorLow:side==='SELL'?level:null,
      body,t:b.t,closeT:b.t+spanMs,structureConfirmed:true};
    if((choch||displacement)&&!firstAny)firstAny=event;
    if(displacement&&!firstDisplacement)firstDisplacement=event;
    if(mss){firstMss=event;break;}
    broken=through;
  }
  return {firstAny,firstMss,firstDisplacement,complete:Boolean(firstMss),
    completeAt:firstMss?.closeT??null,protectedSwing:pivot};
}

export function liquidityHuntRetest(bars,side,event,atrValue,sweepExtreme=null){
  if(!validSide(side)||!event?.mss)return null;
  const level=Number(event.level??(side==='BUY'?event.priorHigh:event.priorLow));
  if(!Number.isFinite(level))return null;
  const tolerance=Math.max(.10,Math.min(.80,(Number(atrValue)||1)*.25));
  const blank={confirmed:false,level,t:null,tolerance};
  let confirmed=null;
  const later=bars.filter(b=>b.t>event.t);
  for(let i=0;i<later.length;i++){
    const b=later[i];
    // An invalidated leg cannot become valid again merely by returning to the level.
    if(Number.isFinite(sweepExtreme)&&(side==='BUY'?b.low<sweepExtreme:b.high>sweepExtreme))return {...blank,invalidated:true};
    if(side==='BUY'?b.close<level-tolerance:b.close>level+tolerance)return {...blank,invalidated:true};
    const touch=b.low<=level+tolerance&&b.high>=level-tolerance;
    const held=side==='BUY'?b.close>level:b.close<level;
    if(!confirmed&&i<12&&touch&&held)confirmed={confirmed:true,level,t:b.t,open:b.open,high:b.high,low:b.low,close:b.close,tolerance};
  }
  return confirmed||blank;
}

export function sessionHuntMss(source,side,level,afterT,currentBarT){
  const ict=source?.ict||source?.confluence?.ict||{},sweep=ict.legSweep||ict.sweep,event=ict.m5MssEvent;
  if(!validSide(side)||!sweep||!event?.mss||event.structureConfirmed!==true)return null;
  if(Math.abs(Number(sweep.level)-Number(level))>.10||!Number.isFinite(Number(sweep.level)))return null;
  if(event.t<=afterT||event.t>currentBarT)return null;
  const expected=event.side;
  return expected===side?event:null;
}
