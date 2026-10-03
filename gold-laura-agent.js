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
  const l=source?.lauraContext?.levels||source?.ict?.levels||source?.liquidityContext?.levels||{};
  add('PWH',l.pwh,'W1','RESISTANCE'); add('PWL',l.pwl,'W1','SUPPORT');
  add('PDH',l.pdh,'D1','RESISTANCE'); add('PDL',l.pdl,'D1','SUPPORT');
  add('H4_SWING_HIGH',l.h4SwingHigh,'H4','RESISTANCE'); add('H4_SWING_LOW',l.h4SwingLow,'H4','SUPPORT');
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
  const w=side(reads?.W1?.side),d=side(reads?.D1?.side),h=side(reads?.H4?.side);
  let bias='NEUTRAL',strength='LOW',reason='W1/D1/H4 are not aligned';
  if(w!=='NEUTRAL'&&w===d){bias=w;strength=h===w?'HIGH':'MEDIUM';reason='W1 and D1 aligned'+(h===w?' with H4 confirmation':' while H4 is not aligned');}
  else if(w!=='NEUTRAL'&&d==='NEUTRAL'&&h===w){bias=w;strength='MEDIUM';reason='W1 bias confirmed by H4 while D1 is neutral';}
  else if(w==='NEUTRAL'&&d!=='NEUTRAL'&&d===h){bias=d;strength='MEDIUM';reason='D1 and H4 aligned while W1 is neutral';}
  return {bias,strength,reads:{W1:w,D1:d,H4:h},reason};
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
  const weekly=barShape(source?.lauraContext?.weekly?.closed||{});
  const daily=barShape(source?.lauraContext?.daily?.closed||{});
  const h4=barShape(source?.lauraContext?.h4?.closed||{});
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
    lastWeek:weekly,
    lastDaily:daily,
    lastH4:h4,
    nearestResistance:above,
    nearestSupport:below,
    nextWeekPath:path,
    invalidation,
    rule:'LAURA-only outlook: weekly close -> daily confirmation -> H4 structure -> clear support/resistance scenarios. No ICT sweep/MSS/FVG input is required.'
  };
}

function lauraSignal(source={},outlook=null){
  const price=num(source.price);
  const m15=barShape(source?.sessionLevels?.lastClosedM15||{});
  const m5=barShape(source?.sessionLevels?.lastClosedM5||{});
  if(price==null||!m15||!m5)return {state:'WAIT',action:'WAIT',reason:'Waiting for fresh M15/M5 bars',setupId:null};
  const bias=outlook?.bias||'NEUTRAL';
  if(!['BUY','SELL'].includes(bias))return {state:'WAIT',action:'WAIT',reason:'W1/D1/H4 outlook is neutral or conflicted',setupId:null};

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

  const entry=m5.close;
  const stopLoss=bias==='BUY'?m5.low-slBuffer:m5.high+slBuffer;
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
    reason:'LAURA-only: HTF bias + decisive M15 level break + M5 retest/hold'
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
    timeframes:{outlook:['W1','D1','H4'],trigger:['M15','M5']},
    outlook,
    signal,
    rule:'Laura decisions are isolated from ICT. W1/D1/H4 define the coming-week directional scenario; M15 decisive close and M5 retest/hold create entries; exits are at mapped S/R targets or structural invalidation.'
  };
}
