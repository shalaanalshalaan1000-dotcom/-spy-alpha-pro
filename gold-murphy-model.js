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
export const bars1m=s=>barsFromSamples(s,1);
export const bars5m=s=>barsFromSamples(s,5);
export const bars15m=s=>barsFromSamples(s,15);
export const bars60m=s=>barsFromSamples(s,60);

function closedBars(bars,minutes,now){const span=minutes*60000;return bars.filter(b=>b.t+span<=now);}
function avg(values=[]){const xs=values.filter(Number.isFinite);return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function trueRange(bar,prevClose){if(!bar)return 0;if(!Number.isFinite(prevClose))return Math.max(0,bar.high-bar.low);return Math.max(bar.high-bar.low,Math.abs(bar.high-prevClose),Math.abs(bar.low-prevClose));}
function atr(bars=[],period=14){if(!bars.length)return 0;const xs=bars.slice(-(period+1)),tr=[];for(let i=0;i<xs.length;i++)tr.push(trueRange(xs[i],i?xs[i-1].close:NaN));return avg(tr.slice(-period));}
function emaSeries(values=[],period=10){if(!values.length)return[];const k=2/(period+1),out=[];let e=values[0];out.push(e);for(let i=1;i<values.length;i++){e=values[i]*k+e*(1-k);out.push(e);}return out;}
function ema(values=[],period=10){return emaSeries(values,period).at(-1)??null;}
function rsi(values=[],period=14){if(values.length<period+1)return null;let gain=0,loss=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>0)gain+=d;else loss-=d;}if(loss===0)return 100;const rs=(gain/period)/(loss/period||1e-9);return 100-(100/(1+rs));}
function slope(values=[]){if(values.length<2)return 0;return(values.at(-1)-values[0])/Math.max(1,values.length-1);}
function structureScore(bars=[]){const x=bars.slice(-8);let score=0;for(let i=1;i<x.length;i++){if(x[i].high>x[i-1].high&&x[i].low>=x[i-1].low)score++;if(x[i].low<x[i-1].low&&x[i].high<=x[i-1].high)score--;}return score;}
function candleQuality(bar){if(!bar)return{bodyShare:0,closePos:.5};const range=Math.max(.000001,bar.high-bar.low),body=Math.abs(bar.close-bar.open),closePos=(bar.close-bar.low)/range;return{bodyShare:body/range,closePos};}
function normalizeClock(samples=[],now=Date.now()){
  const valid=samples.filter(x=>Number.isFinite(Number(x?.t))&&Number.isFinite(Number(x?.p??x?.price??x?.close)));
  if(!valid.length)return samples;const latest=Math.max(...valid.map(x=>Number(x.t))),skew=latest-now;
  if(Math.abs(skew)<=60000)return samples;return samples.map(x=>Number.isFinite(Number(x?.t))?{...x,t:Number(x.t)-skew}:x);
}
function swingLevels(bars=[],side,price){
  const xs=bars.slice(-80),levels=[];
  for(let i=2;i<xs.length-2;i++){
    const b=xs[i];
    if(side==='BUY'&&b.high>=xs[i-1].high&&b.high>=xs[i-2].high&&b.high>xs[i+1].high&&b.high>=xs[i+2].high&&b.high>price)levels.push(b.high);
    if(side==='SELL'&&b.low<=xs[i-1].low&&b.low<=xs[i-2].low&&b.low<xs[i+1].low&&b.low<=xs[i+2].low&&b.low<price)levels.push(b.low);
  }
  return [...new Set(levels.map(v=>round(v,2)))].sort((a,b)=>side==='BUY'?a-b:b-a);
}
function snapTarget(raw,levels,side,atr5){
  const valid=levels.filter(v=>side==='BUY'?v>raw-atr5*.35:v<raw+atr5*.35);
  if(!valid.length)return raw;const nearest=valid.sort((a,b)=>Math.abs(a-raw)-Math.abs(b-raw))[0];
  return Math.abs(nearest-raw)<=Math.max(.45,atr5*.65)?nearest:raw;
}
function orderedTargets(side,entry,rawTargets,levels,atr5){
  const out=[];let prev=entry;const minStep=Math.max(.35,atr5*.18);
  for(const raw of rawTargets){let t=snapTarget(raw,levels,side,atr5);if(side==='BUY'&&t<=prev+minStep)t=Math.max(raw,prev+minStep);if(side==='SELL'&&t>=prev-minStep)t=Math.min(raw,prev-minStep);t=round(t,3);out.push(t);prev=t;}return out;
}
function trendRead(bars60,bars15,price){
  const c60=bars60.map(b=>b.close),c15=bars15.map(b=>b.close);
  const e20h=ema(c60,20),e50h=ema(c60,50),e10m=ema(c15,10),e30m=ema(c15,30);
  const e20Series=emaSeries(c60,20),e10Series=emaSeries(c15,10);
  const slope60=slope(e20Series.slice(-6)),slope15=slope(e10Series.slice(-8));
  const struct60=structureScore(bars60),struct15=structureScore(bars15),rsi15=rsi(c15,14);
  const bull60=e20h!=null&&e50h!=null&&e20h>e50h&&price>=e20h&&slope60>0;
  const bear60=e20h!=null&&e50h!=null&&e20h<e50h&&price<=e20h&&slope60<0;
  const bull15=e10m!=null&&e30m!=null&&e10m>e30m&&slope15>=0&&struct15>=0;
  const bear15=e10m!=null&&e30m!=null&&e10m<e30m&&slope15<=0&&struct15<=0;
  let side=null;if(bull60&&bull15&&!bear60)side='BUY';else if(bear60&&bear15&&!bull60)side='SELL';
  return{side,ema20_60:round(e20h,3),ema50_60:round(e50h,3),ema10_15:round(e10m,3),ema30_15:round(e30m,3),slope60:round(slope60,4),slope15:round(slope15,4),structure60:struct60,structure15:struct15,rsi15:round(rsi15,1),bull60,bear60,bull15,bear15};
}
function trigger5m(bars=[],side,atr5){
  const xs=bars.slice(-30);if(xs.length<22)return{ready:false,type:null,breakLevel:null,ema20:null,structure:0,bodyShare:0};
  const last=xs.at(-1),prev=xs.slice(-13,-1),closes=xs.map(b=>b.close),e20=ema(closes,20),struct=structureScore(xs),q=candleQuality(last);
  const priorHigh=Math.max(...prev.map(b=>b.high)),priorLow=Math.min(...prev.map(b=>b.low));
  const breakout=side==='BUY'?(last.close>priorHigh&&last.close>last.open&&q.bodyShare>=.45&&q.closePos>=.62):(last.close<priorLow&&last.close<last.open&&q.bodyShare>=.45&&q.closePos<=.38);
  const recent=xs.slice(-5),touched=side==='BUY'?Math.min(...recent.map(b=>b.low))<=e20+atr5*.25:Math.max(...recent.map(b=>b.high))>=e20-atr5*.25;
  const resumed=side==='BUY'?(touched&&last.close>e20&&last.close>xs.at(-2).high&&q.closePos>=.58):(touched&&last.close<e20&&last.close<xs.at(-2).low&&q.closePos<=.42);
  return{ready:breakout||resumed,type:breakout?'BREAKOUT':resumed?'PULLBACK_RESUMPTION':null,breakLevel:round(breakout?(side==='BUY'?priorHigh:priorLow):e20,3),ema20:round(e20,3),structure:struct,bodyShare:round(q.bodyShare,2),closePos:round(q.closePos,2),priorHigh:round(priorHigh,3),priorLow:round(priorLow,3)};
}
function timing1m(bars=[],side){
  const xs=bars.slice(-8);if(xs.length<4)return{aligned:false,structure:0,slope:0};const struct=structureScore(xs),sl=slope(xs.slice(-5).map(b=>b.close));
  return{aligned:side==='BUY'?(struct>=0&&sl>=0):(struct<=0&&sl<=0),structure:struct,slope:round(sl,4)};
}

