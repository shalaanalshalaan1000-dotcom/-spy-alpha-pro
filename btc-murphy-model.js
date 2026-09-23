const round=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;};
function emaSeries(values=[],period=10){if(!values.length)return[];const data=values.filter(Number.isFinite);if(!data.length)return[];const k=2/(period+1);let e=data[0];const out=[e];for(let i=1;i<data.length;i++){e=data[i]*k+e*(1-k);out.push(e);}return out;}
function ema(values=[],period=10){return emaSeries(values,period).at(-1)??null;}
function rsi(values=[],period=14){if(values.length<period+1)return null;let gains=0,losses=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>0)gains+=d;else losses-=d;}if(losses===0)return 100;const rs=(gains/period)/(losses/period||1e-9);return 100-(100/(1+rs));}
function atr(candles=[],period=14){if(candles.length<period+1)return null;const xs=candles.slice(-(period+1)),tr=[];for(let i=1;i<xs.length;i++){const c=xs[i],p=xs[i-1];tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));}return avg(tr.slice(-period));}
function slope(values=[]){if(values.length<2)return 0;return(values.at(-1)-values[0])/Math.max(1,values.length-1);}
function structureScore(candles=[]){const xs=candles.slice(-8);let score=0;for(let i=1;i<xs.length;i++){if(xs[i].high>xs[i-1].high&&xs[i].low>=xs[i-1].low)score++;if(xs[i].low<xs[i-1].low&&xs[i].high<=xs[i-1].high)score--;}return score;}
function candleQuality(c){if(!c)return{bodyShare:0,closePos:.5};const range=Math.max(.01,c.high-c.low);return{bodyShare:Math.abs(c.close-c.open)/range,closePos:(c.close-c.low)/range};}
function volumeRatio(candles=[],lookback=20){if(candles.length<3)return null;const last=candles.at(-1),prior=candles.slice(-(lookback+1),-1).map(c=>Number(c.volume)).filter(v=>Number.isFinite(v)&&v>=0),base=avg(prior);return base>0?Number(last.volume||0)/base:null;}
function trendRead(hour,fifteen,price){
  const h=hour.map(c=>c.close),m=fifteen.map(c=>c.close),e20h=ema(h,20),e50h=ema(h,50),e10m=ema(m,10),e30m=ema(m,30),eh=emaSeries(h,20),em=emaSeries(m,10),slopeH=slope(eh.slice(-6)),slopeM=slope(em.slice(-8)),structH=structureScore(hour),structM=structureScore(fifteen),rsi15=rsi(m,14);
  const bullH=e20h!=null&&e50h!=null&&e20h>e50h&&price>=e20h&&slopeH>0,bearH=e20h!=null&&e50h!=null&&e20h<e50h&&price<=e20h&&slopeH<0;
  const bullM=e10m!=null&&e30m!=null&&e10m>e30m&&slopeM>=0&&structM>=0,bearM=e10m!=null&&e30m!=null&&e10m<e30m&&slopeM<=0&&structM<=0;
  let side=null;if(bullH&&bullM&&!bearH)side='BUY';else if(bearH&&bearM&&!bullH)side='SELL';
  return{side,ema20_1h:round(e20h,2),ema50_1h:round(e50h,2),ema10_15:round(e10m,2),ema30_15:round(e30m,2),slope1h:round(slopeH,3),slope15:round(slopeM,3),structure1h:structH,structure15:structM,rsi15:round(rsi15,1),bull1h:bullH,bear1h:bearH,bull15:bullM,bear15:bearM};
}
function trigger5m(five,side,a5){
  const xs=five.slice(-35);if(xs.length<24)return{ready:false,type:null,breakLevel:null,volumeRatio:null,structure:0};
  const last=xs.at(-1),prev=xs.slice(-14,-1),closes=xs.map(c=>c.close),e20=ema(closes,20),q=candleQuality(last),vr=volumeRatio(xs,20),struct=structureScore(xs),priorHigh=Math.max(...prev.map(c=>c.high)),priorLow=Math.min(...prev.map(c=>c.low));
  const breakout=side==='BUY'?(last.close>priorHigh&&last.close>last.open&&q.bodyShare>=.45&&q.closePos>=.62):(last.close<priorLow&&last.close<last.open&&q.bodyShare>=.45&&q.closePos<=.38);
  const volumeConfirmed=vr==null?false:vr>=1.02;
  const recent=xs.slice(-6),touched=side==='BUY'?Math.min(...recent.map(c=>c.low))<=e20+a5*.20:Math.max(...recent.map(c=>c.high))>=e20-a5*.20;
  const resumed=side==='BUY'?(touched&&last.close>e20&&last.close>xs.at(-2).high&&q.closePos>=.58):(touched&&last.close<e20&&last.close<xs.at(-2).low&&q.closePos<=.42);
  const ready=(breakout&&volumeConfirmed)||(resumed&&(vr==null||vr>=.80));
  return{ready,type:breakout?'BREAKOUT':resumed?'PULLBACK_RESUMPTION':null,breakLevel:round(breakout?(side==='BUY'?priorHigh:priorLow):e20,2),ema20:round(e20,2),structure:struct,bodyShare:round(q.bodyShare,2),closePos:round(q.closePos,2),volumeRatio:round(vr,2),volumeConfirmed,priorHigh:round(priorHigh,2),priorLow:round(priorLow,2)};
}
function timing1m(one,side){const xs=one.slice(-10);if(xs.length<5)return{aligned:false,structure:0,slope:0};const st=structureScore(xs),sl=slope(xs.slice(-5).map(c=>c.close));return{aligned:side==='BUY'?(st>=0&&sl>=0):(st<=0&&sl<=0),structure:st,slope:round(sl,2)};}
function swingLevels(candles,side,price){const xs=candles.slice(-100),out=[];for(let i=2;i<xs.length-2;i++){const c=xs[i];if(side==='BUY'&&c.high>=xs[i-1].high&&c.high>=xs[i-2].high&&c.high>xs[i+1].high&&c.high>=xs[i+2].high&&c.high>price)out.push(c.high);if(side==='SELL'&&c.low<=xs[i-1].low&&c.low<=xs[i-2].low&&c.low<xs[i+1].low&&c.low<=xs[i+2].low&&c.low<price)out.push(c.low);}return[...new Set(out.map(v=>round(v,2)))].sort((a,b)=>side==='BUY'?a-b:b-a);}
function snapTarget(raw,levels,side,a5){const tol=Math.max(25,a5*.65),near=levels.filter(v=>Math.abs(v-raw)<=tol);if(!near.length)return raw;return near.sort((a,b)=>Math.abs(a-raw)-Math.abs(b-raw))[0];}
function orderedTargets(side,entry,raw,levels,a5){const out=[];let prev=entry;const step=Math.max(20,a5*.18);for(const x of raw){let t=snapTarget(x,levels,side,a5);if(side==='BUY'&&t<=prev+step)t=Math.max(x,prev+step);if(side==='SELL'&&t>=prev-step)t=Math.min(x,prev-step);t=round(t,2);out.push(t);prev=t;}return out;}

