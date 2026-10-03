const CACHE_MS=Math.max(5000,Math.min(30000,Number(process.env.BTC_CACHE_MS||12000)||12000));
const MIN_CONFIDENCE=Math.max(60,Math.min(95,Number(process.env.BTC_LAURA_MIN_CONFIDENCE||70)||70));
const CONTRACT_SIZE=Math.max(.000001,Number(process.env.EXNESS_BTC_CONTRACT_SIZE||1));
const LOT_STEP=Math.max(.001,Number(process.env.EXNESS_BTC_LOT_STEP||.01));
const SAFE_RISK_USD=Math.max(1,Number(process.env.BTC_SAFE_RISK_USD||5));
const MAX_RISK_USD=Math.max(SAFE_RISK_USD,Number(process.env.BTC_MAX_RISK_USD||10));
const DECISIVE_CLOSE=Math.max(5,Number(process.env.BTC_LAURA_DECISIVE_CLOSE_USD||25));
const RETEST_TOL=Math.max(5,Number(process.env.BTC_LAURA_RETEST_TOLERANCE_USD||35));
const SL_BUFFER=Math.max(5,Number(process.env.BTC_LAURA_SL_BUFFER_USD||20));

const cache={expiresAt:0,value:null};
const lifecycle={signal:null,lastTerminal:null,cooldownUntil:0};

const num=v=>v==null||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
const round=(v,d=2)=>{const n=num(v);return n==null?null:Number(n.toFixed(d));};
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};

