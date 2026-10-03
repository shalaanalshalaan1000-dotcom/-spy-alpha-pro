const num=v=>v==null||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
const round=(v,d=3)=>{const n=num(v);return n==null?null:Number(n.toFixed(d));};
const normSide=v=>['BUY','SELL','NEUTRAL'].includes(String(v||'').toUpperCase())?String(v).toUpperCase():'NEUTRAL';

function barShape(bar={}){
  const open=num(bar.open),high=num(bar.high),low=num(bar.low),close=num(bar.close);
  if([open,high,low,close].some(v=>v==null))return null;
  const range=Math.max(.001,high-low),body=Math.abs(close-open),upper=high-Math.max(open,close),lower=Math.min(open,close)-low,pos=(close-low)/range;
  let pattern=close>open?'BULLISH_CLOSE':close<open?'BEARISH_CLOSE':'DOJI';
  if(lower>=Math.max(body*1.5,range*.30)&&pos>=.60)pattern='LOWER_REJECTION';
  if(upper>=Math.max(body*1.5,range*.30)&&pos<=.40)pattern='UPPER_REJECTION';
  return{open:round(open),high:round(high),low:round(low),close:round(close),range:round(range,2),body:round(body,2),pattern,t:num(bar.t)};
}

function allReads(source={}){
  const mtf=source?.multiTimeframe?.reads||{};
  return Object.fromEntries(['MN1','W1','D1','H4','H1','M15','M5','M1'].map(tf=>[tf,normSide(mtf?.[tf]?.side)]));
}
function topDown(reads={}){
  const weights={MN1:5,W1:5,D1:4,H4:3,H1:2,M15:1};
  let buy=0,sell=0;
  for(const [tf,w] of Object.entries(weights)){if(reads[tf]==='BUY')buy+=w;else if(reads[tf]==='SELL')sell+=w;}
  const delta=buy-sell,bias=delta>=5?'BUY':delta<=-5?'SELL':'NEUTRAL';
  const macro=['MN1','W1','D1'].filter(tf=>reads[tf]===bias).length;
  const context=['H4','H1'].filter(tf=>reads[tf]===bias).length;
  const strength=bias==='NEUTRAL'?'LOW':macro>=2&&context>=1?'HIGH':macro>=2||context===2?'MEDIUM':'LOW';
  const confidence=Math.max(0,Math.min(100,50+Math.abs(delta)*2+(macro>=2?8:0)+(context>=1?5:0)));
  return{bias,strength,confidence,buyWeight:buy,sellWeight:sell,macroAligned:macro,contextAligned:context};
}

