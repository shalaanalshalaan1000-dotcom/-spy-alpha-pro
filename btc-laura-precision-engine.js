const CACHE_MS=Math.max(5000,Math.min(30000,Number(process.env.BTC_CACHE_MS||12000)||12000));
const MIN_CONFIDENCE=Math.max(60,Math.min(95,Number(process.env.BTC_LAURA_MIN_CONFIDENCE||70)||70));
const CONTRACT_SIZE=Math.max(.000001,Number(process.env.EXNESS_BTC_CONTRACT_SIZE||1));
const LOT_STEP=Math.max(.001,Number(process.env.EXNESS_BTC_LOT_STEP||.01));
const SAFE_RISK_USD=Math.max(1,Number(process.env.BTC_SAFE_RISK_USD||5));
const MAX_RISK_USD=Math.max(SAFE_RISK_USD,Number(process.env.BTC_MAX_RISK_USD||10));
const SL_BUFFER=Math.max(5,Number(process.env.BTC_LAURA_SL_BUFFER_USD||20));
const POI_MAX_DISTANCE_PCT=Math.max(.002,Math.min(.03,Number(process.env.BTC_POI_MAX_DISTANCE_PCT||.01)||.01));
const DISPLACEMENT_MULT=Math.max(1,Math.min(3,Number(process.env.BTC_DISPLACEMENT_MULT||1.15)||1.15));
const M5_LOOKBACK=Math.max(12,Math.min(60,Number(process.env.BTC_M5_SEQUENCE_LOOKBACK||30)||30));

const cache={expiresAt:0,value:null};
const lifecycle={signal:null,lastTerminal:null,cooldownUntil:0,seen:new Set()};

const num=v=>v==null||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
const round=(v,d=2)=>{const n=num(v);return n==null?null:Number(n.toFixed(d));};
const avg=xs=>{const a=xs.map(Number).filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

async function coinbaseCandles(product,granularity){
  const url=new URL('https://api.exchange.coinbase.com/products/'+product+'/candles');
  url.searchParams.set('granularity',String(granularity));
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-LAURA-PRECISION/2.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok||!Array.isArray(rows))throw new Error(product+' candles unavailable '+r.status);
  const now=Date.now(),span=granularity*1000;
  return rows.map(x=>({t:Number(x[0])*1000,low:Number(x[1]),high:Number(x[2]),open:Number(x[3]),close:Number(x[4]),volume:Number(x[5]||0)}))
    .filter(x=>[x.t,x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.close>0&&x.t+span<=now+1000)
    .sort((a,b)=>a.t-b.t);
}
async function coinbaseTicker(){
  const r=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker',{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-LAURA-PRECISION/2.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error('Coinbase ticker unavailable '+r.status);
  return d;
}

function aggregate(rows,mode){
  const out=new Map();
  for(const b of rows){
    const d=new Date(b.t);
    let key;
    if(mode==='H4')key=Math.floor(b.t/(4*3600000))*(4*3600000);
    else if(mode==='W1'){
      const day=(d.getUTCDay()+6)%7;
      key=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day);
    }else if(mode==='MN1')key=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
    else throw new Error('unknown aggregate mode');
    const old=out.get(key);
    if(!old)out.set(key,{t:key,open:b.open,high:b.high,low:b.low,close:b.close,volume:num(b.volume)||0});
    else{old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.close=b.close;old.volume+=(num(b.volume)||0);}
  }
  return [...out.values()].sort((a,b)=>a.t-b.t);
}

