const num=v=>v==null||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
const round=(v,d=3)=>{const n=num(v);return n==null?null:Number(n.toFixed(d));};
const side=v=>['BUY','SELL','NEUTRAL'].includes(String(v||'').toUpperCase())?String(v).toUpperCase():'NEUTRAL';

function barShape(bar={}){
  const open=num(bar.open),high=num(bar.high),low=num(bar.low),close=num(bar.close);
  if([open,high,low,close].some(v=>v==null))return null;
  const range=Math.max(0.0001,high-low),body=Math.abs(close-open),upper=high-Math.max(open,close),lower=Math.min(open,close)-low;
  const closePosition=(close-low)/range;
  let pattern=close>open?'BULLISH_CLOSE':close<open?'BEARISH_CLOSE':'DOJI';
  if(lower>=Math.max(body*1.5,range*0.30)&&closePosition>=0.60)pattern='LOWER_REJECTION';
  if(upper>=Math.max(body*1.5,range*0.30)&&closePosition<=0.40)pattern='UPPER_REJECTION';
  return {open:round(open),high:round(high),low:round(low),close:round(close),range:round(range,2),body:round(body,2),closePosition:round(closePosition,2),pattern,t:num(bar.t)};
}

function collectLevels(source={},price=null){
  const rows=[];
  const add=(label,value,timeframe,kind)=>{
    const level=num(value);
    if(level==null)return;
    if(rows.some(x=>Math.abs(x.level-level)<=0.10))return;
    rows.push({label,level:round(level),timeframe,kind,distance:price==null?null:round(Math.abs(level-price),2)});
  };
  const l=source?.lauraContext?.levels||{};
  add('PMH',l.pmh,'MN1','RESISTANCE'); add('PML',l.pml,'MN1','SUPPORT');
  add('PWH',l.pwh,'W1','RESISTANCE'); add('PWL',l.pwl,'W1','SUPPORT');
  add('PDH',l.pdh,'D1','RESISTANCE'); add('PDL',l.pdl,'D1','SUPPORT');
  add('H4_SWING_HIGH',l.h4SwingHigh,'H4','RESISTANCE'); add('H4_SWING_LOW',l.h4SwingLow,'H4','SUPPORT');
  add('H1_SWING_HIGH',l.h1SwingHigh,'H1','RESISTANCE'); add('H1_SWING_LOW',l.h1SwingLow,'H1','SUPPORT');
  add('M15_SWING_HIGH',l.m15SwingHigh,'M15','RESISTANCE'); add('M15_SWING_LOW',l.m15SwingLow,'M15','SUPPORT');
  add('M5_SWING_HIGH',l.m5SwingHigh,'M5','RESISTANCE'); add('M5_SWING_LOW',l.m5SwingLow,'M5','SUPPORT');
  const sessions=source?.sessionLevels?.sessions||{};
  for(const row of Object.values(sessions)){
    if(String(row?.status||'').toUpperCase()!=='CLOSED')continue;
    add((row?.label||row?.id||'SESSION')+'_HIGH',row?.high,'SESSION','RESISTANCE');
    add((row?.label||row?.id||'SESSION')+'_LOW',row?.low,'SESSION','SUPPORT');
  }
  return rows;
}

function biasFromFrames(source={}){
  const reads=source?.multiTimeframe?.reads||{};
  const tf={MN1:side(reads?.MN1?.side),W1:side(reads?.W1?.side),D1:side(reads?.D1?.side),H4:side(reads?.H4?.side),H1:side(reads?.H1?.side),M15:side(reads?.M15?.side),M5:side(reads?.M5?.side),M1:side(reads?.M1?.side)};
  const weights={MN1:5,W1:5,D1:4,H4:3,H1:2,M15:1};
  let buy=0,sell=0;for(const [k,w] of Object.entries(weights)){if(tf[k]==='BUY')buy+=w;else if(tf[k]==='SELL')sell+=w;}
  const delta=buy-sell,bias=delta>=5?'BUY':delta<=-5?'SELL':'NEUTRAL';
  const macroAligned=bias==='NEUTRAL'?0:['MN1','W1','D1'].filter(k=>tf[k]===bias).length;
  const contextAligned=bias==='NEUTRAL'?0:['H4','H1'].filter(k=>tf[k]===bias).length;
  const strength=bias==='NEUTRAL'?'LOW':macroAligned>=2&&contextAligned>=1?'HIGH':macroAligned>=2||contextAligned===2?'MEDIUM':'LOW';
  const reason=bias==='NEUTRAL'?('Classical top-down conflict: BUY weight '+buy+' / SELL weight '+sell):('Classical top-down '+bias+': BUY weight '+buy+' / SELL weight '+sell+'; macro '+macroAligned+'/3; H4/H1 '+contextAligned+'/2');
  return {bias,strength,reads:tf,buyWeight:buy,sellWeight:sell,macroAligned,contextAligned,reason};
}

