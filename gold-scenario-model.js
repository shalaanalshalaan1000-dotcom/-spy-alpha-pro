const round=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function barsFromSamples(samples=[],minutes=1){
  const span=minutes*60000,buckets=new Map();
  for(const sample of samples){
    const t=Number(sample?.t),p=Number(sample?.p??sample?.price??sample?.close);
    if(!Number.isFinite(t)||!Number.isFinite(p)||p<=0)continue;
    const key=Math.floor(t/span)*span;
    const o=Number(sample?.open),h=Number(sample?.high),l=Number(sample?.low),c=Number(sample?.close);
    const hasOhlc=[o,h,l,c].every(Number.isFinite);
    const open=hasOhlc?o:p,high=hasOhlc?h:p,low=hasOhlc?l:p,close=hasOhlc?c:p;
    const b=buckets.get(key);
    if(!b)buckets.set(key,{t:key,open,high,low,close});
    else{b.high=Math.max(b.high,high);b.low=Math.min(b.low,low);b.close=close;}
  }
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}
function closedBars(bars,minutes,now){const span=minutes*60000;return bars.filter(b=>b.t+span<=now);}
function avg(xs=[]){const v=xs.filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;}
function tr(bar,prev){return Math.max(bar.high-bar.low,Number.isFinite(prev)?Math.abs(bar.high-prev):0,Number.isFinite(prev)?Math.abs(bar.low-prev):0);}
function atr(bars=[],period=14){if(!bars.length)return 0;const x=bars.slice(-(period+1)),r=[];for(let i=0;i<x.length;i++)r.push(tr(x[i],i?x[i-1].close:NaN));return avg(r.slice(-period));}
function ema(values=[],period=20){if(!values.length)return null;const k=2/(period+1);let e=values[0];for(let i=1;i<values.length;i++)e=values[i]*k+e*(1-k);return e;}
function rsi(values=[],period=14){if(values.length<period+1)return null;let g=0,l=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>0)g+=d;else l-=d;}if(l===0)return 100;const rs=(g/period)/(l/period||1e-9);return 100-100/(1+rs);}
function normalizeClock(samples=[],now=Date.now()){
  const valid=samples.filter(x=>Number.isFinite(Number(x?.t))&&Number.isFinite(Number(x?.p??x?.price??x?.close)));
  if(!valid.length)return samples;const latest=Math.max(...valid.map(x=>Number(x.t))),skew=latest-now;
  if(Math.abs(skew)<=60000)return samples;return samples.map(x=>Number.isFinite(Number(x?.t))?{...x,t:Number(x.t)-skew}:x);
}
function structureScore(bars=[]){const x=bars.slice(-8);let s=0;for(let i=1;i<x.length;i++){if(x[i].high>x[i-1].high&&x[i].low>=x[i-1].low)s++;if(x[i].low<x[i-1].low&&x[i].high<=x[i-1].high)s--;}return s;}
function pivotLevels(bars=[],type){
  const x=bars.slice(-120),levels=[];
  for(let i=2;i<x.length-2;i++){
    const b=x[i];
    if(type==='LOW'&&b.low<=x[i-1].low&&b.low<=x[i-2].low&&b.low<x[i+1].low&&b.low<=x[i+2].low)levels.push(b.low);
    if(type==='HIGH'&&b.high>=x[i-1].high&&b.high>=x[i-2].high&&b.high>x[i+1].high&&b.high>=x[i+2].high)levels.push(b.high);
  }
  return levels.filter(Number.isFinite);
}
function nearestBelow(values,price){return values.filter(v=>v<price).sort((a,b)=>b-a)[0]??null;}
function nearestAbove(values,price){return values.filter(v=>v>price).sort((a,b)=>a-b)[0]??null;}
function nextAbove(values,level){return values.filter(v=>v>level).sort((a,b)=>a-b)[0]??null;}
function nextBelow(values,level){return values.filter(v=>v<level).sort((a,b)=>b-a)[0]??null;}
function zone(center,width){return{low:round(center-width/2,3),high:round(center+width/2,3),center:round(center,3)};}
function inZone(price,z){return Number.isFinite(price)&&z&&price>=z.low&&price<=z.high;}
function candleSignal(bars=[],side){
  const a=bars.at(-1),b=bars.at(-2);if(!a||!b)return{ready:false,type:null,rejection:false,engulfing:false,shift:false};
  const range=Math.max(.0001,a.high-a.low),body=Math.abs(a.close-a.open),upper=a.high-Math.max(a.open,a.close),lower=Math.min(a.open,a.close)-a.low;
  const bullReject=a.close>a.open&&lower>=Math.max(body*.9,range*.25)&&a.close>=a.low+range*.58;
  const bearReject=a.close<a.open&&upper>=Math.max(body*.9,range*.25)&&a.close<=a.low+range*.42;
  const bullEngulf=a.close>a.open&&b.close<b.open&&a.open<=b.close&&a.close>=b.open;
  const bearEngulf=a.close<a.open&&b.close>b.open&&a.open>=b.close&&a.close<=b.open;
  const bullShift=a.close>b.high;
  const bearShift=a.close<b.low;
  const rejection=side==='BUY'?bullReject:bearReject,engulfing=side==='BUY'?bullEngulf:bearEngulf,shift=side==='BUY'?bullShift:bearShift;
  return{ready:rejection||engulfing||shift,type:engulfing?'ENGULFING':rejection?'REJECTION':shift?'STRUCTURE_SHIFT':null,rejection,engulfing,shift};
}
function marketBias(c60,c15,price){
  const v60=c60.map(x=>x.close),v15=c15.map(x=>x.close),e20=ema(v60,20),e50=ema(v60,50),e15=ema(v15,20),s60=structureScore(c60),s15=structureScore(c15);
  let bias='RANGE';
  if(e20!=null&&e50!=null&&e20>e50&&price>=e20&&s15>=0)bias='BULLISH';
  else if(e20!=null&&e50!=null&&e20<e50&&price<=e20&&s15<=0)bias='BEARISH';
  return{bias,ema20_60:round(e20,3),ema50_60:round(e50,3),ema20_15:round(e15,3),structure60:s60,structure15:s15};
}
function scenarioTargets(side,entry,stop,levels,atr5){
  const risk=Math.max(.5,Math.abs(entry-stop)),dir=side==='BUY'?1:-1;
  const ordered=[...levels].filter(Number.isFinite).sort((a,b)=>side==='BUY'?a-b:b-a);
  const directional=ordered.filter(v=>side==='BUY'?v>entry:v<entry);
  const min1=Math.max(atr5*.65,risk*.65),min2=Math.max(atr5*1.2,risk*1.25),min3=Math.max(atr5*1.8,risk*1.9),min4=Math.max(atr5*2.6,risk*2.7);
  const choose=(minMove,prev)=>{
    const structural=directional.find(v=>Math.abs(v-entry)>=minMove&&Math.abs(v-prev)>=Math.max(.35,atr5*.2));
    return structural??entry+dir*minMove;
  };
  const t1=choose(min1,entry),t2=choose(min2,t1),t3=choose(min3,t2),t4=choose(min4,t3);
  const arr=[t1,t2,t3,t4];let prev=entry;
  return arr.map((v,i)=>{const minStep=Math.max(.35,atr5*.18),fixed=side==='BUY'?Math.max(v,prev+minStep):Math.min(v,prev-minStep);prev=fixed;return round(fixed,3);});
}
function buildScenario(side,price,center,width,atr5,allLevels,bias,trigger5,rsi5){
  const z=zone(center,width),buffer=Math.max(width*.9,atr5*.55,.65),entry=(z.low+z.high)/2;
  const invalidation=side==='BUY'?z.low-buffer:z.high+buffer;
  const targets=scenarioTargets(side,entry,invalidation,allLevels,atr5),inside=inZone(price,z),aligned=side==='BUY'?bias==='BULLISH':side==='SELL'?bias==='BEARISH':false;
  const momentum=side==='BUY'?(rsi5==null||rsi5<=68):(rsi5==null||rsi5>=32);
  let quality=48;quality+=12; if(aligned)quality+=10; if(inside)quality+=8; if(trigger5.ready)quality+=20; if(momentum)quality+=5;
  quality=clamp(Math.round(quality),0,94);
  const state=inside?(trigger5.ready?'TRIGGER_READY':'IN_ZONE_WAIT_TRIGGER'):'WAIT_FOR_ZONE';
  return{side,state,zoneLow:z.low,zoneHigh:z.high,zoneCenter:z.center,invalidation:round(invalidation,3),target1:targets[0],target2:targets[1],target3:targets[2],target4:targets[3],quality,insideZone:inside,trigger:trigger5,alignedWithBias:aligned,momentumOk:momentum};
}

