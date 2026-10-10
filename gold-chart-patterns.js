// Classical chart patterns from "All Chart Patterns" (pages 3–24).
// M15 context only. Neither this module nor its scores authorize a trade.
const num=x=>x!=null&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const round=(x,d=3)=>x==null||!Number.isFinite(Number(x))?null:Number(Number(x).toFixed(d));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

function clean(raw=[]){
  return (Array.isArray(raw)?raw:[]).map(b=>({t:num(b?.t),open:num(b?.open),high:num(b?.high),low:num(b?.low),close:num(b?.close)}))
    .filter(b=>b.t!=null&&[b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close)&&b.high>b.low)
    .sort((a,b)=>a.t-b.t).filter((b,i,a)=>!i||b.t!==a[i-1].t).slice(-120);
}
function volatility(rows){
  const r=rows.slice(-16);if(r.length<2)return null;
  const tr=r.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-r[i].close),Math.abs(b.low-r[i].close)));
  return tr.reduce((a,b)=>a+b,0)/tr.length;
}
function swings(rows,wing=2){
  const high=[],low=[];
  for(let i=wing;i<rows.length-wing;i++){
    let h=true,l=true;
    for(let j=1;j<=wing;j++){
      if(!(rows[i].high>rows[i-j].high&&rows[i].high>=rows[i+j].high))h=false;
      if(!(rows[i].low<rows[i-j].low&&rows[i].low<=rows[i+j].low))l=false;
    }
    if(h)high.push({i,price:rows[i].high,t:rows[i].t});
    if(l)low.push({i,price:rows[i].low,t:rows[i].t});
  }
  return {high,low};
}
function line(points){
  if(points.length<2)return null;
  const x=points.map(p=>p.i),y=points.map(p=>p.price),mx=x.reduce((a,b)=>a+b,0)/x.length,my=y.reduce((a,b)=>a+b,0)/y.length;
  const den=x.reduce((a,b)=>a+(b-mx)**2,0);
  if(den===0)return null;
  const slope=x.reduce((a,v,i)=>a+(v-mx)*(y[i]-my),0)/den;
  return {slope,at:i=>my+slope*(i-mx)};
}
function confirmation(rows,side,level,margin,near=3){
  if(!Number.isFinite(level))return false;
  const last=rows.at(-1),cut=side==='BUY'?level+margin:level-margin;
  const beyond=side==='BUY'?last.close>cut:last.close<cut;
  if(!beyond)return false;
  return rows.slice(-near-1,-1).some(b=>side==='BUY'?b.close<=cut:b.close>=cut);
}
function classification(rows,side,level,margin){
  return confirmation(rows,side,level,margin)?'BREAKOUT_CONFIRMED':'FORMING';
}
function build(name,side,category,rows,level,margin,quality,detail={}){
  const stage=classification(rows,side,level,margin);
  return {name,side,category,stage,confirmed:stage==='BREAKOUT_CONFIRMED',triggerLevel:round(level),qualityScore:clamp(Math.round(quality+(stage==='BREAKOUT_CONFIRMED'?8:0)),0,94),...detail};
}

function reversalCandidates(rows,atr,margin,out){
  const {high:H,low:L}=swings(rows),tol=Math.max(atr*.30,.08),last=rows.length-1;
  for(const side of ['SELL','BUY']){
    const tops=side==='SELL',peaks=(tops?H:L).slice(-3),opposites=tops?L:H;
    const labels=tops?['DOUBLE_TOP','TRIPLE_TOP']:['DOUBLE_BOTTOM','TRIPLE_BOTTOM'];
    for(const count of [3,2]){
      const pts=peaks.slice(-count);
      if(pts.length!==count||pts.at(-1).i<last-24||pts.at(-1).i-pts[0].i>65||pts.some((p,i)=>i&&p.i-pts[i-1].i<3))continue;
      if(Math.max(...pts.map(p=>p.price))-Math.min(...pts.map(p=>p.price))>tol)continue;
      const mids=opposites.filter(p=>p.i>pts[0].i&&p.i<pts.at(-1).i);
      if(mids.length<count-1)continue;
      const neckline=tops?Math.min(...mids.map(p=>p.price)):Math.max(...mids.map(p=>p.price));
      if(tops?pts[0].price-neckline<atr*.55:neckline-pts[0].price<atr*.55)continue;
      out.push(build(labels[count===3?1:0],side,'REVERSAL',rows,neckline,margin,count===3?73:67,{formationTime:pts.at(-1).t,neckline:round(neckline)}));
    }
  }
  for(const side of ['SELL','BUY']){
    const tops=side==='SELL',p=(tops?H:L).slice(-3),op=tops?L:H;
    if(p.length!==3||p.at(-1).i<last-24||p[2].i-p[0].i>65)continue;
    const shoulders=Math.abs(p[0].price-p[2].price)<=atr*.65;
    const head=tops?p[1].price>Math.max(p[0].price,p[2].price)+atr*.35:p[1].price<Math.min(p[0].price,p[2].price)-atr*.35;
    const between=op.filter(z=>z.i>p[0].i&&z.i<p[2].i);
    if(shoulders&&head&&between.length>=2){
      const neckline=between.slice(-2).reduce((s,z)=>s+z.price,0)/2;
      out.push(build(tops?'HEAD_AND_SHOULDERS':'INVERSE_HEAD_AND_SHOULDERS',side,'REVERSAL',rows,neckline,margin,77,{neckline:round(neckline),formationTime:p[2].t}));
    }
  }
}

