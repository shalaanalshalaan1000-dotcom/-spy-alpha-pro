import { analyzeGoldSignal as analyzeClassicModel } from './gold-signal-model.js';
import { analyzeGoldSignal as analyzeIctModel } from './gold-ict-swing-model.js';

const n=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=3)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function minuteBars(samples=[]){
  const buckets=new Map();
  for(const s of samples){
    const t=n(s?.t),p=n(s?.p??s?.price??s?.close); if(t==null||p==null||p<=0)continue;
    const key=Math.floor(t/60000)*60000,o=n(s?.open),h=n(s?.high),l=n(s?.low),c=n(s?.close),old=buckets.get(key);
    if(!old){const open=o??p,high=h??p,low=l??p,close=c??p;buckets.set(key,{t:key,open,high,low,close});}
    else{old.high=Math.max(old.high,h??p);old.low=Math.min(old.low,l??p);old.close=c??p;}
  }
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}
function aggregate(bars,minutes){
  const span=minutes*60000,buckets=new Map();
  for(const b of bars){const key=Math.floor(b.t/span)*span,old=buckets.get(key);if(!old)buckets.set(key,{t:key,open:b.open,high:b.high,low:b.low,close:b.close});else{old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.close=b.close;}}
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}
function closed(bars,minutes,now){const span=minutes*60000;return bars.filter(b=>b.t+span<=now);}
function mean(x=[]){const v=x.filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;}
function atr(bars,count=14){const x=bars.slice(-Math.max(2,count+1));if(x.length<2)return null;const tr=[];for(let i=1;i<x.length;i++){const b=x[i],pc=x[i-1].close;tr.push(Math.max(b.high-b.low,Math.abs(b.high-pc),Math.abs(b.low-pc)));}return mean(tr);}
function ema(values=[],period=20){if(values.length<period)return null;const k=2/(period+1);let e=mean(values.slice(0,period));for(let i=period;i<values.length;i++)e=values[i]*k+e*(1-k);return e;}
function pivots(bars,left=2,right=2){const highs=[],lows=[];for(let i=left;i<bars.length-right;i++){const b=bars[i],before=bars.slice(i-left,i),after=bars.slice(i+1,i+1+right);if(before.every(x=>b.high>x.high)&&after.every(x=>b.high>=x.high))highs.push({t:b.t,price:b.high});if(before.every(x=>b.low<x.low)&&after.every(x=>b.low<=x.low))lows.push({t:b.t,price:b.low});}return{highs,lows};}
function structureDir(bars){const p=pivots(bars.slice(-50),2,2),hs=p.highs.slice(-2),ls=p.lows.slice(-2);if(hs.length>=2&&ls.length>=2){if(hs[1].price>hs[0].price&&ls[1].price>ls[0].price)return 1;if(hs[1].price<hs[0].price&&ls[1].price<ls[0].price)return-1;}const x=bars.slice(-8),last=x.at(-1);if(!last||x.length<4)return 0;const ph=Math.max(...x.slice(0,-1).map(b=>b.high)),pl=Math.min(...x.slice(0,-1).map(b=>b.low));if(last.close>ph)return 1;if(last.close<pl)return-1;return 0;}
function sideOf(dir){return dir>0?'BUY':dir<0?'SELL':'NEUTRAL';}
function lastMomentum(bars,count=3){const x=bars.slice(-Math.max(2,count+1));if(x.length<2)return 0;return x.at(-1).close-x[0].close;}
function recentSweep(bars,side){
  const x=bars.slice(-24);if(x.length<6)return null;
  for(let i=x.length-1;i>=Math.max(4,x.length-8);i--){const b=x[i],prior=x.slice(Math.max(0,i-5),i),lo=Math.min(...prior.map(z=>z.low)),hi=Math.max(...prior.map(z=>z.high));if(side==='BUY'&&b.low<lo&&b.close>lo)return{side,level:round(lo),extreme:round(b.low),t:b.t,type:'SELLSIDE_SWEEP'};if(side==='SELL'&&b.high>hi&&b.close<hi)return{side,level:round(hi),extreme:round(b.high),t:b.t,type:'BUYSIDE_SWEEP'};}
  return null;
}
function fibonacciLocation(bars,price){
  const x=bars.slice(-32);if(x.length<8)return{location:'UNKNOWN',buy:0,sell:0,high:null,low:null,pos:null};
  const high=Math.max(...x.map(b=>b.high)),low=Math.min(...x.map(b=>b.low)),range=high-low;if(!(range>0))return{location:'UNKNOWN',buy:0,sell:0,high:round(high),low:round(low),pos:null};
  const pos=(price-low)/range;let buy=0,sell=0,location='MID';if(pos<=.382){buy=6;location='DEEP_DISCOUNT';}else if(pos<.50){buy=4;location='DISCOUNT';}else if(pos>.618){sell=6;location='DEEP_PREMIUM';}else if(pos>.50){sell=4;location='PREMIUM';}
  return{location,buy,sell,high:round(high),low:round(low),pos:round(pos,3),fib382:round(low+range*.382),fib50:round(low+range*.5),fib618:round(low+range*.618)};
}
function candleBias(bars){
  const last=bars.at(-1),prev=bars.at(-2);if(!last)return{side:'NEUTRAL',strength:0,pattern:'NONE'};const range=Math.max(.001,last.high-last.low),body=Math.abs(last.close-last.open),upper=last.high-Math.max(last.open,last.close),lower=Math.min(last.open,last.close)-last.low;
  if(prev&&last.close>last.open&&prev.close<prev.open&&last.open<=prev.close&&last.close>=prev.open)return{side:'BUY',strength:7,pattern:'BULLISH_ENGULFING'};
  if(prev&&last.close<last.open&&prev.close>prev.open&&last.open>=prev.close&&last.close<=prev.open)return{side:'SELL',strength:7,pattern:'BEARISH_ENGULFING'};
  if(lower>=Math.max(body*2,range*.35)&&last.close>=last.low+range*.65)return{side:'BUY',strength:5,pattern:'LOWER_REJECTION'};
  if(upper>=Math.max(body*2,range*.35)&&last.close<=last.low+range*.35)return{side:'SELL',strength:5,pattern:'UPPER_REJECTION'};
  return{side:last.close>last.open?'BUY':last.close<last.open?'SELL':'NEUTRAL',strength:2,pattern:'CANDLE_DIRECTION'};
}
function breakoutBias(bars,price,atr5){const x=bars.slice(-10);if(x.length<6)return{side:'NEUTRAL',strength:0};const prior=x.slice(-6,-1),hi=Math.max(...prior.map(b=>b.high)),lo=Math.min(...prior.map(b=>b.low)),margin=Math.max(.08,(atr5||1)*.08);if(price>hi+margin)return{side:'BUY',strength:9,level:round(hi),type:'BREAKOUT'};if(price<lo-margin)return{side:'SELL',strength:9,level:round(lo),type:'BREAKOUT'};const last=x.at(-1);if(last.low<=hi+margin&&last.close>hi&&price>=hi)return{side:'BUY',strength:7,level:round(hi),type:'RETEST'};if(last.high>=lo-margin&&last.close<lo&&price<=lo)return{side:'SELL',strength:7,level:round(lo),type:'RETEST'};return{side:'NEUTRAL',strength:0};}
function add(score,side,value,why){if(!['BUY','SELL'].includes(side)||!(value>0))return;score[side]+=value;score.reasons[side].push(why);}
function componentBucket(){return{BUY:0,SELL:0,reasons:{BUY:[],SELL:[]}};}
function nearestTargets(side,entry,bars,minMove,risk){
  const p5=pivots(bars.m5.slice(-80),1,1),p15=pivots(bars.m15.slice(-80),1,1),p1h=pivots(bars.h1.slice(-80),1,1);
  const levels=[...p5.highs,...p5.lows,...p15.highs,...p15.lows,...p1h.highs,...p1h.lows].map(x=>x.price).filter(Number.isFinite).filter(v=>side==='BUY'?v>entry+minMove:v<entry-minMove);
  levels.sort((a,b)=>Math.abs(a-entry)-Math.abs(b-entry));const uniq=[];for(const v of levels){if(!uniq.some(x=>Math.abs(x-v)<.45))uniq.push(v);if(uniq.length>=4)break;}
  const d=[Math.max(minMove,risk*.8),Math.max(minMove*1.4,risk*1.25),Math.max(minMove*2,risk*1.8),Math.max(minMove*2.8,risk*2.5)],dir=side==='BUY'?1:-1,out=[];
  for(let i=0;i<4;i++){let v=uniq[i]??entry+dir*d[i];if(i&&side==='BUY'&&v<=out[i-1]+.45)v=out[i-1]+Math.max(.75,minMove*.5);if(i&&side==='SELL'&&v>=out[i-1]-.45)v=out[i-1]-Math.max(.75,minMove*.5);out.push(round(v));}
  return out;
}
function fallbackStop(side,entry,bars,atr1){const m5=bars.m5.slice(-5),m1=bars.m1.slice(-10),buffer=clamp((atr1||.5)*.35,.18,.55);const candidates=[];if(m5.length)candidates.push(side==='BUY'?Math.min(...m5.map(b=>b.low))-buffer:Math.max(...m5.map(b=>b.high))+buffer);if(m1.length)candidates.push(side==='BUY'?Math.min(...m1.map(b=>b.low))-buffer:Math.max(...m1.map(b=>b.high))+buffer);const valid=candidates.filter(v=>side==='BUY'?v<entry:v>entry).sort((a,b)=>Math.abs(a-entry)-Math.abs(b-entry));let stop=valid.find(v=>Math.abs(v-entry)>=.55&&Math.abs(v-entry)<=4.5)??valid[0];if(!Number.isFinite(stop)||Math.abs(stop-entry)<.55)stop=entry+(side==='BUY'?-1:1)*Math.max(.75,(atr1||.5)*1.5);return round(stop);}
function validPlan(m,side){return Boolean(m&&m.status==='CANDIDATE'&&m.candidateAction===side&&n(m.entryLow)!=null&&n(m.entryHigh)!=null&&n(m.stopLoss)!=null&&n(m.target1)!=null);}