async function coinbaseCandles(granularity){
  const url=new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
  url.searchParams.set('granularity',String(granularity));
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-LAURA/1.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok||!Array.isArray(rows))throw new Error('Coinbase candles unavailable '+r.status);
  const now=Date.now(),span=granularity*1000;
  return rows.map(x=>({t:Number(x[0])*1000,low:Number(x[1]),high:Number(x[2]),open:Number(x[3]),close:Number(x[4]),volume:Number(x[5]||0)}))
    .filter(x=>[x.t,x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.close>0&&x.t+span<=now+1000)
    .sort((a,b)=>a.t-b.t);
}
async function coinbaseTicker(){
  const r=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker',{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-LAURA/1.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
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
    if(before.every(x=>b.high>x.high)&&after.every(x=>b.high>=x.high))highs.push({t:b.t,price:b.high});
    if(before.every(x=>b.low<x.low)&&after.every(x=>b.low<=x.low))lows.push({t:b.t,price:b.low});
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
  return{open:round(open),high:round(high),low:round(low),close:round(close),range:round(range),pattern,t:num(bar.t)};
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
  const weights={MN1:5,W1:5,D1:4,H4:3,H1:2,M15:1};
  let buy=0,sell=0;
  for(const [tf,w] of Object.entries(weights)){if(reads[tf].side==='BUY')buy+=w;else if(reads[tf].side==='SELL')sell+=w;}
  const delta=buy-sell,bias=delta>=5?'BUY':delta<=-5?'SELL':'NEUTRAL';
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

function analyze({M1,M5,M15,H1,H4,D1,W1,MN1,ticker}){
  const price=num(ticker?.price)??num(M1.at(-1)?.close);
  const frames={M1,M5,M15,H1,H4,D1,W1,MN1};
  const reads=Object.fromEntries(Object.entries(frames).map(([tf,rows])=>[tf,tfRead(rows)]));
  const outlook=topDown(reads);
  const levels=levelsOf(frames,price);
  const support=price==null?null:nearest(levels,price,'BELOW');
  const resistance=price==null?null:nearest(levels,price,'ABOVE');
  const lastWeek=barShape(W1.at(-1)||{});
  const nextWeekPath=outlook.bias==='BUY'
    ? (resistance?`BULLISH toward ${resistance.label} ${resistance.level} while support holds`:'BULLISH; wait for next resistance map')
    : outlook.bias==='SELL'
      ? (support?`BEARISH toward ${support.label} ${support.level} while resistance holds`:'BEARISH; wait for next support map')
      : 'RANGE / wait for decisive classical break';

  const base={
    symbol:'BTCUSD',status:'WAIT',action:'WAIT',side:null,executable:false,executionMode:'SIGNALS_ONLY',
    strategy:'LAURA_CLASSICAL_PRICE_ACTION',tradeStyle:'LAURA_ONLY',confidence:round(outlook.confidence,0),
    scoreMeaning:'DESCRIPTIVE_SETUP_STRENGTH_NOT_WIN_PROBABILITY',price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,
    target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,lotSizing:null,
    laura:{mode:'LAURA_ONLY',reads,outlook:{...outlook,lastWeek,nearestSupport:support,nearestResistance:resistance,nextWeekPath},levels:levels.slice().sort((a,b)=>a.distance-b.distance).slice(0,16)},
    priceAction:{bias1h:reads.H1.side,context15:reads.M15.side,structure5:reads.M5.side,triggers:[]},
    smc:null,ict:null,updatedAt:new Date().toISOString(),
    reason:'LAURA WAIT — all-timeframe classical map is active; waiting for decisive M15 break + M5 retest + M1 timing.'
  };
  if(price==null||outlook.bias==='NEUTRAL')return{...base,reason:'LAURA WAIT — MN1/W1/D1/H4/H1 classical direction is neutral or conflicted.'};
  if(outlook.confidence<MIN_CONFIDENCE)return{...base,reason:`LAURA WAIT — classical top-down strength ${Math.round(outlook.confidence)}/100 is below ${MIN_CONFIDENCE}/100.`};

  const bias=outlook.bias,m15=M15.at(-1),m5=M5.at(-1),m1=M1.at(-1);
  if(!m15||!m5||!m1)return base;
  let broken=null;
  if(bias==='BUY'){
    broken=levels.filter(x=>m15.close>x.level+DECISIVE_CLOSE&&m15.open<=x.level+DECISIVE_CLOSE).sort((a,b)=>Math.abs(m15.close-a.level)-Math.abs(m15.close-b.level))[0]||null;
  }else{
    broken=levels.filter(x=>m15.close<x.level-DECISIVE_CLOSE&&m15.open>=x.level-DECISIVE_CLOSE).sort((a,b)=>Math.abs(m15.close-a.level)-Math.abs(m15.close-b.level))[0]||null;
  }
  if(!broken)return{...base,reason:`LAURA WATCH — waiting for decisive M15 ${bias==='BUY'?'close above resistance':'close below support'}.`};

  const retestTouch=bias==='BUY'?m5.low<=broken.level+RETEST_TOL:m5.high>=broken.level-RETEST_TOL;
  const retestHold=bias==='BUY'?m5.close>broken.level:m5.close<broken.level;
  if(!(retestTouch&&retestHold))return{...base,reason:`LAURA RETEST WAIT — M15 broke ${broken.label}; M5 must retest and hold.`,laura:{...base.laura,brokenLevel:broken}};

  const m1Shape=barShape(m1),timing=bias==='BUY'?(m1.close>m1.open||m1Shape?.pattern==='LOWER_REJECTION'):(m1.close<m1.open||m1Shape?.pattern==='UPPER_REJECTION');
  const m1Hold=bias==='BUY'?m1.close>broken.level:m1.close<broken.level;
  if(!(timing&&m1Hold))return{...base,reason:`LAURA TIMING WAIT — M15 break and M5 retest confirmed; waiting for M1 ${bias} timing candle.`,laura:{...base.laura,brokenLevel:broken}};

  const entry=m1.close,stop=bias==='BUY'?Math.min(m5.low,m1.low)-SL_BUFFER:Math.max(m5.high,m1.high)+SL_BUFFER;
  const t1=nearest(levels,entry,bias==='BUY'?'ABOVE':'BELOW',broken.level);
  if(!t1)return{...base,reason:'LAURA WAIT — entry structure confirmed but no next classical S/R target is mapped.',laura:{...base.laura,brokenLevel:broken}};
  const t2=nearest(levels,t1.level,bias==='BUY'?'ABOVE':'BELOW',t1.level);
  const risk=Math.abs(entry-stop),fallbackStep=Math.max(risk*.8,Math.abs(entry)*.0015);
  const targets=[
    t1.level,
    t2?.level??entry+(bias==='BUY'?1:-1)*fallbackStep*2,
    entry+(bias==='BUY'?1:-1)*fallbackStep*3,
    entry+(bias==='BUY'?1:-1)*fallbackStep*4
  ].map(x=>round(x));
  for(let i=1;i<targets.length;i++){
    if(bias==='BUY'&&targets[i]<=targets[i-1])targets[i]=round(targets[i-1]+fallbackStep);
    if(bias==='SELL'&&targets[i]>=targets[i-1])targets[i]=round(targets[i-1]-fallbackStep);
  }
  const labels=[t1.label,t2?.label||'LAURA_NEXT_RESISTANCE','LAURA_EXTENSION_3','LAURA_EXTENSION_4'];
  const rr=risk>0?Math.abs(targets[0]-entry)/risk:null;
  return{
    ...base,status:'ACTIVE',action:bias,side:bias,executable:false,
    confidence:round(Math.max(outlook.confidence,MIN_CONFIDENCE),0),
    entry:round(entry),entryLow:round(entry-RETEST_TOL*.25),entryHigh:round(entry+RETEST_TOL*.25),
    stopLoss:round(stop),target1:targets[0],target2:targets[1],target3:targets[2],target4:targets[3],
    targetLabels:labels,riskReward:round(rr),lotSizing:lotSizing(entry,stop),
    laura:{...base.laura,brokenLevel:broken,m15Close:round(m15.close),m5RetestClose:round(m5.close),m1Timing:m1Shape},
    priceAction:{bias1h:reads.H1.side,context15:reads.M15.side,structure5:reads.M5.side,triggers:['DECISIVE_M15_CLOSE','M5_RETEST_HOLD','M1_TIMING']},
    reason:`LAURA ${bias} — MN1/W1/D1/H4/H1 classical bias → ${broken.label} decisive M15 break → M5 retest/hold → M1 timing; target ${t1.label}.`
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
  if(now>=lifecycle.cooldownUntil&&candidate.status==='ACTIVE'){
    lifecycle.signal={...candidate,signalId:'BTC-LAURA-'+now,issuedAtMs:now,targetHits:[false,false,false,false],lockedTargets:true};
    return{...lifecycle.signal,terminalEvent:lifecycle.lastTerminal};
  }
  return{...candidate,status:'WAIT',action:'WAIT',side:null,entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,signalId:null,terminalEvent:lifecycle.lastTerminal,cooldownRemainingMs:Math.max(0,lifecycle.cooldownUntil-now)};
}
async function freshCandidate(force=false){
  if(!force&&cache.value&&Date.now()<cache.expiresAt)return cache.value;
  const [M1,M5,M15,H1,D1,ticker]=await Promise.all([
    coinbaseCandles(60),coinbaseCandles(300),coinbaseCandles(900),coinbaseCandles(3600),coinbaseCandles(86400),coinbaseTicker()
  ]);
  const H4=aggregate(H1,'H4'),W1=aggregate(D1,'W1'),MN1=aggregate(D1,'MN1');
  const value=analyze({M1,M5,M15,H1,H4,D1,W1,MN1,ticker});
  cache.value=value;cache.expiresAt=Date.now()+CACHE_MS;return value;
}
export async function getBtcSignal(force=false){return lifecycleSignal(await freshCandidate(force));}
export function analyzeBtcLaura(input){return analyze(input);}

export function injectBtcPanel(html){
  if(html.includes('btcLauraPanel'))return html;
  const css='<style>#btcLauraPanel{max-width:1280px;margin:16px auto 28px;padding:16px;border:1px solid #7352a6;border-radius:18px;background:linear-gradient(145deg,#17111f,#0b111b);direction:rtl;color:#eef2f7}#btcLauraPanel h2{margin:0;color:#c9a7ff;font-size:20px}.btcLauraTag{display:inline-block;margin-right:8px;padding:5px 8px;border:1px solid #684c8a;border-radius:999px;color:#d7bcff;font-size:11px}.btcLauraGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.btcLauraCard{padding:10px;border:1px solid #343b48;border-radius:11px;background:#0c121d}.btcLauraCard span{display:block;color:#95a1b4;font-size:10px}.btcLauraCard strong{display:block;margin-top:5px;font-size:15px;direction:ltr;text-align:right}.btcLauraBuy{color:#52e5a5}.btcLauraSell{color:#ff718c}.btcLauraWait{color:#ffd166}.btcLauraNote{margin-top:10px;color:#aaa0b7;font-size:11px;line-height:1.7}@media(max-width:900px){.btcLauraGrid{grid-template-columns:repeat(2,1fr)}}</style>';
  const panel='<section id="btcLauraPanel"><h2>🟣 BTCUSD — LAURA ONLY <span class="btcLauraTag">MN1→W1→D1→H4→H1→M15→M5→M1</span></h2><div class="btcLauraGrid"><div class="btcLauraCard"><span>الحالة</span><strong id="btcLauraState">WAIT</strong></div><div class="btcLauraCard"><span>التصور العام</span><strong id="btcLauraBias">—</strong></div><div class="btcLauraCard"><span>W1 / D1 / H4</span><strong id="btcLauraHtf">—</strong></div><div class="btcLauraCard"><span>M15 / M5 / M1</span><strong id="btcLauraTrigger">—</strong></div><div class="btcLauraCard"><span>السعر</span><strong id="btcLauraPrice">—</strong></div><div class="btcLauraCard"><span>الدخول</span><strong id="btcLauraEntry">—</strong></div><div class="btcLauraCard"><span>وقف الخسارة</span><strong id="btcLauraStop">—</strong></div><div class="btcLauraCard"><span>TP1</span><strong id="btcLauraTp1">—</strong></div></div><p id="btcLauraReason" class="btcLauraNote">Laura classical price action only.</p></section>';
  const js='<script id="btcLauraClient">(function(){const el=id=>document.getElementById(id),fmt=v=>Number.isFinite(Number(v))?"$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2}):"—";async function run(){try{const r=await fetch("/api/btc-signal?_="+Date.now(),{cache:"no-store"}),d=await r.json(),l=d.laura||{},reads=l.reads||{},o=l.outlook||{},active=d.status==="ACTIVE"&&["BUY","SELL"].includes(d.action),s=el("btcLauraState");s.textContent=active?d.action:"WAIT";s.className=active?(d.action==="BUY"?"btcLauraBuy":"btcLauraSell"):"btcLauraWait";el("btcLauraBias").textContent=(o.bias||"NEUTRAL")+" • "+(o.strength||"LOW")+" • "+Math.round(Number(d.confidence)||0)+"/100";el("btcLauraHtf").textContent="W1 "+(reads.W1?.side||"—")+" • D1 "+(reads.D1?.side||"—")+" • H4 "+(reads.H4?.side||"—")+" • H1 "+(reads.H1?.side||"—");el("btcLauraTrigger").textContent="M15 "+(reads.M15?.side||"—")+" • M5 "+(reads.M5?.side||"—")+" • M1 "+(reads.M1?.side||"—");el("btcLauraPrice").textContent=fmt(d.price);el("btcLauraEntry").textContent=active?fmt(d.entry):"—";el("btcLauraStop").textContent=active?fmt(d.stopLoss):"—";el("btcLauraTp1").textContent=active?fmt(d.target1):"—";el("btcLauraReason").textContent=d.reason||"—";}catch(e){el("btcLauraReason").textContent="تعذر تحميل BTC الآن";}setTimeout(run,5000)}run()})();</script>';
  return html.replace('</head>',css+'</head>').replace('</body>',panel+js+'</body>');
}
