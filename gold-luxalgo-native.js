const n = v => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v)) ? Number(v) : null;
const round = (v,d=3) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

const DEFAULTS = {
  length: 5,
  visibleFvgs: 2,
  visibleOrderBlocks: 3,
  liquidityLookback: 120,
  displacementBodyMultiple: 1.15,
  displacementWickRatio: 0.45
};

function minuteBars(samples=[]){
  const buckets=new Map();
  for(const s of samples){
    const t=n(s?.t),p=n(s?.p??s?.price??s?.close);
    if(t==null||p==null||p<=0)continue;
    const key=Math.floor(t/60000)*60000;
    const o=n(s?.open),h=n(s?.high),l=n(s?.low),c=n(s?.close);
    const old=buckets.get(key);
    if(!old){
      const open=o??p,high=h??p,low=l??p,close=c??p;
      buckets.set(key,{t:key,open,high,low,close});
    }else{
      old.high=Math.max(old.high,h??p);
      old.low=Math.min(old.low,l??p);
      old.close=c??p;
    }
  }
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}

function aggregate(bars,minutes){
  const span=minutes*60000,buckets=new Map();
  for(const b of bars){
    const key=Math.floor(b.t/span)*span,old=buckets.get(key);
    if(!old)buckets.set(key,{t:key,open:b.open,high:b.high,low:b.low,close:b.close});
    else{old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.close=b.close;}
  }
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}

function closed(bars,minutes,now){
  const span=minutes*60000;
  return bars.filter(b=>b.t+span<=now);
}

function mean(values){
  const x=values.filter(Number.isFinite);
  return x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
}

function atr(bars,count=14){
  const x=bars.slice(-Math.max(2,count+1));
  if(x.length<2)return null;
  const tr=[];
  for(let i=1;i<x.length;i++){
    const b=x[i],pc=x[i-1].close;
    tr.push(Math.max(b.high-b.low,Math.abs(b.high-pc),Math.abs(b.low-pc)));
  }
  return mean(tr);
}

function swingPoints(bars,length=5){
  const left=Math.max(2,Math.floor(length)),right=1,highs=[],lows=[];
  for(let i=left;i<bars.length-right;i++){
    const b=bars[i],before=bars.slice(i-left,i),after=bars.slice(i+1,i+1+right);
    if(before.every(x=>b.high>x.high)&&after.every(x=>b.high>=x.high))highs.push({index:i,t:b.t,price:b.high});
    if(before.every(x=>b.low<x.low)&&after.every(x=>b.low<=x.low))lows.push({index:i,t:b.t,price:b.low});
  }
  return{highs,lows};
}

function structureEvents(bars,length=5){
  const swings=swingPoints(bars,length);
  const pending=[
    ...swings.highs.map(x=>({...x,kind:'HIGH',broken:false})),
    ...swings.lows.map(x=>({...x,kind:'LOW',broken:false}))
  ].sort((a,b)=>a.index-b.index);
  const events=[];
  let dir=0;
  for(let i=0;i<bars.length;i++){
    const b=bars[i];
    for(const p of pending){
      if(p.broken||p.index>=i)continue;
      if(p.kind==='HIGH'&&b.close>p.price){
        const nextDir=1,type=dir===1?'BOS':'MSS';
        p.broken=true;dir=nextDir;
        events.push({type,side:'BUY',level:round(p.price),pivotTime:p.t,t:b.t,close:round(b.close)});
      }else if(p.kind==='LOW'&&b.close<p.price){
        const nextDir=-1,type=dir===-1?'BOS':'MSS';
        p.broken=true;dir=nextDir;
        events.push({type,side:'SELL',level:round(p.price),pivotTime:p.t,t:b.t,close:round(b.close)});
      }
    }
  }
  return{dir,events,latest:events.at(-1)||null,swings};
}

function latestDisplacement(bars,settings){
  const x=bars.slice(-20);
  if(x.length<8)return null;
  const bodies=x.map(b=>Math.abs(b.close-b.open));
  for(let i=x.length-1;i>=Math.max(4,x.length-8);i--){
    const b=x[i],body=Math.abs(b.close-b.open),priorMean=mean(bodies.slice(Math.max(0,i-10),i))||0;
    const upper=b.high-Math.max(b.open,b.close),lower=Math.min(b.open,b.close)-b.low;
    const compactWicks=upper<=body*settings.displacementWickRatio&&lower<=body*settings.displacementWickRatio;
    if(body>=Math.max(.01,priorMean*settings.displacementBodyMultiple)&&compactWicks){
      return{side:b.close>b.open?'BUY':'SELL',t:b.t,body:round(body),range:round(b.high-b.low),close:round(b.close)};
    }
  }
  return null;
}