export function analyzeGoldSignal(samples,rawPrice,now=Date.now()){
  const price=n(rawPrice),classic=analyzeClassicModel(samples,rawPrice,now),ict=analyzeIctModel(samples,rawPrice,now);
  const m1all=minuteBars(samples),m1=closed(m1all,1,now),m5=closed(aggregate(m1all,5),5,now),m15=closed(aggregate(m1all,15),15,now),h1=closed(aggregate(m1all,60),60,now);
  const base={status:'COLLECTING',action:'WAIT',candidateAction:'WAIT',side:null,strategy:'MULTI_MODEL_CONFLUENCE',tradeStyle:'MULTI_MODEL_CONFLUENCE',confidence:0,price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,oneMinuteConfirmed:false,contextBias:'NEUTRAL',sampleCount:samples.length,modelTimeframes:{context:'1h/15m',setup:'5m multi-model confluence',timing:'1m'},confluence:null,technicalRead:ict?.technicalRead||null,priceAction:ict?.priceAction||null,liquidityContext:ict?.ict||null,ict:ict?.ict||null,updatedAt:new Date(now).toISOString(),reason:'Building multi-model context'};
  if(price==null||m1.length<45||m5.length<24||m15.length<16||h1.length<6)return base;

  const bars={m1,m5,m15,h1},atr1=atr(m1,14)||.5,atr5=atr(m5,14)||1.5,dir1h=structureDir(h1),dir15=structureDir(m15),dir5=structureDir(m5),tech=ict?.technicalRead||{},ind=tech?.indicators||{},fib=fibonacciLocation(h1,price),candle=candleBias(m5),breakout=breakoutBias(m5,price,atr5),sweepBuy=recentSweep(m5,'BUY')||recentSweep(m1,'BUY'),sweepSell=recentSweep(m5,'SELL')||recentSweep(m1,'SELL');
  const components={structure:componentBucket(),trend:componentBucket(),momentum:componentBucket(),priceAction:componentBucket(),liquidity:componentBucket(),location:componentBucket(),volatility:componentBucket()};

  add(components.structure,sideOf(dir1h),6,'1h structure');add(components.structure,sideOf(dir15),10,'15m structure');add(components.structure,sideOf(dir5),8,'5m structure');
  const c5=m5.map(b=>b.close),c15=m15.map(b=>b.close),ema20_5=ema(c5,20),ema50_5=ema(c5,50),ema10_15=ema(c15,10),ema20_15=ema(c15,20),mom5=lastMomentum(m5,4),mom15=lastMomentum(m15,3);
  if(ema20_5!=null&&ema50_5!=null)add(components.trend,ema20_5>ema50_5?'BUY':'SELL',7,'5m EMA trend');if(ema10_15!=null&&ema20_15!=null)add(components.trend,ema10_15>ema20_15?'BUY':'SELL',7,'15m EMA trend');if(mom15!==0)add(components.trend,mom15>0?'BUY':'SELL',4,'15m slope');
  const rsi=n(ind?.rsi14);if(rsi!=null){if(rsi>=54&&rsi<=74)add(components.momentum,'BUY',4,'RSI bullish');else if(rsi<=46&&rsi>=26)add(components.momentum,'SELL',4,'RSI bearish');}
  const macdSide=ind?.macd?.bias;if(['BUY','SELL'].includes(macdSide))add(components.momentum,macdSide,5,'MACD');const stochSide=ind?.stochastic533?.bias;if(['BUY','SELL'].includes(stochSide))add(components.momentum,stochSide,2,'Stochastic');if(mom5!==0)add(components.momentum,mom5>0?'BUY':'SELL',3,'5m momentum');
  add(components.priceAction,candle.side,candle.strength,`candle ${candle.pattern}`);add(components.priceAction,breakout.side,breakout.strength,breakout.type||'breakout');
  if(validPlan(classic,'BUY'))add(components.priceAction,'BUY',4,'classic model candidate');if(validPlan(classic,'SELL'))add(components.priceAction,'SELL',4,'classic model candidate');
  if(sweepBuy)add(components.liquidity,'BUY',7,'sell-side liquidity sweep');if(sweepSell)add(components.liquidity,'SELL',7,'buy-side liquidity sweep');if(validPlan(ict,'BUY'))add(components.liquidity,'BUY',5,'ICT/liquidity candidate');if(validPlan(ict,'SELL'))add(components.liquidity,'SELL',5,'ICT/liquidity candidate');
  add(components.location,'BUY',fib.buy,`Fibonacci ${fib.location}`);add(components.location,'SELL',fib.sell,`Fibonacci ${fib.location}`);
  const volRatio=atr5/Math.max(.25,mean(m5.slice(-20).map(b=>b.high-b.low))||atr5);const healthy=volRatio>=.65&&volRatio<=1.8;if(healthy){add(components.volatility,'BUY',5,'healthy volatility');add(components.volatility,'SELL',5,'healthy volatility');}if(Math.abs(mom5)>=atr5*.35)add(components.volatility,mom5>0?'BUY':'SELL',5,'directional range expansion');else{add(components.volatility,'BUY',2,'room available');add(components.volatility,'SELL',2,'room available');}

  const totals={BUY:0,SELL:0};for(const c of Object.values(components)){totals.BUY+=c.BUY;totals.SELL+=c.SELL;}if(classic?.status==='CANDIDATE'&&['BUY','SELL'].includes(classic.candidateAction)){const opp=classic.candidateAction==='BUY'?'SELL':'BUY';totals[opp]=Math.max(0,totals[opp]-6);}if(ict?.status==='CANDIDATE'&&['BUY','SELL'].includes(ict.candidateAction)){const opp=ict.candidateAction==='BUY'?'SELL':'BUY';totals[opp]=Math.max(0,totals[opp]-3);}
  totals.BUY=clamp(Math.round(totals.BUY),0,100);totals.SELL=clamp(Math.round(totals.SELL),0,100);const side=totals.BUY>=totals.SELL?'BUY':'SELL',confidence=totals[side],other=totals[side==='BUY'?'SELL':'BUY'],lead=confidence-other;
  const breakdown=Object.fromEntries(Object.entries(components).map(([k,v])=>[k,{BUY:v.BUY,SELL:v.SELL,reasons:v.reasons}]));
  const confluence={version:'CONFLUENCE_V1',weights:{structure:24,trend:18,momentum:14,priceAction:16,liquidity:12,location:6,volatility:10},scores:totals,lead,selectedSide:side,breakdown,fibonacci:fib,structure:{h1:sideOf(dir1h),m15:sideOf(dir15),m5:sideOf(dir5)},trend:{ema20_5:round(ema20_5),ema50_5:round(ema50_5),ema10_15:round(ema10_15),ema20_15:round(ema20_15)},momentum:{rsi14:round(rsi,1),macd:ind?.macd||null,stochastic:ind?.stochastic533||null,m5:round(mom5),m15:round(mom15)},priceAction:{candle,breakout},liquidity:{buySweep:sweepBuy,sellSweep:sweepSell,legacyIctCandidate:ict?.status==='CANDIDATE'?ict?.candidateAction:null},legacyModels:{classic:{status:classic?.status,side:classic?.candidateAction,confidence:classic?.confidence,strategy:classic?.strategy},ict:{status:ict?.status,side:ict?.candidateAction,confidence:ict?.confidence,strategy:ict?.strategy}}};
  base.confluence=confluence;base.contextBias=side;base.confidence=confidence;
  if(confidence<65||lead<8)return{...base,status:'WAIT',candidateAction:lead>=4?side:'WAIT',reason:`CONFLUENCE WAIT — BUY ${totals.BUY}/100 • SELL ${totals.SELL}/100 • lead ${lead}; need ≥65 and lead ≥8`};

  const sourcePlan=validPlan(classic,side)?classic:validPlan(ict,side)?ict:null;let entry=n(sourcePlan?.entry)??price,entryLow=n(sourcePlan?.entryLow),entryHigh=n(sourcePlan?.entryHigh),stop=n(sourcePlan?.stopLoss),targets=[n(sourcePlan?.target1),n(sourcePlan?.target2),n(sourcePlan?.target3),n(sourcePlan?.target4)],labels=Array.isArray(sourcePlan?.targetLabels)?sourcePlan.targetLabels.slice(0,4):[];
  const half=clamp(atr1*.75,.25,.75);if(entryLow==null)entryLow=entry-half;if(entryHigh==null)entryHigh=entry+half;if(stop==null||!(side==='BUY'?stop<entry:stop>entry))stop=fallbackStop(side,entry,bars,atr1);const risk=Math.abs(entry-stop);if(!(risk>=.45))return{...base,status:'WAIT',candidateAction:side,reason:'CONFLUENCE WAIT — structural stop is too close'};
  const minMove=Math.max(1.25,atr1*1.2);const fallbackTargets=nearestTargets(side,entry,bars,minMove,risk);for(let i=0;i<4;i++){const room=targets[i]==null?null:Math.abs(targets[i]-entry);if(targets[i]==null||(side==='BUY'?targets[i]<=entry:targets[i]>=entry)||(i===0&&room<minMove))targets[i]=fallbackTargets[i];}for(let i=1;i<4;i++){if(side==='BUY'&&targets[i]<=targets[i-1]+.35)targets[i]=targets[i-1]+Math.max(.75,minMove*.45);if(side==='SELL'&&targets[i]>=targets[i-1]-.35)targets[i]=targets[i-1]-Math.max(.75,minMove*.45);}labels=[0,1,2,3].map((i)=>labels[i]||`CONFLUENCE_TP${i+1}`);
  const tp1Reward=side==='BUY'?targets[0]-entry:entry-targets[0],rr=risk>0?tp1Reward/risk:0;if(!(tp1Reward>=1.0)||rr<.5)return{...base,status:'WAIT',candidateAction:side,reason:`CONFLUENCE WAIT — target room ${round(tp1Reward,2)} / ${round(rr,2)}R is too small`};
  const model=components.liquidity[side]>=7&&components.priceAction[side]>=7?'CONFLUENCE_REVERSAL':components.trend[side]>=12&&components.structure[side]>=14?'CONFLUENCE_TREND':'CONFLUENCE_BREAKOUT';const oneMinuteConfirmed=side==='BUY'?m1.slice(-2).every(b=>b.close>=b.open):m1.slice(-2).every(b=>b.close<=b.open);
  return{...base,status:'CANDIDATE',candidateAction:side,side,strategy:model,tradeStyle:'MULTI_MODEL_CONFLUENCE',confidence,signalConfidence:confidence,contextBias:side,oneMinuteConfirmed,setupId:[side,model,m5.at(-1)?.t??now,round(entry),round(stop),confidence].join('|'),entry:round(entry),entryLow:round(entryLow),entryHigh:round(entryHigh),stopLoss:round(stop),target1:round(targets[0]),target2:round(targets[1]),target3:round(targets[2]),target4:round(targets[3]),targetLabels:labels,riskReward:round(rr,2),confluence,technicalRead:ict?.technicalRead||null,priceAction:ict?.priceAction||null,liquidityContext:ict?.ict||null,ict:ict?.ict||null,reason:`CONFLUENCE ${side} ${confidence}/100 — Structure ${components.structure[side]}/24 • Trend ${components.trend[side]}/18 • Momentum ${components.momentum[side]}/14 • PriceAction ${components.priceAction[side]}/16 • Liquidity ${components.liquidity[side]}/12 • Fib ${components.location[side]}/6 • Volatility ${components.volatility[side]}/10`};
}