function boundaryCandidates(rows,atr,margin,out){
  const part=rows.slice(-48),offset=rows.length-part.length,{high:H,low:L}=swings(part,1);
  if(H.length<2||L.length<2)return;
  const h=line(H.slice(-4)),l=line(L.slice(-4));
  if(!h||!l)return;
  const idx=part.length-1,earlier=Math.max(0,idx-12),upper=h.at(idx),lower=l.at(idx);
  const width=upper-lower,priorWidth=h.at(earlier)-l.at(earlier);
  if(width<=atr*.20||priorWidth<=atr*.25)return;
  const ratio=width/priorWidth,flat=atr*.035,positive=atr*.05,negative=-positive,trend=rows.slice(-45,-15);
  const drift=trend.length>8?trend.at(-1).close-trend[0].close:0;
  let name=null,side=null,category='NEUTRAL',level=null,quality=62;
  if(ratio>=1.16&&h.slope>positive&&l.slope<negative){name='SYMMETRICAL_EXPANDING_TRIANGLE';side='NEUTRAL';level=null;}
  else if(ratio<=.89&&h.slope<-positive&&l.slope>positive){name='SYMMETRICAL_TRIANGLE';side='NEUTRAL';}
  else if(ratio<=.92&&Math.abs(h.slope)<flat&&l.slope>positive){name='ASCENDING_TRIANGLE';side='NEUTRAL';}
  else if(ratio<=.92&&h.slope<negative&&Math.abs(l.slope)<flat){name='DESCENDING_TRIANGLE';side='NEUTRAL';}
  else if(ratio<=.89&&h.slope<negative&&l.slope<negative&&h.slope<l.slope-atr*.015){name='FALLING_WEDGE';side='BUY';category='REVERSAL';level=upper;quality=72;}
  else if(ratio<=.89&&h.slope>positive&&l.slope>positive&&l.slope>h.slope+atr*.015){name='RISING_WEDGE';side='SELL';category='REVERSAL';level=lower;quality=72;}
  if(!name)return;
  if(category==='REVERSAL'&&((side==='BUY'&&drift>atr*4)||(side==='SELL'&&drift< -atr*4)))return;
  if(side==='NEUTRAL'){
    const bull=confirmation(part,'BUY',upper,margin),bear=confirmation(part,'SELL',lower,margin);
    const breakoutSide=bull?'BUY':bear?'SELL':'NEUTRAL';
    const stage=bull||bear?'BREAKOUT_CONFIRMED':'FORMING';
    out.push({name,side:breakoutSide,category,stage,confirmed:stage==='BREAKOUT_CONFIRMED',triggerLevel:round(bull?upper:bear?lower:null),
      upperBoundary:round(upper),lowerBoundary:round(lower),qualityScore:clamp(quality+(stage==='BREAKOUT_CONFIRMED'?8:0),0,92)});
  }else{
    out.push(build(name,side,category,part,level,margin,quality,{upperBoundary:round(upper),lowerBoundary:round(lower)}));
  }
}