function fvgList(bars,limit=2){
  const out=[];
  for(let i=2;i<bars.length;i++){
    const a=bars[i-2],c=bars[i];
    if(c.low>a.high){
      let active=true;
      for(let j=i+1;j<bars.length;j++)if(bars[j].low<=a.high){active=false;break;}
      out.push({side:'BUY',type:'BULLISH_FVG',low:round(a.high),high:round(c.low),mid:round((a.high+c.low)/2),t:c.t,active});
    }
    if(c.high<a.low){
      let active=true;
      for(let j=i+1;j<bars.length;j++)if(bars[j].high>=a.low){active=false;break;}
      out.push({side:'SELL',type:'BEARISH_FVG',low:round(c.high),high:round(a.low),mid:round((c.high+a.low)/2),t:c.t,active});
    }
  }
  return out.filter(x=>x.active).slice(-Math.max(1,limit)).reverse();
}

function clusterLevels(points,tolerance,label){
  const clusters=[];
  for(let i=0;i<points.length;i++){
    const neighbors=points.filter((p,j)=>j!==i&&Math.abs(p.price-points[i].price)<=tolerance);
    if(!neighbors.length)continue;
    const group=[points[i],...neighbors];
    const price=group.reduce((a,b)=>a+b.price,0)/group.length;
    const t=Math.max(...group.map(x=>x.t));
    if(!clusters.some(x=>Math.abs(x.price-price)<=tolerance)){
      clusters.push({label,price:round(price),touches:group.length,t});
    }
  }
  return clusters.sort((a,b)=>b.t-a.t);
}

function liquiditySnapshot(bars,length=5,lookback=120){
  const x=bars.slice(-lookback),a=atr(x,14)||1,tol=Math.max(.12,a*.12),sw=swingPoints(x,length);
  const buy=clusterLevels(sw.highs,tol,'BUYSIDE_LIQUIDITY');
  const sell=clusterLevels(sw.lows,tol,'SELLSIDE_LIQUIDITY');
  let sweep=null;
  const candidates=[...buy.slice(0,5),...sell.slice(0,5)];
  for(let i=x.length-1;i>=Math.max(1,x.length-24);i--){
    const b=x[i];
    for(const z of candidates){
      if(z.t>=b.t)continue;
      if(z.label==='BUYSIDE_LIQUIDITY'&&b.high>z.price&&b.close<z.price){
        const e={side:'SELL',event:'BUYSIDE_LIQUIDITY_SWEPT',level:z.price,extreme:round(b.high),t:b.t};
        if(!sweep||e.t>sweep.t)sweep=e;
      }
      if(z.label==='SELLSIDE_LIQUIDITY'&&b.low<z.price&&b.close>z.price){
        const e={side:'BUY',event:'SELLSIDE_LIQUIDITY_SWEPT',level:z.price,extreme:round(b.low),t:b.t};
        if(!sweep||e.t>sweep.t)sweep=e;
      }
    }
  }
  return{buySide:buy.slice(0,5),sellSide:sell.slice(0,5),sweep};
}

function latestOrderBlock(bars,structure){
  const event=structure?.latest;
  if(!event)return null;
  const idx=bars.findIndex(b=>b.t===event.t);
  if(idx<1)return null;
  for(let i=idx-1;i>=Math.max(0,idx-12);i--){
    const b=bars[i];
    const opposite=event.side==='BUY'?b.close<b.open:b.close>b.open;
    if(opposite){
      return{side:event.side,type:event.side==='BUY'?'BULLISH_OB':'BEARISH_OB',low:round(b.low),high:round(b.high),mid:round((b.low+b.high)/2),t:b.t};
    }
  }
  return null;
}

function frameSnapshot(bars,timeframe,settings){
  const structure=structureEvents(bars,settings.length);
  const fvgs=fvgList(bars,settings.visibleFvgs);
  const displacement=latestDisplacement(bars,settings);
  const liquidity=liquiditySnapshot(bars,settings.length,settings.liquidityLookback);
  const orderBlock=latestOrderBlock(bars,structure);
  const latestStructure=structure.latest;
  const currentSide=latestStructure?.side||(structure.dir===1?'BUY':structure.dir===-1?'SELL':null);
  return{
    timeframe,
    structure:latestStructure?{...latestStructure}:null,
    structureSide:currentSide,
    structureDirection:structure.dir,
    mss:structure.events.filter(x=>x.type==='MSS').at(-1)||null,
    bos:structure.events.filter(x=>x.type==='BOS').at(-1)||null,
    displacement,
    fvg:fvgs[0]||null,
    fvgs,
    orderBlock,
    liquiditySweep:liquidity.sweep,
    liquidity:{buySide:liquidity.buySide,sellSide:liquidity.sellSide},
    bars:bars.length
  };
}

function nySession(now){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const m=Number(parts.hour)*60+Number(parts.minute);
  if(m>=420&&m<540)return'NEW_YORK';
  if(m>=120&&m<300)return'LONDON_OPEN';
  if(m>=600&&m<720)return'LONDON_CLOSE';
  if(m>=1200||m<60)return'ASIA';
  return'OFF_KILLZONE';
}