function nearest(levels,price,direction,skipLevel=null){
  return levels
    .filter(x=>direction==='ABOVE'?x.level>price:x.level<price)
    .filter(x=>skipLevel==null||Math.abs(x.level-skipLevel)>0.10)
    .sort((a,b)=>Math.abs(a.level-price)-Math.abs(b.level-price))[0]||null;
}

function weeklyOutlook(source={},now=Date.now()){
  const p=num(source.price);
  const frames=biasFromFrames(source);
  const monthly=barShape(source?.lauraContext?.monthly?.closed||{});
  const weekly=barShape(source?.lauraContext?.weekly?.closed||{});
  const daily=barShape(source?.lauraContext?.daily?.closed||{});
  const h4=barShape(source?.lauraContext?.h4?.closed||{});
  const h1=barShape(source?.lauraContext?.h1?.closed||{});
  const levels=collectLevels(source,p);
  const above=p==null?null:nearest(levels,p,'ABOVE');
  const below=p==null?null:nearest(levels,p,'BELOW');
  let path='RANGE / WAIT FOR BREAK';
  if(frames.bias==='BUY')path=above?`BULLISH while price holds support; next resistance ${above.label} ${above.level}`:'BULLISH but no mapped resistance above current price';
  if(frames.bias==='SELL')path=below?`BEARISH while price stays below resistance; next support ${below.label} ${below.level}`:'BEARISH but no mapped support below current price';
  const invalidation=frames.bias==='BUY'?below:frames.bias==='SELL'?above:null;
  return {
    generatedAt:new Date(now).toISOString(),
    bias:frames.bias,
    strength:frames.strength,
    reads:frames.reads,
    reason:frames.reason,
    lastMonth:monthly,
    lastWeek:weekly,
    lastDaily:daily,
    lastH4:h4,
    lastH1:h1,
    nearestResistance:above,
    nearestSupport:below,
    nextWeekPath:path,
    invalidation,
    rule:'LAURA-only outlook: MN1 -> W1 -> D1 define the macro map; H4/H1 define classical structure and S/R; M15/M5/M1 are execution frames. No ICT sweep/MSS/FVG input is used.'
  };
}

