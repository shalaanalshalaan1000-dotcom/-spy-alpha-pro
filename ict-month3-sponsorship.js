const n=v=>v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;

const SELL_SIDE_NAMES=new Set(['pdl','pwl','asiaLow','londonLow','nyLow']);
const BUY_SIDE_NAMES=new Set(['pdh','pwh','asiaHigh','londonHigh','nyHigh']);
const LONG_SESSION_NAMES=new Set(['londonLow','nyLow']);
const SHORT_SESSION_NAMES=new Set(['londonHigh','nyHigh']);

function sideOf(v){return ['BUY','SELL'].includes(v)?v:null;}
function sweepOf(ict={}){return ict?.legSweep||ict?.sweep||null;}
function rounded(v,d=3){const x=n(v);return x==null?null:Number(x.toFixed(d));}

export function buildMonth3Sponsorship({side,candidate={},topDown={},price,now=Date.now()}={}){
  const selected=sideOf(side)||sideOf(candidate?.candidateAction)||sideOf(candidate?.side);
  const ict=candidate?.ict||candidate?.liquidityContext||candidate||{};
  const sweep=sweepOf(ict);
  const sweepName=String(sweep?.name||'');
  const target1=n(candidate?.target1);
  const px=n(price??candidate?.price??candidate?.entry);
  const reads=topDown?.reads||candidate?.multiTimeframe?.reads||{};
  const trendContinuation=ict?.trendContinuation||null;
  const htfFvg=trendContinuation?.htfFvg||null;

  const htfExact=Boolean(
    selected&&
    htfFvg?.valid===true&&
    htfFvg?.side===selected&&
    ['H4','H1'].includes(String(htfFvg?.timeframe||''))
  );
  const alignedFrames=['H4','H1'].filter(tf=>reads?.[tf]?.side===selected);
  const htfContext=Boolean(selected&&(htfExact||alignedFrames.length>0));

  const intermediateLiquidityRun=Boolean(
    selected==='BUY' ? SELL_SIDE_NAMES.has(sweepName) :
    selected==='SELL' ? BUY_SIDE_NAMES.has(sweepName) : false
  );

  const shortTermExitLiquidity=Boolean(
    selected&&px!=null&&target1!=null&&
    (selected==='BUY'?target1>px:target1<px)
  );

  const timeOfDayInfluence=Boolean(
    selected==='BUY' ? LONG_SESSION_NAMES.has(sweepName) :
    selected==='SELL' ? SHORT_SESSION_NAMES.has(sweepName) : false
  );

  const confirmations=[
    htfContext,
    intermediateLiquidityRun,
    shortTermExitLiquidity,
    timeOfDayInfluence
  ].filter(Boolean).length;

  return{
    model:'ICT_MONTH3_INSTITUTIONAL_SPONSORSHIP',
    source:'ICT Monthly Mentorship — November 2016',
    advisoryOnly:true,
    canCreateSignal:false,
    canBlockSignal:false,
    canOverrideEntryGate:false,
    side:selected||'WAIT',
    confirmations,
    totalChecks:4,
    supported:confirmations>=2,
    higherTimeFramePriceDisplacement:{
      supported:htfContext,
      evidence:htfExact?'HTF_FVG_DISPLACEMENT_CONTEXT':alignedFrames.length?('ALIGNED_'+alignedFrames.join('_')):'NONE',
      exactEventDetected:htfExact,
      alignedFrames
    },
    intermediateTermImbalance:{
      supported:intermediateLiquidityRun,
      evidence:intermediateLiquidityRun?(selected==='BUY'?'SELL_SIDE_LIQUIDITY_RUN':'BUY_SIDE_LIQUIDITY_RUN'):'NONE',
      sweptLevel:rounded(sweep?.level),
      sweepName:sweepName||null
    },
    shortTermExitLiquidity:{
      supported:shortTermExitLiquidity,
      evidence:shortTermExitLiquidity?(selected==='BUY'?'BUY_SIDE_LIQUIDITY_ABOVE':'SELL_SIDE_LIQUIDITY_BELOW'):'NONE',
      target1:rounded(target1),
      price:rounded(px)
    },
    timeOfDayInfluence:{
      supported:timeOfDayInfluence,
      evidence:timeOfDayInfluence?(selected==='BUY'?'LONDON_OR_NEW_YORK_LOW_FORMATION':'LONDON_OR_NEW_YORK_HIGH_FORMATION'):'NONE',
      sweepName:sweepName||null
    },
    note:'Month 3 context is supporting evidence only. It never creates, blocks, or overrides the existing gold ICT entry gates.',
    updatedAt:new Date(now).toISOString()
  };
}