function continuationCandidates(rows,atr,margin,out){
  // The last closed M15 candle is only checked for a breakout; setup geometry uses older closed bars.
  if(rows.length<35)return;
  const last=rows.at(-1),con=rows.slice(-13,-1),pole=rows.slice(-23,-13);
  if(con.length<12||pole.length<8)return;
  const impulse=pole.at(-1).close-pole[0].open,poleStrong=Math.abs(impulse)>=atr*2.3;
  const top=Math.max(...con.map(b=>b.high)),bottom=Math.min(...con.map(b=>b.low));
  const width=top-bottom,cRange=Math.max(.01,width),centers=con.map(b=>(b.high+b.low)/2);
  const centerSlope=line(centers.map((v,i)=>({i,price:v})))?.slope??0;
  const h=line(con.map((b,i)=>({i,price:b.high}))),l=line(con.map((b,i)=>({i,price:b.low})));
  const opening=(h?.at(0)??0)-(l?.at(0)??0),ending=(h?.at(con.length-1)??0)-(l?.at(con.length-1)??0);
  const condense=opening>0&&ending>0&&ending/opening<.72;
  const bull=impulse>0,side=bull?'BUY':'SELL';
  if(poleStrong&&width<=atr*4.5){
    const breakLevel=bull?top:bottom;
    const tight=width<=atr*3.2;
    if(tight&&Math.abs(centerSlope)<=atr*.10){
      const touchesTop=con.filter(b=>top-b.high<=atr*.24).length,touchesBottom=con.filter(b=>b.low-bottom<=atr*.24).length;
      if(touchesTop>=2&&touchesBottom>=2)out.push(build(bull?'BULLISH_RECTANGLE':'BEARISH_RECTANGLE',side,'CONTINUATION',rows,breakLevel,margin,64,{rangeHigh:round(top),rangeLow:round(bottom)}));
    }
    if(condense&&h&&l&&h.slope< -atr*.015&&l.slope>atr*.015)out.push(build(bull?'BULLISH_PENNANT':'BEARISH_PENNANT',side,'CONTINUATION',rows,breakLevel,margin,68,{rangeHigh:round(top),rangeLow:round(bottom)}));
    if(Math.abs(centerSlope)>atr*.02&&Math.abs(centerSlope)<atr*.40&&Math.sign(centerSlope)!==Math.sign(impulse)&&width<=atr*3.6&&!condense){
      out.push(build(bull?'BULLISH_FLAG':'BEARISH_FLAG',side,'CONTINUATION',rows,breakLevel,margin,66,{rangeHigh:round(top),rangeLow:round(bottom)}));
    }
  }
  // A rounded 15m cup and a 6-bar handle, not a single-candle U.
  if(rows.length>=54){
    const cup=rows.slice(-52,-7),handle=rows.slice(-7,-1);
    const left=cup.slice(0,11),middle=cup.slice(15,30),right=cup.slice(-11);
    const leftHigh=Math.max(...left.map(b=>b.high)),rightHigh=Math.max(...right.map(b=>b.high));
    const leftLow=Math.min(...left.map(b=>b.low)),rightLow=Math.min(...right.map(b=>b.low));
    const midLow=Math.min(...middle.map(b=>b.low)),midHigh=Math.max(...middle.map(b=>b.high));
    const rimTol=atr*1.6,depth=Math.min(leftHigh,rightHigh)-midLow;
    const uShape=Math.abs(leftHigh-rightHigh)<=rimTol&&midLow<leftLow-atr*.8&&midLow<rightLow-atr*.8&&depth>atr*3;
    const invDepth=midHigh-Math.max(Math.min(...left.map(b=>b.low)),Math.min(...right.map(b=>b.low)));
    const inverseRim=Math.abs(Math.min(...left.map(b=>b.low))-Math.min(...right.map(b=>b.low)))<=rimTol&&midHigh>Math.max(leftHigh,rightHigh)+atr*.8&&invDepth>atr*3;
    const handleHi=Math.max(...handle.map(b=>b.high)),handleLo=Math.min(...handle.map(b=>b.low));
    if(uShape&&handleLo>=midLow+depth*.45&&handleHi<Math.max(leftHigh,rightHigh)+atr*.7){
      out.push(build('BULLISH_CUP_AND_HANDLE','BUY','CONTINUATION',rows,Math.max(leftHigh,rightHigh,handleHi),margin,58,{rim:round(Math.max(leftHigh,rightHigh))}));
    }
    if(inverseRim&&handleHi<=midHigh-invDepth*.45&&handleLo>Math.min(...left.map(b=>b.low),...right.map(b=>b.low))-atr*.7){
      out.push(build('INVERTED_CUP_AND_HANDLE','SELL','CONTINUATION',rows,Math.min(...left.map(b=>b.low),...right.map(b=>b.low),handleLo),margin,58,{rim:round(Math.min(...left.map(b=>b.low),...right.map(b=>b.low)))}));
    }
  }
}

export function analyzeGoldChartPatterns({m15=[],m5=[]}={}){
  const rows=clean(m15),quick=clean(m5),base={
    version:'XAU_M15_CHART_PATTERNS_V1',timeframe:'M15',m15ClosedBars:rows.length,m5ClosedBars:quick.length,
    status:'WAIT',primary:null,patterns:[],mode:'ADVISORY_ONLY',advisoryOnly:true,canOpenTrade:false,canBlockTrade:false,
    canChangeStopOrTargets:false,qualityScoreNotProbability:true,executionTimeframe:'M5_MSS_RETEST_HOLD',
    m1Role:'OPTIONAL_ENTRY_TIMING_ONLY',liquidityPolicy:'EXTERNAL_SWEEP_ONLY',guide:'All Chart Patterns.pdf, pages 3–24'
  };
  if(rows.length<35)return {...base,status:'INSUFFICIENT_M15_DATA'};
  const atr=volatility(rows);
  if(atr==null)return {...base,status:'INSUFFICIENT_M15_DATA'};
  const margin=Math.max(.04,atr*.09),out=[];
  reversalCandidates(rows,atr,margin,out);
  boundaryCandidates(rows,atr,margin,out);
  continuationCandidates(rows,atr,margin,out);
  const priority={REVERSAL:3,CONTINUATION:2,NEUTRAL:1};
  const selected=out.sort((a,b)=>Number(b.confirmed)-Number(a.confirmed)||b.qualityScore-a.qualityScore||(priority[b.category]||0)-(priority[a.category]||0)).slice(0,4);
  return {...base,status:selected.length?'PATTERNS_FOUND':'NO_PATTERN',primary:selected[0]||null,patterns:selected,atrM15:round(atr),lastClosedM15At:rows.at(-1)?.t||null};
}
