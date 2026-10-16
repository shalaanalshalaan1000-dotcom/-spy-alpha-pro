// Read-only BTC ICT Draw on Liquidity (DOL) map alongside ICT_ONLY_EXTERNAL_LIQUIDITY execution.
// Coinbase BTC-USD OHLC uses UTC calendar days. Crypto trades 24/7; a weekly
// reference requires seven complete daily candles from the prior UTC week.
const DAY=86400000,FIVE=300000,HOUR=3600000;
// BTC trades continuously. These are explicitly defined UTC observation sessions,
// not promises about spot-FX exchange hours or actual executable market depth.
const BTC_UTC_SESSIONS=[
  {id:'ASIA',startHour:0,endHour:8},
  {id:'LONDON',startHour:8,endHour:13},
  {id:'NEW_YORK',startHour:13,endHour:21}
];
const n=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const round=v=>v==null?null:Number(v.toFixed(2));
const mondayUtc=ms=>{const d=new Date(Math.floor(ms/DAY)*DAY),dow=(d.getUTCDay()+6)%7;return d.getTime()-dow*DAY;};
const completeRows=(rows,span,now)=>Array.isArray(rows)?rows.filter(r=>{
  const t=Number(r?.t);
  return Number.isFinite(t)&&Number.isFinite(Number(r?.high))&&Number.isFinite(Number(r?.low))
    &&r.high>=r.low&&r.low>0&&t+span<=now;
}).sort((a,b)=>a.t-b.t):[];
const lastPivot=(rows,kind)=>{
  const field=kind==='HIGH'?'high':'low';
  for(let i=rows.length-3;i>=2;i--){
    const value=Number(rows[i][field]);
    const before=[rows[i-2],rows[i-1]].map(x=>Number(x[field]));
    const after=[rows[i+1],rows[i+2]].map(x=>Number(x[field]));
    const valid=kind==='HIGH'?before.every(x=>value>x)&&after.every(x=>value>=x):before.every(x=>value<x)&&after.every(x=>value<=x);
    if(valid)return round(value);
  }
  return null;
};
const make=(tf,label,level,side,eligible)=>({
  timeframe:tf,label,level:round(level),price:round(level),liquiditySide:side,
  liquidityClass:eligible?(tf==='SESSION'?'EXTERNAL_COMPLETED_SESSION':'EXTERNAL_PREVIOUS_PERIOD'):'UNVERIFIED_SWING',
  targetEligible:eligible,
  evidence:eligible?(tf==='SESSION'?'COMPLETE_NAMED_UTC_SESSION_M5_CANDLES':'COMPLETE_PREVIOUS_UTC_PERIOD'):'CONFIRMED_PIVOT_NOT_PROVEN_EXTERNAL'
});
function completedPreviousWeek(daily,now){
  const thisWeek=mondayUtc(now);
  const weekly=new Map();
  for(const bar of daily){
    const key=mondayUtc(bar.t);
    if(key>=thisWeek)continue;
    if(!weekly.has(key))weekly.set(key,[]);
    weekly.get(key).push(bar);
  }
  // Never silently substitute an older week when the immediately prior week is incomplete.
  const start=thisWeek-7*DAY,rows=weekly.get(start)||[];
  const dates=new Set(rows.map(x=>x.t));
  if(rows.length!==7 || Array.from({length:7},(_,i)=>start+i*DAY).some(t=>!dates.has(t)))return null;
  return {start,high:Math.max(...rows.map(x=>Number(x.high))),low:Math.min(...rows.map(x=>Number(x.low)))};
}