function pivots(rows,left=2,right=2){
  const highs=[],lows=[];
  for(let i=left;i<rows.length-right;i++){
    const b=rows[i],before=rows.slice(i-left,i),after=rows.slice(i+1,i+1+right);
    if(before.every(x=>b.high>x.high)&&after.every(x=>b.high>=x.high))highs.push({t:b.t,price:b.high,index:i});
    if(before.every(x=>b.low<x.low)&&after.every(x=>b.low<=x.low))lows.push({t:b.t,price:b.low,index:i});
  }
  return{highs,lows};
}
function structureSide(rows){
  if(rows.length<6)return'NEUTRAL';
  const p=pivots(rows.slice(-80),2,2),hs=p.highs.slice(-2),ls=p.lows.slice(-2);
  if(hs.length>=2&&ls.length>=2){
    if(hs[1].price>hs[0].price&&ls[1].price>ls[0].price)return'BUY';
    if(hs[1].price<hs[0].price&&ls[1].price<ls[0].price)return'SELL';
  }
  const x=rows.slice(-8),last=x.at(-1),prior=x.slice(0,-1);
  if(!last||prior.length<3)return'NEUTRAL';
  const hi=Math.max(...prior.map(b=>b.high)),lo=Math.min(...prior.map(b=>b.low));
  if(last.close>hi)return'BUY';
  if(last.close<lo)return'SELL';
  const mom=last.close-x[0].close;
  return mom>0?'BUY':mom<0?'SELL':'NEUTRAL';
}
function barShape(bar={}){
  const open=num(bar.open),high=num(bar.high),low=num(bar.low),close=num(bar.close);
  if([open,high,low,close].some(v=>v==null))return null;
  const range=Math.max(.01,high-low),body=Math.abs(close-open),upper=high-Math.max(open,close),lower=Math.min(open,close)-low,pos=(close-low)/range;
  let pattern=close>open?'BULLISH_CLOSE':close<open?'BEARISH_CLOSE':'DOJI';
  if(lower>=Math.max(body*1.5,range*.30)&&pos>=.60)pattern='LOWER_REJECTION';
  if(upper>=Math.max(body*1.5,range*.30)&&pos<=.40)pattern='UPPER_REJECTION';
  return{open:round(open),high:round(high),low:round(low),close:round(close),range:round(range),body:round(body),pattern,t:num(bar.t)};
}
function tfRead(rows){
  return{side:structureSide(rows),bars:rows.length,lastClosed:round(rows.at(-1)?.close),pattern:barShape(rows.at(-1)||{})?.pattern||'—'};
}
function addLevel(out,label,value,timeframe,kind,price){
  const level=num(value);if(level==null)return;
  const tol=Math.max(10,Math.abs(level)*.00015);
  if(out.some(x=>Math.abs(x.level-level)<=tol))return;
  out.push({label,level:round(level),timeframe,kind,distance:price==null?null:round(Math.abs(level-price))});
}
function levelsOf(frames,price){
  const out=[];
  const addPivots=(name,rows)=>{
    const p=pivots(rows.slice(-120),2,2);
    addLevel(out,name+'_SWING_HIGH',p.highs.at(-1)?.price,name,'RESISTANCE',price);
    addLevel(out,name+'_SWING_LOW',p.lows.at(-1)?.price,name,'SUPPORT',price);
  };
  const prevM=frames.MN1.at(-2),prevW=frames.W1.at(-2),prevD=frames.D1.at(-2);
  addLevel(out,'PMH',prevM?.high,'MN1','RESISTANCE',price);addLevel(out,'PML',prevM?.low,'MN1','SUPPORT',price);
  addLevel(out,'PWH',prevW?.high,'W1','RESISTANCE',price);addLevel(out,'PWL',prevW?.low,'W1','SUPPORT',price);
  addLevel(out,'PDH',prevD?.high,'D1','RESISTANCE',price);addLevel(out,'PDL',prevD?.low,'D1','SUPPORT',price);
  addPivots('H4',frames.H4);addPivots('H1',frames.H1);addPivots('M15',frames.M15);addPivots('M5',frames.M5);
  return out;
}
function topDown(reads){
  const weights={MN1:5,W1:5,D1:4,H4:3,H1:2};
  let buy=0,sell=0;
  for(const [tf,w] of Object.entries(weights)){if(reads[tf].side==='BUY')buy+=w;else if(reads[tf].side==='SELL')sell+=w;}
  const delta=buy-sell,bias=delta>=4?'BUY':delta<=-4?'SELL':'NEUTRAL';
  const macro=['MN1','W1','D1'].filter(tf=>reads[tf].side===bias).length;
  const context=['H4','H1'].filter(tf=>reads[tf].side===bias).length;
  const strength=bias==='NEUTRAL'?'LOW':macro>=2&&context>=1?'HIGH':macro>=2||context===2?'MEDIUM':'LOW';
  const confidence=Math.max(0,Math.min(100,50+Math.abs(delta)*2+(macro>=2?8:0)+(context>=1?5:0)));
  return{bias,strength,buyWeight:buy,sellWeight:sell,macroAligned:macro,contextAligned:context,confidence};
}
function nearest(levels,price,direction,skip=null){
  return levels.filter(x=>direction==='ABOVE'?x.level>price:x.level<price)
    .filter(x=>skip==null||Math.abs(x.level-skip)>10)
    .sort((a,b)=>Math.abs(a.level-price)-Math.abs(b.level-price))[0]||null;
}
function lotForRisk(entry,stop,riskUsd){
  const distance=Math.abs(Number(entry)-Number(stop));if(!(distance>0))return 0;
  const raw=riskUsd/(distance*CONTRACT_SIZE),steps=Math.floor((raw+1e-12)/LOT_STEP);
  return steps>0?Number((steps*LOT_STEP).toFixed(3)):0;
}
function lotSizing(entry,stop){
  const distance=Math.abs(entry-stop),safe=lotForRisk(entry,stop,SAFE_RISK_USD),max=lotForRisk(entry,stop,MAX_RISK_USD);
  return{recommendedLot:safe>0?safe:(max>0?LOT_STEP:0),maxLot:max,stopDistance:round(distance),safeRiskUsd:SAFE_RISK_USD,maxRiskUsd:MAX_RISK_USD};
}

