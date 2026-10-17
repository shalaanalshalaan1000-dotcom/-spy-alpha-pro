import {buildBtcDolMap,projectBtcDolSide} from './btc-dol-map.js';
const CACHE_MS=12000,MAX_ENTRY_AGE_MS=300000,SWEEP_TTL_MS=4*3600000;
const CONTRACT_SIZE=Math.max(.000001,Number(process.env.EXNESS_BTC_CONTRACT_SIZE||1));
const LOT_STEP=Math.max(.001,Number(process.env.EXNESS_BTC_LOT_STEP||.01));
const SAFE_RISK_USD=Math.max(1,Number(process.env.BTC_SAFE_RISK_USD||5));
const MAX_RISK_USD=Math.max(SAFE_RISK_USD,Number(process.env.BTC_MAX_RISK_USD||10));
const cache={expiresAt:0,value:null};
const lifecycle={signal:null,lastTerminal:null,lastClosedSignal:null,cooldownUntil:0,seen:new Set()};
const num=v=>v==null||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
const round=(v,d=2)=>num(v)==null?null:Number(Number(v).toFixed(d));
async function coinbaseCandles(granularity) {
  const url = new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
  url.searchParams.set('granularity', String(granularity));
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Gold-Alpha-BTC-ICT/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000)
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows)) throw new Error(`Coinbase candles unavailable ${response.status}`);
  const now = Date.now();
  const span = granularity * 1000;
  return rows.map(x => ({
    t: Number(x[0]) * 1000,
    low: Number(x[1]),
    high: Number(x[2]),
    open: Number(x[3]),
    close: Number(x[4]),
    volume: Number(x[5] || 0)
  })).filter(x => [x.t, x.open, x.high, x.low, x.close].every(Number.isFinite) && x.close > 0 && x.t + span <= now + 1000)
    .sort((a, b) => a.t - b.t);
}

