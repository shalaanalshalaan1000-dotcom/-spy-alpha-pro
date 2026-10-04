import {validTrendContinuation,continuationImageSupport} from './ict-trend-continuation.js';
import { analyzeGoldSignal as analyzeClassicModel } from './gold-signal-model.js';
import { analyzeGoldSignal as analyzeIctModel } from './gold-ict-swing-model.js';
import { detectImportantCandles } from './important-candles.js';

const n=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=3)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function minuteBars(samples=[]){
  const buckets=new Map();
  for(const s of samples){
    const t=n(s?.t),p=n(s?.p??s?.price??s?.close); if(t==null||p==null||p<=0)continue;
    const key=Math.floor(t/60000)*60000,o=n(s?.open),h=n(s?.high),l=n(s?.low),c=n(s?.close),volume=n(s?.volume),old=buckets.get(key);
    if(!old){const open=o??p,high=h??p,low=l??p,close=c??p;buckets.set(key,{t:key,open,high,low,close,volume:volume!=null&&volume>=0?volume:null});}
    else{old.high=Math.max(old.high,h??p);old.low=Math.min(old.low,l??p);old.close=c??p;if(volume!=null&&volume>=0)old.volume=volume;}
  }
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}
function aggregate(bars,minutes){
  const span=minutes*60000,buckets=new Map();
  for(const b of bars){const key=Math.floor(b.t/span)*span,old=buckets.get(key),vol=n(b.volume);if(!old)buckets.set(key,{t:key,open:b.open,high:b.high,low:b.low,close:b.close,volume:vol!=null&&vol>=0?vol:null});else{old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.close=b.close;if(vol!=null&&vol>=0)old.volume=(n(old.volume)||0)+vol;}}
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}
function closed(bars,minutes,now){const span=minutes*60000;return bars.filter(b=>b.t+span<=now);}
function cleanBars(bars=[]){return (Array.isArray(bars)?bars:[]).map(b=>({t:n(b?.t),open:n(b?.open),high:n(b?.high),low:n(b?.low),close:n(b?.close),volume:n(b?.volume)})).filter(b=>b.t!=null&&[b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.close>0).sort((a,b)=>a.t-b.t);}
function aggregateTradingDays(bars=[],size=2){const x=cleanBars(bars),out=[];for(let i=Math.max(0,x.length%size);i+size-1<x.length;i+=size){const g=x.slice(i,i+size);out.push({t:g[0].t,open:g[0].open,high:Math.max(...g.map(b=>b.high)),low:Math.min(...g.map(b=>b.low)),close:g.at(-1).close,volume:g.some(b=>n(b.volume)!=null)?g.reduce((a,b)=>a+(n(b.volume)||0),0):null});}return out;}
function aggregateCalendarBars(bars=[],mode='week'){const x=cleanBars(bars),m=new Map();for(const b of x){const d=new Date(b.t);let key;if(mode==='month')key=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);else{const day=(d.getUTCDay()+6)%7;key=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day);}const old=m.get(key);if(!old)m.set(key,{t:key,open:b.open,high:b.high,low:b.low,close:b.close,volume:n(b.volume)});else{old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.close=b.close;if(n(b.volume)!=null)old.volume=(n(old.volume)||0)+n(b.volume);}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function timeframeRead(rawBars=[],label='TF'){const all=cleanBars(rawBars);if(all.length<3)return{label,side:'NEUTRAL',strength:0,bars:all.length,closedStructure:'NEUTRAL',currentCandle:'NEUTRAL',momentum:0,ready:false};const closedBars=all.length>1?all.slice(0,-1):all,dir=structureDir(closedBars),mom=lastMomentum(closedBars,Math.min(3,Math.max(2,closedBars.length-1))),lastClosed=closedBars.at(-1),live=candleBias(all.slice(-2));let buy=0,sell=0;if(dir>0)buy+=3;else if(dir<0)sell+=3;if(mom>0)buy+=2;else if(mom<0)sell+=2;if(lastClosed){if(lastClosed.close>lastClosed.open)buy+=1;else if(lastClosed.close<lastClosed.open)sell+=1;}if(live.side==='BUY')buy+=1;else if(live.side==='SELL')sell+=1;const delta=buy-sell,side=delta>=2?'BUY':delta<=-2?'SELL':'NEUTRAL';return{label,side,strength:Math.abs(delta),bars:all.length,closedStructure:sideOf(dir),currentCandle:live.side,currentPattern:live.pattern,momentum:round(mom,3),ready:true,lastClosed:round(lastClosed?.close),currentOpen:round(all.at(-1)?.open),currentClose:round(all.at(-1)?.close)};}
function buildTopDownContext({m1,m5,m15,h1,h4},higherTimeframes={}){const d1=cleanBars(higherTimeframes?.D1||[]),d2Raw=cleanBars(higherTimeframes?.D2||[]),w1Raw=cleanBars(higherTimeframes?.W1||[]),mn1Raw=cleanBars(higherTimeframes?.MN1||[]),d2=d2Raw.length>=6?d2Raw:aggregateTradingDays(d1,2),w1=w1Raw.length>=6?w1Raw:aggregateCalendarBars(d1,'week'),mn1=mn1Raw.length>=4?mn1Raw:aggregateCalendarBars(d1,'month');const reads={MN1:timeframeRead(mn1,'MN1'),W1:timeframeRead(w1,'W1'),D2:timeframeRead(d2,'D2'),D1:timeframeRead(d1,'D1'),H4:timeframeRead(h4,'H4'),H1:timeframeRead(h1,'H1'),M15:timeframeRead(m15,'M15'),M5:timeframeRead(m5,'M5'),M1:timeframeRead(m1,'M1')},weights={MN1:5,W1:5,D2:4,D1:4,H4:3,H1:2,M15:1};let buy=0,sell=0;for(const [tf,w] of Object.entries(weights)){if(reads[tf]?.side==='BUY')buy+=w;else if(reads[tf]?.side==='SELL')sell+=w;}const macroKeys=['MN1','W1','D2','D1'],macroReady=reads.D1.bars>=20&&reads.D2.bars>=8&&reads.W1.bars>=6&&reads.MN1.bars>=3;const mwAligned=reads.MN1.side!=='NEUTRAL'&&reads.MN1.side===reads.W1.side?reads.MN1.side:null;const diff=buy-sell;let side=mwAligned||(diff>=4?'BUY':diff<=-4?'SELL':'NEUTRAL');const macroAligned=macroKeys.filter(tf=>reads[tf].side===side).length,macroOpposed=macroKeys.filter(tf=>reads[tf].side!=='NEUTRAL'&&reads[tf].side!==side).length,intradayKeys=['H4','H1','M15'],intradayAligned=intradayKeys.filter(tf=>reads[tf].side===side).length,m5Aligned=reads.M5.side===side;return{ready:macroReady,side,buyWeight:buy,sellWeight:sell,lead:Math.abs(diff),macroAligned,macroOpposed,intradayAligned,m5Aligned,requiredIntradayAligned:1,reads,sources:{D1:higherTimeframes?.D1?.length?'TRADINGVIEW_D1':'NONE',D2:d2Raw.length>=6?'TRADINGVIEW_2D':'DERIVED_D1',W1:w1Raw.length>=6?'TRADINGVIEW_W1':'DERIVED_D1',MN1:mn1Raw.length>=4?'TRADINGVIEW_MN1':'DERIVED_D1'}};}

function buildMonth6Support(topDown={},ict={},side=null){
  const reads=topDown?.reads||{},sequence=['MN1','W1','D1','H4'];
  const readSides=Object.fromEntries(sequence.map(tf=>[tf,reads[tf]?.side||'NEUTRAL']));
  const aligned=side?sequence.filter(tf=>readSides[tf]===side).length:0;
  const opposed=side?sequence.filter(tf=>readSides[tf]!=='NEUTRAL'&&readSides[tf]!==side).length:0;
  const range=ict?.rangeContext||{},pdLocation=range.location||ict?.location||'UNKNOWN';
  const pdPreferred=side==='BUY'?pdLocation==='DISCOUNT':side==='SELL'?pdLocation==='PREMIUM':false;
  const poi=ict?.poi||null,draw=ict?.primaryLiquidity||ict?.mainLiquidity||ict?.secondaryLiquidity||null;
  return{
    source:'ICT_MONTH_6_SWING_TRADING',mode:'SUPPORT_ONLY',advisoryOnly:true,blocksExecution:false,
    sequence:'MN1 > W1 > D1 > H4',side:side||'WAIT',aligned,opposed,reads:readSides,
    pdLocation,pdPreferred,poiType:poi?.type||null,
    hasFairValueGap:Boolean(ict?.originFvg||poi?.fvg),hasOrderBlock:Boolean(ict?.orderBlock||poi?.orderBlock),
    drawOnLiquidity:draw?{label:draw.label||draw.role||'EXTERNAL_LIQUIDITY',price:n(draw.price??draw.level),sourceTimeframe:draw.sourceTimeframe||null}:null,
    htfConflict:false,
    note:'Month 6 HTF and PD Array context is support-only; it never vetoes a valid M5 ICT external-liquidity setup.'
  };
}

function rangeStats(bars=[],count=20){const x=cleanBars(bars).slice(-count);if(!x.length)return{bars:0,high:null,low:null,mid:null};const high=Math.max(...x.map(b=>b.high)),low=Math.min(...x.map(b=>b.low));return{bars:x.length,high:round(high),low:round(low),mid:round((high+low)/2)};}
function pdReference(bar,price,label){const high=n(bar?.high),low=n(bar?.low);if(high==null||low==null||!(high>low)||!Number.isFinite(price))return{label,ready:false,high:null,low:null,equilibrium:null,location:'UNKNOWN',proxy:true};const equilibrium=(high+low)/2;return{label,ready:true,high:round(high),low:round(low),equilibrium:round(equilibrium),location:price>equilibrium?'PREMIUM':price<equilibrium?'DISCOUNT':'EQUILIBRIUM',proxy:true};}
function uniqueLevels(rows=[]){const out=[];for(const row of rows.filter(x=>Number.isFinite(n(x?.price))).sort((a,b)=>a.price-b.price)){if(!out.some(x=>Math.abs(x.price-row.price)<.05))out.push({...row,price:round(row.price)});}return out;}
export function buildMonth5Context({price,side,ict,higherTimeframes={}}={}){
  const px=n(price),validSide=['BUY','SELL'].includes(side)?side:null;
  const d1=cleanBars(higherTimeframes?.D1||[]),w1=cleanBars(higherTimeframes?.W1||[]),mn1=cleanBars(higherTimeframes?.MN1||[]);
  const closedD1=d1.length>1?d1.slice(0,-1):d1,closedW1=w1.length>1?w1.slice(0,-1):w1,closedMN1=mn1.length>1?mn1.slice(0,-1):mn1;
  const d20=rangeStats(closedD1,20),d40=rangeStats(closedD1,40),d60=rangeStats(closedD1,60),d63=rangeStats(closedD1,63),d126=rangeStats(closedD1,126),d252=rangeStats(closedD1,252);
  const prevDay=closedD1.at(-1)||null,prevWeek=closedW1.at(-1)||null,prevMonth=closedMN1.at(-1)||null;
  const buyStops=uniqueLevels([
    {label:'RECENT_WEEK_HIGH',price:n(prevWeek?.high),basis:'SHORT_TERM_REFERENCE'},
    {label:'PREVIOUS_MONTH_HIGH',price:n(prevMonth?.high),basis:'INSTITUTIONAL_REFERENCE'},
    {label:'3M_HIGH',price:d63.high,basis:'OPEN_FLOAT'},
    {label:'6M_HIGH',price:d126.high,basis:'OPEN_FLOAT'},
    {label:'12M_HIGH',price:d252.high,basis:'OPEN_FLOAT'}
  ]);
  const sellStops=uniqueLevels([
    {label:'RECENT_WEEK_LOW',price:n(prevWeek?.low),basis:'SHORT_TERM_REFERENCE'},
    {label:'PREVIOUS_MONTH_LOW',price:n(prevMonth?.low),basis:'INSTITUTIONAL_REFERENCE'},
    {label:'3M_LOW',price:d63.low,basis:'OPEN_FLOAT'},
    {label:'6M_LOW',price:d126.low,basis:'OPEN_FLOAT'},
    {label:'12M_LOW',price:d252.low,basis:'OPEN_FLOAT'}
  ]);
  const drawCandidates=validSide==='BUY'?buyStops.filter(x=>px!=null&&x.price>px).sort((a,b)=>a.price-b.price):validSide==='SELL'?sellStops.filter(x=>px!=null&&x.price<px).sort((a,b)=>b.price-a.price):[];
  const sweep=ict?.legSweep||ict?.sweep||null,sweepLevel=n(sweep?.level),external=Boolean(sweep&&sweep?.liquidityClass==='EXTERNAL');
  const rejected=Boolean(external&&sweepLevel!=null&&px!=null&&(validSide==='BUY'?px>sweepLevel:validSide==='SELL'?px<sweepLevel:false));
  const structureShift=Boolean(ict?.hasShift||ict?.hasDisplacement||ict?.mss||ict?.displacement);
  const retested=Boolean(ict?.retest||ict?.trendContinuation?.retested||ict?.entryMode==='ORIGIN_FVG_RETEST'||ict?.hasIfvgRetest);
  return{
    version:'ICT_MONTH5_CONTEXT_V1',advisoryOnly:true,executionGate:false,confidenceBonus:0,source:'ICT Monthly Mentorship Month 5',
    quarterlyShift:{lookBackTradingDays:[20,40,60],ranges:{d20,d40,d60},castForwardTradingDays:[20,40,60],projectedLimitTradingDays:60,anchorResetRule:'NEW_HIGH_OR_NEW_LOW',anticipationOnly:true},
    institutionalSwing:{available:external,sweepName:sweep?.name||null,level:round(sweepLevel),rejected,structureShift,retested,confirmed:Boolean(external&&rejected&&structureShift&&retested)},
    openFloat:{buyStops,sellStops,draw:drawCandidates[0]?{...drawCandidates[0],side:validSide==='BUY'?'BSL':'SSL',derived:true}:null},
    pdArrays:{monthly:pdReference(prevMonth,px,'MONTHLY'),weekly:pdReference(prevWeek,px,'WEEKLY'),daily:pdReference(prevDay,px,'DAILY'),proxyNote:'Previous closed period range is used as a lightweight premium/discount reference; it is advisory only.'},
    intermarket:{used:false,reason:'No DXY/bonds feed is added here; Month 5 intermarket relationships are not fabricated or used as an entry gate.'}
  };
}

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
function liquidityHeatmap(bars,price,atr1){
  const x=bars.slice(-240);if(price==null||x.length<30)return{mode:'COLLECTING',free:true,orderBook:false,mbo:false,source:'TRADINGVIEW_OANDA_1M',volumeAvailable:false,zones:[],nearestAbove:null,nearestBelow:null};
  const step=clamp((atr1||.5)*.40,.25,1),positiveVolumes=x.map(b=>n(b.volume)).filter(v=>v!=null&&v>0),volumeAvailable=positiveVolumes.length>=Math.max(10,Math.floor(x.length*.20)),volumeMean=volumeAvailable?(mean(positiveVolumes.slice(-120))||1):1,bins=new Map();
  const put=(px,kind,rejection,volScale)=>{if(!Number.isFinite(px))return;const key=Math.round(px/step)*step,id=key.toFixed(3),z=bins.get(id)||{price:key,score:0,touches:0,highTouches:0,lowTouches:0,upperRejection:0,lowerRejection:0,volumeScore:0};const base=1.35+Math.min(3,Math.max(0,rejection)*3),w=base*volScale;z.score+=w;z.touches+=1;z.volumeScore+=volScale;if(kind==='HIGH'){z.highTouches+=1;z.upperRejection+=rejection;}else{z.lowTouches+=1;z.lowerRejection+=rejection;}bins.set(id,z);};
  for(const b of x){const range=Math.max(.001,b.high-b.low),upper=Math.max(0,b.high-Math.max(b.open,b.close))/range,lower=Math.max(0,Math.min(b.open,b.close)-b.low)/range,vol=n(b.volume),volScale=volumeAvailable&&vol!=null&&vol>0?clamp(vol/volumeMean,.5,3):1;put(b.high,'HIGH',upper,volScale);put(b.low,'LOW',lower,volScale);}
  const raw=[...bins.values()].filter(z=>Math.abs(z.price-price)<=Math.max(8,(atr1||.5)*14)).sort((a,b)=>b.score-a.score),maxScore=raw[0]?.score||1;
  const zones=raw.slice(0,12).map(z=>({...z,price:round(z.price),score:round(z.score,2),intensity:Math.round(clamp(z.score/maxScore*100,0,100)),distance:round(Math.abs(z.price-price),2),upperRejection:round(z.upperRejection,2),lowerRejection:round(z.lowerRejection,2),volumeScore:round(z.volumeScore,2)}));
  const nearestAbove=zones.filter(z=>z.price>price).sort((a,b)=>a.price-b.price)[0]||null,nearestBelow=zones.filter(z=>z.price<price).sort((a,b)=>b.price-a.price)[0]||null;
  return{mode:volumeAvailable?'CANDLE_VOLUME_PROXY':'PRICE_ACTION_PROXY',free:true,orderBook:false,mbo:false,source:'TRADINGVIEW_OANDA_1M',volumeAvailable,lookbackMinutes:x.length,binSize:round(step,2),nearestAbove,nearestBelow,zones:zones.slice(0,8),note:'Free liquidity proxy from repeated highs/lows, wick rejection and TradingView candle volume when available; not Level 2/MBO.'};
}
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
function activeConfirmedLiquidityReversal(key){
  if(!key||!['BUY','SELL'].includes(key.side)||key.status!=='CONFIRMED'||Number(key.score)<88||Number(key.ageBars)>4)return false;
  const patterns=Array.isArray(key.patterns)?key.patterns:[key.pattern].filter(Boolean);
  return patterns.some(x=>['LIQUIDITY_SWEEP','FAILED_BREAKDOWN','FAILED_BREAKOUT'].includes(x));
}
function liquidityReversalInvalidated(key,lastM5){
  if(!key||!lastM5)return false;
  const close=n(lastM5.close),low=n(key.low),high=n(key.high);
  if(close==null)return false;
  if(key.side==='BUY')return low!=null&&close<low;
  if(key.side==='SELL')return high!=null&&close>high;
  return false;
}

export function analyzeGoldSignal(samples,rawPrice,now=Date.now(),higherTimeframes={}){
  const price=n(rawPrice),classic=analyzeClassicModel(samples,rawPrice,now),ict=analyzeIctModel(samples,rawPrice,now,higherTimeframes);
  const m1all=minuteBars(samples),m1=closed(m1all,1,now),m5=closed(aggregate(m1all,5),5,now),m15=closed(aggregate(m1all,15),15,now),h1=closed(aggregate(m1all,60),60,now),h4=closed(aggregate(m1all,240),240,now);
  const monthlyBars=cleanBars(higherTimeframes?.MN1||[]),weeklyBars=cleanBars(higherTimeframes?.W1||[]),dailyBars=cleanBars(higherTimeframes?.D1||[]);
  const weekend=[0,6].includes(new Date(now).getUTCDay());
  const monthlyClosed=monthlyBars.at(-2)||monthlyBars.at(-1)||null;
  const weeklyClosed=weekend?weeklyBars.at(-1)||null:weeklyBars.at(-2)||weeklyBars.at(-1)||null;
  const dailyClosed=dailyBars.at(-1)||null;
  const prevMonth=monthlyBars.at(-2)||null,prevWeek=weeklyBars.at(-2)||null,prevDay=dailyBars.at(-2)||null;
  const h4p=pivots(h4.slice(-80),2,2),h1p=pivots(h1.slice(-120),2,2),m15p=pivots(m15.slice(-160),2,2),m5p=pivots(m5.slice(-180),2,2),m1p=pivots(m1.slice(-240),2,2);
  const lauraContext={
    monthly:{closed:monthlyClosed},
    weekly:{closed:weeklyClosed},
    daily:{closed:dailyClosed},
    h4:{closed:h4.at(-1)||null},
    h1:{closed:h1.at(-1)||null},
    m15:{closed:m15.at(-1)||null},
    m5:{closed:m5.at(-1)||null},
    m1:{closed:m1.at(-1)||null},
    levels:{
      pmh:prevMonth?.high??null,pml:prevMonth?.low??null,
      pwh:prevWeek?.high??null,pwl:prevWeek?.low??null,
      pdh:prevDay?.high??null,pdl:prevDay?.low??null,
      h4SwingHigh:h4p.highs.at(-1)?.price??null,h4SwingLow:h4p.lows.at(-1)?.price??null,
      h1SwingHigh:h1p.highs.at(-1)?.price??null,h1SwingLow:h1p.lows.at(-1)?.price??null,
      m15SwingHigh:m15p.highs.at(-1)?.price??null,m15SwingLow:m15p.lows.at(-1)?.price??null,
      m5SwingHigh:m5p.highs.at(-1)?.price??null,m5SwingLow:m5p.lows.at(-1)?.price??null,
      m1SwingHigh:m1p.highs.at(-1)?.price??null,m1SwingLow:m1p.lows.at(-1)?.price??null
    },
    updatedAt:new Date(now).toISOString()
  };
  const base={status:'COLLECTING',action:'WAIT',candidateAction:'WAIT',side:null,strategy:'MULTI_MODEL_CONFLUENCE',tradeStyle:'MULTI_MODEL_CONFLUENCE',confidence:0,price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,oneMinuteConfirmed:false,contextBias:'NEUTRAL',sampleCount:samples.length,modelTimeframes:{macro:'MN1/W1/D2/D1',context:'H4/H1/M15',setup:'M5 multi-model confluence',timing:'M1'},confluence:null,importantCandles:null,technicalRead:ict?.technicalRead||null,priceAction:ict?.priceAction||null,liquidityContext:ict?.ict||null,ict:ict?.ict||null,lauraContext,month5Context:null,updatedAt:new Date(now).toISOString(),reason:'Building multi-model context'};
  if(price==null||m1.length<45||m5.length<24||m15.length<16||h1.length<6)return base;

  const bars={m1,m5,m15,h1,h4};const topDown=buildTopDownContext(bars,higherTimeframes);base.multiTimeframe=topDown;if(!topDown.ready)return{...base,status:'COLLECTING',reason:'TOP_DOWN COLLECTING — waiting for daily/2D/weekly/monthly context before any gold signal'};
  const externalSweep=ict?.ict?.legSweep||ict?.ict?.sweep||null;
  const externalNames=new Set(['pdh','pdl','pwh','pwl','asiaHigh','asiaLow','londonHigh','londonLow','nyHigh','nyLow']);
  const externalSweepValid=Boolean(externalSweep&&externalNames.has(String(externalSweep.name||''))&&externalSweep.liquidityClass==='EXTERNAL');
  const ictSide=['BUY','SELL'].includes(ict?.candidateAction)?ict.candidateAction:null;
  const month6Support=buildMonth6Support(topDown,ict?.ict,ictSide);
  topDown.month6Support=month6Support;
  const month5Context=buildMonth5Context({price,side:ictSide,ict:ict?.ict,higherTimeframes});
  base.month5Context=month5Context;
  const trendContinuationValid=validTrendContinuation(ict?.ict,ictSide,now);
  const ictTradeStyle=trendContinuationValid?'ICT_ONLY_TREND_CONTINUATION':'ICT_ONLY_EXTERNAL_LIQUIDITY';
  const ictCandidate=Boolean(ict?.status==='CANDIDATE'&&ictSide&&(externalSweepValid||trendContinuationValid));
  if(!ictCandidate){
    return{
      ...base,
      status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,
      strategy:'ICT_EXTERNAL_LIQUIDITY_ONLY',tradeStyle:ictTradeStyle,
      confidence:0,signalConfidence:0,contextBias:topDown.side,
      ict:ict?.ict||null,liquidityContext:ict?.ict||null,
      technicalRead:ict?.technicalRead||null,priceAction:ict?.priceAction||null,
      multiTimeframe:topDown,
      confluence:{version:ictTradeStyle,selectedSide:null,scores:{BUY:0,SELL:0},lead:0,multiTimeframe:topDown,liquidity:{externalSweep:externalSweep||null},legacyModels:null},
      reason:ict?.reason||'ICT EXTERNAL WAIT — no valid PWH/PWL, PDH/PDL or session High/Low setup'
    };
  }
  const opposite=ictSide==='BUY'?'SELL':'BUY';
  const weeklySide=topDown.reads?.W1?.side||'NEUTRAL',dailySide=topDown.reads?.D1?.side||'NEUTRAL';
  month6Support.htfConflict=weeklySide===opposite&&dailySide===opposite;
  month6Support.htfConflictFrames=month6Support.htfConflict?['W1','D1']:[];
  const imageSupport=continuationImageSupport(ict?.ict,ictSide,clamp(Math.round(Number(ict?.confidence)||0),0,100),now);
  const ictConfidence=imageSupport.confidence;
  const ictConfluence={
    version:ictTradeStyle,
    imageSupport,
    selectedSide:ictSide,
    scores:{BUY:ictSide==='BUY'?ictConfidence:0,SELL:ictSide==='SELL'?ictConfidence:0},
    lead:ictConfidence,
    multiTimeframe:topDown,
    month6Support,
    month5Context,
    liquidity:{externalSweep},
    sequence:ict?.ict?.contextSequence||null,
    originFvg:ict?.ict?.originFvg||ict?.ict?.poi?.fvg||null,
    orderBlock:ict?.ict?.orderBlock||ict?.ict?.poi?.orderBlock||null,
    legacyModels:null
  };
  return{
    ...ict,
    strategy:ict?.strategy||'ICT_EXTERNAL_LIQUIDITY',
    tradeStyle:ictTradeStyle,
    confidence:ictConfidence,signalConfidence:ictConfidence,
    confluence:ictConfluence,
    multiTimeframe:topDown,
    month5Context,
    contextBias:ictSide,
    reason:(trendContinuationValid?`ICT ONLY — H4/H1 trend → M5 displacement → FVG → closed M5 retest; optional image support +${imageSupport.bonus}/100; ${ict?.reason||''}`:`ICT ONLY — external ${String(externalSweep?.name||'').toUpperCase()} liquidity event → MSS/displacement → FVG/OB; ${ict?.reason||'setup confirmed'}`)+` | M6 SUPPORT ONLY: ${month6Support.aligned}/4 HTF aligned • PD ${month6Support.pdLocation}${month6Support.pdPreferred?' preferred':''}${month6Support.htfConflict?' • W1/D1 conflict noted, not vetoed':''}`
  };const importantM5=detectImportantCandles(m5,{timeframe:'5m',lookback:30}),importantM15=detectImportantCandles(m15,{timeframe:'15m',lookback:24}),importantM1=detectImportantCandles(m1,{timeframe:'1m',lookback:30});base.importantCandles={primary:importantM5.primary||importantM15.primary||importantM1.primary,m5:importantM5,m15:importantM15,m1:importantM1,closedOnly:true};const atr1=atr(m1,14)||.5,atr5=atr(m5,14)||1.5,dir1h=structureDir(h1),dir15=structureDir(m15),dir5=structureDir(m5),tech=ict?.technicalRead||{},ind=tech?.indicators||{},fib=fibonacciLocation(h1,price),candle=candleBias(m5),breakout=breakoutBias(m5,price,atr5),sweepBuy=recentSweep(m5,'BUY')||recentSweep(m1,'BUY'),sweepSell=recentSweep(m5,'SELL')||recentSweep(m1,'SELL'),heatmap=liquidityHeatmap(m1,price,atr1);
  const components={structure:componentBucket(),trend:componentBucket(),momentum:componentBucket(),priceAction:componentBucket(),liquidity:componentBucket(),location:componentBucket(),volatility:componentBucket()};

  add(components.structure,sideOf(dir1h),6,'1h structure');add(components.structure,sideOf(dir15),10,'15m structure');add(components.structure,sideOf(dir5),8,'5m structure');
  const c5=m5.map(b=>b.close),c15=m15.map(b=>b.close),ema20_5=ema(c5,20),ema50_5=ema(c5,50),ema10_15=ema(c15,10),ema20_15=ema(c15,20),mom5=lastMomentum(m5,4),mom15=lastMomentum(m15,3);
  if(ema20_5!=null&&ema50_5!=null)add(components.trend,ema20_5>ema50_5?'BUY':'SELL',7,'5m EMA trend');if(ema10_15!=null&&ema20_15!=null)add(components.trend,ema10_15>ema20_15?'BUY':'SELL',7,'15m EMA trend');if(mom15!==0)add(components.trend,mom15>0?'BUY':'SELL',4,'15m slope');
  const rsi=n(ind?.rsi14);if(rsi!=null){if(rsi>=54&&rsi<=74)add(components.momentum,'BUY',4,'RSI bullish');else if(rsi<=46&&rsi>=26)add(components.momentum,'SELL',4,'RSI bearish');}
  const macdSide=ind?.macd?.bias;if(['BUY','SELL'].includes(macdSide))add(components.momentum,macdSide,5,'MACD');const stochSide=ind?.stochastic533?.bias;if(['BUY','SELL'].includes(stochSide))add(components.momentum,stochSide,2,'Stochastic');if(mom5!==0)add(components.momentum,mom5>0?'BUY':'SELL',3,'5m momentum');
  add(components.priceAction,candle.side,candle.strength,`candle ${candle.pattern}`);add(components.priceAction,breakout.side,breakout.strength,breakout.type||'breakout');const keyCandle=importantM5.primary;if(keyCandle&&keyCandle.ageBars<=2&&['BUY','SELL'].includes(keyCandle.side)&&keyCandle.score>=66){add(components.priceAction,keyCandle.side,keyCandle.score>=82?5:3,`important candle ${keyCandle.pattern}`);if(keyCandle.patterns?.some(x=>x==='LIQUIDITY_SWEEP'||x==='FAILED_BREAKOUT'||x==='FAILED_BREAKDOWN'))add(components.liquidity,keyCandle.side,2,'important candle liquidity failure');}
  if(validPlan(classic,'BUY'))add(components.priceAction,'BUY',4,'classic model candidate');if(validPlan(classic,'SELL'))add(components.priceAction,'SELL',4,'classic model candidate');
  if(sweepBuy)add(components.liquidity,'BUY',7,'sell-side liquidity sweep');if(sweepSell)add(components.liquidity,'SELL',7,'buy-side liquidity sweep');if(validPlan(ict,'BUY'))add(components.liquidity,'BUY',5,'ICT/liquidity candidate');if(validPlan(ict,'SELL'))add(components.liquidity,'SELL',5,'ICT/liquidity candidate');if(heatmap.nearestBelow&&heatmap.nearestBelow.intensity>=55&&heatmap.nearestBelow.distance<=Math.max(3,atr5*1.5)&&heatmap.nearestBelow.lowerRejection>=heatmap.nearestBelow.upperRejection)add(components.liquidity,'BUY',2,'free heatmap support/rejection zone');if(heatmap.nearestAbove&&heatmap.nearestAbove.intensity>=55&&heatmap.nearestAbove.distance<=Math.max(3,atr5*1.5)&&heatmap.nearestAbove.upperRejection>=heatmap.nearestAbove.lowerRejection)add(components.liquidity,'SELL',2,'free heatmap resistance/rejection zone');
  add(components.location,'BUY',fib.buy,`Fibonacci ${fib.location}`);add(components.location,'SELL',fib.sell,`Fibonacci ${fib.location}`);
  const volRatio=atr5/Math.max(.25,mean(m5.slice(-20).map(b=>b.high-b.low))||atr5);const healthy=volRatio>=.65&&volRatio<=1.8;if(healthy){add(components.volatility,'BUY',5,'healthy volatility');add(components.volatility,'SELL',5,'healthy volatility');}if(Math.abs(mom5)>=atr5*.35)add(components.volatility,mom5>0?'BUY':'SELL',5,'directional range expansion');else{add(components.volatility,'BUY',2,'room available');add(components.volatility,'SELL',2,'room available');}

  const componentCaps={structure:24,trend:18,momentum:14,priceAction:16,liquidity:12,location:6,volatility:10};for(const [name,c] of Object.entries(components)){const cap=componentCaps[name]??100;c.BUY=Math.min(cap,c.BUY);c.SELL=Math.min(cap,c.SELL);}const totals={BUY:0,SELL:0};for(const c of Object.values(components)){totals.BUY+=c.BUY;totals.SELL+=c.SELL;}if(classic?.status==='CANDIDATE'&&['BUY','SELL'].includes(classic.candidateAction)){const opp=classic.candidateAction==='BUY'?'SELL':'BUY';totals[opp]=Math.max(0,totals[opp]-6);}if(ict?.status==='CANDIDATE'&&['BUY','SELL'].includes(ict.candidateAction)){const opp=ict.candidateAction==='BUY'?'SELL':'BUY';totals[opp]=Math.max(0,totals[opp]-3);}
  totals.BUY=clamp(Math.round(totals.BUY),0,100);totals.SELL=clamp(Math.round(totals.SELL),0,100);const side=totals.BUY>=totals.SELL?'BUY':'SELL',confidence=totals[side],other=totals[side==='BUY'?'SELL':'BUY'],lead=confidence-other;
  const breakdown=Object.fromEntries(Object.entries(components).map(([k,v])=>[k,{BUY:v.BUY,SELL:v.SELL,reasons:v.reasons}]));
  const confluence={version:'CONFLUENCE_V4_CONTEXT_NOT_CAGE',weights:{structure:24,trend:18,momentum:14,priceAction:16,liquidity:12,location:6,volatility:10},scores:totals,lead,selectedSide:side,breakdown,fibonacci:fib,structure:{h4:topDown.reads.H4.side,h1:sideOf(dir1h),m15:sideOf(dir15),m5:sideOf(dir5)},multiTimeframe:topDown,trend:{ema20_5:round(ema20_5),ema50_5:round(ema50_5),ema10_15:round(ema10_15),ema20_15:round(ema20_15)},momentum:{rsi14:round(rsi,1),macd:ind?.macd||null,stochastic:ind?.stochastic533||null,m5:round(mom5),m15:round(mom15)},priceAction:{candle,breakout,importantCandle:importantM5.primary},importantCandles:base.importantCandles,liquidity:{buySweep:sweepBuy,sellSweep:sweepSell,legacyIctCandidate:ict?.status==='CANDIDATE'?ict?.candidateAction:null},liquidityMap:heatmap,legacyModels:{classic:{status:classic?.status,side:classic?.candidateAction,confidence:classic?.confidence,strategy:classic?.strategy},ict:{status:ict?.status,side:ict?.candidateAction,confidence:ict?.confidence,strategy:ict?.strategy}}};
  base.confluence=confluence;base.contextBias=topDown.side;base.confidence=confidence;
  const selectedMacroAligned=['MN1','W1','D2','D1'].filter(tf=>topDown.reads[tf]?.side===side).length;
  const selectedMacroOpposed=['MN1','W1','D2','D1'].filter(tf=>topDown.reads[tf]?.side!=='NEUTRAL'&&topDown.reads[tf]?.side!==side).length;
  const selectedIntradayAligned=['H4','H1','M15'].filter(tf=>topDown.reads[tf]?.side===side).length;
  const selectedM5Aligned=topDown.reads.M5?.side===side;
  const strongMacroVeto=selectedMacroOpposed>=3&&selectedMacroAligned===0;
  if(strongMacroVeto)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,hardConflict:true,conflict:{type:'STRONG_OPPOSING_HIGHER_TIMEFRAME_TREND',rawConfluenceSide:side,macroSide:topDown.side,selectedMacroAligned,selectedMacroOpposed},reason:`TOP_DOWN BLOCK — ${side} confluence is opposed by at least 3/4 macro frames: MN1 ${topDown.reads.MN1.side} • W1 ${topDown.reads.W1.side} • D2 ${topDown.reads.D2.side} • D1 ${topDown.reads.D1.side}`};
  if(selectedIntradayAligned<1||!selectedM5Aligned)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,reason:`TOP_DOWN WAIT — ${side} setup needs M5 plus at least 1/3 of H4/H1/M15 aligned (intraday ${selectedIntradayAligned}/3, M5 ${topDown.reads.M5.side}); macro is context, not an automatic veto unless strongly opposed`};
  const key=importantM5.primary,lastM5=m5.at(-1),hardConflict=activeConfirmedLiquidityReversal(key)&&key.side!==side&&!liquidityReversalInvalidated(key,lastM5);
  if(hardConflict){
    const invalidationLevel=key.side==='BUY'?n(key.low):n(key.high);
    return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,hardConflict:true,conflict:{type:'OPPOSING_CONFIRMED_LIQUIDITY_REVERSAL',selectedSide:side,keyCandleSide:key.side,keyCandlePattern:key.pattern,keyCandleScore:Number(key.score)||0,invalidationLevel:round(invalidationLevel)},reason:`CONFLUENCE CONFLICT — confirmed ${key.side} ${key.pattern} ${Number(key.score)||0}/100 remains structurally valid; ${side} is blocked until a closed 5m candle invalidates ${round(invalidationLevel)}.`};
  }
  if(confidence<65||lead<8)return{...base,status:'WAIT',candidateAction:lead>=4?side:'WAIT',reason:`CONFLUENCE WAIT — BUY ${totals.BUY}/100 • SELL ${totals.SELL}/100 • lead ${lead}; need ≥65 and lead ≥8`};

  const sourcePlan=validPlan(classic,side)?classic:validPlan(ict,side)?ict:null;let entry=n(sourcePlan?.entry)??price,entryLow=n(sourcePlan?.entryLow),entryHigh=n(sourcePlan?.entryHigh),stop=n(sourcePlan?.stopLoss),targets=[n(sourcePlan?.target1),n(sourcePlan?.target2),n(sourcePlan?.target3),n(sourcePlan?.target4)],labels=Array.isArray(sourcePlan?.targetLabels)?sourcePlan.targetLabels.slice(0,4):[];
  const half=clamp(atr1*.75,.25,.75);if(entryLow==null)entryLow=entry-half;if(entryHigh==null)entryHigh=entry+half;if(stop==null||!(side==='BUY'?stop<entry:stop>entry))stop=fallbackStop(side,entry,bars,atr1);const risk=Math.abs(entry-stop);if(!(risk>=.45))return{...base,status:'WAIT',candidateAction:side,reason:'CONFLUENCE WAIT — structural stop is too close'};
  const minMove=Math.max(1.25,atr1*1.2);const fallbackTargets=nearestTargets(side,entry,bars,minMove,risk);for(let i=0;i<4;i++){const room=targets[i]==null?null:Math.abs(targets[i]-entry);if(targets[i]==null||(side==='BUY'?targets[i]<=entry:targets[i]>=entry)||(i===0&&room<minMove))targets[i]=fallbackTargets[i];}for(let i=1;i<4;i++){if(side==='BUY'&&targets[i]<=targets[i-1]+.35)targets[i]=targets[i-1]+Math.max(.75,minMove*.45);if(side==='SELL'&&targets[i]>=targets[i-1]-.35)targets[i]=targets[i-1]-Math.max(.75,minMove*.45);}labels=[0,1,2,3].map((i)=>labels[i]||`CONFLUENCE_TP${i+1}`);
  const tp1Reward=side==='BUY'?targets[0]-entry:entry-targets[0],rr=risk>0?tp1Reward/risk:0;if(!(tp1Reward>=1.0)||rr<.5)return{...base,status:'WAIT',candidateAction:side,reason:`CONFLUENCE WAIT — target room ${round(tp1Reward,2)} / ${round(rr,2)}R is too small`};
  const model=components.liquidity[side]>=7&&components.priceAction[side]>=7?'CONFLUENCE_REVERSAL':components.trend[side]>=12&&components.structure[side]>=14?'CONFLUENCE_TREND':'CONFLUENCE_BREAKOUT';const oneMinuteConfirmed=side==='BUY'?m1.slice(-2).every(b=>b.close>=b.open):m1.slice(-2).every(b=>b.close<=b.open);
  return{...base,status:'CANDIDATE',candidateAction:side,side,strategy:model,tradeStyle:'MULTI_MODEL_CONFLUENCE',confidence,signalConfidence:confidence,contextBias:side,oneMinuteConfirmed,setupId:[side,model,m5.at(-1)?.t??now,round(entry),round(stop),confidence].join('|'),entry:round(entry),entryLow:round(entryLow),entryHigh:round(entryHigh),stopLoss:round(stop),target1:round(targets[0]),target2:round(targets[1]),target3:round(targets[2]),target4:round(targets[3]),targetLabels:labels,riskReward:round(rr,2),confluence,technicalRead:ict?.technicalRead||null,priceAction:ict?.priceAction||null,liquidityContext:ict?.ict||null,ict:ict?.ict||null,multiTimeframe:topDown,reason:`TOP_DOWN ${side} ${confidence}/100 — MN1 ${topDown.reads.MN1.side} • W1 ${topDown.reads.W1.side} • D2 ${topDown.reads.D2.side} • D1 ${topDown.reads.D1.side} • H4 ${topDown.reads.H4.side} • H1 ${topDown.reads.H1.side} • M15 ${topDown.reads.M15.side} • M5 ${topDown.reads.M5.side}; execution requires M5 + intraday alignment; macro is context unless strongly opposed`};
}
