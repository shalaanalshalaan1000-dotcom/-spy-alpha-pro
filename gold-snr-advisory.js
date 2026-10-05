const num=value=>value!=null&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value))?Number(value):null;
const round=(value,digits=3)=>{const n=num(value);return n==null?null:Number(n.toFixed(digits));};
const sideOf=source=>['BUY','SELL'].includes(String(source?.side||source?.candidateAction||source?.action||'').toUpperCase())?String(source.side||source.candidateAction||source.action).toUpperCase():null;

function collectLevels(source={},price=null){
  const rows=[];
  const add=(label,value,kind='REFERENCE',basis='MARKET')=>{
    const level=num(value);if(level==null||level<=0)return;
    rows.push({label,level:round(level),kind,basis,distance:price==null?null:round(Math.abs(price-level))});
  };
  const sessions=source?.sessionLevels?.sessions||{};
  for(const [id,row] of Object.entries(sessions)){
    add(`${id}_HIGH`,row?.high,'RESISTANCE','SESSION_M15');
    add(`${id}_LOW`,row?.low,'SUPPORT','SESSION_M15');
  }
  const ict=source?.ict||source?.liquidityContext||{};
  const refs=[
    ['PRIMARY_LIQUIDITY',ict?.primaryLiquidity||ict?.mainLiquidity],
    ['SECONDARY_LIQUIDITY',ict?.secondaryLiquidity],
    ['SWEEP_REFERENCE',ict?.legSweep||ict?.sweep]
  ];
  for(const [label,row] of refs){
    add(String(row?.label||row?.name||label).toUpperCase(),row?.price??row?.level,'REFERENCE','ICT_EXTERNAL_MAP');
  }
  const unique=[];
  for(const row of rows.sort((a,b)=>a.level-b.level)){
    if(unique.some(x=>Math.abs(x.level-row.level)<0.05))continue;
    unique.push(row);
  }
  return unique;
}

export function analyzeGoldSnr(source={}){
  const price=num(source?.price),side=sideOf(source);
  const levels=collectLevels(source,price);
  if(price==null)return{
    name:'GOLD_SNR_ADVISORY',mode:'SNR_ADVISORY',advisoryOnly:true,executionGate:false,confidenceBonus:0,
    canOpenTrade:false,canBlockTrade:false,side,alignment:'NEUTRAL',nearestSupport:null,nearestResistance:null,levels:[],
    reason:'Waiting for live XAUUSD price.'
  };
  const below=levels.filter(x=>x.level<price).sort((a,b)=>b.level-a.level);
  const above=levels.filter(x=>x.level>price).sort((a,b)=>a.level-b.level);
  const nearestSupport=below[0]||null,nearestResistance=above[0]||null;
  let alignment='NEUTRAL';
  if(side==='BUY'&&nearestSupport&&nearestResistance)alignment=nearestSupport.distance<=nearestResistance.distance?'SUPPORTIVE':'CAUTION';
  else if(side==='BUY'&&nearestSupport)alignment='SUPPORTIVE';
  else if(side==='SELL'&&nearestSupport&&nearestResistance)alignment=nearestResistance.distance<=nearestSupport.distance?'SUPPORTIVE':'CAUTION';
  else if(side==='SELL'&&nearestResistance)alignment='SUPPORTIVE';
  return{
    name:'GOLD_SNR_ADVISORY',mode:'SNR_ADVISORY',advisoryOnly:true,executionGate:false,confidenceBonus:0,
    canOpenTrade:false,canBlockTrade:false,side,alignment,price:round(price),
    nearestSupport,nearestResistance,levels:levels.slice(0,18),
    rule:'SNR is a support/resistance map for XAUUSD only. It may support or caution the ICT read, but it never opens, blocks, overrides, scores, or changes the ICT execution gate.'
  };
}