export function analyzeGoldSignal(samples,rawPrice,now=Date.now()){
  const price=Number(rawPrice),alignedSamples=normalizeClock(samples,now);
  const c5=closedBars(barsFromSamples(alignedSamples,5),5,now),c15=closedBars(barsFromSamples(alignedSamples,15),15,now),c60=closedBars(barsFromSamples(alignedSamples,60),60,now);
  const ready=c5.length>=30&&c15.length>=28&&c60.length>=40,completeness=Math.round(Math.min(1,c5.length/30,c15.length/28,c60.length/40)*100);
  const base={status:ready?'WAIT':'COLLECTING',action:'WAIT',candidateAction:'WAIT',side:null,strategy:'ZONE_SCENARIO_STRUCTURE',confidence:0,scoreMeaning:'SETUP_SCORE_NOT_WIN_PROBABILITY',readingCompleteness:completeness,barCount5m:c5.length,barCount15m:c15.length,barCount60m:c60.length,sampleCount:alignedSamples.length,modelTimeframes:{bias:'60m',zones:'15m + 5m pivots',execution:'5m closed-candle rejection / engulfing / structure shift'},price:round(price,3),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:['TP1: nearest structural objective','TP2: next liquidity/support-resistance objective','TP3: extension','TP4: final extension'],riskReward:null,contextBias:'NEUTRAL',scenarioPlan:null,momentum:null,reason:ready?'Scenario engine ready — waiting for price to reach a planned zone':'Collecting 60m / 15m / 5m structure history',updatedAt:new Date(now).toISOString()};
  if(!Number.isFinite(price)||price<=0||!ready)return base;

  const atr5=Math.max(.25,atr(c5,14)),atr15=Math.max(.5,atr(c15,14)),trend=marketBias(c60,c15,price),rsi5=rsi(c5.map(b=>b.close),14);
  const lows=[...pivotLevels(c15,'LOW'),...pivotLevels(c5,'LOW')],highs=[...pivotLevels(c15,'HIGH'),...pivotLevels(c5,'HIGH')];
  const recent15=c15.slice(-18),fallbackSupport=Math.min(...recent15.map(x=>x.low)),fallbackResistance=Math.max(...recent15.map(x=>x.high));
  const support=nearestBelow(lows,price)??fallbackSupport,resistance=nearestAbove(highs,price)??fallbackResistance;
  const zoneWidth=clamp(atr5*.7,.8,4.0),buyTrigger=candleSignal(c5,'BUY'),sellTrigger=candleSignal(c5,'SELL');
  const allLevels=[...lows,...highs],buy=buildScenario('BUY',price,support,zoneWidth,atr5,allLevels,trend.bias,buyTrigger,rsi5),sell=buildScenario('SELL',price,resistance,zoneWidth,atr5,allLevels,trend.bias,sellTrigger,rsi5);

  const nextSupport=nextBelow(lows,support),nextResistance=nextAbove(highs,resistance);
  const scenarioPlan={bias:trend.bias,atr5:round(atr5,3),atr15:round(atr15,3),rsi5:round(rsi5,1),buy,sell,nextSupport:round(nextSupport,3),nextResistance:round(nextResistance,3),rule:'WAIT FOR ZONE → 5M TRIGGER → ENTRY RANGE → STRUCTURAL INVALIDATION → TARGETS'};
  const momentum={trend:{side:trend.bias==='BULLISH'?'BUY':trend.bias==='BEARISH'?'SELL':'NEUTRAL',...trend},rsi5:round(rsi5,1),atr5:round(atr5,3),atr15:round(atr15,3),trigger:{buy:buyTrigger,sell:sellTrigger},scenarioPlan};
  const candidates=[buy,sell].filter(x=>x.state==='TRIGGER_READY'&&x.momentumOk).sort((a,b)=>b.quality-a.quality),chosen=candidates[0]||null;
  const contextBias=trend.bias==='BULLISH'?'BUY':trend.bias==='BEARISH'?'SELL':'NEUTRAL';
  if(!chosen){
    const nearest=[buy,sell].sort((a,b)=>Math.min(Math.abs(price-a.zoneLow),Math.abs(price-a.zoneHigh))-Math.min(Math.abs(price-b.zoneLow),Math.abs(price-b.zoneHigh)))[0];
    const reason=nearest.insideZone?`ZONE WAIT — price is inside ${nearest.side} zone; waiting for a closed 5m rejection / engulfing / structure shift`:`ZONE WAIT — planned BUY ${buy.zoneLow}-${buy.zoneHigh} / SELL ${sell.zoneLow}-${sell.zoneHigh}; do not chase price`;
    return{...base,confidence:Math.max(buy.quality,sell.quality),contextBias,scenarioPlan,momentum,reason};
  }

  const side=chosen.side,entry=(chosen.zoneLow+chosen.zoneHigh)/2,stop=chosen.invalidation,targets=[chosen.target1,chosen.target2,chosen.target3,chosen.target4],risk=Math.abs(entry-stop),rr=risk>0?Math.abs(targets[0]-entry)/risk:null;
  const setupId=['ZONE',side,c5.at(-1)?.t,round(chosen.zoneLow,2),round(chosen.zoneHigh,2),chosen.trigger.type].join('|');
  return{...base,status:'CANDIDATE',candidateAction:side,side,strategy:'ZONE_'+chosen.trigger.type,confidence:chosen.quality,contextBias,oneMinuteConfirmed:true,setupId,structureAt:c5.at(-1)?.t??now,scenarioPlan,momentum,prediction:{side,confidence:chosen.quality,rsi5:round(rsi5,1),triggerType:chosen.trigger.type,bias:trend.bias},entry:round(entry,3),entryLow:chosen.zoneLow,entryHigh:chosen.zoneHigh,stopLoss:stop,target1:targets[0],target2:targets[1],target3:targets[2],target4:targets[3],riskReward:round(rr,2),reason:`ZONE CONFIRMED — ${side} zone ${chosen.zoneLow}-${chosen.zoneHigh} + closed 5m ${chosen.trigger.type}; setup quality ${chosen.quality}/100 (not win probability); invalidation ${stop}`};
}
