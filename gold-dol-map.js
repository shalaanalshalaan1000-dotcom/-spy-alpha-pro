// ICT Draw on Liquidity: descriptive HTF map, never a new entry or exit gate.
// Only named previous-period and session reference pools qualify as external objectives.
// A raw H1/H4/M15 pivot is NOT automatically external to its parent dealing range.
const finitePrice=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const round=(v,d=3)=>v==null?null:Number(v.toFixed(d));
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
  const rawSide=String(source?.side||source?.candidateAction||source?.action||'').toUpperCase();
  const side=['BUY','SELL'].includes(rawSide)?rawSide:'WAIT';
  const drawSide=side==='BUY'?'BSL':side==='SELL'?'SSL':'WAIT';
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
  const m15Direction=ict?.dir15===1?'BUY':ict?.dir15===-1?'SELL':'NEUTRAL';
  const m5Mss=Boolean(ict?.m5MssEvent?.mss||ict?.sequence5?.firstMss);
  const m5Retest=Boolean(ict?.m5MssRetest?.confirmed);
  return {
    model:'ICT_MULTI_TIMEFRAME_DOL_V1',
    advisoryOnly:true,canCreateSignal:false,canOverrideIctGate:false,canChangeActiveTargets:false,
    price:round(price),side,drawSide,
    timeframeHierarchy:['W1','D1','H4','H1','M15','M5'],
    levels:records,objectives,nearest:objectives[0]||null,primary,
    targetPreview:objectives.slice(0,4).map((x,i)=>({target:'TP'+(i+1),label:x.label,price:x.price,timeframe:x.timeframe,liquiditySide:x.liquiditySide})),
    byTimeframe:Object.fromEntries(['W1','D1','H4','H1','M15'].map(tf=>[tf,records.filter(x=>x.timeframe===tf)])),
    m15:{timeframe:'M15',direction:m15Direction,role:'CONTEXT_ONLY'},
    m5:{timeframe:'M5',externalSweep:Boolean(ict?.legSweep?.liquidityClass==='EXTERNAL'),mss:m5Mss,retestHold:m5Retest,confirmed:Boolean(ict?.coreIctEntryReady&&m5Mss&&m5Retest)},
    dataStatus:records.length?'PARTIAL_OR_AVAILABLE':'NO_NAMED_LIQUIDITY_LEVELS',
    note:'Only named previous-day/week and session pools are eligible objectives. H1/H4/M15 swing levels are context unless independently proven external. This map never changes existing trade TP/SL or the external sweep + M5 MSS + M5 retest/hold gate.',
    updatedAt:new Date(now).toISOString()
  };
}