export function analyzeNativeLuxAlgo(samples=[],now=Date.now(),overrides={}){
  const settings={...DEFAULTS,...overrides};
  const m1all=minuteBars(samples);
  const frames={
    '1m':frameSnapshot(closed(m1all,1,now),'1m',settings),
    '5m':frameSnapshot(closed(aggregate(m1all,5),5,now),'5m',settings),
    '15m':frameSnapshot(closed(aggregate(m1all,15),15,now),'15m',settings),
    '1h':frameSnapshot(closed(aggregate(m1all,60),60,now),'1h',settings)
  };
  const ready=frames['1h'].bars>=24&&frames['15m'].bars>=40&&frames['5m'].bars>=60;
  const h1=frames['1h'].structureSide,m15=frames['15m'].structureSide,m5=frames['5m'].structureSide;
  const bias=h1&&m15&&h1===m15?h1:h1||m15||m5||'NEUTRAL';
  return{
    source:'NATIVE_ICT_CONCEPTS',
    implementation:'LuxAlgo-style native market-structure engine',
    mode:'NATIVE',
    connected:true,
    ready,
    settings:{length:settings.length,visibleFvgs:settings.visibleFvgs,visibleOrderBlocks:settings.visibleOrderBlocks},
    session:nySession(now),
    bias,
    frames,
    updatedAt:new Date(now).toISOString()
  };
}

function eventFresh(event,tf,now){
  if(!event)return false;
  const ttl={'1m':20*60_000,'5m':90*60_000,'15m':4*60*60_000,'1h':12*60*60_000}[tf]||2*60*60_000;
  return now-event.t>=0&&now-event.t<=ttl;
}

function same(event,side,tf,now){return Boolean(event&&event.side===side&&eventFresh(event,tf,now));}
function opposite(event,side,tf,now){return Boolean(event&&event.side&&event.side!==side&&eventFresh(event,tf,now));}

function block(model,snapshot,reason,code){
  return{
    ...model,
    status:'WAIT',
    action:'WAIT',
    candidateAction:'WAIT',
    side:null,
    confidence:0,
    signalConfidence:0,
    luxalgo:{...snapshot,gate:'BLOCK',gateCode:code,gateReason:reason},
    reason:`NATIVE ICT BLOCK: ${reason}`
  };
}

export function gateGoldModelWithNativeLuxAlgo(model,samples=[],options={}){
  const now=Number(options.now)||Date.now();
  const snapshot=analyzeNativeLuxAlgo(samples,now,options.settings||{});
  const candidate=['BUY','SELL'].includes(model?.candidateAction)?model.candidateAction:['BUY','SELL'].includes(model?.side)?model.side:null;

  if(!snapshot.ready){
    return block(model,snapshot,'Native ICT engine is still building enough H1/M15/M5 history.','NATIVE_HISTORY_BUILDING');
  }

  if(!candidate){
    return{...model,luxalgo:{...snapshot,gate:'NO_CANDIDATE',gateReason:'No site-engine candidate to validate yet.'}};
  }

  const h1=snapshot.frames['1h'],m15=snapshot.frames['15m'],m5=snapshot.frames['5m'],m1=snapshot.frames['1m'];
  const h1Side=h1.structureSide,m15Side=m15.structureSide,m5Side=m5.structureSide;

  if(h1Side&&h1Side!==candidate)return block(model,snapshot,`H1 market structure is ${h1Side}, not ${candidate}.`,'H1_CONFLICT');
  if(m15Side&&m15Side!==candidate)return block(model,snapshot,`M15 market structure is ${m15Side}, not ${candidate}.`,'M15_CONFLICT');
  if(!h1Side||!m15Side)return block(model,snapshot,'Need confirmed H1 and M15 market structure before entry.','HTF_STRUCTURE_MISSING');

  if(!m5Side)return block(model,snapshot,'Need confirmed M5 MSS/BOS before entry.','M5_STRUCTURE_MISSING');
  if(m5Side!==candidate)return block(model,snapshot,`M5 market structure is ${m5Side}, not ${candidate}.`,'M5_CONFLICT');

  const fvg=m5.fvg;
  if(!fvg||fvg.side!==candidate)return block(model,snapshot,'Need an active same-side M5 FVG.','M5_FVG_MISSING');

  const disp=m5.displacement;
  if(!same(disp,candidate,'5m',now))return block(model,snapshot,'Need fresh same-side M5 displacement.','M5_DISPLACEMENT_MISSING');

  if(opposite(m1.structure,candidate,'1m',now)){
    return block(model,snapshot,`M1 timing structure is ${m1.structure.side}; wait for execution to realign.`,'M1_TIMING_CONFLICT');
  }

  const agreement={
    h1:h1Side,
    m15:m15Side,
    m5:m5Side,
    m5Fvg:fvg.type,
    m5Displacement:disp.side,
    m5LiquiditySweep:m5.liquiditySweep?.event||null,
    m1:m1.structureSide||null
  };

  return{
    ...model,
    luxalgo:{...snapshot,gate:'PASS',gateReason:`Native ICT context confirms ${candidate}: H1/M15/M5 aligned + M5 displacement + active FVG.`,agreement}
  };
}