function fvgAt(rows,i){
  if(i<2||i>=rows.length)return null;
  const a=rows[i-2],c=rows[i];
  if(c.low>a.high)return{side:'BUY',type:'BISI',low:round(a.high),high:round(c.low),mid:round((a.high+c.low)/2),t:c.t,index:i};
  if(c.high<a.low)return{side:'SELL',type:'SIBI',low:round(c.high),high:round(a.low),mid:round((c.high+a.low)/2),t:c.t,index:i};
  return null;
}
function fvgs(rows){
  const out=[];
  for(let i=2;i<rows.length;i++){const z=fvgAt(rows,i);if(z)out.push(z);}
  return out;
}
function latestIfvg(rows,bias){
  const zones=fvgs(rows.slice(-100));
  let best=null;
  for(const z of zones){
    if(bias==='BUY'&&z.side!=='SELL')continue;
    if(bias==='SELL'&&z.side!=='BUY')continue;
    const later=rows.filter(b=>b.t>z.t);
    const inverted=bias==='BUY'?later.find(b=>b.close>z.high):later.find(b=>b.close<z.low);
    if(inverted)best={...z,side:bias,type:'iFVG',invertedAt:inverted.t,sourceType:z.type};
  }
  return best;
}
function zoneDistance(price,z){
  if(!z||price==null)return Infinity;
  if(price<z.low)return z.low-price;
  if(price>z.high)return price-z.high;
  return 0;
}
function protectedLevel(frames,bias){
  const h1=pivots(frames.H1.slice(-100),2,2),h4=pivots(frames.H4.slice(-100),2,2);
  const row=bias==='BUY'?(h1.lows.at(-1)||h4.lows.at(-1)):(h1.highs.at(-1)||h4.highs.at(-1));
  if(!row)return null;
  return{label:bias==='BUY'?'PROTECTED_LOW':'PROTECTED_HIGH',level:round(row.price),timeframe:h1[bias==='BUY'?'lows':'highs'].at(-1)?'H1':'H4',t:row.t};
}
function findPoi(frames,bias,price){
  const candidates=[];
  for(const tf of ['D1','H1']){
    const rows=frames[tf],raw=fvgs(rows.slice(-120)).filter(z=>z.side===bias).slice(-6);
    for(const z of raw)candidates.push({...z,timeframe:tf,label:tf+'_'+z.type});
    const inv=latestIfvg(rows,bias);if(inv)candidates.push({...inv,timeframe:tf,label:tf+'_iFVG'});
  }
  const protectedRef=protectedLevel(frames,bias);
  if(protectedRef){
    const half=Math.max(20,price*.0006);
    candidates.push({side:bias,type:'PROTECTED_LEVEL',label:protectedRef.timeframe+'_'+protectedRef.label,timeframe:protectedRef.timeframe,low:round(protectedRef.level-half),high:round(protectedRef.level+half),mid:protectedRef.level,t:protectedRef.t});
  }
  for(const c of candidates)c.distance=round(zoneDistance(price,c));
  candidates.sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity));
  const chosen=candidates[0]||null,maxDistance=Math.max(100,price*POI_MAX_DISTANCE_PCT);
  return{valid:Boolean(chosen&&(chosen.distance??Infinity)<=maxDistance),chosen,maxDistance:round(maxDistance),candidates:candidates.slice(0,8),protected:protectedRef};
}
function dailyCloseModel(D1,bias){
  const last=barShape(D1.at(-1)||{}),prev=barShape(D1.at(-2)||{});
  if(!last||!prev)return{label:'UNKNOWN',aligned:false,pattern:last?.pattern||null};
  let label='AVOID',aligned=false;
  if(bias==='BUY'){
    if(last.pattern==='LOWER_REJECTION'||(last.low<prev.low&&last.close>prev.low)){label='REVERSAL';aligned=true;}
    else if(last.close>last.open&&last.close>=prev.close){label='CONTINUATION';aligned=true;}
  }else if(bias==='SELL'){
    if(last.pattern==='UPPER_REJECTION'||(last.high>prev.high&&last.close<prev.high)){label='REVERSAL';aligned=true;}
    else if(last.close<last.open&&last.close<=prev.close){label='CONTINUATION';aligned=true;}
  }
  return{label,aligned,pattern:last.pattern,last,previous:prev};
}
function pspDivergence(btcH1,ethH1,bias){
  if(!Array.isArray(ethH1)||btcH1.length<2||ethH1.length<2)return{available:false,aligned:false,type:null};
  const b0=btcH1.at(-2),b1=btcH1.at(-1),e0=ethH1.at(-2),e1=ethH1.at(-1);
  if(!b0||!b1||!e0||!e1)return{available:false,aligned:false,type:null};
  const btcLower=b1.low<b0.low,ethLower=e1.low<e0.low,btcHigher=b1.high>b0.high,ethHigher=e1.high>e0.high;
  const bullish=btcLower!==ethLower,bearish=btcHigher!==ethHigher;
  const type=bullish&&!bearish?'BULLISH_PSP':bearish&&!bullish?'BEARISH_PSP':bullish&&bearish?'MIXED_PSP':null;
  return{available:true,aligned:(bias==='BUY'&&type==='BULLISH_PSP')||(bias==='SELL'&&type==='BEARISH_PSP'),type,
    btc:{previousLow:round(b0.low),low:round(b1.low),previousHigh:round(b0.high),high:round(b1.high)},
    eth:{previousLow:round(e0.low),low:round(e1.low),previousHigh:round(e0.high),high:round(e1.high)}};
}

