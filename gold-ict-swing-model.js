const round=(v,d=3)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
const n=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function minuteBars(samples=[]){
  const buckets=new Map();
  for(const s of samples){
    const t=n(s?.t),p=n(s?.p??s?.price??s?.close); if(t==null||p==null||p<=0)continue;
    const key=Math.floor(t/60000)*60000;
    const o=n(s?.open),h=n(s?.high),l=n(s?.low),c=n(s?.close);
    const bar=buckets.get(key);
    if(!bar){
      const open=o??p,high=h??p,low=l??p,close=c??p;
      buckets.set(key,{t:key,open,high,low,close});
    }else{
      bar.high=Math.max(bar.high,h??p);
      bar.low=Math.min(bar.low,l??p);
      bar.close=c??p;
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
function closed(bars,minutes,now){const span=minutes*60000;return bars.filter(b=>b.t+span<=now);}
function atr(bars,count=14){
  const x=bars.slice(-Math.max(2,count+1)); if(x.length<2)return null;
  const tr=[]; for(let i=1;i<x.length;i++){const b=x[i],pc=x[i-1].close;tr.push(Math.max(b.high-b.low,Math.abs(b.high-pc),Math.abs(b.low-pc)));}
  return tr.length?tr.reduce((a,b)=>a+b,0)/tr.length:null;
}
function pivots(bars,left=2,right=2){
  const highs=[],lows=[];
  for(let i=left;i<bars.length-right;i++){
    const b=bars[i],before=bars.slice(i-left,i),after=bars.slice(i+1,i+1+right);
    if(before.every(x=>b.high>x.high)&&after.every(x=>b.high>=x.high))highs.push({t:b.t,price:b.high});
    if(before.every(x=>b.low<x.low)&&after.every(x=>b.low<=x.low))lows.push({t:b.t,price:b.low});
  }
  return{highs,lows};
}
function structureDirection(bars){
  const x=bars.slice(-30),p=pivots(x,2,2),hs=p.highs.slice(-2),ls=p.lows.slice(-2),last=x.at(-1);
  if(!last)return 0;
  if(hs.length>=2&&ls.length>=2){
    if(hs[1].price>hs[0].price&&ls[1].price>ls[0].price)return 1;
    if(hs[1].price<hs[0].price&&ls[1].price<ls[0].price)return -1;
  }
  const priorHigh=Math.max(...x.slice(-8,-1).map(b=>b.high)),priorLow=Math.min(...x.slice(-8,-1).map(b=>b.low));
  if(Number.isFinite(priorHigh)&&last.close>priorHigh)return 1;
  if(Number.isFinite(priorLow)&&last.close<priorLow)return -1;
  return 0;
}
function nyParts(ts){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return{day:parts.year+'-'+parts.month+'-'+parts.day,hour:Number(parts.hour),minute:Number(parts.minute)};
}
function hi(rows){return rows.length?Math.max(...rows.map(x=>x.high)):null;}
function lo(rows){return rows.length?Math.min(...rows.map(x=>x.low)):null;}
function sessionLevels(bars,now){
  const today=nyParts(now).day,days=[...new Set(bars.map(b=>nyParts(b.t).day))].sort(),prev=days.filter(d=>d<today).at(-1);
  const prevRows=prev?bars.filter(b=>nyParts(b.t).day===prev):[],todayRows=bars.filter(b=>nyParts(b.t).day===today);
  const asia=bars.filter(b=>{const p=nyParts(b.t);return (p.day===prev&&p.hour>=20)||(p.day===today&&p.hour<1);});
  const london=todayRows.filter(b=>{const h=nyParts(b.t).hour;return h>=2&&h<5;});
  const nyam=todayRows.filter(b=>{const h=nyParts(b.t).hour;return h>=7&&h<10;});
  const dayOpen=todayRows.at(0)?.open??null;
  return{today,prev,pdh:hi(prevRows),pdl:lo(prevRows),asiaHigh:hi(asia),asiaLow:lo(asia),londonHigh:hi(london),londonLow:lo(london),nyHigh:hi(nyam),nyLow:lo(nyam),dayOpen};
}
function activeSession(now){
  const p=nyParts(now),m=p.hour*60+p.minute;
  if(m>=120&&m<300)return'LONDON_KILLZONE';
  if(m>=420&&m<600)return'NEW_YORK_AM_KILLZONE';
  if(m>=600&&m<720)return'LONDON_CLOSE';
  return'OFF_KILLZONE';
}
function latestFvg(bars,side){
  const x=bars.slice(-18);
  for(let i=x.length-1;i>=2;i--){
    const a=x[i-2],c=x[i];
    if(side==='BUY'&&c.low>a.high)return{low:a.high,high:c.low,mid:(a.high+c.low)/2,t:c.t,type:'BULL_FVG'};
    if(side==='SELL'&&c.high<a.low)return{low:c.high,high:a.low,mid:(c.high+a.low)/2,t:c.t,type:'BEAR_FVG'};
  }
  return null;
}
function firstFvgAfter(bars,side,afterT){
  const x=bars.slice(-60),found=[];
  for(let i=2;i<x.length;i++){
    const a=x[i-2],c=x[i];
    if(afterT!=null&&c.t<afterT)continue;
    if(side==='BUY'&&c.low>a.high)found.push({low:a.high,high:c.low,mid:(a.high+c.low)/2,t:c.t,type:'BULL_FVG'});
    if(side==='SELL'&&c.high<a.low)found.push({low:c.high,high:a.low,mid:(c.high+a.low)/2,t:c.t,type:'BEAR_FVG'});
  }
  return found[0]??null;
}
function originFvg(m1,m5,side,afterT){
  const rows=[firstFvgAfter(m1,side,afterT),firstFvgAfter(m5,side,afterT)].filter(Boolean).sort((a,b)=>a.t-b.t);
  return rows[0]??null;
}
function localSweep(bars,side,levels){
  const x=bars.slice(-48); if(x.length<4)return null;
  const named=Object.entries(levels).filter(([,v])=>Number.isFinite(v));
  for(let i=x.length-1;i>=Math.max(1,x.length-30);i--){
    const b=x[i],prior=x.slice(Math.max(0,i-5),i),localLow=lo(prior),localHigh=hi(prior);
    if(side==='BUY'){
      const candidates=[...named.filter(([k])=>/Low|pdl/i.test(k)),['localSellSide',localLow]].filter(([,v])=>Number.isFinite(v));
      for(const [name,v] of candidates)if(b.low<v&&b.close>v)return{name,level:v,extreme:b.low,t:b.t};
    }else{
      const candidates=[...named.filter(([k])=>/High|pdh/i.test(k)),['localBuySide',localHigh]].filter(([,v])=>Number.isFinite(v));
      for(const [name,v] of candidates)if(b.high>v&&b.close<v)return{name,level:v,extreme:b.high,t:b.t};
    }
  }
  return null;
}
function displacementAndMss(bars,side,atr5){
  const x=bars.slice(-8),last=x.at(-1); if(x.length<5||!last)return{displacement:false,mss:false};
  const body=Math.abs(last.close-last.open),range=Math.max(.0001,last.high-last.low),prior=x.slice(-5,-1);
  const priorHigh=hi(prior),priorLow=lo(prior);
  const displacement=body>=Math.max((atr5||1)*.45,.45)&&(side==='BUY'?last.close>=last.low+range*.72:last.close<=last.high-range*.72);
  const mss=side==='BUY'?last.close>priorHigh:last.close<priorLow;
  return{displacement,mss,body:round(body),priorHigh:round(priorHigh),priorLow:round(priorLow)};
}
function shiftAfter(bars,side,afterT,atrValue){
  const x=bars.slice(-72); if(x.length<6)return null;
  for(let i=4;i<x.length;i++){
    const last=x[i]; if(afterT!=null&&last.t<afterT)continue;
    const prior=x.slice(i-4,i),priorHigh=hi(prior),priorLow=lo(prior);
    const body=Math.abs(last.close-last.open),range=Math.max(.0001,last.high-last.low);
    const displacement=body>=Math.max((atrValue||1)*.45,.45)&&(side==='BUY'?last.close>=last.low+range*.72:last.close<=last.high-range*.72);
    const mss=side==='BUY'?last.close>priorHigh:last.close<priorLow;
    if(mss||displacement)return{mss,displacement,body:round(body),priorHigh:round(priorHigh),priorLow:round(priorLow),t:last.t};
  }
  return null;
}
function sequenceAfter(bars,side,afterT,atrValue,spanMs=60000){
  const x=bars.slice(-96); if(x.length<6)return{firstAny:null,firstMss:null,firstDisplacement:null,complete:false,completeAt:null};
  let firstAny=null,firstMss=null,firstDisplacement=null;
  for(let i=4;i<x.length;i++){
    const last=x[i],barCloseT=last.t+spanMs; if(afterT!=null&&barCloseT<=afterT)continue;
    const prior=x.slice(i-4,i),priorHigh=hi(prior),priorLow=lo(prior);
    const body=Math.abs(last.close-last.open),range=Math.max(.0001,last.high-last.low);
    const displacement=body>=Math.max((atrValue||1)*.45,.45)&&(side==='BUY'?last.close>=last.low+range*.72:last.close<=last.high-range*.72);
    const mss=side==='BUY'?last.close>priorHigh:last.close<priorLow;
    if(!(mss||displacement))continue;
    const event={mss,displacement,body:round(body),priorHigh:round(priorHigh),priorLow:round(priorLow),t:last.t,closeT:barCloseT};
    if(!firstAny)firstAny=event;
    if(mss&&!firstMss)firstMss=event;
    if(displacement&&!firstDisplacement)firstDisplacement=event;
    if(firstMss&&firstDisplacement)break;
  }
  const complete=Boolean(firstMss&&firstDisplacement),completeAt=complete?Math.max(firstMss.closeT??firstMss.t,firstDisplacement.closeT??firstDisplacement.t):null;
  return{firstAny,firstMss,firstDisplacement,complete,completeAt};
}
function recentSweeps(bars,side,levels,limit=12){
  const x=bars.slice(-120); if(x.length<4)return[];
  const named=Object.entries(levels).filter(([,v])=>Number.isFinite(v)),out=[],seen=new Set();
  for(let i=x.length-1;i>=Math.max(1,x.length-72)&&out.length<limit;i--){
    const b=x[i],prior=x.slice(Math.max(0,i-5),i),localLow=lo(prior),localHigh=hi(prior);
    const candidates=side==='BUY'
      ?[...named.filter(([k])=>/Low|pdl/i.test(k)),['localSellSide',localLow]]
      :[...named.filter(([k])=>/High|pdh/i.test(k)),['localBuySide',localHigh]];
    for(const [name,v] of candidates){
      if(!Number.isFinite(v))continue;
      const swept=side==='BUY'?(b.low<v&&b.close>v):(b.high>v&&b.close<v);
      if(!swept)continue;
      const key=[b.t,name,round(v)].join('|'); if(seen.has(key))continue; seen.add(key);
      out.push({name,level:v,extreme:side==='BUY'?b.low:b.high,t:b.t});
      if(out.length>=limit)break;
    }
  }
  return out.sort((a,b)=>b.t-a.t);
}
function selectSweepSequence({m1,m5,m15,side,levels,atr1,atr5,atr15,now}){
  const rows=[
    ...recentSweeps(m5,side,levels,10).map(x=>({...x,tf:5})),
    ...recentSweeps(m1,side,levels,14).map(x=>({...x,tf:1})),
    ...recentSweeps(m15,side,levels,6).map(x=>({...x,tf:15}))
  ].filter(x=>now-x.t>=0&&now-x.t<=120*60_000);
  let best=null;
  for(const sweep of rows){
    const seq5=sequenceAfter(m5,side,sweep.t,atr5,300000),seq1=sequenceAfter(m1,side,sweep.t,atr1,60000);
    const firstMss=[seq5?.firstMss,seq1?.firstMss].filter(Boolean).sort((a,b)=>(a.closeT??a.t)-(b.closeT??b.t))[0]??null;
    const firstDisplacement=[seq5?.firstDisplacement,seq1?.firstDisplacement].filter(Boolean).sort((a,b)=>(a.closeT??a.t)-(b.closeT??b.t))[0]??null;
    const complete=Boolean(firstMss&&firstDisplacement),progress=(firstMss?1:0)+(firstDisplacement?1:0);
    const named=!/^local/i.test(String(sweep.name||'')),ageMin=Math.max(0,(now-sweep.t)/60000);
    const quality=(complete?1000:0)+progress*120+(named?28:0)+(sweep.tf===5?12:sweep.tf===1?8:3)-ageMin*.08;
    const candidate={sweep,seq5,seq1,firstMss,firstDisplacement,complete,quality};
    if(!best||candidate.quality>best.quality||(candidate.quality===best.quality&&sweep.t>best.sweep.t))best=candidate;
  }
  return best;
}

function latestBos(bars,side){
  const x=bars.slice(-48); if(x.length<8)return{broken:false,level:null,t:null};
  const p=pivots(x,2,2),points=(side==='BUY'?p.highs:p.lows).slice().reverse();
  for(const pivot of points){
    const later=x.filter(b=>b.t>pivot.t);
    const breakBar=later.find(b=>side==='BUY'?b.close>pivot.price:b.close<pivot.price);
    if(breakBar)return{broken:true,level:round(pivot.price),pivotTime:pivot.t,t:breakBar.t};
  }
  return{broken:false,level:null,t:x.at(-1)?.t??null};
}
function oneMinuteConfirm(bars,side){
  const x=bars.slice(-4); if(x.length<3)return false;
  const closes=x.map(b=>b.close);
  return side==='BUY'?closes.at(-1)>closes.at(-2)&&closes.at(-2)>=closes.at(-3):closes.at(-1)<closes.at(-2)&&closes.at(-2)<=closes.at(-3);
}
function dedupePools(pools,side,entry){
  const filtered=pools.filter(x=>Number.isFinite(x.price)&&(side==='BUY'?x.price>entry:x.price<entry)).sort((a,b)=>side==='BUY'?a.price-b.price:b.price-a.price);
  const out=[];
  for(const p of filtered)if(!out.some(x=>Math.abs(x.price-p.price)<.20))out.push(p);
  return out;
}
function equalLiquidity(bars,side,atrValue){
  const p=pivots(bars.slice(-120),2,2),pts=side==='BUY'?p.highs:p.lows,tol=Math.max(.18,(Number(atrValue)||1)*.18),clusters=[];
  for(let i=0;i<pts.length;i++){
    const group=pts.filter((x,j)=>j!==i&&Math.abs(x.price-pts[i].price)<=tol);
    if(group.length){
      const all=[pts[i],...group],price=all.reduce((a,b)=>a+b.price,0)/all.length;
      clusters.push({label:side==='BUY'?'EQH_BUY_SIDE':'EQL_SELL_SIDE',price:round(price),touches:all.length,t:Math.max(...all.map(x=>x.t))});
    }
  }
  return clusters.sort((a,b)=>b.t-a.t).filter((x,i,a)=>a.findIndex(y=>Math.abs(y.price-x.price)<=tol)===i).slice(0,4);
}
function orderBlockBeforeShift(bars,side,shiftT){
  const x=bars.filter(b=>shiftT==null||b.t<=shiftT).slice(-24);
  for(let i=x.length-2;i>=0;i--){
    const b=x[i],bear=b.close<b.open,bull=b.close>b.open;
    if((side==='BUY'&&bear)||(side==='SELL'&&bull)){
      return{type:side==='BUY'?'BULLISH_OB':'BEARISH_OB',low:round(b.low),high:round(b.high),mid:round((b.low+b.high)/2),t:b.t};
    }
  }
  return null;
}
function dealingRangeContext(h1,h4,price,side){
  const rows=[...h4.slice(-8),...h1.slice(-24)];
  const high=hi(rows),low=lo(rows),eq=Number.isFinite(high)&&Number.isFinite(low)?(high+low)/2:null;
  if(eq==null)return{high:null,low:null,equilibrium:null,location:'UNKNOWN',preferred:false};
  const location=price<eq?'DISCOUNT':price>eq?'PREMIUM':'EQUILIBRIUM';
  return{high:round(high),low:round(low),equilibrium:round(eq),location,preferred:side==='BUY'?price<=eq:price>=eq};
}
function ictPhase({hasSweep,firstShift,originFvg,price,entryLow,entryHigh,hasBos,target}){
  if(!hasSweep)return'WAITING_FOR_LIQUIDITY';
  if(!firstShift)return'LIQUIDITY_TAKEN';
  if(!originFvg)return'DISPLACEMENT_WITHOUT_POI';
  if(Number.isFinite(entryLow)&&Number.isFinite(entryHigh)&&price>=entryLow&&price<=entryHigh)return'RETRACE_INTO_POI';
  if(hasBos&&Number.isFinite(target))return'EXPANSION_TO_EXTERNAL_LIQUIDITY';
  return'WAITING_FOR_POI_RETRACE';
}
function choosePoi(side,fvg,ob,range){
  if(!fvg)return null;
  let low=Math.min(fvg.low,fvg.high),high=Math.max(fvg.low,fvg.high);
  if(ob){
    const overlapLow=Math.max(low,Math.min(ob.low,ob.high)),overlapHigh=Math.min(high,Math.max(ob.low,ob.high));
    if(overlapLow<=overlapHigh){low=overlapLow;high=overlapHigh;}
  }
  const mid=(low+high)/2;
  return{type:ob?'FVG_OB_CONFLUENCE':'FVG',low:round(low),high:round(high),mid:round(mid),fvg,orderBlock:ob,rangeLocation:range?.location||'UNKNOWN'};
}
function targetPlan(side,entry,stop,levels,m1,m5,m15,h1,h4,atr1,atr5){
  const risk=Math.abs(entry-stop); if(!(risk>0))return null;
  const p5=pivots(m5.slice(-96),2,2),p15=pivots(m15.slice(-64),2,2),pH1=pivots(h1.slice(-72),2,2),pH4=pivots(h4.slice(-36),2,2);
  const eq5=equalLiquidity(m5,side,atr5),eq15=equalLiquidity(m15,side,atr5*2),eqH1=equalLiquidity(h1,side,atr5*3);
  const pools=[
    {label:'PDH',price:levels.pdh},{label:'PDL',price:levels.pdl},
    {label:'ASIA_HIGH',price:levels.asiaHigh},{label:'ASIA_LOW',price:levels.asiaLow},
    {label:'LONDON_HIGH',price:levels.londonHigh},{label:'LONDON_LOW',price:levels.londonLow},
    {label:'NY_AM_HIGH',price:levels.nyHigh},{label:'NY_AM_LOW',price:levels.nyLow},
    ...p5.highs.slice(-10).map(x=>({label:'M5_BUY_SIDE',price:x.price})),
    ...p5.lows.slice(-10).map(x=>({label:'M5_SELL_SIDE',price:x.price})),
    ...p15.highs.slice(-8).map(x=>({label:'M15_BUY_SIDE',price:x.price})),
    ...p15.lows.slice(-8).map(x=>({label:'M15_SELL_SIDE',price:x.price})),
    ...pH1.highs.slice(-6).map(x=>({label:'H1_BUY_SIDE',price:x.price})),
    ...pH1.lows.slice(-6).map(x=>({label:'H1_SELL_SIDE',price:x.price})),
    ...pH4.highs.slice(-4).map(x=>({label:'H4_BUY_SIDE',price:x.price})),
    ...pH4.lows.slice(-4).map(x=>({label:'H4_SELL_SIDE',price:x.price})),
    ...eq5,...eq15,...eqH1
  ];
  const MIN_TARGET_MOVE=5;
  const priority=label=>/^H4_/.test(label)?0:/^H1_|^PDH$|^PDL$/.test(label)?1:/^EQH_|^EQL_/.test(label)?2:/^M15_|^ASIA_|^LONDON_|^NY_AM_/.test(label)?3:4;
  const all=dedupePools(pools,side,entry);
  const external=all.filter(x=>Math.abs(x.price-entry)>=MIN_TARGET_MOVE)
    .sort((a,b)=>priority(a.label)-priority(b.label)||Math.abs(a.price-entry)-Math.abs(b.price-entry));
  if(!external.length)return null;
  const targets=[];
  let prev=entry;
  for(const pool of external){
    if(targets.length>=4)break;
    if(Math.abs(pool.price-prev)<1)continue;
    targets.push({label:pool.label,price:round(pool.price)});
    prev=pool.price;
  }
  if(!targets.length)return null;
  const rr=Math.abs(targets[0].price-entry)/risk;
  return{risk,rr,targets,mode:'ICT_EXTERNAL_LIQUIDITY',minimumTargetMove:MIN_TARGET_MOVE,mainLiquidity:targets[0]};
}

export function analyzeGoldSignal(samples,rawPrice,now=Date.now()){
  const price=n(rawPrice),m1all=minuteBars(samples),m5all=aggregate(m1all,5),m15all=aggregate(m1all,15),h1all=aggregate(m1all,60),h4all=aggregate(m1all,240);
  const m1=closed(m1all,1,now),m5=closed(m5all,5,now),m15=closed(m15all,15,now),h1=closed(h1all,60,now),h4=closed(h4all,240,now);
  const base={status:'COLLECTING',action:'WAIT',candidateAction:'WAIT',side:null,strategy:'ICT_TOP_DOWN',confidence:0,price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,oneMinuteConfirmed:false,contextBias:'NEUTRAL',ict:null,sampleCount:samples.length,modelTimeframes:{context:'4H/1H',bias:'15m',setup:'5m liquidity/FVG',execution:'1m/5m MSS/FVG',timing:'1m'},updatedAt:new Date(now).toISOString(),reason:'ICT engine is collecting enough HTF history'};
  if(price==null||m1.length<120||m5.length<30||m15.length<20||h1.length<12||h4.length<3)return base;

  const levels=sessionLevels(m15,now),session=activeSession(now),dir4=structureDirection(h4),dir1=structureDirection(h1),dir15=structureDirection(m15);
  const rangeRows=h1.slice(-24),rangeHigh=hi(rangeRows),rangeLow=lo(rangeRows),equilibrium=Number.isFinite(rangeHigh)&&Number.isFinite(rangeLow)?(rangeHigh+rangeLow)/2:null;
  const location=equilibrium==null?'UNKNOWN':price<=equilibrium?'DISCOUNT':'PREMIUM';
  const atr1=atr(m1,14)||.25,atr5=atr(m5,14)||1,atr15=atr(m15,14)||2;
  const offSession=session==='OFF_KILLZONE';
  const build15=side=>{
    const sign=side==='BUY'?1:-1,fvg=latestFvg(m15,side),sweep=localSweep(m15,side,levels),dm=displacementAndMss(m15,side,atr15);
    const coreVotes=[Boolean(sweep),Boolean(fvg),Boolean(dm.displacement||dm.mss)].filter(Boolean).length;
    const structureAligned=dir15===sign;
    const tieScore=coreVotes*10+(structureAligned?3:0)+(dir1===sign?2:0)+(dir4===sign?1:0);
    return{side,sign,fvg,sweep,dm,coreVotes,structureAligned,tieScore};
  };
  const buy15=build15('BUY'),sell15=build15('SELL');
  // M15 is context only. The execution side is selected from fresh M5 evidence first so
  // the engine does not wait for a slow 15m MSS after the move has already expanded.
  const build5Preview=side=>{
    const sign=side==='BUY'?1:-1,fvg=latestFvg(m5,side),dm=displacementAndMss(m5,side,atr5),bos=latestBos(m5,side);
    const seqPick=selectSweepSequence({m1,m5,m15,side,levels,atr1,atr5,atr15,now});
    const sweep=seqPick?.sweep??null,sweep5=sweep?.tf===5?sweep:null,sweep1=sweep?.tf===1?sweep:null;
    const namedSweep=Boolean(sweep&&!/^local/i.test(String(sweep.name||''))),freshSweep=Boolean(sweep&&now-sweep.t>=0&&now-sweep.t<=120*60_000);
    const seq5=seqPick?.seq5??null,seq1=seqPick?.seq1??null,firstMss=seqPick?.firstMss??null,firstDisplacement=seqPick?.firstDisplacement??null;
    const sequenceAt=firstMss&&firstDisplacement?Math.max(firstMss.closeT??firstMss.t,firstDisplacement.closeT??firstDisplacement.t):null;
    const origin=sequenceAt!=null?originFvg(m1,m5,side,sequenceAt-1):null;
    const freshSequence=Boolean(freshSweep&&firstMss&&firstDisplacement);
    const freshReversal=Boolean(freshSequence&&origin);
    const freshBos=Boolean(bos?.broken&&now-bos.t>=0&&now-bos.t<=120*60_000);
    const directionalBreak=Boolean(dm.mss||dm.displacement);
    const score=(freshSequence?70:0)+(freshReversal?20:0)+(namedSweep?12:0)+(freshSweep?18:0)+(freshBos?16:0)+(directionalBreak?12:0)+(fvg?6:0)+(dir15===sign?3:0)+(dir1===sign?1:0);
    return{side,sign,fvg,sweep,sweep5,sweep1,namedSweep,freshSweep,seq5,seq1,firstMss,firstDisplacement,sequenceAt,origin,freshSequence,freshReversal,dm,bos,freshBos,directionalBreak,score};
  };
  const buy5Preview=build5Preview('BUY'),sell5Preview=build5Preview('SELL');
  const reversalWinner=[buy5Preview,sell5Preview].filter(x=>x.freshReversal).sort((a,b)=>(b.sequenceAt||0)-(a.sequenceAt||0)||(b.sweep?.t||0)-(a.sweep?.t||0))[0]??null;
  const lowerTfWinner=reversalWinner??(buy5Preview.score>sell5Preview.score?buy5Preview:sell5Preview.score>buy5Preview.score?sell5Preview:null);
  let setup15=lowerTfWinner&&lowerTfWinner.score>=28
    ?(lowerTfWinner.side==='BUY'?buy15:sell15)
    :(buy15.tieScore>sell15.tieScore?buy15:sell15.tieScore>buy15.tieScore?sell15:(dir15===1?buy15:dir15===-1?sell15:dir1===1?buy15:dir1===-1?sell15:buy15));
  if((!lowerTfWinner||lowerTfWinner.score<28)&&setup15.coreVotes<1&&dir15===0)return{...base,status:'WAIT',candidateAction:'WAIT',confidence:0,contextBias:dir1===1?'BUY':dir1===-1?'SELL':'NEUTRAL',ict:{dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),offSession,buy15:{coreVotes:buy15.coreVotes,structureAligned:buy15.structureAligned},sell15:{coreVotes:sell15.coreVotes,structureAligned:sell15.structureAligned},buy5Preview:{score:buy5Preview.score,freshSweep:buy5Preview.freshSweep,freshBos:buy5Preview.freshBos},sell5Preview:{score:sell5Preview.score,freshSweep:sell5Preview.freshSweep,freshBos:sell5Preview.freshBos}},reason:'ICT FAST WAIT: M15 is context only; waiting for a fresh M5 liquidity/structure trigger'};

  const side=setup15.side,trendSign=setup15.sign;
  const contextAligned=dir4===trendSign,biasAligned=dir1===trendSign,setupAligned=dir15===trendSign;
  const locationOk=side==='BUY'?location==='DISCOUNT':location==='PREMIUM';
  const oneMinuteConfirmed=oneMinuteConfirm(m1,side);
  const fvg15=setup15.fvg,sweep15=setup15.sweep,dm15=setup15.dm,setupVotes=setup15.coreVotes,setupReady=setupVotes>=2;
  const fvg5=latestFvg(m5,side),sweep5=localSweep(m5,side,levels),dm5=displacementAndMss(m5,side,atr5),bos5=latestBos(m5,side);
  const fvg1=latestFvg(m1,side),sweep1=localSweep(m1,side,levels),dm1=displacementAndMss(m1,side,atr1),bos1=latestBos(m1,side);
  const bos15=latestBos(m15,side);
  // Execution hierarchy: keep the best live sweep anchor for up to two hours.
  // A later micro-sweep must not erase an earlier sweep that already produced MSS/displacement.
  const sweepState=selectSweepSequence({m1,m5,m15,side,levels,atr1,atr5,atr15,now});
  const legSweep=sweepState?.sweep??null;
  const hasSweep=Boolean(legSweep);
  const sequence5=sweepState?.seq5??null;
  const sequence1=sweepState?.seq1??null;
  const shift5=sequence5?.firstAny??null;
  const shift1=sequence1?.firstAny??null;
  const shift15=hasSweep?shiftAfter(m15,side,legSweep.t,atr15):null;
  const shiftEvents=[shift5,shift1].filter(Boolean).sort((a,b)=>(a.closeT??a.t)-(b.closeT??b.t));
  const firstShift=shiftEvents[0]??null;
  const firstMssEvent=sweepState?.firstMss??null;
  const firstDisplacementEvent=sweepState?.firstDisplacement??null;
  const hasShift=Boolean(firstMssEvent);
  const hasDisplacement=Boolean(firstDisplacementEvent);
  // A valid reversal sequence is chronological: freshest liquidity sweep -> MSS and displacement
  // (they may occur on separate 1m/5m candles) -> first NEW FVG. H1/M15 remain context only.
  const sequenceShiftT=hasShift&&hasDisplacement?Math.max(firstMssEvent.closeT??firstMssEvent.t,firstDisplacementEvent.closeT??firstDisplacementEvent.t):null;
  const hasBos=Boolean((bos5.broken&&(!legSweep||bos5.t>=legSweep.t))||(bos1.broken&&(!legSweep||bos1.t>=legSweep.t)));
  const reversalAnchor=sequenceShiftT;
  const continuationAnchor=[bos5,bos1].filter(x=>x?.broken).sort((a,b)=>a.t-b.t)[0]?.t??null;
  const contShift1=continuationAnchor!=null?shiftAfter(m1,side,continuationAnchor,atr1):null;
  const contShift5=continuationAnchor!=null?shiftAfter(m5,side,continuationAnchor,atr5):null;
  const contShiftEvents=[contShift1,contShift5].filter(Boolean).sort((a,b)=>a.t-b.t);
  const continuationDisplacementEvent=contShiftEvents.find(x=>x.displacement)??null;
  const contDisplacement=Boolean(continuationDisplacementEvent);
  const reversalFvg=reversalAnchor!=null?originFvg(m1,m5,side,reversalAnchor):null;
  // Continuation FVG must also be created after the post-BOS displacement, never before it.
  const continuationFvg=continuationDisplacementEvent?originFvg(m1,m5,side,continuationDisplacementEvent.t):null;
  const sequenceConfirmed=Boolean(hasSweep&&hasShift&&hasDisplacement);
  const structureAligned=Boolean(setupAligned||biasAligned||contextAligned);
  const reversal=Boolean(reversalFvg&&sequenceConfirmed);
  const continuation=Boolean(continuationFvg&&structureAligned&&hasBos&&contDisplacement);
  const directContinuation=Boolean(sequenceConfirmed&&structureAligned&&hasBos);
  const executionReady=Boolean(reversal||continuation||directContinuation);
  const selectedFvg=reversal?reversalFvg:(continuation?continuationFvg:(reversalFvg??continuationFvg??fvg1??fvg5??null));
  const contextSequence=reversal?'LIQUIDITY_SWEEP -> MSS/DISPLACEMENT -> ORIGIN_FVG':continuation?'TREND_STRUCTURE -> BOS -> DISPLACEMENT -> FVG':'LIQUIDITY_SWEEP -> MSS/DISPLACEMENT -> BOS -> CONFIRMED_CONTINUATION';

  if(!executionReady)return{...base,status:'WAIT',candidateAction:side,confidence:0,contextBias:side,oneMinuteConfirmed,ict:{dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),offSession,contextAligned,biasAligned,setupAligned,setupVotes,setupReady,fvg15,sweep15,dm15,fvg5,sweep5,dm5,bos5,fvg1,sweep1,dm1,bos1,bos15,legSweep,sequence1,sequence5,shift1,shift5,shift15,firstMssEvent,firstDisplacementEvent,sequenceShiftT,sequenceComplete:Boolean(sequenceShiftT),hasSweep,hasShift,hasDisplacement,hasBos,contextSequence},reason:'ICT CONTEXT WAIT: waiting for a preserved liquidity sweep to produce MSS + displacement; after confirmation the engine may use either an Origin FVG retest or a controlled continuation entry'};

  const setupType=reversal?'ICT_ORIGIN_REVERSAL':continuation?'ICT_ORIGIN_CONTINUATION':'ICT_CONFIRMED_CONTINUATION';
  const fvg=selectedFvg,shiftT=reversal?firstShift?.t:continuationAnchor;
  const orderBlock=orderBlockBeforeShift(reversal?m1:m5,side,shiftT);
  const rangeContext=dealingRangeContext(h1,h4,price,side);
  const originPoi=fvg?choosePoi(side,fvg,orderBlock,rangeContext):null;
  const originPad=clamp(atr1*.16,.05,.16);
  const originEntryLow=originPoi?originPoi.low-originPad:null,originEntryHigh=originPoi?originPoi.high+originPad:null;
  const insideOriginPoi=originPoi&&price>=originEntryLow&&price<=originEntryHigh;
  const useDirectContinuation=Boolean(directContinuation&&!insideOriginPoi);
  const directPad=clamp(atr1*.20,.08,.22);
  const poi=useDirectContinuation?{type:'STRUCTURE_CONTINUATION',low:round(price-directPad),high:round(price+directPad),mid:round(price),fvg:fvg||null,orderBlock,rangeLocation:rangeContext?.location||'UNKNOWN'}:originPoi;
  if(!poi)return{...base,status:'WAIT',candidateAction:side,contextBias:side,ict:{dir4,dir1,dir15,levels,session,contextSequence,legSweep,sequence1,sequence5,hasSweep,hasShift,hasDisplacement,hasBos,directContinuation},reason:'ICT WAIT: structure confirmed but no valid entry zone is available yet'};
  const entry=poi.mid,entryPad=useDirectContinuation?directPad:originPad,entryLow=useDirectContinuation?poi.low:poi.low-entryPad,entryHigh=useDirectContinuation?poi.high:poi.high+entryPad;
  const zoneAgeMs=fvg?now-fvg.t:0;
  if(!useDirectContinuation&&fvg&&zoneAgeMs>75*60_000)return{...base,status:'WAIT',candidateAction:side,contextBias:side,ict:{dir4,dir1,dir15,levels,session,contextSequence,originFvg:fvg,zoneAgeMinutes:round(zoneAgeMs/60000,1)},reason:'ICT MOVE CONSUMED: origin FVG is too old; wait for a new liquidity sweep / structure leg'};
  const buffer=clamp(atr1*.35,.15,.45);
  const recent=m1.slice(-16),fallbackExtreme=side==='BUY'?lo(recent):hi(recent);
  const sweep=legSweep;
  const anchor=useDirectContinuation?fallbackExtreme:(sweep?.extreme??fallbackExtreme);
  const stop=side==='BUY'?anchor-buffer:anchor+buffer;
  const risk=Math.abs(entry-stop);
  if(!(risk>=.30))return{...base,status:'WAIT',candidateAction:side,contextBias:side,ict:{dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),sweep,fvg,setupVotes},reason:'ICT WAIT: structural invalidation is too close to entry'};

  const plan=targetPlan(side,entry,stop,levels,m1,m5,m15,h1,h4,atr1,atr5);
  if(!plan)return{...base,status:'WAIT',candidateAction:side,contextBias:side,oneMinuteConfirmed,ict:{dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),sweep,fvg,orderBlock,poi,rangeContext,offSession,contextAligned,biasAligned,setupAligned,setupVotes,setupReady},reason:'ICT TARGET WAIT: no meaningful external liquidity draw at least $5 from the origin entry'};
  const mainTarget=plan.targets[0]?.price??null;
  const referenceEntry=originPoi?.mid??entry,totalPath=mainTarget==null?null:Math.abs(mainTarget-referenceEntry),travelled=Math.abs(price-referenceEntry),pathConsumed=totalPath>0?travelled/totalPath:0;
  const insidePoi=price>=entryLow&&price<=entryHigh;
  const phase=useDirectContinuation?'CONFIRMED_CONTINUATION_ENTRY':ictPhase({hasSweep,firstShift,originFvg:fvg,price,entryLow,entryHigh,hasBos,target:mainTarget});
  if(useDirectContinuation&&pathConsumed>=.40)return{...base,status:'WAIT',candidateAction:side,contextBias:side,ict:{dir4,dir1,dir15,levels,session,phase,contextSequence,legSweep,sequence1,sequence5,firstShift,orderBlock,poi,rangeContext,mainLiquidity:plan.mainLiquidity,pathConsumed:round(pathConsumed,2),directContinuation:true},reason:'ICT NO CHASE: continuation confirmed but more than 40% of the path to external liquidity is already consumed'};
  const lateMove=!useDirectContinuation&&pathConsumed>=.55&&!insidePoi;
  if(lateMove)return{...base,status:'WAIT',candidateAction:side,contextBias:side,ict:{dir4,dir1,dir15,levels,session,phase,contextSequence,legSweep,sequence1,sequence5,firstShift,orderBlock,poi,rangeContext,mainLiquidity:plan.mainLiquidity,pathConsumed:round(pathConsumed,2)},reason:'ICT NO CHASE: more than half of the path to external liquidity is already consumed; wait for a fresh liquidity event / new dealing range'};
  let confidence=55;
  if(sequenceConfirmed)confidence+=6;
  if(directContinuation)confidence+=2;
  // Confidence is driven primarily by the M5 execution sequence. M15/H1 are context bonuses only.
  if(sweep5)confidence+=12;
  if(dm5.mss)confidence+=10;
  if(dm5.displacement)confidence+=10;
  if(bos5.broken)confidence+=8;
  if(fvg5)confidence+=7;
  if(fvg1)confidence+=4;
  if(sweep1)confidence+=3;
  if(dm1.mss)confidence+=4;
  if(dm1.displacement)confidence+=3;
  if(bos1.broken)confidence+=3;
  if(sweep15)confidence+=2;
  if(fvg15)confidence+=2;
  if(dm15.mss)confidence+=2;
  if(dm15.displacement)confidence+=2;
  if(bos15.broken)confidence+=1;
  if(setupAligned)confidence+=2;
  if(biasAligned)confidence+=2;
  if(contextAligned)confidence+=1;
  if(locationOk)confidence+=3;
  if(session==='LONDON_KILLZONE'||session==='NEW_YORK_AM_KILLZONE')confidence+=2;
  if(oneMinuteConfirmed)confidence+=1;
  confidence=Math.min(95,confidence);
  const targets=plan.targets.map(x=>round(x.price));
  const labels=plan.targets.map(x=>x.label);
  const drawOnLiquidity=labels[0]||'OPPOSING_LIQUIDITY';
  return{...base,status:'CANDIDATE',candidateAction:side,side,strategy:setupType,confidence,contextBias:side,oneMinuteConfirmed,setupId:[side,setupType,sweep?.t??fvg?.t??now,round(entry),round(stop),drawOnLiquidity].join('|'),entry:round(entry),entryLow:round(entryLow),entryHigh:round(entryHigh),stopLoss:round(stop),target1:targets[0]??null,target2:targets[1]??null,target3:targets[2]??null,target4:targets[3]??null,targetLabels:labels,riskReward:round(plan.rr,2),ict:{setupType,mode:'ICT_NARRATIVE_ENGINE',phase,dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),dealingRangeHigh:round(rangeHigh),dealingRangeLow:round(rangeLow),rangeContext,contextAligned,biasAligned,setupAligned,setupReady,executionReady,setupVotes,contextSequence,hasSweep,hasShift,hasDisplacement,hasBos,legSweep,sequence1,sequence5,firstShift,firstMssEvent,firstDisplacementEvent,sequenceShiftT,sequenceComplete:Boolean(sequenceShiftT),shift1,shift5,shift15,contShift1,contShift5,continuationDisplacementEvent,sweep:sweep??sweep15,sweep15,sweep5,sweep1,displacement:hasDisplacement,mss:hasShift,bos:hasBos,bos15,bos5,bos1,dm15,dm5,dm1,orderBlock,poi,originFvg:fvg?{...fvg,low:round(fvg.low),high:round(fvg.high),mid:round(fvg.mid)}:null,entryMode:useDirectContinuation?'CONFIRMED_CONTINUATION':'ORIGIN_FVG_RETEST',directContinuation,useDirectContinuation,entryZoneAgeMinutes:fvg?round(zoneAgeMs/60000,1):null,minimumTargetMove:plan.minimumTargetMove,mainLiquidity:plan.mainLiquidity,drawOnLiquidity,pathConsumed:round(pathConsumed,2),atr1:round(atr1),atr5:round(atr5),atr15:round(atr15),stopBuffer:round(buffer),offSession},reason:'ICT NARRATIVE | '+phase+' | '+contextSequence+' | '+side+' via '+(useDirectContinuation?'CONFIRMED CONTINUATION':'ORIGIN FVG RETEST')+' from '+poi.type+' in '+rangeContext.location+' | draw '+drawOnLiquidity+' '+round(targets[0])+' | remaining '+round(Math.abs(targets[0]-price),2)};
}