export function buildBtcMurphySignal(one=[],five=[],fifteen=[],hour=[],ticker={}){
  const price=Number(ticker?.price??one.at(-1)?.close);
  if(!Number.isFinite(price)||one.length<40||five.length<60||fifteen.length<50||hour.length<55)throw new Error('BTC history incomplete for Murphy 1h/15m/5m model');
  const base={symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'MURPHY_FRAMEWORK',confidence:0,scoreMeaning:'SETUP_SCORE_NOT_WIN_PROBABILITY',minConfidence:82,executable:false,executionMode:'SIGNALS_ONLY',timeframe:'1h trend / 15m confirmation / 5m closed-candle execution',price:round(price,2),entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,riskReward:null,trend:'NEUTRAL',murphy:null,targetLabels:[],reason:'Murphy framework is scanning BTC trend, levels, momentum and volume.',updatedAt:new Date().toISOString()};
  const trend=trendRead(hour,fifteen,price);
  if(!trend.side)return{...base,confidence:55,murphy:{trend,volumeAvailable:true},reason:'MURPHY WAIT: 1h and 15m trend are not aligned.'};
  const side=trend.side,a5=atr(five,14)||price*.0018,rsi5=rsi(five.map(c=>c.close),14),trigger=trigger5m(five,side,a5),timing=timing1m(one,side),rsiAligned=side==='BUY'?(rsi5!=null&&rsi5>=50&&rsi5<=76&&trend.rsi15>=50&&trend.rsi15<=78):(rsi5!=null&&rsi5<=50&&rsi5>=24&&trend.rsi15<=50&&trend.rsi15>=22),overextended=side==='BUY'?(rsi5!=null&&rsi5>80):(rsi5!=null&&rsi5<20);
  let score=68;if(Math.abs(trend.structure15)>=2)score+=5;if(Math.abs(trend.structure1h)>=2)score+=4;if(rsiAligned)score+=6;if(trigger.ready)score+=8;if(trigger.type==='BREAKOUT'&&trigger.volumeConfirmed)score+=3;if(trigger.bodyShare>=.55)score+=2;if(timing.aligned)score+=2;if(overextended)score-=12;score=clamp(Math.round(score),0,94);
  const murphy={trend,rsi5:round(rsi5,1),atr5:round(a5,2),trigger,structure5m:trigger.structure,timing1m:timing,volumeAvailable:true,volume5Ratio:trigger.volumeRatio};
  const trendLabel=side==='BUY'?'BULLISH':'BEARISH';
  if(!trigger.ready)return{...base,confidence:score,trend:trendLabel,murphy,reason:'MURPHY WAIT: trend is aligned, but no confirmed 5m breakout/resumption with acceptable volume.'};
  if(!rsiAligned||overextended)return{...base,confidence:Math.min(score,79),trend:trendLabel,murphy,reason:'MURPHY WAIT: momentum is not confirming the trend or BTC is overextended.'};
  const entry=Number(trigger.breakLevel),chase=Math.abs(price-entry),maxChase=Math.max(45,a5*.80);
  if(chase>maxChase)return{...base,confidence:score,trend:trendLabel,murphy,reason:'NO CHASE: BTC moved too far from the confirmed support/resistance trigger.'};
  const recent5=five.slice(-14),recent15=fifteen.slice(-8),swing5=side==='BUY'?Math.min(...recent5.map(c=>c.low)):Math.max(...recent5.map(c=>c.high)),swing15=side==='BUY'?Math.min(...recent15.map(c=>c.low)):Math.max(...recent15.map(c=>c.high)),buffer=Math.max(25,a5*.20);
  let stop=side==='BUY'?Math.min(swing5,swing15)-buffer:Math.max(swing5,swing15)+buffer,minRisk=Math.max(40,price*.00045,a5*.38);if(Math.abs(entry-stop)<minRisk)stop=side==='BUY'?entry-minRisk:entry+minRisk;const risk=Math.abs(entry-stop),maxRisk=Math.max(650,price*.008);
  if(risk>maxRisk)return{...base,confidence:score,trend:trendLabel,murphy,reason:'MURPHY WAIT: structural stop is too wide for this BTC setup.'};
  const dir=side==='BUY'?1:-1,levels=swingLevels(hour.concat(fifteen).concat(five),side,entry),raw=[entry+dir*Math.max(risk*1.25,a5*1.15),entry+dir*Math.max(risk*2,a5*2),entry+dir*Math.max(risk*3,a5*3),entry+dir*Math.max(risk*4,a5*4.2)],[t1,t2,t3,t4]=orderedTargets(side,entry,raw,levels,a5),rr4=Math.abs(t4-entry)/risk,active=score>=82;
  return{...base,status:active?'ACTIVE':'WAIT',action:active?side:'WAIT',side:active?side:null,strategy:trigger.type==='BREAKOUT'?'MURPHY_TREND_BREAKOUT':'MURPHY_PULLBACK_RESUMPTION',confidence:score,trend:trendLabel,murphy,entry:round(active?entry:null,2),stopLoss:round(active?stop:null,2),target1:round(active?t1:null,2),target2:round(active?t2:null,2),target3:round(active?t3:null,2),target4:round(active?t4:null,2),riskReward:active?round(rr4,2):null,targetLabels:['Murphy: first support/resistance objective','Murphy: trend continuation objective','Murphy: extended trend objective','Murphy: final trend extension'],reason:active?`MURPHY CONFIRMED: 1h/15m trend + 5m ${trigger.type} + RSI + volume/support-resistance; score ${score}/100 (not win probability).`:`MURPHY WAIT: setup score ${score}/100 is below 82.`,updatedAt:new Date().toISOString()};
}
