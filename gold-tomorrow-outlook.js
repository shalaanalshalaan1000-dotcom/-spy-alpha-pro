const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function sideOf(value){
  const s=String(value||'').toUpperCase();
  if(['BUY','UP','BULL','BULLISH','LONG'].includes(s))return'BUY';
  if(['SELL','DOWN','BEAR','BEARISH','SHORT'].includes(s))return'SELL';
  return'NEUTRAL';
}

function nyDateParts(ts){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(ts));
  const out=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return{year:Number(out.year),month:Number(out.month),day:Number(out.day)};
}

function nextTradingDate(now=Date.now()){
  const p=nyDateParts(now);
  for(let offset=1;offset<=4;offset++){
    const d=new Date(Date.UTC(p.year,p.month-1,p.day+offset,12));
    const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'}).format(d);
    if(weekday!=='Sat'&&weekday!=='Sun'){
      const q=nyDateParts(d.getTime());
      return String(q.year).padStart(4,'0')+'-'+String(q.month).padStart(2,'0')+'-'+String(q.day).padStart(2,'0');
    }
  }
  return null;
}

function liquidityPoint(candidate){
  if(!candidate||typeof candidate!=='object')return null;
  const price=finite(candidate.price??candidate.level);
  if(price==null)return null;
  return{label:String(candidate.label||candidate.name||candidate.role||'EXTERNAL LIQUIDITY'),price};
}

export function buildTomorrowOutlook(source={},now=Date.now()){
  const price=finite(source.price);
  const ict=source.ict||source.liquidityContext||{};
  const mtf=source.multiTimeframe||source.confluence?.multiTimeframe||{};
  const reads=mtf.reads||{};
  const m6=mtf.month6Support||source.agents?.market?.context?.month6Support||{};
  const scenario=source.scenarioPlan||source.momentum?.scenarioPlan||{};
  const levels=ict.levels||{};

  const weights={W1:3,D1:4,H4:2,H1:1};
  let directional=0,evidence=0;
  for(const [tf,w] of Object.entries(weights)){
    const side=sideOf(reads?.[tf]?.side??m6?.reads?.[tf]);
    if(side==='BUY'){directional+=w;evidence+=w;}
    else if(side==='SELL'){directional-=w;evidence+=w;}
  }

  const draw=liquidityPoint(m6.drawOnLiquidity)
    ||liquidityPoint(ict.primaryLiquidity)
    ||liquidityPoint(ict.mainLiquidity)
    ||liquidityPoint(ict.secondaryLiquidity);

  if(draw&&price!=null){
    const diff=draw.price-price;
    if(Math.abs(diff)>=0.05){directional+=diff>0?2:-2;evidence+=2;}
  }

  const scenarioSide=sideOf(scenario.bias);
  if(scenarioSide==='BUY'){directional+=1;evidence+=1;}
  else if(scenarioSide==='SELL'){directional-=1;evidence+=1;}

  const w1=sideOf(reads?.W1?.side??m6?.reads?.W1);
  const d1=sideOf(reads?.D1?.side??m6?.reads?.D1);
  const htfConflict=w1!=='NEUTRAL'&&d1!=='NEUTRAL'&&w1!==d1;

  let bias='BALANCED';
  if(!htfConflict&&directional>=3)bias='BUY';
  else if(!htfConflict&&directional<=-3)bias='SELL';

  let contextScore=evidence?Math.round(50+Math.min(38,Math.abs(directional)*4+Math.min(12,evidence))):0;
  if(htfConflict)contextScore=Math.min(contextScore||58,62);
  if(bias==='BALANCED')contextScore=Math.min(contextScore||50,64);

  let target=draw;
  if(!target&&bias!=='BALANCED'&&price!=null){
    const level=bias==='BUY'
      ? finite(levels.pdh??levels.weeklyHigh??levels.externalHigh)
      : finite(levels.pdl??levels.weeklyLow??levels.externalLow);
    if(level!=null)target={label:bias==='BUY'?'PDH / external buy-side':'PDL / external sell-side',price:level};
  }

  const pdLocation=String(m6.pdLocation||ict.rangeContext?.location||ict.location||'UNKNOWN').toUpperCase();
  const primaryPlan=bias==='BUY'
    ? 'ميل الغد BUY، لكن لا دخول مسبق: ننتظر سحب sell-side external liquidity ثم M5 MSS/displacement ثم retest/hold.'
    : bias==='SELL'
      ? 'ميل الغد SELL، لكن لا دخول مسبق: ننتظر سحب buy-side external liquidity ثم M5 MSS/displacement ثم retest/hold.'
      : 'الغد BALANCED/CONDITIONAL: لا اتجاه مسبق. أول sweep حقيقي للسيولة الخارجية هو الذي يحدد السيناريو، ثم M5 MSS + retest/hold.';

  return{
    sessionDate:nextTradingDate(now),
    mode:'ADVISORY_ONLY',
    bias,
    contextScore:clamp(contextScore,0,90),
    scoreMeaning:'CONTEXT_ALIGNMENT_NOT_WIN_PROBABILITY',
    htfConflict,
    price,
    pdLocation,
    liquidityTarget:target,
    referenceLevels:{
      pdh:finite(levels.pdh),
      pdl:finite(levels.pdl),
      asiaHigh:finite(levels.asiaHigh),
      asiaLow:finite(levels.asiaLow)
    },
    bullishTrigger:'External sell-side sweep/reclaim → M5 MSS/displacement → retest/hold',
    bearishTrigger:'External buy-side sweep/reclaim → M5 MSS/displacement → retest/hold',
    noEntryWithoutM5:true,
    primaryPlan,
    note:'قراءة الغد تخطيطية فقط ولا تفتح صفقة ولا تغيّر بوابة ICT الحالية أو قرار Telegram.'
  };
}
