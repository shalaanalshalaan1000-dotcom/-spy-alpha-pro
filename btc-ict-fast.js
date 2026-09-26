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
function candleRead(rows){
  const last=rows.at(-1),prev=rows.at(-2);if(!last)return{side:'NEUTRAL',strength:0,pattern:'NONE'};
  const range=Math.max(.01,last.high-last.low),body=Math.abs(last.close-last.open),upper=last.high-Math.max(last.open,last.close),lower=Math.min(last.open,last.close)-last.low;
  if(prev&&last.close>last.open&&prev.close<prev.open&&last.open<=prev.close&&last.close>=prev.open)return{side:'BUY',strength:5,pattern:'BULLISH_ENGULFING'};
  if(prev&&last.close<last.open&&prev.close>prev.open&&last.open>=prev.close&&last.close<=prev.open)return{side:'SELL',strength:5,pattern:'BEARISH_ENGULFING'};
  if(lower>=Math.max(body*1.8,range*.32)&&last.close>=last.low+range*.62)return{side:'BUY',strength:4,pattern:'LOWER_REJECTION'};
  if(upper>=Math.max(body*1.8,range*.32)&&last.close<=last.low+range*.38)return{side:'SELL',strength:4,pattern:'UPPER_REJECTION'};
  if(body>=range*.58)return{side:last.close>last.open?'BUY':'SELL',strength:3,pattern:last.close>last.open?'BULLISH_IMPULSE':'BEARISH_IMPULSE'};
  return{side:last.close>last.open?'BUY':last.close<last.open?'SELL':'NEUTRAL',strength:1,pattern:'CANDLE_DIRECTION'};
}
function breakoutRead(rows,a5){
  const x=rows.slice(-36);if(x.length<12)return{side:'NEUTRAL',type:'NONE',level:null};
  const last=x.at(-1),prior=x.slice(0,-1),sw=swingPoints(prior,3);
  const recentHigh=sw.highs.at(-1)?.price??Math.max(...prior.slice(-12).map(v=>v.high));
  const recentLow=sw.lows.at(-1)?.price??Math.min(...prior.slice(-12).map(v=>v.low));
  const buffer=Math.max(4,(a5||50)*.04);
  if(last.close>recentHigh+buffer)return{side:'BUY',type:'BREAKOUT',level:round(recentHigh),close:round(last.close),t:last.t};
  if(last.close<recentLow-buffer)return{side:'SELL',type:'BREAKDOWN',level:round(recentLow),close:round(last.close),t:last.t};
  return{side:'NEUTRAL',type:'NONE',level:null,close:round(last.close),t:last.t};
}
function srSnapshot(rows){
  const x=rows.slice(-120),sw=swingPoints(x,4),price=x.at(-1)?.close;
  const highs=sw.highs.map(v=>v.price).filter(Number.isFinite),lows=sw.lows.map(v=>v.price).filter(Number.isFinite);
  const resistance=highs.filter(v=>v>price).sort((a,b)=>a-b)[0]??highs.at(-1)??null;
  const support=lows.filter(v=>v<price).sort((a,b)=>b-a)[0]??lows.at(-1)??null;
  return{support:round(support),resistance:round(resistance)};
}
function priceActionTargets(side,entry,risk,h1,m15,m5,a5){
  const pools=[];
  const add=(label,price)=>{if(Number.isFinite(price)&&(side==='BUY'?price>entry:price<entry))pools.push({label,price:round(price)});};
  const frames=[['M5',m5],['M15',m15],['H1',h1]];
  for(const [name,snap] of frames){
    const pts=side==='BUY'?snap.structure.swings.highs:snap.structure.swings.lows;
    for(const p of pts.slice(-20))add(side==='BUY'?name+'_RESISTANCE':name+'_SUPPORT',p.price);
  }
  const minGap=Math.max(35,a5*.28);
  const dedup=[];
  for(const p of pools.sort((a,b)=>Math.abs(a.price-entry)-Math.abs(b.price-entry))){
    if(Math.abs(p.price-entry)<minGap)continue;
    if(!dedup.some(x=>Math.abs(x.price-p.price)<=Math.max(12,a5*.10)))dedup.push(p);
  }
  const dir=side==='BUY'?1:-1;
  const fallback=[
    entry+dir*Math.max(minGap,risk*.80),
    entry+dir*Math.max(minGap*1.6,risk*1.25),
    entry+dir*Math.max(minGap*2.4,risk*1.80),
    entry+dir*Math.max(minGap*3.2,risk*2.50)
  ];
  const out=[],labels=[];
  for(let i=0;i<4;i++){
    let p=dedup[i]?.price??fallback[i],label=dedup[i]?.label??('PA_TP'+(i+1));
    if(i&&side==='BUY'&&p<=out[i-1]+Math.max(18,a5*.10)){p=Math.max(fallback[i],out[i-1]+Math.max(22,a5*.12));label='PA_TP'+(i+1);}
    if(i&&side==='SELL'&&p>=out[i-1]-Math.max(18,a5*.10)){p=Math.min(fallback[i],out[i-1]-Math.max(22,a5*.12));label='PA_TP'+(i+1);}
    out.push(round(p));labels.push(label);
  }
  return{targets:out,labels,levels:dedup.slice(0,8)};
}
function analyze(data){
  const one=data.one,five=data.five,fifteen=data.fifteen,hour=data.hour,ticker=data.ticker||{};
  if(one.length<80||five.length<80||fifteen.length<80||hour.length<80)throw new Error('BTC history incomplete');
  const price=Number(ticker.price??one.at(-1).close),h1=frame(hour,'1h'),m15=frame(fifteen,'15m'),m5=frame(five,'5m');
  const a5=atr(five,14)||price*.0015,a1=atr(one,14)||price*.0007;
  const context=m15.structure.side||null,bias1h=h1.structure.side||'NEUTRAL',setup5=m5.structure.side||'NEUTRAL';
  const event5=m5.structure.latest||null,eventFresh=Boolean(event5&&fresh(event5,70*60_000));
  const candle5=candleRead(five),breakout5=breakoutRead(five,a5),disp5=m5.displacement;
  const displacementFresh=Boolean(disp5&&fresh(disp5,45*60_000));
  const sr5=srSnapshot(five),sr15=srSnapshot(fifteen);
  const base={symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'PRICE_ACTION_ONLY',tradeStyle:'PRICE_ACTION_ONLY',confidence:0,scoreMeaning:'DESCRIPTIVE_SETUP_STRENGTH_NOT_WIN_PROBABILITY',price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,lotSizing:null,executionMode:'SIGNALS_ONLY',trend:`1h ${bias1h} / 15m ${context||'NEUTRAL'} / 5m ${setup5}`,priceAction:{version:'BTC_PRICE_ACTION_V1',context15:context||'NEUTRAL',bias1h,structure5:setup5,event5,candle5,breakout5,displacement5:disp5,supportResistance:{m5:sr5,m15:sr15}},updatedAt:new Date().toISOString(),reason:'PRICE ACTION WAIT — waiting for 15m context and a confirmed 5m trigger.'};

  if(!context)return{...base,confidence:25,reason:'PRICE ACTION WAIT — 15m structure is neutral; no directional context yet.'};

  const structureAligned=setup5===context;
  const freshStructureTrigger=eventFresh&&event5.side===context;
  const breakoutTrigger=breakout5.side===context;
  const candleTrigger=candle5.side===context&&candle5.strength>=4;
  const displacementTrigger=displacementFresh&&disp5?.side===context;
  const triggerReady=freshStructureTrigger||breakoutTrigger||candleTrigger||displacementTrigger;
  const setupReady=structureAligned||freshStructureTrigger||breakoutTrigger;

  let confidence=50;
  confidence+=setupReady?12:0;
  confidence+=freshStructureTrigger?12:0;
  confidence+=breakoutTrigger?10:0;
  confidence+=candleTrigger?8:0;
  confidence+=displacementTrigger?6:0;
  confidence+=bias1h===context?5:bias1h==='NEUTRAL'?0:-4;
  confidence=clamp(Math.round(confidence),20,95);
  base.confidence=confidence;

  if(!setupReady)return{...base,reason:`PRICE ACTION WAIT — 15m ${context}; 5m structure is ${setup5}. Waiting for 5m structure to align or break back ${context}.`};
  if(!triggerReady)return{...base,reason:`PRICE ACTION WAIT — 15m ${context} and 5m context are aligned, but no fresh 5m BOS/MSS, breakout, strong rejection/engulfing, or displacement yet.`};

  const side=context,dir=side==='BUY'?1:-1,recent5=five.slice(-12),sw5=m5.structure.swings;
  const lastSwing=side==='BUY'?sw5.lows.at(-1)?.price:sw5.highs.at(-1)?.price;
  const localExtreme=side==='BUY'?Math.min(...recent5.slice(-6).map(c=>c.low)):Math.max(...recent5.slice(-6).map(c=>c.high));
  const buffer=Math.max(12,a5*.12,a1*.30);
  let stop=side==='BUY'?Math.min(Number.isFinite(lastSwing)?lastSwing:localExtreme,localExtreme)-buffer:Math.max(Number.isFinite(lastSwing)?lastSwing:localExtreme,localExtreme)+buffer;
  let risk=Math.abs(price-stop);
  const minRisk=Math.max(28,a5*.28),maxRisk=Math.max(120,a5*1.8);
  if(risk<minRisk){stop=price-dir*minRisk;risk=minRisk;}
  if(risk>maxRisk){
    stop=side==='BUY'?localExtreme-buffer:localExtreme+buffer;
    risk=Math.abs(price-stop);
    if(risk>maxRisk)return{...base,reason:`PRICE ACTION WAIT — 5m trigger is valid but structural stop is too wide (${round(risk)}).`};
  }

  const entry=price,entryHalf=Math.max(10,Math.min(45,a1*.35)),chosen=priceActionTargets(side,entry,risk,h1,m15,m5,a5),targets=chosen.targets;
  const rr=Math.abs(targets[0]-entry)/risk;
  const triggers=[freshStructureTrigger?event5?.type:null,breakoutTrigger?breakout5.type:null,candleTrigger?candle5.pattern:null,displacementTrigger?'DISPLACEMENT':null].filter(Boolean);
  const h1Note=bias1h===side?'1h aligned':bias1h==='NEUTRAL'?'1h neutral':'1h opposite (bias only)';
  const pa={...base.priceAction,side,setupReady:true,triggerReady:true,triggers,targetLevels:chosen.levels,h1Note};

  return{...base,status:'ACTIVE',action:side,side,confidence,entry:round(entry),entryLow:round(entry-entryHalf),entryHigh:round(entry+entryHalf),stopLoss:round(stop),target1:targets[0],target2:targets[1],target3:targets[2],target4:targets[3],targetLabels:chosen.labels,riskReward:round(rr,2),lotSizing:lotSizing(entry,stop),priceAction:pa,reason:`PRICE ACTION ${side} — 15m ${context} context + 5m ${triggers.join(' + ')||'confirmed trigger'}; ${h1Note}.`};
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
  const panel='<section id="btcIctFastPanel"><div><h2>BTCUSD — PRICE ACTION ONLY <span class="btcFastTag">15m Context • 5m Setup + Confirmation • 1h Bias Only</span></h2><p id="btcFastMeta" class="btcFastNote">جارٍ تحميل قراءة البيتكوين…</p></div><div class="btcFastGrid"><div class="btcFastCard"><span>الحالة</span><strong id="btcFastState">WAIT</strong></div><div class="btcFastCard"><span>قوة الإعداد</span><strong id="btcFastConfidence">—</strong></div><div class="btcFastCard"><span>15m Context</span><strong id="btcFastContext">—</strong></div><div class="btcFastCard"><span>5m Structure</span><strong id="btcFastStructure">—</strong></div><div class="btcFastCard"><span>5m Trigger</span><strong id="btcFastTrigger">—</strong></div><div class="btcFastCard"><span>1h Bias</span><strong id="btcFastBias">—</strong></div><div class="btcFastCard"><span>السعر</span><strong id="btcFastPrice">—</strong></div><div class="btcFastCard"><span>الدخول</span><strong id="btcFastEntry">—</strong></div><div class="btcFastCard"><span>وقف الخسارة</span><strong id="btcFastStop">—</strong></div><div class="btcFastCard"><span>TP1</span><strong id="btcFastTp1">—</strong></div><div class="btcFastCard"><span>TP2</span><strong id="btcFastTp2">—</strong></div><div class="btcFastCard"><span>TP3</span><strong id="btcFastTp3">—</strong></div><div class="btcFastCard"><span>TP4</span><strong id="btcFastTp4">—</strong></div><div class="btcFastCard"><span>اللوت المقترح</span><strong id="btcFastLot">—</strong></div><div class="btcFastCard"><span>الاستراتيجية</span><strong>PRICE_ACTION_ONLY</strong></div></div><p id="btcFastReason" class="btcFastNote">15m يحدد السياق، 5m يؤكد الدخول. 1h Bias فقط ولا يمنع الصفقة.</p></section>';
  const js='<script id="btcIctFastClient">(function(){const el=id=>document.getElementById(id),money=v=>v==null?"—":"$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2});async function run(){try{const r=await fetch("/api/btc-signal?_="+Date.now(),{cache:"no-store"}),d=await r.json(),pa=d.priceAction||{},active=d.status==="ACTIVE"&&["BUY","SELL"].includes(d.action);const state=el("btcFastState");state.textContent=active?(d.action==="BUY"?"شراء":"بيع"):"WAIT";state.className=active?(d.action==="BUY"?"btcFastBuy":"btcFastSell"):"btcFastWait";el("btcFastConfidence").textContent=Math.round(Number(d.confidence)||0)+"/100";el("btcFastContext").textContent=pa.context15||"—";el("btcFastStructure").textContent=pa.structure5||"—";el("btcFastTrigger").textContent=(pa.triggers&&pa.triggers.length?pa.triggers.join(" + "):(pa.breakout5?.type||pa.candle5?.pattern||"WAIT"));el("btcFastBias").textContent=pa.bias1h||"—";el("btcFastPrice").textContent=money(d.price);el("btcFastEntry").textContent=active?money(d.entry):"—";el("btcFastStop").textContent=active?money(d.stopLoss):"—";for(let i=1;i<=4;i++)el("btcFastTp"+i).textContent=active?money(d["target"+i]):"—";el("btcFastLot").textContent=active&&Number(d.lotSizing?.recommendedLot)>0?Number(d.lotSizing.recommendedLot).toFixed(2)+" lot":"—";el("btcFastReason").textContent=d.reason||"—";el("btcFastMeta").textContent="BTC-USD • تحديث كل 5 ثوانٍ • "+(active?"إشارة Price Action مقفلة":"Price Action scan")+" • "+new Date(d.updatedAt||Date.now()).toLocaleTimeString("ar-SA",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch(e){el("btcFastMeta").textContent="تعذر تحميل BTC الآن";}setTimeout(run,5000)}run()})();</script>';
  return html.replace('</head>',css+'</head>').replace('</body>',panel+js+'</body>');
}
