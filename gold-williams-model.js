const round=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function barsFromSamples(samples=[],minutes=1){
  const span=minutes*60000,buckets=new Map();
  for(const sample of samples){
    const t=Number(sample?.t),p=Number(sample?.p??sample?.price??sample?.close);
    if(!Number.isFinite(t)||!Number.isFinite(p)||p<=0)continue;
    const key=Math.floor(t/span)*span;
    const o=Number(sample?.open),h=Number(sample?.high),l=Number(sample?.low),c=Number(sample?.close);
    const hasOhlc=[o,h,l,c].every(Number.isFinite);
    const open=hasOhlc?o:p,high=hasOhlc?h:p,low=hasOhlc?l:p,close=hasOhlc?c:p;
    const b=buckets.get(key);
    if(!b)buckets.set(key,{t:key,open,high,low,close});
    else{b.high=Math.max(b.high,high);b.low=Math.min(b.low,low);b.close=close;}
  }
  return [...buckets.values()].sort((a,b)=>a.t-b.t);
}
export const bars1m=s=>barsFromSamples(s,1);
export const bars5m=s=>barsFromSamples(s,5);
export const bars15m=s=>barsFromSamples(s,15);

function closedBars(bars,minutes,now){
  const span=minutes*60000;
  return bars.filter(b=>b.t+span<=now);
}
function avg(values=[]){
  const xs=values.filter(Number.isFinite);
  return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
}
function trueRange(bar,prevClose){
  if(!bar)return 0;
  if(!Number.isFinite(prevClose))return Math.max(0,bar.high-bar.low);
  return Math.max(bar.high-bar.low,Math.abs(bar.high-prevClose),Math.abs(bar.low-prevClose));
}
function atr(bars=[],period=14){
  if(!bars.length)return 0;
  const xs=bars.slice(-(period+1));
  const tr=[];
  for(let i=0;i<xs.length;i++)tr.push(trueRange(xs[i],i?xs[i-1].close:NaN));
  return avg(tr.slice(-period));
}
function ema(values=[],period=10){
  if(!values.length)return null;
  const k=2/(period+1);let out=values[0];
  for(let i=1;i<values.length;i++)out=values[i]*k+out*(1-k);
  return out;
}
function slope(values=[]){
  if(values.length<2)return 0;
  return (values.at(-1)-values[0])/Math.max(1,values.length-1);
}
function williamsR(bars=[],period=14){
  const xs=bars.slice(-period);
  if(xs.length<3)return -50;
  const hh=Math.max(...xs.map(b=>b.high)),ll=Math.min(...xs.map(b=>b.low)),c=xs.at(-1).close;
  if(!(hh>ll))return -50;
  return -100*(hh-c)/(hh-ll);
}
function shortTermStructure(bars=[]){
  const x=bars.slice(-8);let score=0;
  for(let i=1;i<x.length;i++){
    if(x[i].high>x[i-1].high&&x[i].low>=x[i-1].low)score++;
    if(x[i].low<x[i-1].low&&x[i].high<=x[i-1].high)score--;
  }
  return score;
}
function normalizeClock(samples=[],now=Date.now()){
  const valid=samples.filter(x=>Number.isFinite(Number(x?.t))&&Number.isFinite(Number(x?.p??x?.price??x?.close)));
  if(!valid.length)return samples;
  const latest=Math.max(...valid.map(x=>Number(x.t))),skew=latest-now;
  if(Math.abs(skew)<=60000)return samples;
  return samples.map(x=>Number.isFinite(Number(x?.t))?{...x,t:Number(x.t)-skew}:x);
}
function swingLevels(bars=[],side,price){
  const xs=bars.slice(-32),levels=[];
  for(let i=2;i<xs.length-2;i++){
    const b=xs[i];
    if(side==='BUY'&&b.high>=xs[i-1].high&&b.high>=xs[i-2].high&&b.high>xs[i+1].high&&b.high>=xs[i+2].high&&b.high>price)levels.push(b.high);
    if(side==='SELL'&&b.low<=xs[i-1].low&&b.low<=xs[i-2].low&&b.low<xs[i+1].low&&b.low<=xs[i+2].low&&b.low<price)levels.push(b.low);
  }
  return [...new Set(levels.map(v=>round(v,2)))].sort((a,b)=>side==='BUY'?a-b:b-a);
}
function snapTarget(raw,levels,side,atr5){
  if(!levels.length)return raw;
  const tolerance=Math.max(.35,atr5*.45);
  const nearby=levels.filter(v=>Math.abs(v-raw)<=tolerance);
  if(!nearby.length)return raw;
  return nearby.sort((a,b)=>Math.abs(a-raw)-Math.abs(b-raw))[0];
}
function orderedTargets(side,entry,rawTargets,levels,atr5){
  const out=[];let prev=entry;
  for(const raw of rawTargets){
    let t=snapTarget(raw,levels,side,atr5);
    const minStep=Math.max(.35,atr5*.18);
    if(side==='BUY'&&t<=prev+minStep)t=raw>prev+minStep?raw:prev+minStep;
    if(side==='SELL'&&t>=prev-minStep)t=raw<prev-minStep?raw:prev-minStep;
    t=round(t,3);out.push(t);prev=t;
  }
  return out;
}
function trend15m(bars=[],price){
  const xs=bars.slice(-20),closes=xs.map(b=>b.close);
  if(xs.length<6)return{side:null,strength:0,emaFast:null,emaSlow:null,structure:0};
  const fast=ema(closes,5),slow=ema(closes,10),sl=slope(closes.slice(-6)),structure=shortTermStructure(xs);
  const atr15=Math.max(.01,atr(xs,10));
  const up=fast>slow&&sl>0&&structure>=0&&price>=fast-atr15*.20;
  const down=fast<slow&&sl<0&&structure<=0&&price<=fast+atr15*.20;
  let side=null;if(up&&!down)side='BUY';else if(down&&!up)side='SELL';
  const separation=Math.abs((fast??price)-(slow??price))/atr15;
  const strength=side?clamp(Math.round(8+separation*10+Math.abs(structure)*1.5),8,22):0;
  return{side,strength,emaFast:round(fast,3),emaSlow:round(slow,3),slope:round(sl,4),structure,atr15:round(atr15,3)};
}
function explosion5m(bars=[],side){
  const xs=bars.slice(-12);
  if(xs.length<6)return{ready:false,ratio:0,breakLevel:null,bar:null};
  const current=xs.at(-1),prior=xs.slice(-7,-1);
  const currentTR=trueRange(current,xs.at(-2)?.close);
  const priorTR=prior.map((b,i)=>trueRange(b,i?prior[i-1].close:xs.at(-8)?.close));
  const baseline=Math.max(.01,avg(priorTR));
  const ratio=currentTR/baseline;
  const priorHigh=Math.max(...prior.map(b=>b.high)),priorLow=Math.min(...prior.map(b=>b.low));
  const body=Math.abs(current.close-current.open),range=Math.max(.01,current.high-current.low),bodyShare=body/range;
  const directional=side==='BUY'?current.close>current.open:current.close<current.open;
  const breakout=side==='BUY'?current.close>priorHigh:current.close<priorLow;
  const ready=ratio>=1.15&&bodyShare>=.48&&directional&&breakout;
  return{ready,ratio:round(ratio,2),breakLevel:round(side==='BUY'?priorHigh:priorLow,3),bodyShare:round(bodyShare,2),bar:current};
}
function timing1m(bars=[],side){
  const xs=bars.slice(-8);
  if(xs.length<4)return{ready:false,wpr:-50,structure:0,impulse:0};
  const wpr=williamsR(xs,7),structure=shortTermStructure(xs),closes=xs.map(b=>b.close);
  const impulse=slope(closes.slice(-4));
  const ready=side==='BUY'?(wpr>-72&&structure>=0&&impulse>=0):(wpr<-28&&structure<=0&&impulse<=0);
  return{ready,wpr:round(wpr,1),structure,impulse:round(impulse,4)};
}

