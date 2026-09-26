import { buildBtcMurphySignal } from './btc-murphy-model.js';
const BTC_MIN_CONFIDENCE=Math.max(65,Math.min(90,Number(process.env.BTC_MIN_CONFIDENCE||65)||65));
const BTC_CACHE_MS=Math.max(5000,Math.min(30000,Number(process.env.BTC_CACHE_MS||12000)||12000));
const BTC_CONTRACT_SIZE=Math.max(.000001,Number(process.env.EXNESS_BTC_CONTRACT_SIZE||1));
const BTC_LOT_STEP=Math.max(.001,Number(process.env.EXNESS_BTC_LOT_STEP||.01));
const BTC_SAFE_RISK_USD=Math.max(1,Number(process.env.BTC_SAFE_RISK_USD||5));
const BTC_MAX_RISK_USD=Math.max(BTC_SAFE_RISK_USD,Number(process.env.BTC_MAX_RISK_USD||10));
const cache={expiresAt:0,value:null};
const lifecycle={signal:null,lastTerminal:null,cooldownUntil:0};

const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=2)=>{const x=num(v);return x==null?null:Number(x.toFixed(d))};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};

async function coinbaseCandles(granularity){
  const url=new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
  url.searchParams.set('granularity',String(granularity));
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-ICT-Narrative/2.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok||!Array.isArray(rows))throw new Error('Coinbase candles unavailable '+r.status);
  const now=Date.now(),span=granularity*1000;
  return rows.map(x=>({t:Number(x[0])*1000,low:Number(x[1]),high:Number(x[2]),open:Number(x[3]),close:Number(x[4]),volume:Number(x[5]||0)}))
    .filter(x=>Number.isFinite(x.close)&&x.t+span<=now+1000).sort((a,b)=>a.t-b.t);
}
async function coinbaseTicker(){
  const r=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker',{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-ICT-Narrative/2.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error('Coinbase ticker unavailable '+r.status);
  return d;
}
function atr(rows,period=14){
  if(rows.length<period+1)return null;
  const tr=[];
  for(let i=rows.length-period;i<rows.length;i++){
    const c=rows[i],p=rows[i-1];
    tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
  }
  return mean(tr);
}
function swingPoints(rows,length=5){
  const left=Math.max(2,Math.floor(length)),right=1,highs=[],lows=[];
  for(let i=left;i<rows.length-right;i++){
    const c=rows[i],before=rows.slice(i-left,i),after=rows.slice(i+1,i+1+right);
    if(before.every(x=>c.high>x.high)&&after.every(x=>c.high>=x.high))highs.push({index:i,t:c.t,price:c.high});
    if(before.every(x=>c.low<x.low)&&after.every(x=>c.low<=x.low))lows.push({index:i,t:c.t,price:c.low});
  }
  return{highs,lows};
}
function structureSnapshot(rows,length=5){
  const swings=swingPoints(rows,length),pivots=[
    ...swings.highs.map(x=>({...x,kind:'HIGH',broken:false})),
    ...swings.lows.map(x=>({...x,kind:'LOW',broken:false}))
  ].sort((a,b)=>a.index-b.index);
  const events=[];let dir=0;
  for(let i=0;i<rows.length;i++){
    const c=rows[i];
    for(const p of pivots){
      if(p.broken||p.index>=i)continue;
      if(p.kind==='HIGH'&&c.close>p.price){
        const type=dir===1?'BOS':'MSS';p.broken=true;dir=1;
        events.push({type,side:'BUY',level:round(p.price),pivotTime:p.t,t:c.t,close:round(c.close)});
      }else if(p.kind==='LOW'&&c.close<p.price){
        const type=dir===-1?'BOS':'MSS';p.broken=true;dir=-1;
        events.push({type,side:'SELL',level:round(p.price),pivotTime:p.t,t:c.t,close:round(c.close)});
      }
    }
  }
  const latest=events.at(-1)||null;
  return{dir,side:latest?.side||(dir===1?'BUY':dir===-1?'SELL':null),latest,mss:events.filter(x=>x.type==='MSS').at(-1)||null,bos:events.filter(x=>x.type==='BOS').at(-1)||null,events,swings};
}
function activeFvgs(rows,limit=5){
  const out=[];
  for(let i=2;i<rows.length;i++){
    const a=rows[i-2],c=rows[i];
    if(c.low>a.high){
      let active=true;
      for(let j=i+1;j<rows.length;j++)if(rows[j].low<=a.high){active=false;break;}
      out.push({side:'BUY',type:'BULLISH_FVG',low:round(a.high),high:round(c.low),mid:round((a.high+c.low)/2),t:c.t,active});
    }
    if(c.high<a.low){
      let active=true;
      for(let j=i+1;j<rows.length;j++)if(rows[j].high>=a.low){active=false;break;}
      out.push({side:'SELL',type:'BEARISH_FVG',low:round(c.high),high:round(a.low),mid:round((c.high+a.low)/2),t:c.t,active});
    }
  }
  return out.filter(x=>x.active).slice(-limit).reverse();
}
function latestDisplacement(rows){
  const x=rows.slice(-24);if(x.length<10)return null;
  const bodies=x.map(c=>Math.abs(c.close-c.open));
  for(let i=x.length-1;i>=Math.max(5,x.length-10);i--){
    const c=x[i],body=Math.abs(c.close-c.open),base=mean(bodies.slice(Math.max(0,i-10),i))||0,range=Math.max(.01,c.high-c.low);
    const upper=c.high-Math.max(c.open,c.close),lower=Math.min(c.open,c.close)-c.low;
    if(body>=Math.max(base*1.15,range*.48)&&upper<=body*.55&&lower<=body*.55){
      return{side:c.close>c.open?'BUY':'SELL',t:c.t,body:round(body),range:round(range),close:round(c.close)};
    }
  }
  return null;
}
function equalLiquidity(rows,side,a){
  const sw=swingPoints(rows.slice(-140),5),pts=side==='BUY'?sw.highs:sw.lows,tol=Math.max(8,(a||50)*.14),out=[];
  for(let i=0;i<pts.length;i++){
    const g=pts.filter((p,j)=>j!==i&&Math.abs(p.price-pts[i].price)<=tol);
    if(!g.length)continue;
    const all=[pts[i],...g],price=all.reduce((s,p)=>s+p.price,0)/all.length,t=Math.max(...all.map(p=>p.t));
    if(!out.some(x=>Math.abs(x.price-price)<=tol))out.push({label:side==='BUY'?'EQH_BUY_SIDE':'EQL_SELL_SIDE',price:round(price),touches:all.length,t});
  }
  return out.sort((a,b)=>b.t-a.t).slice(0,5);
}
function liquiditySweep(rows,a){
  const x=rows.slice(-140),tol=Math.max(8,(a||50)*.12),sw=swingPoints(x,5);
  const buy=equalLiquidity(x,'BUY',a),sell=equalLiquidity(x,'SELL',a);
  const levels=[
    ...buy.map(v=>({...v,kind:'BUY_SIDE'})),
    ...sell.map(v=>({...v,kind:'SELL_SIDE'})),
    ...sw.highs.slice(-8).map(v=>({label:'SWING_BUY_SIDE',price:v.price,t:v.t,kind:'BUY_SIDE'})),
    ...sw.lows.slice(-8).map(v=>({label:'SWING_SELL_SIDE',price:v.price,t:v.t,kind:'SELL_SIDE'}))
  ];
  let best=null;
  for(let i=x.length-1;i>=Math.max(1,x.length-30);i--){
    const c=x[i];
    for(const z of levels){
      if(z.t>=c.t)continue;
      if(z.kind==='BUY_SIDE'&&c.high>z.price+tol*.05&&c.close<z.price){
        const e={side:'SELL',event:'BUYSIDE_LIQUIDITY_SWEPT',level:round(z.price),extreme:round(c.high),t:c.t,label:z.label};
        if(!best||e.t>best.t)best=e;
      }else if(z.kind==='SELL_SIDE'&&c.low<z.price-tol*.05&&c.close>z.price){
        const e={side:'BUY',event:'SELLSIDE_LIQUIDITY_SWEPT',level:round(z.price),extreme:round(c.low),t:c.t,label:z.label};
        if(!best||e.t>best.t)best=e;
      }
    }
  }
  return{buySide:buy,sellSide:sell,sweep:best};
}
function latestOrderBlock(rows,structure){
  const e=structure?.latest;if(!e)return null;
  const idx=rows.findIndex(c=>c.t===e.t);if(idx<1)return null;
  for(let i=idx-1;i>=Math.max(0,idx-12);i--){
    const c=rows[i],opp=e.side==='BUY'?c.close<c.open:c.close>c.open;
    if(opp)return{side:e.side,type:e.side==='BUY'?'BULLISH_OB':'BEARISH_OB',low:round(c.low),high:round(c.high),mid:round((c.low+c.high)/2),t:c.t};
  }
  return null;
}
function frame(rows,name){
  const a=atr(rows,14)||50,structure=structureSnapshot(rows,5),fvgs=activeFvgs(rows,6),displacement=latestDisplacement(rows),liq=liquiditySweep(rows,a),orderBlock=latestOrderBlock(rows,structure);
  return{name,atr:round(a),structure,fvg:fvgs[0]||null,fvgs,displacement,liquiditySweep:liq.sweep,liquidity:liq,orderBlock};
}
function fresh(event,ms){return Boolean(event&&Date.now()-event.t>=0&&Date.now()-event.t<=ms);}
function zoneContains(price,z,pad=0){return Boolean(z&&price>=Math.min(z.low,z.high)-pad&&price<=Math.max(z.low,z.high)+pad);}
function nearestSameSideFvg(snapshot,side,price){
  const same=snapshot.fvgs.filter(z=>z.side===side);
  if(!same.length)return null;
  return same.sort((a,b)=>{
    const da=price<Math.min(a.low,a.high)?Math.min(a.low,a.high)-price:price>Math.max(a.low,a.high)?price-Math.max(a.low,a.high):0;
    const db=price<Math.min(b.low,b.high)?Math.min(b.low,b.high)-price:price>Math.max(b.low,b.high)?price-Math.max(b.low,b.high):0;
    return da-db;
  })[0];
}
function targetPools(side,entry,h1,m15,m5,a5){
  const pools=[];
  const add=(label,price)=>{if(Number.isFinite(price)&&(side==='BUY'?price>entry:price<entry))pools.push({label,price:round(price)});};
  if(side==='BUY'){
    for(const p of h1.structure.swings.highs.slice(-14))add('H1_BUY_SIDE',p.price);
    for(const p of m15.structure.swings.highs.slice(-18))add('M15_BUY_SIDE',p.price);
    for(const p of m5.structure.swings.highs.slice(-20))add('M5_BUY_SIDE',p.price);
    for(const p of h1.liquidity.buySide)add('H1_EQH_BUY_SIDE',p.price);
    for(const p of m15.liquidity.buySide)add('M15_EQH_BUY_SIDE',p.price);
  }else{
    for(const p of h1.structure.swings.lows.slice(-14))add('H1_SELL_SIDE',p.price);
    for(const p of m15.structure.swings.lows.slice(-18))add('M15_SELL_SIDE',p.price);
    for(const p of m5.structure.swings.lows.slice(-20))add('M5_SELL_SIDE',p.price);
    for(const p of h1.liquidity.sellSide)add('H1_EQL_SELL_SIDE',p.price);
    for(const p of m15.liquidity.sellSide)add('M15_EQL_SELL_SIDE',p.price);
  }
  const dedup=[];
  for(const p of pools.sort((a,b)=>Math.abs(a.price-entry)-Math.abs(b.price-entry))){
    if(!dedup.some(x=>Math.abs(x.price-p.price)<=Math.max(10,a5*.12)))dedup.push(p);
  }
  return dedup;
}
function lotForRisk(entry,stop,riskUsd){
  const distance=Math.abs(Number(entry)-Number(stop));if(!(distance>0))return 0;
  const raw=riskUsd/(distance*BTC_CONTRACT_SIZE),steps=Math.floor((raw+1e-12)/BTC_LOT_STEP);
  return steps>0?Number((steps*BTC_LOT_STEP).toFixed(3)):0;
}
function lotSizing(entry,stop){
  const distance=Math.abs(Number(entry)-Number(stop)),safeLot=lotForRisk(entry,stop,BTC_SAFE_RISK_USD),maxLot=lotForRisk(entry,stop,BTC_MAX_RISK_USD),recommendedLot=safeLot>0?safeLot:(maxLot>0?BTC_LOT_STEP:0);
  return{recommendedLot,maxLot,stopDistance:round(distance,2),actualRiskUsd:recommendedLot>0?round(distance*BTC_CONTRACT_SIZE*recommendedLot,2):null,safeRiskUsd:BTC_SAFE_RISK_USD,maxRiskUsd:BTC_MAX_RISK_USD};
}
function compatIct(h1,m15,m5,m1,side){
  const bool=(e,s)=>Boolean(e&&e.side===s);
  return{
    context15:m15.structure.side==='BUY'?'BULLISH':m15.structure.side==='SELL'?'BEARISH':'NEUTRAL',
    trend1h:h1.structure.side==='BUY'?'BULLISH':h1.structure.side==='SELL'?'BEARISH':'NEUTRAL',
    fvg1:{bull:Boolean(m1.fvgs.some(x=>x.side==='BUY')),bear:Boolean(m1.fvgs.some(x=>x.side==='SELL'))},
    fvg5:{bull:Boolean(m5.fvgs.some(x=>x.side==='BUY')),bear:Boolean(m5.fvgs.some(x=>x.side==='SELL'))},
    mss1:{bull:bool(m1.structure.mss,'BUY'),bear:bool(m1.structure.mss,'SELL')},
    mss5:{bull:bool(m5.structure.mss,'BUY'),bear:bool(m5.structure.mss,'SELL')},
    displacement1:{bull:bool(m1.displacement,'BUY'),bear:bool(m1.displacement,'SELL')},
    displacement5:{bull:bool(m5.displacement,'BUY'),bear:bool(m5.displacement,'SELL')},
    narrativeSide:side,
    h1:{side:h1.structure.side,latest:h1.structure.latest,fvg:h1.fvg,orderBlock:h1.orderBlock,liquiditySweep:h1.liquiditySweep},
    m15:{side:m15.structure.side,latest:m15.structure.latest,fvg:m15.fvg,orderBlock:m15.orderBlock,liquiditySweep:m15.liquiditySweep},
    m5:{side:m5.structure.side,latest:m5.structure.latest,fvg:m5.fvg,orderBlock:m5.orderBlock,liquiditySweep:m5.liquiditySweep},
    m1:{side:m1.structure.side,latest:m1.structure.latest,fvg:m1.fvg,orderBlock:m1.orderBlock,liquiditySweep:m1.liquiditySweep}
  };
}
function scoreBucket(){return{BUY:0,SELL:0,reasons:{BUY:[],SELL:[]}};}
function addScore(bucket,side,value,reason){if(!['BUY','SELL'].includes(side)||!(value>0))return;bucket[side]+=value;bucket.reasons[side].push(reason);}
function sideFromDir(dir){return dir>0?'BUY':dir<0?'SELL':'NEUTRAL';}
function momentumSide(rows,count=4){const x=rows.slice(-Math.max(2,count+1));if(x.length<2)return'NEUTRAL';const d=x.at(-1).close-x[0].close;return d>0?'BUY':d<0?'SELL':'NEUTRAL';}
function fibonacciLocation(rows,price){
  const x=rows.slice(-72);if(x.length<12)return{location:'UNKNOWN',BUY:0,SELL:0,high:null,low:null,pos:null};
  const high=Math.max(...x.map(c=>c.high)),low=Math.min(...x.map(c=>c.low)),range=high-low;
  if(!(range>0))return{location:'UNKNOWN',BUY:0,SELL:0,high:round(high),low:round(low),pos:null};
  const pos=(price-low)/range;let BUY=0,SELL=0,location='MID';
  if(pos<=.382){BUY=6;location='DEEP_DISCOUNT';}
  else if(pos<.50){BUY=4;location='DISCOUNT';}
  else if(pos>.618){SELL=6;location='DEEP_PREMIUM';}
  else if(pos>.50){SELL=4;location='PREMIUM';}
  return{location,BUY,SELL,high:round(high),low:round(low),pos:round(pos,3),fib382:round(low+range*.382),fib50:round(low+range*.5),fib618:round(low+range*.618)};
}
function candleRead(rows){
  const last=rows.at(-1),prev=rows.at(-2);if(!last)return{side:'NEUTRAL',strength:0,pattern:'NONE'};
  const range=Math.max(.01,last.high-last.low),body=Math.abs(last.close-last.open),upper=last.high-Math.max(last.open,last.close),lower=Math.min(last.open,last.close)-last.low;
  if(prev&&last.close>last.open&&prev.close<prev.open&&last.open<=prev.close&&last.close>=prev.open)return{side:'BUY',strength:5,pattern:'BULLISH_ENGULFING'};
  if(prev&&last.close<last.open&&prev.close>prev.open&&last.open>=prev.close&&last.close<=prev.open)return{side:'SELL',strength:5,pattern:'BEARISH_ENGULFING'};
  if(lower>=Math.max(body*1.8,range*.32)&&last.close>=last.low+range*.62)return{side:'BUY',strength:4,pattern:'LOWER_REJECTION'};
  if(upper>=Math.max(body*1.8,range*.32)&&last.close<=last.low+range*.38)return{side:'SELL',strength:4,pattern:'UPPER_REJECTION'};
  return{side:last.close>last.open?'BUY':last.close<last.open?'SELL':'NEUTRAL',strength:2,pattern:'CANDLE_DIRECTION'};
}
function fallbackTargets(side,entry,risk,a5){
  const dir=side==='BUY'?1:-1;
  const d=[
    Math.max(45,a5*.45,risk*.70),
    Math.max(80,a5*.80,risk*1.15),
    Math.max(130,a5*1.25,risk*1.65),
    Math.max(200,a5*1.85,risk*2.30)
  ];
  return d.map(x=>round(entry+dir*x));
}
function chooseTargets(side,entry,risk,h1,m15,m5,a5){
  const minMove=Math.max(45,a5*.45),pools=targetPools(side,entry,h1,m15,m5,a5),fallback=fallbackTargets(side,entry,risk,a5),out=[],labels=[];
  const usable=pools.filter(p=>Math.abs(p.price-entry)>=minMove);
  for(let i=0;i<4;i++){
    let p=usable[i]?.price??fallback[i],label=usable[i]?.label??('CONFLUENCE_TP'+(i+1));
    if(i&&side==='BUY'&&p<=out[i-1]+20){p=Math.max(fallback[i],out[i-1]+Math.max(25,a5*.18));label='CONFLUENCE_TP'+(i+1);}
    if(i&&side==='SELL'&&p>=out[i-1]-20){p=Math.min(fallback[i],out[i-1]-Math.max(25,a5*.18));label='CONFLUENCE_TP'+(i+1);}
    out.push(round(p));labels.push(label);
  }
  return{targets:out,labels,pools:usable.slice(0,8)};
}
function analyze(data){
  const one=data.one,five=data.five,fifteen=data.fifteen,hour=data.hour,ticker=data.ticker||{};
  if(one.length<80||five.length<80||fifteen.length<80||hour.length<80)throw new Error('BTC history incomplete');
  const price=Number(ticker.price??one.at(-1).close),h1=frame(hour,'1h'),m15=frame(fifteen,'15m'),m5=frame(five,'5m'),m1=frame(one,'1m');
  const a1=atr(one,14)||price*.0007,a5=atr(five,14)||price*.0015,ict=compatIct(h1,m15,m5,m1,null);
  let murphy=null;try{murphy=buildBtcMurphySignal(one,five,fifteen,hour,ticker);}catch{}
  const base={symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'MULTI_MODEL_CONFLUENCE',tradeStyle:'MULTI_MODEL_CONFLUENCE',confidence:0,scoreMeaning:'SETUP_SCORE_NOT_WIN_PROBABILITY',minimumConfidence:BTC_MIN_CONFIDENCE,price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,lotSizing:null,trend:`15m ${m15.structure.side||'NEUTRAL'} / 1h ${h1.structure.side||'NEUTRAL'}`,confluence:null,murphy: murphy?.murphy||null,ict,updatedAt:new Date().toISOString(),reason:'CONFLUENCE WAIT — building BTC evidence.'};

  const components={structure:scoreBucket(),trend:scoreBucket(),momentum:scoreBucket(),priceAction:scoreBucket(),liquidity:scoreBucket(),location:scoreBucket(),volatility:scoreBucket()};
  addScore(components.structure,h1.structure.side,7,'1h structure');
  addScore(components.structure,m15.structure.side,9,'15m structure');
  addScore(components.structure,m5.structure.side,8,'5m structure');

  const mt=murphy?.murphy?.trend||{},murphySide=mt.side||(['BUY','SELL'].includes(murphy?.action)?murphy.action:null);
  addScore(components.trend,murphySide,10,'Murphy multi-timeframe trend');
  if(mt.bull1h)addScore(components.trend,'BUY',4,'1h EMA trend');if(mt.bear1h)addScore(components.trend,'SELL',4,'1h EMA trend');
  if(mt.bull15)addScore(components.trend,'BUY',4,'15m EMA trend');if(mt.bear15)addScore(components.trend,'SELL',4,'15m EMA trend');

  const rsi5=Number(murphy?.murphy?.rsi5),rsi15=Number(mt.rsi15),mom5=momentumSide(five,4),mom1=momentumSide(one,5);
  if(Number.isFinite(rsi5)){if(rsi5>=53&&rsi5<=76)addScore(components.momentum,'BUY',5,'5m RSI bullish');else if(rsi5<=47&&rsi5>=24)addScore(components.momentum,'SELL',5,'5m RSI bearish');}
  if(Number.isFinite(rsi15)){if(rsi15>=52&&rsi15<=78)addScore(components.momentum,'BUY',4,'15m RSI bullish');else if(rsi15<=48&&rsi15>=22)addScore(components.momentum,'SELL',4,'15m RSI bearish');}
  addScore(components.momentum,mom5,3,'5m momentum');addScore(components.momentum,mom1,2,'1m momentum');

  const candle=candleRead(five),trigger=murphy?.murphy?.trigger||{};
  addScore(components.priceAction,candle.side,candle.strength,`5m ${candle.pattern}`);
  if(trigger.ready&&murphySide){addScore(components.priceAction,murphySide,8,`Murphy ${trigger.type||'trigger'}`);if(trigger.type==='BREAKOUT'||trigger.type==='PULLBACK_RESUMPTION')addScore(components.priceAction,murphySide,3,'confirmed 5m price-action trigger');}

  const sweeps=[h1.liquiditySweep,m15.liquiditySweep,m5.liquiditySweep,m1.liquiditySweep].filter(Boolean);
  for(const e of sweeps.slice(-2))addScore(components.liquidity,e.side,7,'liquidity sweep');
  const fvgBuy=Boolean(m5.fvgs.some(x=>x.side==='BUY')||m1.fvgs.some(x=>x.side==='BUY')),fvgSell=Boolean(m5.fvgs.some(x=>x.side==='SELL')||m1.fvgs.some(x=>x.side==='SELL'));
  if(fvgBuy)addScore(components.liquidity,'BUY',3,'active bullish FVG');if(fvgSell)addScore(components.liquidity,'SELL',3,'active bearish FVG');
  if(m5.orderBlock?.side)addScore(components.liquidity,m5.orderBlock.side,2,'5m order block');

  const fib=fibonacciLocation(hour,price);addScore(components.location,'BUY',fib.BUY,`Fibonacci ${fib.location}`);addScore(components.location,'SELL',fib.SELL,`Fibonacci ${fib.location}`);

  const avgRange=mean(five.slice(-20).map(c=>c.high-c.low))||a5,volRatio=a5/Math.max(1,avgRange),volumeRatio=Number(murphy?.murphy?.volume5Ratio);
  if(volRatio>=.65&&volRatio<=1.9){addScore(components.volatility,'BUY',4,'healthy ATR regime');addScore(components.volatility,'SELL',4,'healthy ATR regime');}
  if(Number.isFinite(volumeRatio)&&volumeRatio>=1.02){addScore(components.volatility,mom5,3,'5m volume expansion');}
  if(m5.displacement?.side)addScore(components.volatility,m5.displacement.side,3,'5m displacement');

  const caps={structure:24,trend:18,momentum:14,priceAction:16,liquidity:12,location:6,volatility:10};
  for(const [name,c] of Object.entries(components)){c.BUY=Math.min(caps[name],c.BUY);c.SELL=Math.min(caps[name],c.SELL);}
  const totals={BUY:0,SELL:0};for(const c of Object.values(components)){totals.BUY+=c.BUY;totals.SELL+=c.SELL;}
  totals.BUY=clamp(Math.round(totals.BUY),0,100);totals.SELL=clamp(Math.round(totals.SELL),0,100);
  const side=totals.BUY>=totals.SELL?'BUY':'SELL',confidence=totals[side],other=totals[side==='BUY'?'SELL':'BUY'],lead=confidence-other;
  const confluence={version:'BTC_CONFLUENCE_V1',weights:caps,scores:totals,lead,selectedSide:side,breakdown:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,{BUY:v.BUY,SELL:v.SELL,reasons:v.reasons}])),structure:{h1:h1.structure.side||'NEUTRAL',m15:m15.structure.side||'NEUTRAL',m5:m5.structure.side||'NEUTRAL'},momentum:{rsi5:round(rsi5,1),rsi15:round(rsi15,1),m5:mom5,m1:mom1},priceAction:{candle,trigger},liquidity:{sweeps:sweeps.slice(-4),m5Fvg:m5.fvg,m1Fvg:m1.fvg,orderBlock:m5.orderBlock},fibonacci:fib,volatility:{atr1:round(a1),atr5:round(a5),atrRatio:round(volRatio,2),volumeRatio:round(volumeRatio,2)},legacyModels:{murphy:{status:murphy?.status||'WAIT',action:murphy?.action||'WAIT',confidence:murphy?.confidence||0,strategy:murphy?.strategy||null},ictContext:{h1:h1.structure.side,m15:m15.structure.side,m5:m5.structure.side}}};
  base.confluence=confluence;base.confidence=confidence;base.trend=`1h ${h1.structure.side||'NEUTRAL'} / 15m ${m15.structure.side||'NEUTRAL'} / 5m ${m5.structure.side||'NEUTRAL'}`;base.ict=compatIct(h1,m15,m5,m1,side);

  if(confidence<BTC_MIN_CONFIDENCE||lead<8)return{...base,reason:`CONFLUENCE WAIT — BUY ${totals.BUY}/100 • SELL ${totals.SELL}/100 • lead ${lead}; need ≥${BTC_MIN_CONFIDENCE} and lead ≥8.`};

  const murphyAligned=murphy?.status==='ACTIVE'&&murphy?.action===side;
  let entry=murphyAligned&&Number.isFinite(Number(murphy.entry))?Number(murphy.entry):price;
  const entryHalf=Math.max(15,Math.min(65,a1*.45)),entryLow=entry-entryHalf,entryHigh=entry+entryHalf;
  const recent5=five.slice(-10),recent1=one.slice(-18),buffer=Math.max(18,a1*.35);
  let stop=side==='BUY'?Math.min(Math.min(...recent5.map(c=>c.low)),Math.min(...recent1.map(c=>c.low)))-buffer:Math.max(Math.max(...recent5.map(c=>c.high)),Math.max(...recent1.map(c=>c.high)))+buffer;
  const minRisk=Math.max(35,a1*.55);if(Math.abs(entry-stop)<minRisk)stop=entry+(side==='BUY'?-1:1)*minRisk;
  const risk=Math.abs(entry-stop),maxRisk=Math.max(900,price*.009);
  if(!(risk>0)||risk>maxRisk)return{...base,reason:`CONFLUENCE WAIT — structural BTC stop ${round(risk,2)} is outside allowed range.`};

  const chosen=chooseTargets(side,entry,risk,h1,m15,m5,a5),targets=chosen.targets,tp1Reward=Math.abs(targets[0]-entry),rr=tp1Reward/risk;
  if(tp1Reward<Math.max(40,a5*.35)||rr<.50)return{...base,reason:`CONFLUENCE WAIT — TP1 room ${round(tp1Reward,2)} / ${round(rr,2)}R is too small.`};

  const strategy=components.liquidity[side]>=7&&components.priceAction[side]>=7?'CONFLUENCE_REVERSAL':components.trend[side]>=12&&components.structure[side]>=14?'CONFLUENCE_TREND':'CONFLUENCE_BREAKOUT';
  const sizing=lotSizing(entry,stop);
  return{...base,status:'ACTIVE',action:side,side,strategy,tradeStyle:'MULTI_MODEL_CONFLUENCE',confidence,entry:round(entry),entryLow:round(entryLow),entryHigh:round(entryHigh),stopLoss:round(stop),target1:targets[0],target2:targets[1],target3:targets[2],target4:targets[3],targetLabels:chosen.labels,riskReward:round(rr,2),lotSizing:sizing,confluence,ict:compatIct(h1,m15,m5,m1,side),reason:`CONFLUENCE ${side} ${confidence}/100 — Structure ${components.structure[side]}/24 • Trend ${components.trend[side]}/18 • Momentum ${components.momentum[side]}/14 • PriceAction ${components.priceAction[side]}/16 • Liquidity ${components.liquidity[side]}/12 • Fib ${components.location[side]}/6 • Volatility ${components.volatility[side]}/10.`};
}
async function freshCandidate(force=false){
  if(!force&&cache.value&&Date.now()<cache.expiresAt)return cache.value;
  const [one,five,fifteen,hour,ticker]=await Promise.all([coinbaseCandles(60),coinbaseCandles(300),coinbaseCandles(900),coinbaseCandles(3600),coinbaseTicker()]);
  const value=analyze({one,five,fifteen,hour,ticker});cache.value=value;cache.expiresAt=Date.now()+BTC_CACHE_MS;return value;
}
function reached(side,price,target){return side==='BUY'?price>=target:price<=target;}
function lifecycleSignal(candidate,now=Date.now()){
  const price=Number(candidate.price);
  if(lifecycle.signal){
    const s=lifecycle.signal;
    const stopHit=s.action==='BUY'?price<=s.stopLoss:price>=s.stopLoss;
    if(stopHit){
      lifecycle.lastTerminal={type:'SL',side:s.action,price:round(price),at:new Date(now).toISOString(),signalId:s.signalId};
      lifecycle.signal=null;lifecycle.cooldownUntil=now+60000;
    }else{
      s.price=round(price);s.updatedAt=candidate.updatedAt;s.targetHits=[s.target1,s.target2,s.target3,s.target4].map(t=>reached(s.action,price,t));
      if(s.targetHits.every(Boolean)){lifecycle.lastTerminal={type:'TP4',side:s.action,price:round(price),at:new Date(now).toISOString(),signalId:s.signalId};lifecycle.signal=null;lifecycle.cooldownUntil=now+60000;}
      else return{...s,status:'ACTIVE',lockedTargets:true,terminalEvent:lifecycle.lastTerminal};
    }
  }
  if(now>=lifecycle.cooldownUntil&&candidate.status==='ACTIVE'){
    lifecycle.signal={...candidate,signalId:'BTC-'+now,issuedAtMs:now,targetHits:[false,false,false,false],lockedTargets:true};
    return{...lifecycle.signal,terminalEvent:lifecycle.lastTerminal};
  }
  return{...candidate,status:'WAIT',action:'WAIT',entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,signalId:null,terminalEvent:lifecycle.lastTerminal,cooldownRemainingMs:Math.max(0,lifecycle.cooldownUntil-now)};
}
export async function getBtcSignal(force=false){
  const candidate=await freshCandidate(force);
  return lifecycleSignal(candidate);
}