function lauraSignal(source={},outlook=null){
  const price=num(source.price);
  const m15=barShape(source?.lauraContext?.m15?.closed||source?.sessionLevels?.lastClosedM15||{});
  const m5=barShape(source?.lauraContext?.m5?.closed||source?.sessionLevels?.lastClosedM5||{});
  const m1=barShape(source?.lauraContext?.m1?.closed||{});
  if(price==null||!m15||!m5||!m1)return {state:'WAIT',action:'WAIT',reason:'Waiting for fresh M15/M5/M1 bars',setupId:null};
  const bias=outlook?.bias||'NEUTRAL';
  if(!['BUY','SELL'].includes(bias))return {state:'WAIT',action:'WAIT',reason:'Classical all-timeframe outlook is neutral or conflicted',setupId:null};

  const levels=collectLevels(source,price);
  const decisive=Math.max(0.05,num(process.env.LAURA_DECISIVE_CLOSE_USD)??0.25);
  const retestTol=Math.max(0.10,num(process.env.LAURA_RETEST_TOLERANCE_USD)??0.60);
  const slBuffer=Math.max(0.10,num(process.env.LAURA_SL_BUFFER_USD)??0.25);
  const candidates=levels.filter(x=>x.timeframe!=='SESSION'||String(process.env.LAURA_ALLOW_SESSION_LEVELS||'true').toLowerCase()!=='false');

  let broken=null;
  if(bias==='BUY'){
    broken=candidates.filter(x=>m15.close>x.level+decisive&&m15.open<=x.level+decisive).sort((a,b)=>Math.abs(m15.close-a.level)-Math.abs(m15.close-b.level))[0]||null;
  }else{
    broken=candidates.filter(x=>m15.close<x.level-decisive&&m15.open>=x.level-decisive).sort((a,b)=>Math.abs(m15.close-a.level)-Math.abs(m15.close-b.level))[0]||null;
  }
  if(!broken)return {state:'WATCHING',action:'WAIT',reason:`Waiting for decisive M15 ${bias==='BUY'?'break above resistance':'break below support'}`,setupId:null,bias};

  const retestTouch=bias==='BUY'?m5.low<=broken.level+retestTol:m5.high>=broken.level-retestTol;
  const held=bias==='BUY'?m5.close>broken.level:m5.close<broken.level;
  if(!(retestTouch&&held)){
    return {state:'RETEST_WAIT',action:'WAIT',reason:`M15 broke ${broken.label}; waiting for M5 retest/hold`,setupId:`LAURA|${bias}|${broken.label}|${m15.t||'NA'}`,bias,brokenLevel:broken};
  }

  const m1Direction=bias==='BUY'?m1.close>m1.open:m1.close<m1.open;
  const m1Rejection=bias==='BUY'?m1.pattern==='LOWER_REJECTION':m1.pattern==='UPPER_REJECTION';
  const m1Held=bias==='BUY'?m1.close>broken.level:m1.close<broken.level;
  if(!(m1Held&&(m1Direction||m1Rejection))){
    return {state:'TIMING_WAIT',action:'WAIT',reason:'M15 break + M5 retest confirmed; waiting for M1 '+bias+' timing candle',setupId:'LAURA|'+bias+'|'+broken.label+'|'+(m15.t||'NA'),bias,brokenLevel:broken};
  }

  const entry=m1.close;
  const stopLoss=bias==='BUY'?Math.min(m5.low,m1.low)-slBuffer:Math.max(m5.high,m1.high)+slBuffer;
  const target1=nearest(levels,entry,bias==='BUY'?'ABOVE':'BELOW',broken.level);
  const target2=target1?nearest(levels,target1.level,bias==='BUY'?'ABOVE':'BELOW',target1.level):null;
  if(!target1)return {state:'WATCHING',action:'WAIT',reason:'Break/retest confirmed but no next mapped S/R target is available',setupId:null,bias,brokenLevel:broken};

  return {
    state:'ENTRY',
    action:bias,
    setupId:`LAURA|${bias}|${broken.label}|${m15.t||'NA'}`,
    bias,
    entry:round(entry),
    stopLoss:round(stopLoss),
    target1,
    target2,
    brokenLevel:broken,
    m15Close:round(m15.close),
    m5RetestClose:round(m5.close),
    m1TimingClose:round(m1.close),
    m1Pattern:m1.pattern,
    reason:'LAURA-only: all-timeframe classical bias + decisive M15 level break + M5 retest/hold + M1 timing'
  };
}

export function analyzeLaura(source={},now=Date.now()){
  const outlook=weeklyOutlook(source,now);
  const signal=lauraSignal(source,outlook);
  return {
    name:'LAURA_AGENT',
    mode:'INDEPENDENT_CLASSICAL_PRICE_ACTION',
    independent:true,
    canOverrideIctGate:false,
    usesIctSignalLogic:false,
    timeframes:{macro:['MN1','W1','D1'],structure:['H4','H1'],trigger:['M15','M5','M1']},
    outlook,
    signal,
    rule:'Laura decisions are isolated from ICT. MN1/W1/D1 define macro direction; H4/H1 define classical structure/S/R; M15 decisive close, M5 retest/hold and M1 timing create entries; exits are mapped S/R targets or structural invalidation.'
  };
}