// Only the MOST RECENT finished instance of each named session can be external.
// Never promote an in-progress range, a gap-filled series, or an H1/H4 pivot.
export function completedBtcSessionLevels(M5=[],now=Date.now()){
  const five=completeRows(M5,FIVE,now);
  const today=Math.floor(now/DAY)*DAY;
  const completed=[];
  for(const session of BTC_UTC_SESSIONS){
    let end=today+session.endHour*HOUR;
    if(end>now)end-=DAY;
    const start=end-(session.endHour-session.startHour)*HOUR;
    const expected=(end-start)/FIVE;
    const rows=five.filter(b=>b.t>=start&&b.t<end);
    // All closed M5 candles must exist: no synthetic session highs/lows
    // from incomplete Coinbase coverage.
    if(rows.length!==expected||rows.some((bar,i)=>bar.t!==start+i*FIVE))continue;
    completed.push({id:session.id,start,end,
      high:Math.max(...rows.map(b=>b.high)),
      low:Math.min(...rows.map(b=>b.low)),
      source:'FULLY_CLOSED_M5_UTC_SESSION'});
  }
  return completed;
}
const distinct=rows=>rows.filter((x,i,a)=>a.findIndex(y=>Math.abs(y.level-x.level)<=0.01)===i);
export function projectBtcDolSide(map,side='WAIT',price=map?.price){
  const direction=['BUY','SELL'].includes(String(side||'').toUpperCase())?String(side).toUpperCase():'WAIT';
  const drawSide=direction==='BUY'?'BSL':direction==='SELL'?'SSL':'WAIT';
  const px=n(price);
  const levels=Array.isArray(map?.levels)?map.levels:[];
  const eligible=levels.filter(x=>x.targetEligible&&x.liquiditySide===drawSide&&px!=null&&
    (drawSide==='BSL'?x.level>px:x.level<px))
    .sort((a,b)=>Math.abs(a.level-px)-Math.abs(b.level-px));
  const objectives=distinct(eligible).map(x=>({...x,distance:round(Math.abs(x.level-px))}));
  const nearest=objectives[0]||null;
  const primary=[...objectives].sort((a,b)=>{
    const rank=x=>x.timeframe==='W1'?0:1;
    return rank(a)-rank(b)||b.distance-a.distance;
  }).find(x=>!nearest||Math.abs(x.level-nearest.level)>0.01)||nearest;
  return {...map,side:direction,drawSide,price:round(px),objectives,nearest,primary,
    targetPreview:objectives.slice(0,4).map((x,i)=>({target:'DOL'+(i+1),label:x.label,price:x.price,timeframe:x.timeframe,liquiditySide:x.liquiditySide}))};
}
export function buildBtcDolMap({M5=[],M15=[],H1=[],H4=[],D1=[],price=null,side='WAIT',now=Date.now()}={}){
  const daily=completeRows(D1,DAY,now),hour=completeRows(H1,3600000,now),
    four=completeRows(H4,14400000,now),fifteen=completeRows(M15,900000,now),five=completeRows(M5,300000,now);
  const yesterday=Math.floor(now/DAY)*DAY-DAY;
  const prevDay=daily.find(x=>x.t===yesterday)||null;
  const week=completedPreviousWeek(daily,now);
  const levels=[];
  const add=(tf,label,v,liquiditySide,eligible)=>{
    if(n(v)!=null)levels.push(make(tf,label,v,liquiditySide,eligible));
  };
  add('W1','PWH',week?.high,'BSL',true);add('W1','PWL',week?.low,'SSL',true);
  add('D1','PDH',prevDay?.high,'BSL',true);add('D1','PDL',prevDay?.low,'SSL',true);
  for(const session of completedBtcSessionLevels(five,now)){
    add('SESSION',session.id+'_HIGH',session.high,'BSL',true);
    add('SESSION',session.id+'_LOW',session.low,'SSL',true);
  }
  add('H4','H4_SWING_HIGH',lastPivot(four,'HIGH'),'BSL',false);
  add('H4','H4_SWING_LOW',lastPivot(four,'LOW'),'SSL',false);
  add('H1','H1_SWING_HIGH',lastPivot(hour,'HIGH'),'BSL',false);
  add('H1','H1_SWING_LOW',lastPivot(hour,'LOW'),'SSL',false);
  const recent15=fifteen.slice(-3);
  const dir15=recent15.length<3?'UNKNOWN':recent15[2].close>recent15[1].close&&recent15[1].close>recent15[0].close?'BUY':
    recent15[2].close<recent15[1].close&&recent15[1].close<recent15[0].close?'SELL':'NEUTRAL';
  const base={
    model:'BTC_ICT_MULTI_TIMEFRAME_DOL_V1',symbol:'BTCUSD',advisoryOnly:true,
    executionStrategy:'ICT_ONLY_EXTERNAL_LIQUIDITY',canOpenTrade:false,canBlockIct:false,canOverrideIctGate:false,canChangeActiveTargets:false,
    timeframeHierarchy:['W1','D1','SESSION','H4','H1','M15','M5'],levels,
    byTimeframe:Object.fromEntries(['W1','D1','SESSION','H4','H1'].map(tf=>[tf,levels.filter(x=>x.timeframe===tf)])),
    m15:{role:'CONTEXT_ONLY',direction:dir15},
    m5:{role:'EXTERNAL_SWEEP_M5_MSS_RETEST',completedBars:five.length,confirmation:'M5_MSS_DISPLACEMENT_PLUS_LATER_M5_RETEST_HOLD',mssRequired:true},
    status:levels.some(x=>x.targetEligible)?'PARTIAL_OR_AVAILABLE':'NO_CONFIRMED_EXTERNAL_REFERENCES',
    note:'External BTC levels include previous complete UTC day/week and fully observed CLOSED Asia/London/New York UTC session highs/lows. H4/H1 pivots remain context only. No M5 MSS/displacement/retest, no entry; active trade TP/SL immutable.',
    updatedAt:new Date(now).toISOString()
  };
  return projectBtcDolSide(base,side,price);
}