export function analyzeGoldSignal(samples,rawPrice,now=Date.now()){
  const price=Number(rawPrice),aligned=normalizeClock(samples,now);
  const c1=closedBars(bars1m(aligned),1,now),c5=closedBars(bars5m(aligned),5,now),c15=closedBars(bars15m(aligned),15,now),c60=closedBars(bars60m(aligned),60,now);
  const ready=c1.length>=8&&c5.length>=30&&c15.length>=35&&c60.length>=52;
  const completeness=Math.round(Math.min(1,c1.length/8,c5.length/30,c15.length/35,c60.length/52)*100);
  const base={status:ready?'WAIT':'COLLECTING',action:'WAIT',candidateAction:'WAIT',side:null,strategy:'MURPHY_FRAMEWORK',confidence:0,scoreMeaning:'SETUP_SCORE_NOT_WIN_PROBABILITY',readingCompleteness:completeness,barCount:c1.length,barCount5m:c5.length,barCount15m:c15.length,barCount60m:c60.length,sampleCount:aligned.length,modelTimeframes:{primaryTrend:'60m',trendConfirmation:'15m',execution:'5m closed candle',timing:'1m secondary only'},price:round(price,3),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,contextBias:'NEUTRAL',murphy:null,momentum:null,reason:ready?'Murphy framework ready — scanning trend + support/resistance + momentum':'جمع بيانات كافية لـ 60m / 15m / 5m',updatedAt:new Date(now).toISOString()};
  if(!Number.isFinite(price)||price<=0||!ready)return base;

  const trend=trendRead(c60,c15,price);
  if(!trend.side)return{...base,confidence:55,contextBias:'NEUTRAL',murphy:{trend,volumeAvailable:false},momentum:{trend,volumeAvailable:false},reason:'MURPHY WAIT — 60m/15m trend alignment is not clear'};

  const side=trend.side,atr5=Math.max(.20,atr(c5,14)),atr15=Math.max(.30,atr(c15,14)),rsi5=rsi(c5.map(b=>b.close),14),trigger=trigger5m(c5,side,atr5),timing=timing1m(c1,side);
  const rsiAligned=side==='BUY'?(rsi5!=null&&rsi5>=50&&rsi5<=76&&trend.rsi15>=50&&trend.rsi15<=78):(rsi5!=null&&rsi5<=50&&rsi5>=24&&trend.rsi15<=50&&trend.rsi15>=22);
  const overextended=side==='BUY'?(rsi5!=null&&rsi5>80):(rsi5!=null&&rsi5<20);
  let score=58;
  score+=10;
  if(Math.abs(trend.structure15)>=2)score+=5;
  if(Math.abs(trend.structure60)>=2)score+=4;
  if(rsiAligned)score+=6;
  if(trigger.ready)score+=10;
  if(trigger.type==='BREAKOUT')score+=3;
  if(trigger.bodyShare>=.55)score+=3;
  if(timing.aligned)score+=3;
  if(overextended)score-=10;
  score=clamp(Math.round(score),0,94);
  const murphy={trend,rsi5:round(rsi5,1),atr5:round(atr5,3),atr15:round(atr15,3),trigger,structure5m:trigger.structure,timing1m:timing,volumeAvailable:false,volumePolicy:'Not used because the XAUUSD feed does not provide reliable centralized volume'};
  if(!trigger.ready)return{...base,confidence:score,contextBias:side,murphy,momentum:murphy,reason:'MURPHY WAIT — trend is aligned, but no confirmed 5m breakout or pullback resumption'};
  if(!rsiAligned||overextended)return{...base,confidence:Math.min(score,79),contextBias:side,murphy,momentum:murphy,reason:'MURPHY WAIT — momentum does not confirm the trend or price is overextended'};

  const triggerLevel=Number(trigger.breakLevel),chase=Math.abs(price-triggerLevel),maxChase=Math.max(.70,atr5*.75);
  if(chase>maxChase)return{...base,confidence:score,contextBias:side,murphy,momentum:murphy,reason:'NO CHASE — confirmed setup already moved too far from support/resistance trigger'};

  const recent5=c5.slice(-12),recent15=c15.slice(-8);
  const swing5=side==='BUY'?Math.min(...recent5.map(b=>b.low)):Math.max(...recent5.map(b=>b.high));
  const swing15=side==='BUY'?Math.min(...recent15.map(b=>b.low)):Math.max(...recent15.map(b=>b.high));
  const buffer=clamp(atr5*.22,.30,1.10);
  let stop=side==='BUY'?Math.min(swing5,swing15)-buffer:Math.max(swing5,swing15)+buffer;
  const minRisk=Math.max(.55,atr5*.42),risk0=Math.abs(triggerLevel-stop);
  if(risk0<minRisk)stop=side==='BUY'?triggerLevel-minRisk:triggerLevel+minRisk;
  const risk=Math.abs(triggerLevel-stop);
  if(!(risk>0))return{...base,confidence:score,contextBias:side,murphy,momentum:murphy,reason:'MURPHY WAIT — invalid structural stop'};

  const direction=side==='BUY'?1:-1,levels=swingLevels(c60.concat(c15).concat(c5),side,triggerLevel);
  const rawTargets=[triggerLevel+direction*Math.max(risk*1.25,atr5*1.15),triggerLevel+direction*Math.max(risk*2.0,atr5*2.0),triggerLevel+direction*Math.max(risk*3.0,atr5*3.0),triggerLevel+direction*Math.max(risk*4.0,atr5*4.2)];
  const [t1,t2,t3,t4]=orderedTargets(side,triggerLevel,rawTargets,levels,atr5),half=clamp(atr5*.24,.35,1.25),rr4=Math.abs(t4-triggerLevel)/risk;
  const setupId=['MURPHY',side,c5.at(-1)?.t,trigger.type,round(triggerLevel,2),round(stop,2)].join('|');
  return{...base,status:'CANDIDATE',candidateAction:side,side,strategy:trigger.type==='BREAKOUT'?'MURPHY_TREND_BREAKOUT':'MURPHY_PULLBACK_RESUMPTION',confidence:score,contextBias:side,oneMinuteConfirmed:timing.aligned,setupId,structureAt:c5.at(-1)?.t??now,murphy,momentum:murphy,prediction:{side,confidence:score,scoreGap:side==='BUY'?score-50:50-score,rsi5:round(rsi5,1),triggerType:trigger.type},entry:round(triggerLevel,3),entryLow:round(triggerLevel-half,3),entryHigh:round(triggerLevel+half,3),stopLoss:round(stop,3),target1:t1,target2:t2,target3:t3,target4:t4,riskReward:round(rr4,2),targetLabels:['Murphy: first resistance/support objective','Murphy: trend continuation objective','Murphy: extended trend objective','Murphy: final trend extension'],reason:`MURPHY CONFIRMED — 60m/15m trend + 5m ${trigger.type} + RSI confirmation + support/resistance; score ${score}/100 (setup quality, not win probability)`};
}