function bodySize(b){return Math.abs(Number(b?.close)-Number(b?.open));}
function sweepEvents(rows,bias){
  const out=[],start=Math.max(4,rows.length-M5_LOOKBACK);
  for(let i=start;i<rows.length;i++){
    const prior=rows.slice(Math.max(0,i-6),i);if(prior.length<3)continue;
    const b=rows[i];
    if(bias==='BUY'){
      const level=Math.min(...prior.map(x=>x.low));
      if(b.low<level&&b.close>level)out.push({side:'BUY',idx:i,t:b.t,level:round(level),extreme:round(b.low),close:round(b.close)});
    }else{
      const level=Math.max(...prior.map(x=>x.high));
      if(b.high>level&&b.close<level)out.push({side:'SELL',idx:i,t:b.t,level:round(level),extreme:round(b.high),close:round(b.close)});
    }
  }
  return out;
}
function sequenceForSweep(rows,bias,sweep){
  const prior=rows.slice(Math.max(0,sweep.idx-6),sweep.idx);
  const opposite=[...prior].reverse().find(b=>bias==='BUY'?b.close<b.open:b.close>b.open)||null;
  const cisdLevel=opposite?round(opposite.open):null;
  const mssLevel=bias==='BUY'?round(Math.max(...prior.map(b=>b.high))):round(Math.min(...prior.map(b=>b.low)));
  let shiftIdx=-1,cisd=false,mss=false;
  for(let j=sweep.idx+1;j<rows.length;j++){
    const b=rows[j];
    const cisdNow=cisdLevel!=null&&(bias==='BUY'?b.close>cisdLevel:b.close<cisdLevel);
    const mssNow=bias==='BUY'?b.close>mssLevel:b.close<mssLevel;
    if(cisdNow||mssNow){shiftIdx=j;cisd=cisdNow;mss=mssNow;break;}
  }
  if(shiftIdx<0)return{complete:false,stage:'WAIT_CISD_MSS',sweep,cisdLevel,mssLevel};

  let dispIdx=-1,dispRatio=0;
  for(let j=shiftIdx;j<Math.min(rows.length,shiftIdx+4);j++){
    const b=rows[j],priorBodies=rows.slice(Math.max(0,j-8),j).map(bodySize),base=avg(priorBodies)||bodySize(b)||1;
    const directional=bias==='BUY'?b.close>b.open:b.close<b.open;
    const ratio=bodySize(b)/Math.max(.01,base);
    if(directional&&ratio>=DISPLACEMENT_MULT){dispIdx=j;dispRatio=ratio;break;}
  }
  if(dispIdx<0)return{complete:false,stage:'WAIT_DISPLACEMENT',sweep,cisd,mss,cisdLevel,mssLevel,shiftIdx};

  let gap=null;
  for(let k=Math.max(2,dispIdx);k<rows.length;k++){
    const z=fvgAt(rows,k);
    if(z&&z.side===bias){gap=z;break;}
  }
  if(!gap)return{complete:false,stage:'WAIT_FVG',sweep,cisd,mss,cisdLevel,mssLevel,shiftIdx,dispIdx,displacementRatio:round(dispRatio,2)};

  let retest=null;
  for(let k=gap.index+1;k<rows.length;k++){
    const b=rows[k],touch=b.low<=gap.high&&b.high>=gap.low;
    const hold=bias==='BUY'?b.close>=gap.mid:b.close<=gap.mid;
    if(touch&&hold){retest={idx:k,t:b.t,open:round(b.open),high:round(b.high),low:round(b.low),close:round(b.close)};break;}
  }
  if(!retest)return{complete:false,stage:'WAIT_FVG_RETRACE',sweep,cisd,mss,cisdLevel,mssLevel,shiftIdx,dispIdx,displacementRatio:round(dispRatio,2),fvg:gap};

  return{complete:true,stage:'CONFIRMED',sweep,cisd,mss,cisdLevel,mssLevel,shiftIdx,dispIdx,displacementRatio:round(dispRatio,2),fvg:gap,retest};
}
function m5Precision(rows,bias){
  const events=sweepEvents(rows,bias);
  if(!events.length)return{complete:false,stage:'WAIT_SWEEP',sweep:null};
  let partial=null;
  for(const sw of [...events].reverse()){
    const seq=sequenceForSweep(rows,bias,sw);
    if(!partial)partial=seq;
    if(seq.complete)return seq;
  }
  return partial||{complete:false,stage:'WAIT_SWEEP',sweep:null};
}
function targetPlan(levels,entry,bias,risk){
  const direction=bias==='BUY'?'ABOVE':'BELOW';
  const candidates=levels.filter(x=>direction==='ABOVE'?x.level>entry:x.level<entry)
    .sort((a,b)=>Math.abs(a.level-entry)-Math.abs(b.level-entry));
  const selected=[];
  for(const c of candidates){
    if(selected.some(x=>Math.abs(x.level-c.level)<10))continue;
    selected.push(c);if(selected.length===4)break;
  }
  const step=Math.max(risk*.9,entry*.0015);
  while(selected.length<4){
    const i=selected.length+1,last=selected.at(-1)?.level??entry;
    const level=bias==='BUY'?Math.max(last+step,entry+step*i):Math.min(last-step,entry-step*i);
    selected.push({label:'LIQUIDITY_EXTENSION_'+i,level:round(level),timeframe:'MODEL',kind:bias==='BUY'?'RESISTANCE':'SUPPORT'});
  }
  return selected;
}
function precisionReason(stage,bias,poi){
  const prefix='LAURA+PRECISION '+bias+' — ';
  if(!poi?.valid)return prefix+'waiting for valid D1/H1 POI near price.';
  if(stage==='WAIT_SWEEP')return prefix+'POI mapped; waiting for M5 liquidity sweep.';
  if(stage==='WAIT_CISD_MSS')return prefix+'M5 sweep detected; waiting for CISD/MSS.';
  if(stage==='WAIT_DISPLACEMENT')return prefix+'structure shifted; waiting for displacement.';
  if(stage==='WAIT_FVG')return prefix+'displacement confirmed; waiting for aligned BISI/SIBI FVG.';
  if(stage==='WAIT_FVG_RETRACE')return prefix+'FVG formed; waiting for M5 retrace/hold.';
  return prefix+'confirmed.';
}

