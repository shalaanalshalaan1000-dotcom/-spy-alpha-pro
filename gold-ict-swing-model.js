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
function localSweep(bars,side,levels){
  const x=bars.slice(-8); if(x.length<4)return null;
  const named=Object.entries(levels).filter(([,v])=>Number.isFinite(v));
  for(let i=x.length-1;i>=Math.max(1,x.length-4);i--){
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
function targetPlan(side,entry,stop,levels,h1,h4){
  const p1=pivots(h1.slice(-72),2,2),p4=pivots(h4.slice(-30),1,1);
  const pools=[
    {label:'PDH',price:levels.pdh},{label:'PDL',price:levels.pdl},
    {label:'ASIA_HIGH',price:levels.asiaHigh},{label:'ASIA_LOW',price:levels.asiaLow},
    {label:'LONDON_HIGH',price:levels.londonHigh},{label:'LONDON_LOW',price:levels.londonLow},
    {label:'NY_AM_HIGH',price:levels.nyHigh},{label:'NY_AM_LOW',price:levels.nyLow},
    ...p1.highs.slice(-5).map(x=>({label:'H1_BUY_SIDE',price:x.price})),
    ...p1.lows.slice(-5).map(x=>({label:'H1_SELL_SIDE',price:x.price})),
    ...p4.highs.slice(-4).map(x=>({label:'H4_BUY_SIDE',price:x.price})),
    ...p4.lows.slice(-4).map(x=>({label:'H4_SELL_SIDE',price:x.price}))
  ];
  const risk=Math.abs(entry-stop); if(!(risk>0))return null;
  const candidates=dedupePools(pools,side,entry);
  if(!candidates.length)return null;
  const mainIndex=candidates.findIndex(x=>Math.abs(x.price-entry)/risk>=1.5);
  if(mainIndex<0)return null;
  const picked=candidates.slice(mainIndex,mainIndex+4);
  const rr=Math.abs(picked[0].price-entry)/risk;
  return{risk,rr,targets:picked};
}

export function analyzeGoldSignal(samples,rawPrice,now=Date.now()){
  const price=n(rawPrice),m1all=minuteBars(samples),m5all=aggregate(m1all,5),m15all=aggregate(m1all,15),h1all=aggregate(m1all,60),h4all=aggregate(m1all,240);
  const m1=closed(m1all,1,now),m5=closed(m5all,5,now),m15=closed(m15all,15,now),h1=closed(h1all,60,now),h4=closed(h4all,240,now);
  const base={status:'COLLECTING',action:'WAIT',candidateAction:'WAIT',side:null,strategy:'ICT_TOP_DOWN',confidence:0,price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,oneMinuteConfirmed:false,contextBias:'NEUTRAL',ict:null,sampleCount:samples.length,modelTimeframes:{context:'4H',bias:'1H',setup:'15m',execution:'5m',timing:'1m optional'},updatedAt:new Date(now).toISOString(),reason:'ICT engine is collecting enough HTF history'};
  if(price==null||m1.length<120||m5.length<30||m15.length<20||h1.length<12||h4.length<3)return base;

  const levels=sessionLevels(m15,now),session=activeSession(now),dir4=structureDirection(h4),dir1=structureDirection(h1),dir15=structureDirection(m15);
  const rangeRows=h1.slice(-24),rangeHigh=hi(rangeRows),rangeLow=lo(rangeRows),equilibrium=Number.isFinite(rangeHigh)&&Number.isFinite(rangeLow)?(rangeHigh+rangeLow)/2:null;
  const location=equilibrium==null?'UNKNOWN':price<=equilibrium?'DISCOUNT':'PREMIUM';
  const atr5=atr(m5,14)||1,atr15=atr(m15,14)||2;
  const offSession=session==='OFF_KILLZONE';
  const biasScore=dir1*3+dir15*2+(dir4===dir1&&dir1!==0?1:0);
  let side=dir1===1?'BUY':dir1===-1?'SELL':dir15===1?'BUY':dir15===-1?'SELL':'NEUTRAL';
  if(side==='NEUTRAL')return{...base,status:'WAIT',contextBias:'NEUTRAL',ict:{biasScore,dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),offSession},reason:'ICT WAIT: 1H bias is neutral and 15m has no usable direction'};

  const trendSign=side==='BUY'?1:-1;
  const contextAligned=dir4===trendSign;
  const biasAligned=dir1===0||dir1===trendSign;
  const setupAligned=dir15===trendSign;
  const locationOk=side==='BUY'?location==='DISCOUNT':location==='PREMIUM';
  const oneMinuteConfirmed=oneMinuteConfirm(m1,side);
  const fvg15=latestFvg(m15,side),sweep15=localSweep(m15,side,levels),dm15=displacementAndMss(m15,side,atr15);
  const fvg5=latestFvg(m5,side),sweep5=localSweep(m5,side,levels),dm5=displacementAndMss(m5,side,atr5);
  const setupVotes=[Boolean(sweep15),Boolean(fvg15),Boolean(dm15.displacement||dm15.mss)].filter(Boolean).length;
  const setupReady=Boolean(setupAligned&&setupVotes>=2);
  const executionReady=Boolean(fvg5&&(dm5.displacement||dm5.mss||oneMinuteConfirmed));
  const reversal=Boolean(setupReady&&executionReady&&(sweep15||sweep5)&&(dm15.mss||dm5.mss));
  const continuation=Boolean(setupReady&&executionReady&&!reversal);

  if(!setupAligned)return{...base,status:'WAIT',candidateAction:'WAIT',confidence:0,contextBias:side,oneMinuteConfirmed,ict:{biasScore,dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),offSession,contextAligned,biasAligned,setupAligned,setupVotes,fvg15,sweep15,dm15,fvg5,sweep5,dm5},reason:'ICT WAIT: 1H bias and 15m setup are not aligned'};
  if(!setupReady)return{...base,status:'WAIT',candidateAction:'WAIT',confidence:0,contextBias:side,oneMinuteConfirmed,ict:{biasScore,dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),offSession,contextAligned,biasAligned,setupAligned,setupVotes,fvg15,sweep15,dm15,fvg5,sweep5,dm5},reason:'ICT WAIT: 15m setup needs two of liquidity sweep / FVG / displacement-MSS'};
  if(!executionReady)return{...base,status:'WAIT',candidateAction:'WAIT',confidence:0,contextBias:side,oneMinuteConfirmed,ict:{biasScore,dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),offSession,contextAligned,biasAligned,setupAligned,setupVotes,fvg15,sweep15,dm15,fvg5,sweep5,dm5},reason:'ICT WAIT: 15m setup ready; waiting for 5m FVG + displacement/MSS entry'};

  const setupType=reversal?'ICT_15M_LIQUIDITY_REVERSAL':'ICT_1H_15M_CONTINUATION';
  const fvg=fvg5,entry=fvg.mid,entryLow=Math.min(fvg.low,fvg.high),entryHigh=Math.max(fvg.low,fvg.high);
  const buffer=clamp(atr5*.18,.25,.85);
  const recent=m5.slice(-8),fallbackExtreme=side==='BUY'?lo(recent):hi(recent);
  const sweep=sweep5??sweep15;
  const anchor=sweep?.extreme??fallbackExtreme;
  const stop=side==='BUY'?anchor-buffer:anchor+buffer;
  const risk=Math.abs(entry-stop);
  if(!(risk>=.50))return{...base,status:'WAIT',candidateAction:'WAIT',contextBias:bias,ict:{biasScore,dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),sweep,fvg},reason:'ICT WAIT: structural invalidation is too close to entry'};

  const plan=targetPlan(side,entry,stop,levels,h1,h4);
  if(!plan)return{...base,status:'WAIT',candidateAction:'WAIT',contextBias:bias,oneMinuteConfirmed,ict:{biasScore,dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),sweep,fvg,offSession,htfAligned},reason:'ICT WAIT: no opposing liquidity target offers at least 1.5R'};
  let confidence=56;
  if(dir1===trendSign)confidence+=12;
  if(dir15===trendSign)confidence+=10;
  if(contextAligned)confidence+=4;
  if(session==='LONDON_KILLZONE'||session==='NEW_YORK_AM_KILLZONE')confidence+=4;
  if(sweep15)confidence+=8;
  if(fvg15)confidence+=5;
  if(dm15.mss)confidence+=6;
  if(dm15.displacement)confidence+=5;
  if(sweep5)confidence+=4;
  if(dm5.mss)confidence+=5;
  if(dm5.displacement)confidence+=5;
  if(fvg5)confidence+=5;
  if(locationOk)confidence+=2;
  if(oneMinuteConfirmed)confidence+=2;
  confidence=Math.min(95,confidence);
  const targets=plan.targets.map(x=>round(x.price));
  const labels=plan.targets.map(x=>x.label);
  const drawOnLiquidity=labels[0]||'OPPOSING_LIQUIDITY';
  return{...base,status:'CANDIDATE',candidateAction:side,side,strategy:setupType,confidence,contextBias:bias,oneMinuteConfirmed,setupId:[side,setupType,sweep?.t??fvg.t,round(entry),round(stop),drawOnLiquidity].join('|'),entry:round(entry),entryLow:round(entryLow),entryHigh:round(entryHigh),stopLoss:round(stop),target1:targets[0]??null,target2:targets[1]??null,target3:targets[2]??null,target4:targets[3]??null,targetLabels:labels,riskReward:round(plan.rr,2),ict:{setupType,biasScore,dir4,dir1,dir15,levels,session,location,equilibrium:round(equilibrium),dealingRangeHigh:round(rangeHigh),dealingRangeLow:round(rangeLow),contextAligned,biasAligned,setupAligned,setupReady,executionReady,setupVotes,sweep:sweep15??sweep5,sweep15,sweep5,displacement:Boolean(dm15.displacement||dm5.displacement),mss:Boolean(dm15.mss||dm5.mss),dm15,dm5,fvg:{...fvg,low:round(fvg.low),high:round(fvg.high),mid:round(fvg.mid)},fvg15,fvg5:{...fvg5,low:round(fvg5.low),high:round(fvg5.high),mid:round(fvg5.mid)},drawOnLiquidity,atr5:round(atr5),atr15:round(atr15),stopBuffer:round(buffer),offSession},reason:'ICT '+setupType+' | 4H context '+(dir4===1?'UP':dir4===-1?'DOWN':'NEUTRAL')+' | 1H bias '+side+' | 15m setup confirmed | 5m entry confirmed | draw on '+drawOnLiquidity+' | '+round(plan.rr,2)+'R'};
}