export function injectBtcPanel(html){
  if(html.includes('btcIctFastPanel'))return html;
  const css='<style>#btcIctFastPanel{max-width:1280px;margin:16px auto 28px;padding:16px;border:1px solid #5f4724;border-radius:18px;background:linear-gradient(145deg,#17130d,#0b111b);direction:rtl;color:#eef2f7}#btcIctFastPanel h2{margin:0;color:#f2bd63;font-size:20px}.btcFastTag{display:inline-block;margin-right:8px;padding:5px 8px;border:1px solid #6d4b24;border-radius:999px;color:#ffc56e;font-size:11px}.btcFastGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}.btcFastCard{padding:10px;border:1px solid #343b48;border-radius:11px;background:#0c121d}.btcFastCard span{display:block;color:#95a1b4;font-size:10px}.btcFastCard strong{display:block;margin-top:5px;font-size:15px;direction:ltr;text-align:right}.btcFastBuy{color:#52e5a5}.btcFastSell{color:#ff718c}.btcFastWait{color:#ffd166}.btcFastNote{margin-top:10px;color:#a79a84;font-size:11px;line-height:1.7}@media(max-width:900px){.btcFastGrid{grid-template-columns:repeat(2,1fr)}}</style>';
  const panel='<section id="btcIctFastPanel"><div><h2>BTCUSD — MULTI-MODEL CONFLUENCE <span class="btcFastTag">24/7 LIVE TEST • 1H/15m Context • 5m/1m Timing</span></h2><p id="btcFastMeta" class="btcFastNote">جارٍ تحميل قراءة البيتكوين…</p></div><div class="btcFastGrid"><div class="btcFastCard"><span>الحالة</span><strong id="btcFastState">WAIT</strong></div><div class="btcFastCard"><span>درجة الإعداد</span><strong id="btcFastConfidence">—</strong></div><div class="btcFastCard"><span>BUY Score</span><strong id="btcFastBuyScore">—</strong></div><div class="btcFastCard"><span>SELL Score</span><strong id="btcFastSellScore">—</strong></div><div class="btcFastCard"><span>السعر</span><strong id="btcFastPrice">—</strong></div><div class="btcFastCard"><span>الدخول</span><strong id="btcFastEntry">—</strong></div><div class="btcFastCard"><span>وقف الخسارة</span><strong id="btcFastStop">—</strong></div><div class="btcFastCard"><span>TP1</span><strong id="btcFastTp1">—</strong></div><div class="btcFastCard"><span>TP2</span><strong id="btcFastTp2">—</strong></div><div class="btcFastCard"><span>TP3</span><strong id="btcFastTp3">—</strong></div><div class="btcFastCard"><span>TP4</span><strong id="btcFastTp4">—</strong></div><div class="btcFastCard"><span>اللوت المقترح</span><strong id="btcFastLot">—</strong></div><div class="btcFastCard"><span>Structure</span><strong id="btcFastStructure">—</strong></div><div class="btcFastCard"><span>Momentum</span><strong id="btcFastMomentum">—</strong></div><div class="btcFastCard"><span>Price Action</span><strong id="btcFastTrigger">—</strong></div></div><p id="btcFastReason" class="btcFastNote">Structure + Trend + Momentum + Price Action + Liquidity + Fibonacci + Volatility. ICT أصبح سياقًا فقط وليس بوابة إلزامية.</p></section>';
  const js='<script id="btcIctFastClient">(function(){const el=id=>document.getElementById(id),money=v=>v==null?"—":"$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2});async function run(){try{const r=await fetch("/api/btc-signal?_="+Date.now(),{cache:"no-store"}),d=await r.json(),cf=d.confluence||{},scores=cf.scores||{},bd=cf.breakdown||{},active=d.status==="ACTIVE"&&["BUY","SELL"].includes(d.action),selected=cf.selectedSide||d.action||"BUY";const state=el("btcFastState");state.textContent=active?(d.action==="BUY"?"شراء":"بيع"):"WAIT";state.className=active?(d.action==="BUY"?"btcFastBuy":"btcFastSell"):"btcFastWait";el("btcFastConfidence").textContent=Math.round(Number(d.confidence)||0)+"/100";el("btcFastBuyScore").textContent=Math.round(Number(scores.BUY)||0)+"/100";el("btcFastSellScore").textContent=Math.round(Number(scores.SELL)||0)+"/100";el("btcFastPrice").textContent=money(d.price);el("btcFastEntry").textContent=active?money(d.entry):"—";el("btcFastStop").textContent=active?money(d.stopLoss):"—";for(let i=1;i<=4;i++)el("btcFastTp"+i).textContent=active?money(d["target"+i]):"—";el("btcFastLot").textContent=active&&Number(d.lotSizing?.recommendedLot)>0?Number(d.lotSizing.recommendedLot).toFixed(2)+" lot":"—";el("btcFastStructure").textContent=(cf.structure?.h1||"—")+" / "+(cf.structure?.m15||"—")+" / "+(cf.structure?.m5||"—");el("btcFastMomentum").textContent="RSI5 "+(cf.momentum?.rsi5??"—")+" • RSI15 "+(cf.momentum?.rsi15??"—");el("btcFastTrigger").textContent=(cf.priceAction?.trigger?.type||cf.priceAction?.candle?.pattern||"WAIT");el("btcFastReason").textContent=d.reason||"—";el("btcFastMeta").textContent="BTC-USD • تحديث كل 5 ثوانٍ • "+(active?"إشارة مقفلة":"Confluence scan")+" • "+new Date(d.updatedAt||Date.now()).toLocaleTimeString("ar-SA",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch(e){el("btcFastMeta").textContent="تعذر تحميل BTC الآن";}setTimeout(run,5000)}run()})();</script>';
  return html.replace('</head>',css+'</head>').replace('</body>',panel+js+'</body>');
}
