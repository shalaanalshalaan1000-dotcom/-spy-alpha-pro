// ICT Draw on Liquidity: descriptive HTF map, never a new entry or exit gate.
// Only named previous-period and session reference pools qualify as external objectives.
// A raw H1/H4/M15 pivot is NOT automatically external to its parent dealing range.
const finitePrice=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const round=(v,d=3)=>v==null?null:Number(v.toFixed(d));
import { goldEntryWindow } from './gold-session-entry-policy.js';
const SOURCES=[
  ['W1','PWH','pwh','BSL',0],['W1','PWL','pwl','SSL',0],
  ['D1','PDH','pdh','BSL',1],['D1','PDL','pdl','SSL',1],
  ['H4','H4_SWING_HIGH','h4SwingHigh','BSL',2],['H4','H4_SWING_LOW','h4SwingLow','SSL',2],
  ['H1','H1_SWING_HIGH','h1SwingHigh','BSL',3],['H1','H1_SWING_LOW','h1SwingLow','SSL',3],
  ['M15','M15_SWING_HIGH','m15SwingHigh','BSL',4],['M15','M15_SWING_LOW','m15SwingLow','SSL',4],
  ['SESSION','ASIA_HIGH','asiaHigh','BSL',5],['SESSION','ASIA_LOW','asiaLow','SSL',5],
  ['SESSION','LONDON_HIGH','londonHigh','BSL',5],['SESSION','LONDON_LOW','londonLow','SSL',5],
  ['SESSION','NY_AM_HIGH','nyHigh','BSL',5],['SESSION','NY_AM_LOW','nyLow','SSL',5]
];
export function buildGoldDolMap(source={},now=Date.now()){
  const ict=source?.ict||source?.liquidityContext||{};
  const levels=ict?.levels||{};
  const price=finitePrice(source?.entry??source?.price);
  const tradeSide=String(source?.tradeState?.side||'').toUpperCase();
  const side=[source?.tradeState?.active===true?tradeSide:null,source?.candidateAction,source?.side].map(x=>String(x||'').toUpperCase()).find(x=>['BUY','SELL'].includes(x))||'WAIT';
  const entryWindow=goldEntryWindow(now);
  const m15Direction=ict?.dir15===1?'BUY':ict?.dir15===-1?'SELL':'NEUTRAL';
  const m15Aligned=m15Direction==='NEUTRAL'||side==='WAIT'||m15Direction===side;
  const drawSide=!m15Aligned?'WAIT':side==='BUY'?'BSL':side==='SELL'?'SSL':'WAIT';
  const records=SOURCES.flatMap(([timeframe,label,key,liquiditySide,rank])=>{
    const value=finitePrice(levels[key]);
    if(value==null)return [];
    const eligible=['W1','D1','SESSION'].includes(timeframe);
    return [{
      timeframe,label,level:round(value),price:round(value),liquiditySide,
      liquidityClass:eligible?'EXTERNAL_NAMED_POOL':'UNVERIFIED_SWING',
      targetEligible:eligible,rank,
      evidence:eligible?'NAMED_LEVEL_FROM_ICT_SOURCE':'PIVOT_ONLY_NOT_PROVEN_EXTERNAL'
    }];
  });
  const objectives=records.filter(x=>x.targetEligible&&x.liquiditySide===drawSide&&
    price!=null&&(side==='BUY'?x.level>price:x.level<price))
    .sort((a,b)=>Math.abs(a.level-price)-Math.abs(b.level-price)||a.rank-b.rank)
    .filter((x,i,a)=>a.findIndex(y=>Math.abs(y.level-x.level)<=.10)===i)
    .map(x=>({...x,distance:round(Math.abs(x.level-price),2)}));
  const strategic=[...objectives].sort((a,b)=>a.rank-b.rank||b.distance-a.distance);
  const primary=strategic.find(x=>!objectives[0]||Math.abs(x.level-objectives[0].level)>.10)||objectives[0]||null;
  // Liquidity map: named prior-period/session pools are external references;
  // H4/H1/M15 pivots remain internal candidates only when they sit inside a known dealing range.
  const range=ict?.dealingRange||ict?.rangeContext||ict?.range||{};
  const rangeHigh=finitePrice(range.high??range.rangeHigh??range.highPrice??ict?.dealingRangeHigh);
  const rangeLow=finitePrice(range.low??range.rangeLow??range.lowPrice??ict?.dealingRangeLow);
  const validRange=rangeHigh!=null&&rangeLow!=null&&rangeHigh>rangeLow;
  const externalPools=records.filter(x=>x.liquidityClass==='EXTERNAL_NAMED_POOL');
  const swingPools=records.filter(x=>x.liquidityClass==='UNVERIFIED_SWING');
  const internalPools=validRange?swingPools.filter(x=>x.level>rangeLow&&x.level<rangeHigh).map(x=>({...x,liquidityClass:'INTERNAL_RANGE_LIQUIDITY',targetEligible:false,evidence:'SWING_INSIDE_KNOWN_DEALING_RANGE'})):[];
  const unclassifiedSwings=validRange?swingPools.filter(x=>x.level<=rangeLow||x.level>=rangeHigh):swingPools;
  const explicitSweep=ict?.legSweep||ict?.liquiditySweep||ict?.sweep||null;
  const sweepConfirmed=Boolean(explicitSweep&&(explicitSweep.liquidityClass==='EXTERNAL'||explicitSweep.external===true));
  const sweepSide=String(explicitSweep?.side||explicitSweep?.direction||explicitSweep?.liquiditySide||'UNKNOWN').toUpperCase();
  const m1Mss=Boolean(ict?.firstMssEvent||ict?.sequence1?.firstMss||ict?.m1MssEvent?.confirmed);
  const m1Displacement=Boolean(ict?.firstDisplacementEvent||ict?.sequence1?.firstDisplacement||ict?.hasDisplacement);
  const m1Retest=Boolean(ict?.m1MssRetest?.confirmed);
  const setupChecksPassed=Boolean(ict?.coreIctEntryReady&&m1Mss&&m1Displacement&&m1Retest&&ict?.legSweep?.liquidityClass==='EXTERNAL');
  const entryEligible=Boolean(entryWindow.allowed&&setupChecksPassed&&side!=='WAIT');
  return {
    model:'ICT_MULTI_TIMEFRAME_DOL_V1',
    advisoryOnly:true,canCreateSignal:false,canOverrideIctGate:false,canChangeActiveTargets:false,
    price:round(price),side,drawSide,
    timeframeHierarchy:['W1','D1','H4','H1','M15','M1'],
    levels:records,objectives,nearest:objectives[0]||null,primary,
    liquidityMap:{
      model:'ICT_INTERNAL_EXTERNAL_LIQUIDITY_V1',advisoryOnly:true,canCreateSignal:false,
      dealingRange:validRange?{high:round(rangeHigh),low:round(rangeLow),source:'ICT_RANGE_CONTEXT'}:null,
      external:{count:externalPools.length,pools:externalPools,eligibleObjectives:objectives},
      internal:{count:internalPools.length,pools:internalPools,rangeKnown:validRange,reason:validRange?'SWINGS_INSIDE_DEALING_RANGE':'DEALING_RANGE_UNAVAILABLE'},
      unclassifiedSwings:{count:unclassifiedSwings.length,pools:unclassifiedSwings},
      sweep:{confirmed:sweepConfirmed,side:sweepSide,source:explicitSweep?'ICT_SOURCE':'NO_SWEEP_EVIDENCE'},
      sequence:{externalSweep:sweepConfirmed,mss:m1Mss,displacement:m1Displacement,retestHold:m1Retest,entryTimeframe:'M1',entryRequiresExistingIctGate:true}
    },
    targetPreview:objectives.slice(0,4).map((x,i)=>({target:'TP'+(i+1),label:x.label,price:x.price,timeframe:x.timeframe,liquiditySide:x.liquiditySide})),
    byTimeframe:Object.fromEntries(['W1','D1','H4','H1','M15'].map(tf=>[tf,records.filter(x=>x.timeframe===tf)])),
    m15:{timeframe:'M15',direction:m15Direction,role:'CONTEXT_ONLY'},
    m1:{timeframe:'M1',externalSweep:Boolean(ict?.legSweep?.liquidityClass==='EXTERNAL'),mss:m1Mss,displacement:m1Displacement,retestHold:m1Retest,setupChecksPassed,confirmed:entryEligible,entryEligible,session:entryWindow.session,sessionEntryAllowed:entryWindow.allowed,sessionReason:entryWindow.reason,m15Aligned},
    dataStatus:records.length?'PARTIAL_OR_AVAILABLE':'NO_NAMED_LIQUIDITY_LEVELS',
    entryGate:{allowed:entryEligible,session:entryWindow.session,sessionAllowed:entryWindow.allowed,m15Direction,m15Aligned,setupChecksPassed,reason:!entryWindow.allowed?entryWindow.reason:!setupChecksPassed?'ICT_M1_SEQUENCE_NOT_FULLY_CONFIRMED':'ICT_ENTRY_GATES_PASSED'},
    note:'Only named previous-day/week and session pools are eligible objectives. H1/H4/M15 swing levels are context unless independently proven external. This map never changes existing trade TP/SL or the external sweep + closed M1 MSS/displacement + M1 retest/hold gate.',
    updatedAt:new Date(now).toISOString()
  };
}