function analyze({M1=[],M5=[],M15=[],H1=[],H4=[],D1=[],W1=[],MN1=[],ETHH1=[],ticker={}}){
  const price=num(ticker?.price)??num(M1.at(-1)?.close)??num(M5.at(-1)?.close);
  const frames={M1,M5,M15,H1,H4,D1,W1,MN1};
  const reads=Object.fromEntries(Object.entries(frames).map(([tf,rows])=>[tf,tfRead(rows)]));
  const outlook=topDown(reads);
  const levels=levelsOf(frames,price);
  const support=price==null?null:nearest(levels,price,'BELOW');
  const resistance=price==null?null:nearest(levels,price,'ABOVE');
  const lastWeek=barShape(W1.at(-1)||{});
  const nextWeekPath=outlook.bias==='BUY'
    ? (resistance?'BULLISH toward '+resistance.label+' '+resistance.level+' while support holds':'BULLISH; wait for next resistance map')
    : outlook.bias==='SELL'
      ? (support?'BEARISH toward '+support.label+' '+support.level+' while resistance holds':'BEARISH; wait for next support map')
      : 'RANGE / wait for higher-timeframe agreement';

  const bias=outlook.bias;
  const poi=price!=null&&['BUY','SELL'].includes(bias)?findPoi(frames,bias,price):{valid:false,chosen:null,candidates:[],protected:null,maxDistance:null};
  const daily=dailyCloseModel(D1,bias);
  const psp=pspDivergence(H1,ETHH1,bias);
  const m5=['BUY','SELL'].includes(bias)?m5Precision(M5,bias):{complete:false,stage:'WAIT_BIAS',sweep:null};
  const confluence={
    dailyClose:daily,
    poi,
    psp,
    bisiSibi:m5?.fvg?.type||null,
    iFvg:Boolean(poi?.chosen?.type==='iFVG'),
    cisd:Boolean(m5?.cisd),
    mss:Boolean(m5?.mss),
    displacement:Boolean(m5?.dispIdx>=0),
    fvgRetest:Boolean(m5?.retest)
  };

  let quality=outlook.confidence;
  if(daily.aligned)quality+=4;
  if(poi.valid)quality+=4;
  if(poi?.chosen?.type==='iFVG')quality+=2;
  if(m5.cisd&&m5.mss)quality+=4;else if(m5.cisd||m5.mss)quality+=2;
  if(m5.complete)quality+=5;
  if(psp.aligned)quality+=3;
  quality=clamp(Math.round(quality),0,100);

  const base={
    symbol:'BTCUSD',status:'WAIT',action:'WAIT',side:null,executable:false,executionMode:'SIGNALS_ONLY',
    strategy:'LAURA_PRECISION_HYBRID',tradeStyle:'LAURA_PLUS_PRECISION',confidence:quality,
    scoreMeaning:'DESCRIPTIVE_SETUP_STRENGTH_NOT_WIN_PROBABILITY',price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,
    target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,lotSizing:null,setupId:null,
    laura:{mode:'LAURA_PLUS_PRECISION',reads,outlook:{...outlook,lastWeek,nearestSupport:support,nearestResistance:resistance,nextWeekPath},levels:levels.slice().sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)).slice(0,16)},
    precision:{model:'SUNDAY_TRIAL_V1',requiredGates:['LAURA_HTF_BIAS','D1_H1_POI','M5_SWEEP_CISD_OR_MSS_DISPLACEMENT_FVG_RETRACE'],confluence,m5},
    priceAction:{bias1h:reads.H1.side,context15:reads.M15.side,structure5:reads.M5.side,triggers:[]},
    smc:null,ict:null,updatedAt:new Date().toISOString(),
    reason:'LAURA+PRECISION WAIT.'
  };

  if(price==null||!['BUY','SELL'].includes(bias))return{...base,reason:'LAURA+PRECISION WAIT — W1/D1/H4/H1 direction is neutral or conflicted.'};
  if(outlook.confidence<MIN_CONFIDENCE)return{...base,reason:'LAURA+PRECISION WAIT — Laura HTF strength '+Math.round(outlook.confidence)+'/100 is below '+MIN_CONFIDENCE+'/100.'};
  if(!poi.valid)return{...base,reason:precisionReason('WAIT_POI',bias,poi)};
  if(!m5.complete)return{...base,reason:precisionReason(m5.stage,bias,poi)};

  const entry=num(m5.retest?.close)??price;
  const stop=bias==='BUY'?m5.sweep.extreme-SL_BUFFER:m5.sweep.extreme+SL_BUFFER;
  const risk=Math.abs(entry-stop);
  if(!(risk>0))return{...base,reason:'LAURA+PRECISION WAIT — invalid structural stop after M5 sweep.'};
  const targets=targetPlan(levels,entry,bias,risk);
  const rr=Math.abs(targets[0].level-entry)/risk;
  const setupId='BTC-LP-'+bias+'-'+String(m5.sweep.t)+'-'+String(m5.fvg.t)+'-'+String(m5.retest.t);

  return{
    ...base,status:'ACTIVE',action:bias,side:bias,
    entry:round(entry),entryLow:round(m5.fvg.low),entryHigh:round(m5.fvg.high),stopLoss:round(stop),
    target1:targets[0].level,target2:targets[1].level,target3:targets[2].level,target4:targets[3].level,
    targetLabels:targets.map(x=>x.label),riskReward:round(rr),lotSizing:lotSizing(entry,stop),setupId,
    priceAction:{bias1h:reads.H1.side,context15:reads.M15.side,structure5:reads.M5.side,triggers:['M5_LIQUIDITY_SWEEP','CISD_OR_MSS','DISPLACEMENT',m5.fvg.type+'_FVG','M5_FVG_RETRACE']},
    reason:'LAURA+PRECISION '+bias+' — Laura HTF bias → '+(poi.chosen?.label||'D1/H1 POI')+' → M5 sweep → '+(m5.cisd&&m5.mss?'CISD+MSS':m5.cisd?'CISD':'MSS')+' → displacement → '+m5.fvg.type+' → FVG retrace; target '+targets[0].label+'.'
  };
}