export function analyzeGoldSignal(samples,rawPrice,now=Date.now()){
  const price=Number(rawPrice),aligned=normalizeClock(samples,now);
  const all1=bars1m(aligned),all5=bars5m(aligned),all15=bars15m(aligned);
  const c1=closedBars(all1,1,now),c5=closedBars(all5,5,now),c15=closedBars(all15,15,now);
  const ready=c1.length>=8&&c5.length>=8&&c15.length>=6;
  const base={
    status:ready?'WAIT':'COLLECTING',action:'WAIT',candidateAction:'WAIT',side:null,
    strategy:'WILLIAMS_FRAMEWORK',confidence:0,readingCompleteness:ready?100:Math.round(Math.min(1,c1.length/8,c5.length/8,c15.length/6)*100),
    barCount:c1.length,barCount5m:c5.length,barCount15m:c15.length,sampleCount:aligned.length,
    modelTimeframes:{trend:'15m',explosion:'5m',timing:'1m + Williams %R'},price:round(price,3),
    entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,
    targetLabels:[],riskReward:null,contextBias:'NEUTRAL',williams:null,
    reason:ready?'Williams framework ready — scanning trend + volatility expansion':'جمع بيانات كافية لـ 15m / 5m / 1m',
    updatedAt:new Date(now).toISOString()
  };
  if(!Number.isFinite(price)||price<=0||!ready)return base;

  const trend=trend15m(c15,price);
  if(!trend.side)return{...base,confidence:52,contextBias:'NEUTRAL',williams:{trend},reason:'NO TREND — لا صفقة حتى يظهر اتجاه 15m واضح'};

  const side=trend.side,exp=explosion5m(c5,side),timing=timing1m(c1,side),atr5=Math.max(.20,atr(c5,14));
  const wpr5=williamsR(c5,14),struct5=shortTermStructure(c5);
  let confidence=58+trend.strength;
  if(exp.ratio>=1.15)confidence+=6;
  if(exp.ready)confidence+=9;
  if(timing.ready)confidence+=5;
  if(side==='BUY'&&wpr5>-80&&wpr5<-5)confidence+=3;
  if(side==='SELL'&&wpr5<-20&&wpr5>-95)confidence+=3;
  if(side==='BUY'&&struct5>=2)confidence+=3;
  if(side==='SELL'&&struct5<=-2)confidence+=3;
  confidence=clamp(Math.round(confidence),0,94);

  const williams={trend,volatilityExpansion:exp,timing,williamsR5:round(wpr5,1),atr5:round(atr5,3),structure5m:struct5};
  if(!exp.ready)return{...base,confidence,contextBias:side,williams,momentum:williams,reason:'WAIT EXPLOSION — الاتجاه موجود لكن لا يوجد volatility breakout مؤكد على 5m'};

  const breakLevel=Number(exp.breakLevel),chase=Math.abs(price-breakLevel),maxChase=Math.max(.75,atr5*.65);
  if(chase>maxChase)return{...base,confidence,contextBias:side,williams,momentum:williams,reason:'NO CHASE — الانفجار حدث لكن السعر ابتعد عن نقطة الكسر؛ ننتظر إعادة اختبار أو إعدادًا جديدًا'};

  const recent5=c5.slice(-7),recent1=c1.slice(-10);
  const rawSwing=side==='BUY'?Math.min(...recent5.map(b=>b.low)):Math.max(...recent5.map(b=>b.high));
  const buffer=clamp(atr5*.18,.25,.85);
  let stop=side==='BUY'?rawSwing-buffer:rawSwing+buffer;
  const minRisk=Math.max(.55,atr5*.35),maxRisk=Math.max(2.5,atr5*2.20);
  let risk=Math.abs(price-stop);
  if(risk<minRisk)stop=side==='BUY'?price-minRisk:price+minRisk;
  risk=Math.abs(price-stop);
  if(risk>maxRisk)return{...base,confidence,contextBias:side,williams,momentum:williams,reason:'STOP TOO WIDE — بنية السوق تجعل المخاطرة أكبر من المقبول لهذا الإعداد'};

  const direction=side==='BUY'?1:-1;
  const levels=swingLevels(c15.concat(c5),side,price);
  const rawTargets=[
    price+direction*Math.max(risk*1.20,atr5*.95),
    price+direction*Math.max(risk*2.00,atr5*1.65),
    price+direction*Math.max(risk*3.00,atr5*2.45),
    price+direction*Math.max(risk*4.00,atr5*3.30)
  ];
  const [t1,t2,t3,t4]=orderedTargets(side,price,rawTargets,levels,atr5);
  const rr4=Math.abs(t4-price)/risk;
  const half=clamp(atr5*.16,.25,.85);
  const setupId=['WILLIAMS',side,c5.at(-1)?.t,round(breakLevel,2),round(stop,2)].join('|');

  return{
    ...base,status:'CANDIDATE',candidateAction:side,side,strategy:'WILLIAMS_VOLATILITY_BREAKOUT',
    confidence,contextBias:side,oneMinuteConfirmed:timing.ready,setupId,structureAt:c5.at(-1)?.t??now,
    williams,momentum:williams,prediction:{side,confidence,scoreGap:side==='BUY'?confidence-50:50-confidence,williamsR5:round(wpr5,1)},
    entry:round(breakLevel,3),entryLow:round(breakLevel-half,3),entryHigh:round(breakLevel+half,3),stopLoss:round(stop,3),
    target1:t1,target2:t2,target3:t3,target4:t4,riskReward:round(rr4,2),
    targetLabels:['Williams 1.2R / structure','Williams 2R / structure','Williams 3R / structure','Williams 4R / expansion'],
    reason:'LARRY WILLIAMS FRAMEWORK — 15m trend + 5m volatility explosion/breakout'+(timing.ready?' + 1m/%R timing':'')
  };
}
