// Independent, read-only XAUUSD timeframe agents. They never create or gate trades.
// Each agent evaluates only candles belonging to its own timeframe. If data is absent,
// it reports INSUFFICIENT_DATA instead of copying another timeframe's MSS.
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = v => finite(v) ? Number(v) : null;
const arr = v => Array.isArray(v) ? v : [];
const firstArray = (...xs) => xs.find(Array.isArray) || [];
const normalize = rows => arr(rows).map((b, i) => {
  const time = b?.time ?? b?.timestamp ?? b?.t ?? b?.openTime ?? b?.date ?? null;
  return {
    t: typeof time === 'number' && time < 1e12 ? time * 1000 : (typeof time === 'string' && Number.isFinite(Date.parse(time)) ? Date.parse(time) : time),
    open: num(b?.open ?? b?.o), high: num(b?.high ?? b?.h), low: num(b?.low ?? b?.l), close: num(b?.close ?? b?.c),
    closed: b?.closed !== false && b?.isClosed !== false && b?.complete !== false, _i: i
  };
}).filter(b => [b.open,b.high,b.low,b.close].every(Number.isFinite) && b.high >= b.low && b.high >= Math.max(b.open,b.close) && b.low <= Math.min(b.open,b.close))
  .filter(b => b.closed);

function pivotAt(bars, i, side, strength=2) {
  const p=bars[i]; if(!p || i<strength || i+strength>=bars.length) return false;
  for(let j=1;j<=strength;j++){
    if(side==='HIGH' && (bars[i-j].high>p.high || bars[i+j].high>=p.high)) return false;
    if(side==='LOW' && (bars[i-j].low<p.low || bars[i+j].low<=p.low)) return false;
  }
  return true;
}
function swings(bars) {
  const out=[];
  for(let i=2;i<bars.length-2;i++){
    if(pivotAt(bars,i,'HIGH')) out.push({side:'BSL',price:bars[i].high,t:bars[i].t,index:i});
    if(pivotAt(bars,i,'LOW')) out.push({side:'SSL',price:bars[i].low,t:bars[i].t,index:i});
  }
  return out;
}
function aggregate(bars, bucketMs) {
  const groups=[];
  for(const b of bars){
    const key=Number.isFinite(Number(b.t))?Math.floor(Number(b.t)/bucketMs):null;
    if(key===null) continue;
    let g=groups[groups.length-1];
    if(!g || g._key!==key){g={_key:key,t:key*bucketMs,open:b.open,high:b.high,low:b.low,close:b.close,closed:true};groups.push(g);}
    else {g.high=Math.max(g.high,b.high);g.low=Math.min(g.low,b.low);g.close=b.close;}
  }
  return groups;
}
function evaluate(tf, bars, fallbackLevels={}, now=Date.now()) {
  const clean=normalize(bars);
  const base={timeframe:tf,status:'INSUFFICIENT_DATA',bias:'UNKNOWN',liquidity:{high:null,low:null},sweep:{status:'UNKNOWN',side:null,level:null},mss:{status:'UNKNOWN',direction:null,brokenSwing:null,confirmationTime:null},barsAvailable:clean.length,updatedAt:new Date(now).toISOString(),source:'OWN_TIMEFRAME_CLOSED_CANDLES'};
  if(clean.length<8) {
    const hi=num(fallbackLevels.high),lo=num(fallbackLevels.low);
    return {...base,liquidity:{high:hi,low:lo},status:'INSUFFICIENT_DATA',reason:'Need at least 8 valid closed candles from this timeframe; fallback swing levels are display-only.'};
  }
  const pivots=swings(clean), highs=pivots.filter(x=>x.side==='BSL'), lows=pivots.filter(x=>x.side==='SSL');
  const latest=clean[clean.length-1], prior=clean.slice(0,-1);
  const lastHigh=highs[highs.length-1]||null,lastLow=lows[lows.length-1]||null;
  let mss=null;
  // A structure shift is confirmed only by a candle close beyond the latest confirmed opposing swing.
  if(lastHigh && latest.close>lastHigh.price && prior.slice(-4).some(b=>b.close<=lastHigh.price)) mss={status:'CONFIRMED',direction:'BULLISH',brokenSwing:lastHigh.price,confirmationTime:latest.t};
  if(lastLow && latest.close<lastLow.price && prior.slice(-4).some(b=>b.close>=lastLow.price)) {
    const candidate={status:'CONFIRMED',direction:'BEARISH',brokenSwing:lastLow.price,confirmationTime:latest.t};
    if(!mss || Number(candidate.confirmationTime)>=Number(mss.confirmationTime)) mss=candidate;
  }
  const sweepHigh=lastHigh && latest.high>lastHigh.price && latest.close<lastHigh.price;
  const sweepLow=lastLow && latest.low<lastLow.price && latest.close>lastLow.price;
  const sweep=sweepHigh?{status:'CONFIRMED',side:'BSL',level:lastHigh.price,confirmationTime:latest.t}
    :sweepLow?{status:'CONFIRMED',side:'SSL',level:lastLow.price,confirmationTime:latest.t}
    :{status:'NOT_DETECTED',side:null,level:null,confirmationTime:null};
  const direction=mss?.direction||(latest.close>clean[Math.max(0,clean.length-5)].close?'BULLISH':latest.close<clean[Math.max(0,clean.length-5)].close?'BEARISH':'RANGE');
  return {...base,status:'ACTIVE',bias:direction,liquidity:{high:lastHigh?.price??num(fallbackLevels.high),low:lastLow?.price??num(fallbackLevels.low),highTime:lastHigh?.t??null,lowTime:lastLow?.t??null},sweep,mss:mss||{status:'NONE',direction:null,brokenSwing:null,confirmationTime:null},barsAvailable:clean.length,lastClosedCandle:{time:latest.t,close:latest.close},reason:mss?'Closed-candle MSS confirmed on this timeframe.':'No confirmed MSS on the latest closed candle.',source:'OWN_TIMEFRAME_CLOSED_CANDLES'};
}
export function buildGoldTimeframeAgents(source={}, now=Date.now()) {
  const ict=source.ict||source.liquidityContext||{};
  const feeds=source.timeframeCandles||source.candlesByTimeframe||source.multiTimeframe?.candles||source.marketData?.candles||ict.timeframeCandles||ict.candlesByTimeframe||{};
  const bars=(...keys)=>firstArray(...keys.map(k=>feeds?.[k]),...keys.map(k=>source?.[k]),...keys.map(k=>ict?.[k]));
  const raw1m=bars('M1','m1','1m','oneMinute','candlesM1');
  const raw5m=bars('M5','m5','5m','candlesM5');
  const raw15m=bars('M15','m15','15m','candlesM15');
  const raw30m=bars('M30','m30','30m','candlesM30');
  const raw1h=bars('H1','h1','1h','60m','candlesH1');
  const raw4h=bars('H4','h4','4h','240m','candlesH4');
  const norm15=normalize(raw15m), norm30=normalize(raw30m), norm1h=normalize(raw1h);
  // Aggregation is allowed only from complete native lower-timeframe candle series.
  const bars30=norm30.length?raw30m:(norm15.length>=16?aggregate(norm15,30*60*1000):[]);
  const bars4h=normalize(raw4h).length?raw4h:(norm1h.length>=16?aggregate(norm1h,4*60*60*1000):[]);
  const levels=ict.levels||{};
  const agents={
    H4:evaluate('H4',bars4h,{high:levels.h4SwingHigh,low:levels.h4SwingLow},now),
    H1:evaluate('H1',raw1h,{high:levels.h1SwingHigh,low:levels.h1SwingLow},now),
    M30:evaluate('M30',bars30,{},now),
    M15:evaluate('M15',raw15m,{high:levels.m15SwingHigh,low:levels.m15SwingLow},now),
    M1:evaluate('M1',raw1m,{},now)
  };
  return {model:'GOLD_INDEPENDENT_TIMEFRAME_AGENTS_V1',advisoryOnly:true,canCreateSignal:false,canChangeTradeGate:false,timeframes:agents,updatedAt:new Date(now).toISOString(),note:'Each agent uses its own closed candles. Missing candle data remains INSUFFICIENT_DATA; no MSS is copied from another timeframe.'};
}