function collectLevels(source={},price=null){
  const rows=[],l=source?.lauraContext?.levels||{};
  const add=(label,value,timeframe,kind)=>{
    const level=num(value);if(level==null)return;
    if(rows.some(x=>Math.abs(x.level-level)<=.10))return;
    rows.push({label,level:round(level),timeframe,kind,distance:price==null?null:round(Math.abs(level-price),2)});
  };
  add('PMH',l.pmh,'MN1','RESISTANCE');add('PML',l.pml,'MN1','SUPPORT');
  add('PWH',l.pwh,'W1','RESISTANCE');add('PWL',l.pwl,'W1','SUPPORT');
  add('PDH',l.pdh,'D1','RESISTANCE');add('PDL',l.pdl,'D1','SUPPORT');
  add('H4_SWING_HIGH',l.h4SwingHigh,'H4','RESISTANCE');add('H4_SWING_LOW',l.h4SwingLow,'H4','SUPPORT');
  add('H1_SWING_HIGH',l.h1SwingHigh,'H1','RESISTANCE');add('H1_SWING_LOW',l.h1SwingLow,'H1','SUPPORT');
  add('M15_SWING_HIGH',l.m15SwingHigh,'M15','RESISTANCE');add('M15_SWING_LOW',l.m15SwingLow,'M15','SUPPORT');
  add('M5_SWING_HIGH',l.m5SwingHigh,'M5','RESISTANCE');add('M5_SWING_LOW',l.m5SwingLow,'M5','SUPPORT');
  add('M1_SWING_HIGH',l.m1SwingHigh,'M1','RESISTANCE');add('M1_SWING_LOW',l.m1SwingLow,'M1','SUPPORT');
  const sessions=source?.sessionLevels?.sessions||{};
  for(const row of Object.values(sessions)){
    if(String(row?.status||'').toUpperCase()!=='CLOSED')continue;
    add((row?.label||row?.id||'SESSION')+'_HIGH',row?.high,'SESSION','RESISTANCE');
    add((row?.label||row?.id||'SESSION')+'_LOW',row?.low,'SESSION','SUPPORT');
  }
  return rows;
}
function nearest(levels,price,direction,skip=null){
  return levels.filter(x=>direction==='ABOVE'?x.level>price:x.level<price)
    .filter(x=>skip==null||Math.abs(x.level-skip)>.10)
    .sort((a,b)=>Math.abs(a.level-price)-Math.abs(b.level-price))[0]||null;
}
function weeklyOutlook(source={},now=Date.now()){
  const price=num(source.price),reads=allReads(source),td=topDown(reads),levels=collectLevels(source,price);
  const support=price==null?null:nearest(levels,price,'BELOW'),resistance=price==null?null:nearest(levels,price,'ABOVE');
  const ctx=source?.lauraContext||{};
  const lastMonth=barShape(ctx?.monthly?.closed||{}),lastWeek=barShape(ctx?.weekly?.closed||{}),lastDaily=barShape(ctx?.daily?.closed||{}),lastH4=barShape(ctx?.h4?.closed||{});
  let path='RANGE / WAIT FOR DECISIVE BREAK';
  if(td.bias==='BUY')path=resistance?`BULLISH while support holds → next resistance ${resistance.label} ${resistance.level}`:'BULLISH; no higher mapped resistance available';
  if(td.bias==='SELL')path=support?`BEARISH while resistance holds → next support ${support.label} ${support.level}`:'BEARISH; no lower mapped support available';
  return{
    generatedAt:new Date(now).toISOString(),bias:td.bias,strength:td.strength,confidence:round(td.confidence,0),reads,
    weights:{MN1:5,W1:5,D1:4,H4:3,H1:2,M15:1},lastMonth,lastWeek,lastDaily,lastH4,
    nearestSupport:support,nearestResistance:resistance,nextWeekPath:path,
    invalidation:td.bias==='BUY'?support:td.bias==='SELL'?resistance:null,
    levels:levels.slice().sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)).slice(0,18),
    rule:'Laura-only classical hierarchy: MN1/W1/D1 map the macro direction; H4/H1 define structure and S/R; M15 confirms a decisive break; M5 confirms retest/hold; M1 times the final entry.'
  };
}
function lauraSignal(source={},outlook=null){
  const price=num(source.price),bias=outlook?.bias||'NEUTRAL',ctx=source?.lauraContext||{};
  const m15=barShape(ctx?.m15?.closed||source?.sessionLevels?.lastClosedM15||{});
  const m5=barShape(ctx?.m5?.closed||source?.sessionLevels?.lastClosedM5||{});
  const m1=barShape(ctx?.m1?.closed||{});
  if(price==null||!m15||!m5||!m1)return{state:'WAIT',action:'WAIT',reason:'Waiting for complete M15/M5/M1 Laura candles',setupId:null};
  if(!['BUY','SELL'].includes(bias))return{state:'WAIT',action:'WAIT',reason:'Laura all-timeframe bias is neutral/conflicted',setupId:null};
  const minConfidence=Math.max(60,Math.min(95,num(process.env.LAURA_MIN_CONFIDENCE)??75));
  if((num(outlook?.confidence)??0)<minConfidence)return{state:'WAIT',action:'WAIT',reason:`Laura top-down strength ${outlook?.confidence||0}/100 is below ${minConfidence}/100`,setupId:null,bias};

  const levels=collectLevels(source,price),decisive=Math.max(.05,num(process.env.LAURA_DECISIVE_CLOSE_USD)??.25),tol=Math.max(.10,num(process.env.LAURA_RETEST_TOLERANCE_USD)??.60),buffer=Math.max(.10,num(process.env.LAURA_SL_BUFFER_USD)??.25);
  let broken=null;
  if(bias==='BUY')broken=levels.filter(x=>m15.close>x.level+decisive&&m15.open<=x.level+decisive).sort((a,b)=>Math.abs(m15.close-a.level)-Math.abs(m15.close-b.level))[0]||null;
  else broken=levels.filter(x=>m15.close<x.level-decisive&&m15.open>=x.level-decisive).sort((a,b)=>Math.abs(m15.close-a.level)-Math.abs(m15.close-b.level))[0]||null;
  if(!broken)return{state:'WATCHING',action:'WAIT',reason:`Waiting for decisive M15 ${bias==='BUY'?'close above resistance':'close below support'}`,setupId:null,bias};

  const retestTouch=bias==='BUY'?m5.low<=broken.level+tol:m5.high>=broken.level-tol,retestHold=bias==='BUY'?m5.close>broken.level:m5.close<broken.level;
  if(!(retestTouch&&retestHold))return{state:'RETEST_WAIT',action:'WAIT',reason:`M15 broke ${broken.label}; waiting for M5 retest/hold`,setupId:`LAURA|${bias}|${broken.label}|${m15.t||'NA'}`,bias,brokenLevel:broken};

  const timing=bias==='BUY'?(m1.close>m1.open||m1.pattern==='LOWER_REJECTION'):(m1.close<m1.open||m1.pattern==='UPPER_REJECTION');
  const timingHold=bias==='BUY'?m1.close>broken.level:m1.close<broken.level;
  if(!(timing&&timingHold))return{state:'TIMING_WAIT',action:'WAIT',reason:`M15 break + M5 retest confirmed; waiting for M1 ${bias} timing candle`,setupId:`LAURA|${bias}|${broken.label}|${m15.t||'NA'}`,bias,brokenLevel:broken};

  const entry=m1.close,stopLoss=bias==='BUY'?Math.min(m5.low,m1.low)-buffer:Math.max(m5.high,m1.high)+buffer;
  const t1=nearest(levels,entry,bias==='BUY'?'ABOVE':'BELOW',broken.level),t2=t1?nearest(levels,t1.level,bias==='BUY'?'ABOVE':'BELOW',t1.level):null;
  if(!t1)return{state:'WATCHING',action:'WAIT',reason:'Laura entry confirmed but next classical S/R target is unavailable',setupId:null,bias,brokenLevel:broken};
  return{
    state:'ENTRY',action:bias,setupId:`LAURA|${bias}|${broken.label}|${m15.t||'NA'}`,bias,
    entry:round(entry),stopLoss:round(stopLoss),target1:t1,target2:t2,brokenLevel:broken,
    m15Close:round(m15.close),m5RetestClose:round(m5.close),m1TimingClose:round(m1.close),m1Pattern:m1.pattern,
    reason:'LAURA-only: all-timeframe classical bias → decisive M15 S/R break → M5 retest/hold → M1 timing'
  };
}
export function analyzeLaura(source={},now=Date.now()){
  const outlook=weeklyOutlook(source,now),signal=lauraSignal(source,outlook);
  return{
    name:'LAURA_AGENT',mode:'INDEPENDENT_CLASSICAL_PRICE_ACTION',independent:true,usesIctSignalLogic:false,canOverrideIctGate:false,
    timeframes:{macro:['MN1','W1','D1'],structure:['H4','H1'],break:['M15'],retest:['M5'],timing:['M1']},
    theory:['TREND_STRUCTURE','SUPPORT_RESISTANCE','RANGE_CHANNEL_CONTEXT','DECISIVE_CLOSE','RETEST_OR_REJECTION','NEXT_TECHNICAL_LEVEL_TARGET'],
    outlook,signal,
    rule:'Laura is fully isolated from ICT/SMC. It never requires liquidity sweep, MSS, FVG, OB, or Wyckoff logic.'
  };
}