function reached(side,price,target){return Number.isFinite(Number(target))&&(side==='BUY'?price>=target:price<=target);}
function lifecycleSignal(candidate,now=Date.now()){
  const price=Number(candidate.price);
  if(lifecycle.signal){
    const s=lifecycle.signal;
    const stopHit=Number.isFinite(price)&&(s.action==='BUY'?price<=s.stopLoss:price>=s.stopLoss);
    if(stopHit){lifecycle.lastTerminal={type:'SL',side:s.action,price:round(price),at:new Date(now).toISOString(),signalId:s.signalId};lifecycle.signal=null;lifecycle.cooldownUntil=now+60000;}
    else{
      s.price=round(price);s.updatedAt=candidate.updatedAt;s.targetHits=[s.target1,s.target2,s.target3,s.target4].map(t=>reached(s.action,price,t));
      if(s.targetHits.every(Boolean)){lifecycle.lastTerminal={type:'TP4',side:s.action,price:round(price),at:new Date(now).toISOString(),signalId:s.signalId};lifecycle.signal=null;lifecycle.cooldownUntil=now+60000;}
      else return{...s,status:'ACTIVE',lockedTargets:true,terminalEvent:lifecycle.lastTerminal};
    }
  }
  if(now>=lifecycle.cooldownUntil&&candidate.status==='ACTIVE'&&candidate.setupId&&!lifecycle.seen.has(candidate.setupId)){
    lifecycle.seen.add(candidate.setupId);
    if(lifecycle.seen.size>200)lifecycle.seen.delete(lifecycle.seen.values().next().value);
    lifecycle.signal={...candidate,signalId:'BTC-LP-'+now,issuedAtMs:now,targetHits:[false,false,false,false],lockedTargets:true};
    return{...lifecycle.signal,terminalEvent:lifecycle.lastTerminal};
  }
  return{...candidate,status:'WAIT',action:'WAIT',side:null,entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,signalId:null,terminalEvent:lifecycle.lastTerminal,cooldownRemainingMs:Math.max(0,lifecycle.cooldownUntil-now)};
}
async function freshCandidate(force=false){
  if(!force&&cache.value&&Date.now()<cache.expiresAt)return cache.value;
  const [M1,M5,M15,H1,D1,ticker,ETHH1]=await Promise.all([
    coinbaseCandles('BTC-USD',60),coinbaseCandles('BTC-USD',300),coinbaseCandles('BTC-USD',900),
    coinbaseCandles('BTC-USD',3600),coinbaseCandles('BTC-USD',86400),coinbaseTicker(),
    coinbaseCandles('ETH-USD',3600).catch(()=>[])
  ]);
  const H4=aggregate(H1,'H4'),W1=aggregate(D1,'W1'),MN1=aggregate(D1,'MN1');
  const value=analyze({M1,M5,M15,H1,H4,D1,W1,MN1,ETHH1,ticker});
  cache.value=value;cache.expiresAt=Date.now()+CACHE_MS;return value;
}
export async function getBtcSignal(force=false){return lifecycleSignal(await freshCandidate(force));}
export function analyzeBtcLaura(input){return analyze(input);}
export const analyzeBtcLauraPrecision=analyzeBtcLaura;

