const BTC_MIN_CONFIDENCE=Math.max(65,Math.min(90,Number(process.env.BTC_MIN_CONFIDENCE||70)||70));
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
function analyze(data){
  const one=data.one,five=data.five,fifteen=data.fifteen,hour=data.hour,ticker=data.ticker||{};
  if(one.length<80||five.length<80||fifteen.length<80||hour.length<80)throw new Error('BTC history incomplete');
  const price=Number(ticker.price??one.at(-1).close),h1=frame(hour,'1h'),m15=frame(fifteen,'15m'),m5=frame(five,'5m'),m1=frame(one,'1m');
  const base={symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'ICT_NARRATIVE',tradeStyle:'ICT_NARRATIVE',confidence:0,scoreMeaning:'SETUP_SCORE_NOT_WIN_PROBABILITY',minimumConfidence:BTC_MIN_CONFIDENCE,price:round(price),entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,lotSizing:null,trend:`15m ${m15.structure.side||'NEUTRAL'} / 1h ${h1.structure.side||'NEUTRAL'}`,ict:compatIct(h1,m15,m5,m1,null),updatedAt:new Date().toISOString(),reason:'ICT NARRATIVE WAIT'};
  if(!h1.structure.side||!m15.structure.side)return{...base,reason:'ICT NARRATIVE WAIT — need confirmed H1 and M15 structure.'};
  if(h1.structure.side!==m15.structure.side)return{...base,confidence:45,reason:`ICT NARRATIVE WAIT — H1 ${h1.structure.side} and M15 ${m15.structure.side} disagree; no counter-trend entry.`};

  const side=h1.structure.side,sign=side==='BUY'?1:-1,a1=atr(one,14)||price*.0007,a5=atr(five,14)||price*.0015;
  const ict=compatIct(h1,m15,m5,m1,side);
  const m15Fvg=nearestSameSideFvg(m15,side,price),m15Ob=m15.orderBlock?.side===side?m15.orderBlock:null;
  const pullbackPad=Math.max(15,a5*.22);
  const inM15Poi=zoneContains(price,m15Fvg,pullbackPad)||zoneContains(price,m15Ob,pullbackPad);
  const sweep=[m15.liquiditySweep,m5.liquiditySweep,m1.liquiditySweep].filter(x=>x?.side===side).sort((a,b)=>b.t-a.t)[0]||null;
  const pullbackContext=Boolean(inM15Poi||fresh(sweep,4*60*60_000));
  if(!pullbackContext)return{...base,confidence:55,ict:{...ict,m15Poi:m15Fvg||m15Ob,pullbackContext:false},reason:`ICT NARRATIVE WAIT — ${side} HTF structure is intact; wait for retracement into same-side M15 FVG/OB or a liquidity sweep. Opposite FVG alone is not a reversal.`};

  const m5Shift=m5.structure.latest?.side===side&&fresh(m5.structure.latest,90*60_000)?m5.structure.latest:null;
  const m1Shift=m1.structure.latest?.side===side&&fresh(m1.structure.latest,30*60_000)?m1.structure.latest:null;
  const shift=m5Shift||m1Shift;
  const displacement=m5.displacement?.side===side&&fresh(m5.displacement,60*60_000)?m5.displacement:m1.displacement?.side===side&&fresh(m1.displacement,20*60_000)?m1.displacement:null;
  const executionAnchor=Math.max(Number(shift?.t)||0,Number(displacement?.t)||0);
  const executionCandidates=[...m5.fvgs,...m1.fvgs].filter(z=>z.side===side&&z.t>=executionAnchor);
  const executionFvg=executionCandidates.sort((a,b)=>Math.abs(a.mid-price)-Math.abs(b.mid-price))[0]||null;
  if(!shift||!displacement||!executionFvg){
    return{...base,confidence:62,ict:{...ict,m15Poi:m15Fvg||m15Ob,pullbackContext:true,executionShift:shift,executionDisplacement:displacement,executionFvg},reason:`ICT NARRATIVE WAIT — ${side} pullback is valid; wait for M5/M1 same-side MSS/BOS + displacement + FVG.`};
  }

  const entry=executionFvg.mid,entryPad=Math.max(12,a1*.18),entryLow=executionFvg.low-entryPad,entryHigh=executionFvg.high+entryPad;
  const insideEntry=price>=entryLow&&price<=entryHigh;
  if(!insideEntry){
    return{...base,confidence:68,ict:{...ict,m15Poi:m15Fvg||m15Ob,pullbackContext:true,executionShift:shift,executionDisplacement:displacement,executionFvg,entryZone:{low:round(entryLow),high:round(entryHigh)}},reason:'ICT NO CHASE — structure confirmed; wait for price to retrace into the execution FVG.'};
  }

  const recent=five.slice(-12),recentLow=Math.min(...recent.map(c=>c.low)),recentHigh=Math.max(...recent.map(c=>c.high)),buffer=Math.max(18,a1*.35);
  const anchor=sweep?.extreme??(side==='BUY'?recentLow:recentHigh);
  let stop=side==='BUY'?Math.min(anchor,executionFvg.low)-buffer:Math.max(anchor,executionFvg.high)+buffer;
  const risk=Math.abs(entry-stop);
  if(!(risk>0))return{...base,reason:'ICT WAIT — invalid structural stop.'};

  const pools=targetPools(side,entry,h1,m15,m5,a5);
  const minMove=Math.max(60,a5*.75);
  const usable=pools.filter(p=>Math.abs(p.price-entry)>=minMove);
  if(usable.length<4)return{...base,confidence:70,ict:{...ict,executionFvg,externalLiquidity:pools.slice(0,8)},reason:'ICT TARGET WAIT — not enough clean external-liquidity objectives beyond the entry.'};
  const targets=usable.slice(0,4),tp1=targets[0].price,rr=Math.abs(tp1-entry)/risk;
  if(rr<.8)return{...base,confidence:70,ict:{...ict,executionFvg,externalLiquidity:targets},reason:`ICT TARGET WAIT — first external liquidity offers only ${round(rr,2)}R.`};

  const totalPath=Math.abs(tp1-entry),consumed=totalPath>0?Math.abs(price-entry)/totalPath:1;
  if(consumed>.55&&!insideEntry)return{...base,confidence:68,ict:{...ict,executionFvg,pathConsumed:round(consumed,2)},reason:'ICT NO CHASE — more than half the path to external liquidity is already consumed.'};

  let score=60;
  score+=8; // H1/M15 alignment
  if(inM15Poi)score+=7;
  if(sweep)score+=5;
  if(m5Shift)score+=7;else if(m1Shift)score+=4;
  if(displacement)score+=6;
  if(executionFvg)score+=5;
  if(m1.structure.side===side)score+=2;
  score=clamp(Math.round(score),0,95);
  const active=score>=BTC_MIN_CONFIDENCE;
  const sizing=lotSizing(entry,stop);
  return{
    ...base,status:active?'ACTIVE':'WAIT',action:active?side:'WAIT',side:active?side:null,strategy:'ICT_NARRATIVE_CONTINUATION',tradeStyle:'ICT_NARRATIVE_CONTINUATION',
    confidence:score,entry:active?round(entry):null,stopLoss:active?round(stop):null,target1:active?targets[0].price:null,target2:active?targets[1].price:null,target3:active?targets[2].price:null,target4:active?targets[3].price:null,
    targetLabels:targets.map(x=>x.label),riskReward:active?round(rr,2):null,lotSizing:active?sizing:null,
    trend:`15m ${side} / 1h ${side}`,
    ict:{...ict,m15Poi:m15Fvg||m15Ob,pullbackContext:true,executionShift:shift,executionDisplacement:displacement,executionFvg,entryZone:{low:round(entryLow),high:round(entryHigh)},externalLiquidity:targets,pathConsumed:round(consumed,2),atr1:round(a1),atr5:round(a5),rsi5:null},
    reason:active?`ICT NARRATIVE CONFIRMED — ${side} H1/M15 structure; pullback into M15 POI; M5/M1 MSS/BOS + displacement + FVG; target ${targets[0].label} ${round(tp1)}.`:`ICT NARRATIVE WAIT — setup score ${score}/100 below minimum ${BTC_MIN_CONFIDENCE}.`
  };
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
  const panel='<section id="btcIctFastPanel"><div><h2>BTCUSD — ICT NARRATIVE <span class="btcFastTag">1H + 15m Context • M5/M1 Execution</span></h2><p id="btcFastMeta" class="btcFastNote">جارٍ تحميل قراءة البيتكوين…</p></div><div class="btcFastGrid"><div class="btcFastCard"><span>الحالة</span><strong id="btcFastState">WAIT</strong></div><div class="btcFastCard"><span>درجة الإعداد</span><strong id="btcFastConfidence">—</strong></div><div class="btcFastCard"><span>السعر</span><strong id="btcFastPrice">—</strong></div><div class="btcFastCard"><span>15m Structure</span><strong id="btcFastContext">—</strong></div><div class="btcFastCard"><span>1h Structure</span><strong id="btcFastTrend">—</strong></div><div class="btcFastCard"><span>الدخول</span><strong id="btcFastEntry">—</strong></div><div class="btcFastCard"><span>وقف الخسارة</span><strong id="btcFastStop">—</strong></div><div class="btcFastCard"><span>TP1</span><strong id="btcFastTp1">—</strong></div><div class="btcFastCard"><span>TP2</span><strong id="btcFastTp2">—</strong></div><div class="btcFastCard"><span>TP3</span><strong id="btcFastTp3">—</strong></div><div class="btcFastCard"><span>TP4</span><strong id="btcFastTp4">—</strong></div><div class="btcFastCard"><span>اللوت المقترح</span><strong id="btcFastLot">—</strong></div><div class="btcFastCard"><span>M15 POI</span><strong id="btcFastRsi">—</strong></div><div class="btcFastCard"><span>Execution FVG</span><strong id="btcFastFvg">—</strong></div><div class="btcFastCard"><span>MSS/BOS + Displacement</span><strong id="btcFastTrigger">—</strong></div></div><p id="btcFastReason" class="btcFastNote">السياق من H1/M15، والتنفيذ فقط بعد pullback وM5/M1 confirmation. لا SELL لمجرد وجود Bearish FVG داخل سياق صاعد.</p></section>';
  const js='<script id="btcIctFastClient">(function(){const el=id=>document.getElementById(id),money=v=>v==null?"—":"$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2}),zone=z=>z&&z.low!=null?money(z.low)+" – "+money(z.high):"—";async function run(){try{const r=await fetch("/api/btc-signal?_="+Date.now(),{cache:"no-store"}),d=await r.json(),ict=d.ict||{},active=d.status==="ACTIVE"&&["BUY","SELL"].includes(d.action);const state=el("btcFastState");state.textContent=active?(d.action==="BUY"?"شراء":"بيع"):"WAIT";state.className=active?(d.action==="BUY"?"btcFastBuy":"btcFastSell"):"btcFastWait";el("btcFastConfidence").textContent=Math.round(Number(d.confidence)||0)+"/100";el("btcFastPrice").textContent=money(d.price);el("btcFastContext").textContent=ict.context15||"—";el("btcFastTrend").textContent=ict.trend1h||"—";el("btcFastEntry").textContent=active?money(d.entry):"—";el("btcFastStop").textContent=active?money(d.stopLoss):"—";for(let i=1;i<=4;i++)el("btcFastTp"+i).textContent=active?money(d["target"+i]):"—";el("btcFastLot").textContent=active&&Number(d.lotSizing?.recommendedLot)>0?Number(d.lotSizing.recommendedLot).toFixed(2)+" lot":"—";el("btcFastRsi").textContent=zone(ict.m15Poi);el("btcFastFvg").textContent=zone(ict.executionFvg);const shift=ict.executionShift,disp=ict.executionDisplacement;el("btcFastTrigger").textContent=shift&&disp?(shift.side+" "+shift.type+" + DISP"):"WAIT";el("btcFastReason").textContent=d.reason||"—";el("btcFastMeta").textContent="BTC-USD • تحديث كل 5 ثوانٍ • "+(active?"إشارة مقفلة":"ICT Narrative scan")+" • "+new Date(d.updatedAt||Date.now()).toLocaleTimeString("ar-SA",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch(e){el("btcFastMeta").textContent="تعذر تحميل BTC الآن";}setTimeout(run,5000)}run()})();</script>';
  return html.replace('</head>',css+'</head>').replace('</body>',panel+js+'</body>');
}