async function coinbaseTicker() {
  const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker', {
    headers: { accept: 'application/json', 'user-agent': 'Gold-Alpha-BTC-ICT/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Coinbase ticker unavailable ${response.status}`);
  return data;
}

function aggregate(rows, hours) {
  const span = hours * 3600000;
  const out = new Map();
  for (const bar of rows) {
    const key = Math.floor(bar.t / span) * span;
    const old = out.get(key);
    if (!old) out.set(key, { ...bar, t: key });
    else {
      old.high = Math.max(old.high, bar.high);
      old.low = Math.min(old.low, bar.low);
      old.close = bar.close;
      old.volume += num(bar.volume) || 0;
    }
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

function atr(rows, period = 14) {
  if (!Array.isArray(rows) || rows.length <= period) return null;
  const vals = [];
  for (let i = rows.length - period; i < rows.length; i += 1) {
    const bar = rows[i], prev = rows[i - 1];
    vals.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close)));
  }
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function pivots(rows, left = 2, right = 2) {
  const highs = [], lows = [];
  for (let i = left; i < rows.length - right; i += 1) {
    const bar = rows[i];
    const before = rows.slice(i - left, i), after = rows.slice(i + 1, i + 1 + right);
    if (before.every(x => bar.high > x.high) && after.every(x => bar.high >= x.high)) highs.push({ t: bar.t, price: bar.high });
    if (before.every(x => bar.low < x.low) && after.every(x => bar.low <= x.low)) lows.push({ t: bar.t, price: bar.low });
  }
  return { highs, lows };
}

function lotForRisk(entry, stop, riskUsd) {
  const distance = Math.abs(Number(entry) - Number(stop));
  if (!(distance > 0)) return 0;
  const raw = riskUsd / (distance * CONTRACT_SIZE);
  const steps = Math.floor((raw + 1e-12) / LOT_STEP);
  return steps > 0 ? Number((steps * LOT_STEP).toFixed(3)) : 0;
}

function lotSizing(entry, stop) {
  const distance = Math.abs(entry - stop);
  return {
    recommendedLot: lotForRisk(entry, stop, SAFE_RISK_USD),
    maxLot: lotForRisk(entry, stop, MAX_RISK_USD),
    stopDistance: round(distance),
    safeRiskUsd: SAFE_RISK_USD,
    maxRiskUsd: MAX_RISK_USD
  };
}


const validM1=(b,now)=>b&&Number.isFinite(b.t)&&b.t+60000<=now&&Number.isFinite(b.open)&&Number.isFinite(b.high)&&Number.isFinite(b.low)&&Number.isFinite(b.close);
const sideFor=pool=>pool.liquiditySide==='SSL'?'BUY':'SELL';
function precedingPivot(bars,side){
 if(bars.length<7)return null;const f=side==='BUY'?'high':'low';
 for(let i=bars.length-3;i>=2;i--){const v=bars[i][f],l=[bars[i-2],bars[i-1]],r=[bars[i+1],bars[i+2]];
  const valid=side==='BUY'?l.every(b=>v>b.high)&&r.every(b=>v>=b.high):l.every(b=>v<b.low)&&r.every(b=>v<=b.low);
  if(valid)return v;}return null;
}
// BTC mirrors gold: external sweep -> closed M1 MSS/displacement -> later M1 retest/hold.
export function detectBtcIctSequence({M1=[],externalLevels=[],now=Date.now(),atr1=null}={}){
 const bars=M1.filter(b=>validM1(b,now)).sort((a,b)=>a.t-b.t),a=atr1||atr(bars)||50;
 const levels=externalLevels.filter(p=>p.targetEligible===true&&(['PWH','PWL','PDH','PDL'].includes(p.label)||String(p.label||'').startsWith('M1I_'))),found=[];
 for(let s=Math.max(7,bars.length-240);s<bars.length-2;s++){
  const sweep=bars[s];if(now-(sweep.t+60000)>4*3600000)continue;
  for(const pool of levels){const side=sideFor(pool),isBuy=side==='BUY';
   if(!(isBuy?sweep.low<pool.level&&sweep.close>pool.level:sweep.high>pool.level&&sweep.close<pool.level))continue;
   const trigger=precedingPivot(bars.slice(Math.max(0,s-60),s),side);if(trigger==null)continue;
   const extreme=isBuy?sweep.low:sweep.high;
   for(let i=s+1;i<Math.min(bars.length,s+21);i++){
    const mssBar=bars[i];if(isBuy?mssBar.close<extreme:mssBar.close>extreme)break;
    // MSS is the first closed M1 candle through the pre-sweep pivot; displacement may
    // confirm on that candle or either of the next two closed candles.
    const crossed=isBuy?mssBar.close>trigger:mssBar.close<trigger;
    const crossedEarlier=bars.slice(s+1,i).some(x=>isBuy?x.close>trigger:x.close<trigger);
    if(!crossed||crossedEarlier)continue;
    let displacementIndex=-1;
    for(let d=i;d<=Math.min(i+2,bars.length-1);d++){
     const b=bars[d];if(isBuy?b.close<extreme:b.close>extreme)break;
     const range=Math.max(.0001,b.high-b.low),body=Math.abs(b.close-b.open);
     const displaced=body>=Math.max(.0001,a*.25)&&(isBuy?b.close>b.open&&b.close>=b.low+range*.55:b.close<b.open&&b.close<=b.high-range*.55);
     if(displaced){displacementIndex=d;break;}
    }
    if(displacementIndex<0)continue;
    const displacementBar=bars[displacementIndex];
    let retestFound=false;
    for(let j=displacementIndex+1;j<Math.min(bars.length,displacementIndex+21);j++){
     const r=bars[j],tol=Math.max(.5,a*.35);if(isBuy?r.close<extreme:r.close>extreme)break;
     const touched=isBuy?r.low<=trigger+tol:r.high>=trigger-tol;
     const held=isBuy?r.close>trigger&&r.low>=extreme:r.close<trigger&&r.high<=extreme;
     if(!touched||!held||now-(r.t+60000)>8*60000)continue;
     found.push({side,pool,trigger,extreme,sweepAt:sweep.t,mssAt:mssBar.t,displacementAt:displacementBar.t,retestAt:r.t,retestClose:r.close,retestLow:r.low,retestHigh:r.high,
      mss:{confirmed:true,level:round(trigger),t:mssBar.t,timeframe:'M1',closeT:mssBar.t+60000,displacement:true,displacementAt:displacementBar.t},
      retest:{confirmed:true,level:round(trigger),t:r.t,timeframe:'M1',closeT:r.t+60000,hold:true},
      setupId:['BTC-ICT-M1',side,pool.label,sweep.t,mssBar.t,displacementBar.t,r.t].join('-')});
     retestFound=true;break;
    }
    if(retestFound)break;
   }
  }
 }
 return found.sort((a,b)=>b.retestAt-a.retestAt||b.mssAt-a.mssAt);
}
export function analyzeBtcIct({M1=[],M5=[],M15=[],H1=[],H4=[],D1=[],ticker={},now=Date.now()}={}){
 const price=num(ticker.price),closed1=M1.filter(b=>validM1(b,now)).sort((a,b)=>a.t-b.t),closed5=M5.filter(b=>b&&Number.isFinite(b.t)&&b.t+300000<=now&&Number.isFinite(b.close)).sort((a,b)=>a.t-b.t);
 const dol=buildBtcDolMap({M5:closed5,M15,H1,H4,D1,price,now});
 // Confirmed M1 swing pools inside the recent range are eligible for short-duration scalps.
 const internalBars=closed1.slice(-120), internalPivots=pivots(internalBars,2,2);
 const rangeHigh=internalBars.length?Math.max(...internalBars.map(b=>b.high)):null;
 const rangeLow=internalBars.length?Math.min(...internalBars.map(b=>b.low)):null;
 const internalLevels=[
   ...internalPivots.highs.slice(-4).map(p=>({timeframe:'M1',label:'M1I_BSL_'+p.t,level:round(p.price),price:round(p.price),liquiditySide:'BSL',liquidityClass:'INTERNAL_RANGE',targetEligible:true,evidence:'CONFIRMED_M1_SWING_INSIDE_RECENT_RANGE'})),
   ...internalPivots.lows.slice(-4).map(p=>({timeframe:'M1',label:'M1I_SSL_'+p.t,level:round(p.price),price:round(p.price),liquiditySide:'SSL',liquidityClass:'INTERNAL_RANGE',targetEligible:true,evidence:'CONFIRMED_M1_SWING_INSIDE_RECENT_RANGE'}))
 ].filter(p=>p.level!=null&&p.level>0&&rangeHigh!=null&&rangeLow!=null&&p.level<=rangeHigh&&p.level>=rangeLow);
 dol.levels=[...(dol.levels||[]),...internalLevels];
 const qt=Date.parse(ticker.time||''),quoteFresh=Number.isFinite(qt)&&qt<=now+30000&&now-qt<=90000;
 const last=closed1.at(-1),oneFresh=last&&now-(last.t+60000)<=180000;
 const base={symbol:'BTCUSD',strategy:'ICT_EXTERNAL_AND_INTERNAL_M1_SCALP',tradeStyle:'ICT_EXTERNAL_PLUS_INTERNAL_LIQUIDITY',
   status:'WAIT',action:'WAIT',side:null,executable:false,executionMode:'SIGNALS_ONLY',
   confidence:0,confidenceIsProbability:false,price:round(price),entry:null,stopLoss:null,target1:null,
   target2:null,target3:null,target4:null,targetLabels:[],lotSizing:null,riskReward:null,dol,
   ict:{gate:'EXTERNAL_OR_INTERNAL_M1_SWEEP -> CLOSED_M1_MSS_CHOCH_DISPLACEMENT -> LATER_M1_RETEST_HOLD',externalOnly:false,internalLiquidityScalps:true,confirmed:false,
    m15Role:'CONTEXT_ONLY',m1Role:'EXECUTION_GATE',m5Role:'CONTEXT_ONLY',quoteFresh,oneFresh:Boolean(oneFresh)},
   updatedAt:new Date(now).toISOString(),reason:'BTC ICT WAIT — external/internal liquidity sweep, closed M1 MSS/CHoCH, displacement and later M1 retest/hold'};
 if(price==null||!quoteFresh||!oneFresh||closed1.length<30)return{...base,reason:'BTC ICT WAIT — fresh quote plus completed M1 history required'};
 const atr1=atr(closed1)||price*.0005;
 const sequence=detectBtcIctSequence({M1:closed1,externalLevels:dol.levels,atr1,now})[0];
 if(!sequence)return base;
 const side=sequence.side,dir=side==='BUY'?1:-1,objectives=projectBtcDolSide(dol,side,price);
 const anchor=side==='BUY'?Math.min(sequence.extreme,sequence.retestLow):Math.max(sequence.extreme,sequence.retestHigh);
 const stop=round(anchor-dir*Math.max(2,atr1*.22)),risk=Math.abs(price-stop);
 const targets=objectives.objectives.filter(x=>x.liquidityClass==='INTERNAL_RANGE'?x.distance>=Math.max(2,risk*.8):x.distance>=Math.max(10,risk*.8)).slice(0,4);
 const drift=Math.abs(price-sequence.retestClose),maxDrift=Math.max(20,Math.min(200,atr1*2.5));
 const ict={...base.ict,confirmed:true,legSweep:{name:sequence.pool.label,level:sequence.pool.level,
   liquidityClass:sequence.pool.liquidityClass==='INTERNAL_RANGE'?'INTERNAL_RANGE':'EXTERNAL',t:sequence.sweepAt,extreme:round(sequence.extreme)},
   setupLiquidityClass:sequence.pool.liquidityClass==='INTERNAL_RANGE'?'INTERNAL_RANGE':'EXTERNAL',
   m1MssEvent:sequence.mss,m1MssRetest:sequence.retest,activeSequence:sequence,atr1:round(atr1),executionTimeframe:'M1'};
 if(risk<=0||dir*(price-stop)<=0||!targets.length||drift>maxDrift){
   return{...base,dol:objectives,ict,reason:!targets.length?'BTC ICT WAIT — no valid external or internal liquidity TP with enough reward':drift>maxDrift?'BTC ICT NO CHASE — price too far from M1 retest':'BTC ICT WAIT — invalid structural stop'};
 }
 const rr=targets[0].distance/risk;
 if(rr<.8)return{...base,dol:objectives,ict,reason:'BTC ICT WAIT — minimum 0.8R to first valid liquidity TP not met'};
 return{...base,status:'ACTIVE',action:side,side,confidence:80,setupStrength:80,
   setupId:sequence.setupId,entry:round(price),stopLoss:stop,target1:targets[0]?.level??null,
   target2:targets[1]?.level??null,target3:targets[2]?.level??null,target4:targets[3]?.level??null,
   targetLabels:targets.map(x=>x.label),riskReward:round(rr),lotSizing:lotSizing(price,stop),
   dol:objectives,ict,reason:'BTC ICT '+side+' — '+(sequence.pool.liquidityClass==='INTERNAL_RANGE'?'internal M1 liquidity scalp':'external '+sequence.pool.label)+' sweep, displaced closed M1 MSS, subsequent M1 retest/hold. Target class: '+sequence.pool.liquidityClass+'.'};
}
function reached(side, price, target) {
  const p = num(price), t = num(target);
  if (p == null || t == null || p <= 0 || t <= 0) return false;
  return side === 'BUY' ? p >= t : p <= t;
}

// Pure safety check for the displayed entry. Setup strength is not a live entry permission.
export function btcEntryBlockReason(candidate = {}) {
  const side = candidate.action;
  const price = num(candidate.price), entry = num(candidate.entry);
  const stop = num(candidate.stopLoss), tp1 = num(candidate.target1);
  if (!['BUY', 'SELL'].includes(side) ||
      [price, entry, stop, tp1].some(v => v == null || v <= 0)) return 'MISSING_VALID_LIVE_LEVELS';
  if (side === 'BUY' ? !(stop < entry && entry < tp1) : !(tp1 < entry && entry < stop)) {
    return 'INVALID_ENTRY_STOP_TARGET_GEOMETRY';
  }
  if (reached(side, price, tp1)) return 'TP1_ALREADY_REACHED';
  if (side === 'BUY' ? price <= stop : price >= stop) return 'STOP_ALREADY_REACHED';
  // A large gap between last completed M1 candle and live ticker is not an executable price.
  const maxDrift = Math.max(20, Math.min(200, Math.abs(entry - stop) * 0.5));
  if (Math.abs(price - entry) > maxDrift) return 'LIVE_PRICE_TOO_FAR_FROM_ENTRY';
  return null;
}

function noNewEntry(signal, status, reason, terminalEvent) {
  return {
    ...signal,
    status,
    action: 'WAIT',
    side: null,
    tradeSide: signal.tradeSide || signal.action,
    executable: false,
    entryEligible: false,
    confidence: 0,
    originalSetupStrength: signal.originalSetupStrength ?? signal.confidence,
    reason,
    lockedTargets: true,
    terminalEvent
  };
}

function closeBtcSignal(signal, type, price, now) {
  const at = new Date(now).toISOString();
  const terminalEvent = {
    type, side: signal.action, signalId: signal.signalId, at,
    price: round(price), entry: signal.entry,
    stopLoss: signal.stopLoss, target1: signal.target1, target2: signal.target2,
    targetHits: [...(signal.targetHits || [])],
    status: 'CLOSED', // Model signal outcome, NOT a confirmed broker-side closure.
    brokerPositionClosed: false
  };
  lifecycle.lastTerminal = terminalEvent;
  lifecycle.cooldownUntil = now + 60000;
  lifecycle.signal = null;
  const reason = `BTC ICT SIGNAL CLOSED — ${type}; signal ended at ${round(price)}. Not a broker trade closure. NO NEW ENTRY.`;
  lifecycle.lastClosedSignal = {
    ...noNewEntry(signal, 'CLOSED', reason, terminalEvent),
    closedAt: at,
    closedReason: type,
    brokerPositionClosed: false
  };
  return lifecycle.lastClosedSignal;
}

export function lifecycleSignal(candidate, now = Date.now()) {
  const price = num(candidate?.price);
  const validPrice = price != null && price > 0;

  if (lifecycle.signal) {
    const signal = lifecycle.signal;
    const alreadyHitTp1 = signal.targetHits?.[0] === true;
    const protectiveLevel = alreadyHitTp1 ? signal.target1 : signal.stopLoss;
    const stopHit = validPrice && num(protectiveLevel) != null &&
      (signal.action === 'BUY' ? price <= protectiveLevel : price >= protectiveLevel);
    if (stopHit) {
      return closeBtcSignal(signal, alreadyHitTp1 ? 'PROTECTED_STOP' : 'SL', price, now);
    }
    if (validPrice) {
      signal.price = round(price);
      signal.updatedAt = candidate.updatedAt || new Date(now).toISOString();
      const priorHits = [...signal.targetHits];
      signal.targetHits = [signal.target1, signal.target2, signal.target3, signal.target4]
        .map((target, i) => priorHits[i] || reached(signal.action, price, target));
      // TP2 is the default completion point. If only TP1 exists, TP1 completes the model signal.
      const closeAt = num(signal.target2) != null && signal.target2 > 0 ? 2 : 1;
      if (signal.targetHits[closeAt - 1]) {
        return closeBtcSignal(signal, `TP${closeAt}`, price, now);
      }
      if (!alreadyHitTp1 && signal.targetHits[0]) {
        signal.latestMilestone = {
          type: 'TP1', price: round(price), target: signal.target1,
          at: new Date(now).toISOString(), signalId: signal.signalId
        };
      }
    }
    if (signal.targetHits[0]) {
      return noNewEntry(signal, 'TP1_HIT',
        `BTC ICT TP1 HIT at ${signal.target1}; entry is closed to new traders. TP2 or protective stop is next. NO NEW ENTRY.`,
        lifecycle.lastTerminal);
    }
    if (now - signal.issuedAtMs >= MAX_ENTRY_AGE_MS) {
      const at = new Date(now).toISOString();
      const terminalEvent = {type:'ENTRY_EXPIRED',side:signal.action,signalId:signal.signalId,at,price:round(price),entry:signal.entry,stopLoss:signal.stopLoss,target1:signal.target1,target2:signal.target2,targetHits:[...(signal.targetHits||[])],status:'EXPIRED',brokerPositionClosed:false};
      lifecycle.lastTerminal = terminalEvent;
      lifecycle.cooldownUntil = now + 15000;
      lifecycle.signal = null;
      lifecycle.lastClosedSignal = {...noNewEntry(signal,'EXPIRED','BTC ICT ENTRY WINDOW EXPIRED — stale setup released; waiting for a new confirmed M1 setup.',terminalEvent),closedAt:at,closedReason:'ENTRY_EXPIRED',brokerPositionClosed:false,trackingActive:false,entryWindowExpired:true};
      return lifecycle.lastClosedSignal;
    }
    return { ...signal, status: 'ACTIVE', entryEligible: true, lockedTargets: true, terminalEvent: lifecycle.lastTerminal };
  }

  if (now >= lifecycle.cooldownUntil && candidate.status === 'ACTIVE' && candidate.setupId && !lifecycle.seen.has(candidate.setupId)) {
    // A stale or already-consumed target MUST NOT be issued as a fresh SELL/BUY.
    const entryBlock = btcEntryBlockReason(candidate);
    if (entryBlock) {
      lifecycle.seen.add(candidate.setupId);
      return lifecycle.lastClosedSignal
        ? { ...lifecycle.lastClosedSignal, price: round(price), updatedAt: candidate.updatedAt }
        : { ...candidate, status: 'WAIT', action: 'WAIT', side: null,
            entry: null, stopLoss: null, target1: null, target2: null, target3: null, target4: null,
            confidence: 0, executable: false, entryEligible: false,
            reason: `BTC ICT BLOCKED — ${entryBlock}; historical setup is not a new entry.`,
            terminalEvent: lifecycle.lastTerminal };
    }
    lifecycle.seen.add(candidate.setupId);
    if (lifecycle.seen.size > 200) lifecycle.seen.delete(lifecycle.seen.values().next().value);
    lifecycle.lastClosedSignal = null;
    lifecycle.signal = {
      ...candidate, signalId: `BTC-ICT-${now}`, issuedAtMs: now,
      targetHits: [false, false, false, false],
      lockedTargets: true, entryEligible: true, latestMilestone: null
    };
    return { ...lifecycle.signal, terminalEvent: lifecycle.lastTerminal };
  }

  if (lifecycle.lastClosedSignal) {
    return {
      ...lifecycle.lastClosedSignal,
      price: round(price),
      updatedAt: candidate.updatedAt || new Date(now).toISOString()
    };
  }

  return {
    ...candidate,
    status: 'WAIT',
    action: 'WAIT',
    side: null,
    entry: null,
    stopLoss: null,
    target1: null,
    target2: null,
    target3: null,
    target4: null,
    signalId: null,
    confidence: 0,
    executable: false,
    entryEligible: false,
    terminalEvent: lifecycle.lastTerminal,
    cooldownRemainingMs: Math.max(0, lifecycle.cooldownUntil - now)
  };
}

export function resetBtcIctLifecycleForTests() {
  lifecycle.signal = null;
  lifecycle.lastTerminal = null;
  lifecycle.lastClosedSignal = null;
  lifecycle.cooldownUntil = 0;
  lifecycle.seen.clear();
}

async function freshCandidate(force=false){
 if(!force&&cache.value&&Date.now()<cache.expiresAt)return cache.value;
 const [M1,M5,M15,H1,D1,ticker]=await Promise.all([
  coinbaseCandles(60),coinbaseCandles(300),coinbaseCandles(900),
  coinbaseCandles(3600),coinbaseCandles(86400),coinbaseTicker()
 ]);
 const value=analyzeBtcIct({M1,M5,M15,H1,H4:aggregate(H1,4),D1,ticker});
 cache.value=value;cache.expiresAt=Date.now()+CACHE_MS;return value;
}
export async function getBtcSignal(force=false){
 const candidate=await freshCandidate(force),managed=lifecycleSignal(candidate);
 return{...managed,dol:projectBtcDolSide(candidate.dol,managed.tradeSide||managed.side||managed.action,managed.price),
  ict:managed.ict||candidate.ict,strategy:'ICT_EXTERNAL_AND_INTERNAL_M1_SCALP',tradeStyle:'ICT_EXTERNAL_PLUS_INTERNAL_LIQUIDITY'};
}