export function injectBtcPanel(html){
  if(html.includes('btcLauraPanel'))return html;
  const css='<style>#btcLauraPanel{max-width:1280px;margin:16px auto 28px;padding:16px;border:1px solid #7352a6;border-radius:18px;background:linear-gradient(145deg,#17111f,#0b111b);direction:rtl;color:#eef2f7}#btcLauraPanel h2{margin:0;color:#c9a7ff;font-size:20px}.btcLauraTag{display:inline-block;margin-right:8px;padding:5px 8px;border:1px solid #684c8a;border-radius:999px;color:#d7bcff;font-size:11px}.btcLauraGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.btcLauraCard{padding:10px;border:1px solid #343b48;border-radius:11px;background:#0c121d}.btcLauraCard span{display:block;color:#95a1b4;font-size:10px}.btcLauraCard strong{display:block;margin-top:5px;font-size:15px;direction:ltr;text-align:right}.btcLauraBuy{color:#52e5a5}.btcLauraSell{color:#ff718c}.btcLauraWait{color:#ffd166}.btcLauraNote{margin-top:10px;color:#aaa0b7;font-size:11px;line-height:1.7}@media(max-width:900px){.btcLauraGrid{grid-template-columns:repeat(2,1fr)}}</style>';
  const panel='<section id="btcLauraPanel"><h2>🟣 BTCUSD — LAURA + PRECISION <span class="btcLauraTag">W1/D1→H4/H1 POI→M5</span></h2><div class="btcLauraGrid"><div class="btcLauraCard"><span>الحالة</span><strong id="btcLauraState">WAIT</strong></div><div class="btcLauraCard"><span>Laura Bias</span><strong id="btcLauraBias">—</strong></div><div class="btcLauraCard"><span>W1 / D1 / H4</span><strong id="btcLauraHtf">—</strong></div><div class="btcLauraCard"><span>M5 Precision</span><strong id="btcLauraTrigger">—</strong></div><div class="btcLauraCard"><span>السعر</span><strong id="btcLauraPrice">—</strong></div><div class="btcLauraCard"><span>الدخول</span><strong id="btcLauraEntry">—</strong></div><div class="btcLauraCard"><span>وقف الخسارة</span><strong id="btcLauraStop">—</strong></div><div class="btcLauraCard"><span>TP1</span><strong id="btcLauraTp1">—</strong></div></div><p id="btcLauraReason" class="btcLauraNote">Laura HTF + M5 precision.</p></section>';
  const js='<script id="btcLauraClient">(function(){const el=id=>document.getElementById(id),fmt=v=>Number.isFinite(Number(v))?"$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2}):"—";async function run(){try{const r=await fetch("/api/btc-signal?_="+Date.now(),{cache:"no-store"}),d=await r.json(),l=d.laura||{},reads=l.reads||{},o=l.outlook||{},p=d.precision||{},m=p.m5||{},active=d.status==="ACTIVE"&&["BUY","SELL"].includes(d.action),s=el("btcLauraState");s.textContent=active?d.action:"WAIT";s.className=active?(d.action==="BUY"?"btcLauraBuy":"btcLauraSell"):"btcLauraWait";el("btcLauraBias").textContent=(o.bias||"NEUTRAL")+" • "+(o.strength||"LOW")+" • "+Math.round(Number(d.confidence)||0)+"/100";el("btcLauraHtf").textContent="W1 "+(reads.W1?.side||"—")+" • D1 "+(reads.D1?.side||"—")+" • H4 "+(reads.H4?.side||"—")+" • H1 "+(reads.H1?.side||"—");el("btcLauraTrigger").textContent=m.stage||"WAIT";el("btcLauraPrice").textContent=fmt(d.price);el("btcLauraEntry").textContent=active?fmt(d.entry):"—";el("btcLauraStop").textContent=active?fmt(d.stopLoss):"—";el("btcLauraTp1").textContent=active?fmt(d.target1):"—";el("btcLauraReason").textContent=d.reason||"—";}catch(e){el("btcLauraReason").textContent="تعذر تحميل BTC الآن";}setTimeout(run,5000)}run()})();</script>';
  return html.replace('</head>',css+'</head>').replace('</body>',panel+js+'</body>');
}
