const BTC_CACHE_MS=Math.max(5000,Math.min(30000,Number(process.env.BTC_CACHE_MS||10000)||10000));
const BTC_CONTRACT_SIZE=Math.max(.000001,Number(process.env.EXNESS_BTC_CONTRACT_SIZE||1));
const BTC_LOT_STEP=Math.max(.001,Number(process.env.EXNESS_BTC_LOT_STEP||.01));
const BTC_SAFE_RISK_USD=Math.max(1,Number(process.env.BTC_SAFE_RISK_USD||5));
const BTC_MAX_RISK_USD=Math.max(BTC_SAFE_RISK_USD,Number(process.env.BTC_MAX_RISK_USD||10));
const BTC_MIN_CONFIDENCE=Math.max(60,Math.min(90,Number(process.env.BTC_MIN_CONFIDENCE||68)||68));
const cache={expiresAt:0,value:null};
const lifecycle={signal:null,lastTerminal:null,cooldownUntil:0};

const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=2)=>{const x=num(v);return x==null?null:Number(x.toFixed(d))};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
const median=xs=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const fresh=(event,ms)=>Boolean(event&&Number(event.t)&&Date.now()-Number(event.t)<=ms);

async function coinbaseCandles(granularity){
  const url=new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
  url.searchParams.set('granularity',String(granularity));
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-Wyckoff/1.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok||!Array.isArray(rows))throw new Error('Coinbase candles unavailable '+r.status);
  const now=Date.now(),span=granularity*1000;
  return rows.map(x=>({t:Number(x[0])*1000,low:Number(x[1]),high:Number(x[2]),open:Number(x[3]),close:Number(x[4]),volume:Number(x[5]||0)}))
    .filter(x=>Number.isFinite(x.close)&&x.t+span<=now+1000).sort((a,b)=>a.t-b.t);
}
async function coinbaseTicker(){
  const r=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker',{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-Wyckoff/1.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error('Coinbase ticker unavailable '+r.status);
  return d;
}
function atr(rows,period=14){
  if(rows.length<period+1)return null;
  const tr=[];
  for(let i=rows.length-period;i<rows.length;i++){
    const c=rows[i],p=rows[i-1];
    tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
  }
  return mean(tr);
}
function slope(rows,count=24){
  const x=rows.slice(-count);if(x.length<8)return 0;
  const first=mean(x.slice(0,Math.max(3,Math.floor(x.length/4))).map(c=>c.close));
  const last=mean(x.slice(-Math.max(3,Math.floor(x.length/4))).map(c=>c.close));
  return first?((last-first)/first):0;
}
function volumeStats(rows,count=30){
  const x=rows.slice(-count).map(c=>c.volume).filter(v=>Number.isFinite(v)&&v>=0);
  return{avg:mean(x)||0,median:median(x)||0,last:rows.at(-1)?.volume||0};
}
function rangeSnapshot(rows,a){
  const sample=rows.slice(-72,-4);if(sample.length<36)return null;
  const highs=sample.map(c=>c.high).sort((x,y)=>x-y),lows=sample.map(c=>c.low).sort((x,y)=>x-y);
  const qi=(arr,p)=>arr[Math.max(0,Math.min(arr.length-1,Math.floor((arr.length-1)*p)))];
  const resistance=qi(highs,.86),support=qi(lows,.14),mid=(support+resistance)/2,width=resistance-support;
  const closeNow=rows.at(-1)?.close;
  return{
    support:round(support),resistance:round(resistance),mid:round(mid),width:round(width),
    atr:round(a),widthAtr:round(width/Math.max(a||1,1),2),
    location:closeNow==null?null:round((closeNow-support)/Math.max(width,1),3)
  };
}
function findWyckoffEvents(rows,range,a){
  if(!range)return{spring:null,utad:null,sos:null,sow:null,lps:null,lpsy:null};
  const x=rows.slice(-36),buffer=Math.max(8,(a||50)*.12),v=volumeStats(rows,40),events={spring:null,utad:null,sos:null,sow:null,lps:null,lpsy:null};
  for(let i=1;i<x.length;i++){
    const c=x[i],prev=x[i-1],volRatio=v.avg>0?c.volume/v.avg:1;
    if(c.low<range.support-buffer*.15&&c.close>range.support&&c.close>c.low+(c.high-c.low)*.55){
      events.spring={type:'SPRING',side:'BUY',t:c.t,level:range.support,extreme:round(c.low),close:round(c.close),volumeRatio:round(volRatio,2)};
    }
    if(c.high>range.resistance+buffer*.15&&c.close<range.resistance&&c.close<c.low+(c.high-c.low)*.45){
      events.utad={type:'UTAD',side:'SELL',t:c.t,level:range.resistance,extreme:round(c.high),close:round(c.close),volumeRatio:round(volRatio,2)};
    }
    if(c.close>range.resistance+buffer*.20&&c.close>c.open&&c.close>prev.close){
      events.sos={type:'SOS',side:'BUY',t:c.t,level:range.resistance,close:round(c.close),volumeRatio:round(volRatio,2)};
    }
    if(c.close<range.support-buffer*.20&&c.close<c.open&&c.close<prev.close){
      events.sow={type:'SOW',side:'SELL',t:c.t,level:range.support,close:round(c.close),volumeRatio:round(volRatio,2)};
    }
  }
  if(events.sos){
    const after=x.filter(c=>c.t>events.sos.t);
    for(const c of after){
      if(c.low<=range.resistance+buffer&&c.low>=range.mid&&c.close>=range.resistance-buffer*.25){
        events.lps={type:'LPS',side:'BUY',t:c.t,level:range.resistance,extreme:round(c.low),close:round(c.close)};
      }
    }
  }
  if(events.sow){
    const after=x.filter(c=>c.t>events.sow.t);
    for(const c of after){
      if(c.high>=range.support-buffer&&c.high<=range.mid&&c.close<=range.support+buffer*.25){
        events.lpsy={type:'LPSY',side:'SELL',t:c.t,level:range.support,extreme:round(c.high),close:round(c.close)};
      }
    }
  }
  return events;
}
function priorTrend(rows,a){
  const prior=rows.slice(-132,-72);if(prior.length<20)return'NEUTRAL';
  const s=slope(prior,prior.length),move=Math.abs(prior.at(-1).close-prior[0].close),noise=Math.max(a||1,1)*2.2;
  if(move<noise)return'NEUTRAL';
  return s>.002?'UP':s<-.002?'DOWN':'NEUTRAL';
}
function classifyWyckoff(rows,range,events,a){
  const prior=priorTrend(rows,a),loc=range?.location??.5;
  let accumulation=0,distribution=0;
  if(prior==='DOWN')accumulation+=28;
  if(prior==='UP')distribution+=28;
  if(events.spring)accumulation+=32;
  if(events.utad)distribution+=32;
  if(events.sos)accumulation+=22;
  if(events.sow)distribution+=22;
  if(events.lps)accumulation+=18;
  if(events.lpsy)distribution+=18;
  if(loc<.35)accumulation+=8;
  if(loc>.65)distribution+=8;
  let schematic='RANGE',phase='B';
  if(accumulation>distribution+8)schematic='ACCUMULATION';
  else if(distribution>accumulation+8)schematic='DISTRIBUTION';
  if(schematic==='ACCUMULATION')phase=events.lps?'D':events.sos?'D':events.spring?'C':'B';
  if(schematic==='DISTRIBUTION')phase=events.lpsy?'D':events.sow?'D':events.utad?'C':'B';
  if(schematic==='ACCUMULATION'&&events.sos&&fresh(events.sos,6*60*60_000))phase='D/E';
  if(schematic==='DISTRIBUTION'&&events.sow&&fresh(events.sow,6*60*60_000))phase='D/E';
  return{schematic,phase,priorTrend:prior,accumulationScore:accumulation,distributionScore:distribution};
}
function microTrigger(rows,side,a){
  const x=rows.slice(-18);if(x.length<10)return{ready:false,type:'WAIT',side:null};
  const last=x.at(-1),prior=x.slice(-7,-1),v=mean(x.slice(-14,-1).map(c=>c.volume))||1,volRatio=last.volume/v;
  const hi=Math.max(...prior.map(c=>c.high)),lo=Math.min(...prior.map(c=>c.low)),range=Math.max(.01,last.high-last.low),body=Math.abs(last.close-last.open);
  if(side==='BUY'){
    const breakout=last.close>hi+Math.max(2,(a||20)*.02),rejection=(last.close>last.open&&last.low<lo&&last.close>last.low+range*.65),impulse=last.close>last.open&&body>range*.55&&last.close>hi-(a||20)*.03;
    const ready=breakout||rejection||impulse;
    return{ready,type:breakout?'MICRO_SOS':rejection?'TEST_REJECTION':impulse?'DEMAND_IMPULSE':'WAIT',side:ready?'BUY':null,volumeRatio:round(volRatio,2),t:last.t};
  }
  const breakdown=last.close<lo-Math.max(2,(a||20)*.02),rejection=(last.close<last.open&&last.high>hi&&last.close<last.low+range*.35),impulse=last.close<last.open&&body>range*.55&&last.close<lo+(a||20)*.03;
  const ready=breakdown||rejection||impulse;
  return{ready,type:breakdown?'MICRO_SOW':rejection?'TEST_REJECTION':impulse?'SUPPLY_IMPULSE':'WAIT',side:ready?'SELL':null,volumeRatio:round(volRatio,2),t:last.t};
}
function fiveMinuteTrigger(rows,side,range,a){
  const x=rows.slice(-30);if(x.length<14)return{ready:false,type:'WAIT',side:null};
  const last=x.at(-1),prev=x.at(-2),v=mean(x.slice(-18,-1).map(c=>c.volume))||1,vr=last.volume/v,buf=Math.max(5,(a||40)*.06);
  if(side==='BUY'){
    const reclaim=last.close>range.mid&&prev.close<=range.mid;
    const test=last.low<=range.support+buf&&last.close>range.support&&last.close>last.open;
    const continuation=last.close>Math.max(...x.slice(-8,-1).map(c=>c.high))&&last.close>last.open;
    return{ready:reclaim||test||continuation,type:reclaim?'MID_RECLAIM':test?'SPRING_TEST':continuation?'SOS_CONTINUATION':'WAIT',side:(reclaim||test||continuation)?'BUY':null,volumeRatio:round(vr,2),t:last.t};
  }
  const reject=last.close<range.mid&&prev.close>=range.mid;
  const test=last.high>=range.resistance-buf&&last.close<range.resistance&&last.close<last.open;
  const continuation=last.close<Math.min(...x.slice(-8,-1).map(c=>c.low))&&last.close<last.open;
  return{ready:reject||test||continuation,type:reject?'MID_REJECTION':test?'UTAD_TEST':continuation?'SOW_CONTINUATION':'WAIT',side:(reject||test||continuation)?'SELL':null,volumeRatio:round(vr,2),t:last.t};
}
function lotForRisk(entry,stop,riskUsd){
  const distance=Math.abs(Number(entry)-Number(stop));if(!(distance>0))return 0;
  const raw=riskUsd/(distance*BTC_CONTRACT_SIZE),steps=Math.floor((raw+1e-12)/BTC_LOT_STEP);
  return steps>0?Number((steps*BTC_LOT_STEP).toFixed(3)):0;
}
function lotSizing(entry,stop){
  const distance=Math.abs(Number(entry)-Number(stop)),safeLot=lotForRisk(entry,stop,BTC_SAFE_RISK_USD),maxLot=lotForRisk(entry,stop,BTC_MAX_RISK_USD),recommendedLot=safeLot>0?safeLot:(maxLot>0?BTC_LOT_STEP:0);
  return{recommendedLot,maxLot,stopDistance:round(distance),actualRiskUsd:recommendedLot>0?round(distance*BTC_CONTRACT_SIZE*recommendedLot):null,safeRiskUsd:BTC_SAFE_RISK_USD,maxRiskUsd:BTC_MAX_RISK_USD};
}
function targets(side,entry,stop,range,a){
  const risk=Math.abs(entry-stop),dir=side==='BUY'?1:-1,minStep=Math.max(25,(a||50)*.25),out=[],labels=[];
  const add=(p,label)=>{if(Number.isFinite(p)&&(side==='BUY'?p>entry+minStep*.35:p<entry-minStep*.35)&&!out.some(x=>Math.abs(x-p)<minStep*.35)){out.push(round(p));labels.push(label);}};
  if(side==='BUY'){
    add(range.mid,'RANGE_MID');add(range.resistance,'CREEK / RANGE_HIGH');add(range.resistance+range.width*.5,'MARKUP_0.5RANGE');add(range.resistance+range.width,'MARKUP_MEASURED_MOVE');
  }else{
    add(range.mid,'RANGE_MID');add(range.support,'ICE / RANGE_LOW');add(range.support-range.width*.5,'MARKDOWN_0.5RANGE');add(range.support-range.width,'MARKDOWN_MEASURED_MOVE');
  }
  for(const m of [.8,1.25,1.8,2.5])add(entry+dir*Math.max(minStep,risk*m),'R_'+m);
  while(out.length<4){const i=out.length;add(entry+dir*Math.max(minStep*(i+1),risk*(.8+i*.55)),'WYCKOFF_TP'+(i+1));if(out.length<4&&i===out.length)break;}
  return{targets:out.slice(0,4),labels:labels.slice(0,4)};
}
function analyze(data){
  const one=data.one,five=data.five,fifteen=data.fifteen,hour=data.hour,ticker=data.ticker||{};
  if(one.length<100||five.length<100||fifteen.length<100||hour.length<100)throw new Error('BTC history incomplete');
  const price=Number(ticker.price??one.at(-1).close),a15=atr(fifteen,14)||price*.002,a5=atr(five,14)||price*.0012,a1=atr(one,14)||price*.0005;
  const range=rangeSnapshot(fifteen,a15);if(!range)throw new Error('Wyckoff range unavailable');
  const events15=findWyckoffEvents(fifteen,range,a15),context=classifyWyckoff(fifteen,range,events15,a15);
  const events5=findWyckoffEvents(five,{...range,support:range.support,resistance:range.resistance,mid:range.mid,width:range.width},a5);

  let side=null,primaryEvent=null;
  const buyEvent=events15.lps||events15.sos||events15.spring||events5.lps||events5.sos||events5.spring;
  const sellEvent=events15.lpsy||events15.sow||events15.utad||events5.lpsy||events5.sow||events5.utad;
  if(context.schematic==='ACCUMULATION'&&buyEvent){side='BUY';primaryEvent=buyEvent;}
  if(context.schematic==='DISTRIBUTION'&&sellEvent){side='SELL';primaryEvent=sellEvent;}

  const trigger5=side?fiveMinuteTrigger(five,side,range,a5):{ready:false,type:'WAIT'};
  const trigger1=side?microTrigger(one,side,a1):{ready:false,type:'WAIT'};
  const vol15=volumeStats(fifteen,30),priceLoc=range.location;
  let confidence=38;
  if(context.schematic!=='RANGE')confidence+=12;
  if(context.phase==='C')confidence+=10;
  if(String(context.phase).includes('D'))confidence+=14;
  if(primaryEvent)confidence+=14;
  if(primaryEvent?.volumeRatio>=1.15)confidence+=5;
  if(trigger5.ready)confidence+=12;
  if(trigger1.ready)confidence+=7;
  if(side==='BUY'&&priceLoc<.75)confidence+=4;
  if(side==='SELL'&&priceLoc>.25)confidence+=4;
  confidence=clamp(Math.round(confidence),20,95);
  const contextStrength=confidence;

  const wyckoff={
    version:'BTC_WYCKOFF_V1',schematic:context.schematic,phase:context.phase,priorTrend:context.priorTrend,
    range,events15,events5,primaryEvent,trigger5,trigger1,
    volume:{avg15:round(vol15.avg,2),last15:round(vol15.last,2),lastRatio:vol15.avg?round(vol15.last/vol15.avg,2):null},
    interpretation:context.schematic==='ACCUMULATION'?'Demand-side Wyckoff schematic':context.schematic==='DISTRIBUTION'?'Supply-side Wyckoff schematic':'No clean Wyckoff schematic yet'
  };
  const base={
    symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'WYCKOFF',tradeStyle:'WYCKOFF',
    confidence,contextStrength,minimumConfidence:BTC_MIN_CONFIDENCE,scoreMeaning:'READINESS_SCORE_NOT_WIN_PROBABILITY',
    price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,lotSizing:null,
    executionMode:'SIGNALS_ONLY',trend:'Wyckoff '+context.schematic+' Phase '+context.phase+' / prior '+context.priorTrend,wyckoff,updatedAt:new Date().toISOString(),
    reason:'WYCKOFF WAIT — no confirmed BTC setup.'
  };
  if(!side)return{...base,confidence:Math.min(confidence,59),reason:'WYCKOFF WAIT — '+context.schematic+' Phase '+context.phase+'; waiting for Spring/SOS/LPS or UTAD/SOW/LPSY.'};
  if(!primaryEvent||!fresh(primaryEvent,12*60*60_000))return{...base,confidence:Math.min(confidence,64),reason:'WYCKOFF WAIT — '+context.schematic+' context exists, but the key event is not fresh enough.'};
  if(!trigger5.ready)return{...base,confidence:Math.min(confidence,Math.max(59,BTC_MIN_CONFIDENCE-1)),reason:'WYCKOFF WAIT — '+primaryEvent.type+' detected; waiting for 5m confirmation (test/reclaim/continuation).'};
  if(!trigger1.ready&&confidence<76)return{...base,confidence:Math.min(confidence,75),reason:'WYCKOFF WAIT — 5m '+trigger5.type+' is ready; waiting for 1m micro confirmation unless context strength reaches 76/100.'};
  if(confidence<BTC_MIN_CONFIDENCE)return{...base,reason:'WYCKOFF WAIT — setup strength '+confidence+'/100 is below '+BTC_MIN_CONFIDENCE+'/100.'};

  const recent=five.slice(-18),buf=Math.max(10,a5*.12);
  const structuralExtreme=side==='BUY'
    ? Math.min(primaryEvent.extreme??range.support,...recent.slice(-8).map(c=>c.low))
    : Math.max(primaryEvent.extreme??range.resistance,...recent.slice(-8).map(c=>c.high));
  let stop=side==='BUY'?structuralExtreme-buf:structuralExtreme+buf;
  let risk=Math.abs(price-stop),minRisk=Math.max(30,a5*.28),maxRisk=Math.max(150,a5*2.2);
  if(risk<minRisk){stop=side==='BUY'?price-minRisk:price+minRisk;risk=minRisk;}
  if(risk>maxRisk)return{...base,reason:'WYCKOFF WAIT — setup confirmed but structural stop is too wide ('+round(risk)+').'};
  const t=targets(side,price,stop,range,a15),rr=Math.abs(t.targets[0]-price)/risk,half=Math.max(8,Math.min(40,a1*.35));
  return{
    ...base,status:'ACTIVE',action:side,side,confidence,entry:round(price),entryLow:round(price-half),entryHigh:round(price+half),stopLoss:round(stop),
    target1:t.targets[0],target2:t.targets[1],target3:t.targets[2],target4:t.targets[3],targetLabels:t.labels,riskReward:round(rr,2),lotSizing:lotSizing(price,stop),
    reason:'WYCKOFF '+side+' — '+context.schematic+' Phase '+context.phase+'; '+primaryEvent.type+' + 5m '+trigger5.type+(trigger1.ready?' + 1m '+trigger1.type:'')+'; strength '+confidence+'/100.'
  };
}
async function freshCandidate(force=false){
  if(!force&&cache.value&&Date.now()<cache.expiresAt)return cache.value;
  const [one,five,fifteen,hour,ticker]=await Promise.all([coinbaseCandles(60),coinbaseCandles(300),coinbaseCandles(900),coinbaseCandles(3600),coinbaseTicker()]);
  const value=analyze({one,five,fifteen,hour,ticker});cache.value=value;cache.expiresAt=Date.now()+BTC_CACHE_MS;return value;
}
function reached(side,price,target){return side==='BUY'?price>=target:price<=target;}
function lifecycleSignal(candidate,now=Date.now()){
  const price=Number(candidate.price);
  if(lifecycle.signal){
    const s=lifecycle.signal,stopHit=s.action==='BUY'?price<=s.stopLoss:price>=s.stopLoss;
    if(stopHit){lifecycle.lastTerminal={type:'SL',side:s.action,price:round(price),at:new Date(now).toISOString(),signalId:s.signalId};lifecycle.signal=null;lifecycle.cooldownUntil=now+60000;}
    else{
      s.price=round(price);s.updatedAt=candidate.updatedAt;s.targetHits=[s.target1,s.target2,s.target3,s.target4].map(t=>reached(s.action,price,t));
      if(s.targetHits.every(Boolean)){lifecycle.lastTerminal={type:'TP4',side:s.action,price:round(price),at:new Date(now).toISOString(),signalId:s.signalId};lifecycle.signal=null;lifecycle.cooldownUntil=now+60000;}
      else return{...s,status:'ACTIVE',lockedTargets:true,terminalEvent:lifecycle.lastTerminal};
    }
  }
  if(now>=lifecycle.cooldownUntil&&candidate.status==='ACTIVE'){
    lifecycle.signal={...candidate,signalId:'BTC-WY-'+now,issuedAtMs:now,targetHits:[false,false,false,false],lockedTargets:true};
    return{...lifecycle.signal,terminalEvent:lifecycle.lastTerminal};
  }
  return{...candidate,status:'WAIT',action:'WAIT',entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,signalId:null,terminalEvent:lifecycle.lastTerminal,cooldownRemainingMs:Math.max(0,lifecycle.cooldownUntil-now)};
}
export async function getBtcSignal(force=false){return lifecycleSignal(await freshCandidate(force));}

export function injectBtcPanel(html){
  if(html.includes('btcWyckoffPanel'))return html;
  const css='<style>#btcWyckoffPanel{max-width:1280px;margin:16px auto 28px;padding:16px;border:1px solid #6d4b24;border-radius:18px;background:linear-gradient(145deg,#17130d,#0b111b);direction:rtl;color:#eef2f7}#btcWyckoffPanel h2{margin:0;color:#f2bd63;font-size:20px}.btcWyTag{display:inline-block;margin-right:8px;padding:5px 8px;border:1px solid #6d4b24;border-radius:999px;color:#ffc56e;font-size:11px}.btcWyGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}.btcWyCard{padding:10px;border:1px solid #343b48;border-radius:11px;background:#0c121d}.btcWyCard span{display:block;color:#95a1b4;font-size:10px}.btcWyCard strong{display:block;margin-top:5px;font-size:15px;direction:ltr;text-align:right}.btcWyBuy{color:#52e5a5}.btcWySell{color:#ff718c}.btcWyWait{color:#ffd166}.btcWyNote{margin-top:10px;color:#a79a84;font-size:11px;line-height:1.7}@media(max-width:900px){.btcWyGrid{grid-template-columns:repeat(2,1fr)}}</style>';
  const panel='<section id="btcWyckoffPanel"><div><h2>BTCUSD — WYCKOFF <span class="btcWyTag">15m Schematic • 5m Test/Confirmation • 1m Timing</span></h2><p id="btcWyMeta" class="btcWyNote">جارٍ تحميل قراءة Wyckoff…</p></div><div class="btcWyGrid"><div class="btcWyCard"><span>الحالة</span><strong id="btcWyState">WAIT</strong></div><div class="btcWyCard"><span>قوة الإعداد</span><strong id="btcWyConfidence">—</strong></div><div class="btcWyCard"><span>Schematic</span><strong id="btcWySchematic">—</strong></div><div class="btcWyCard"><span>Phase</span><strong id="btcWyPhase">—</strong></div><div class="btcWyCard"><span>Key Event</span><strong id="btcWyEvent">—</strong></div><div class="btcWyCard"><span>5m Confirmation</span><strong id="btcWyTrigger5">—</strong></div><div class="btcWyCard"><span>1m Timing</span><strong id="btcWyTrigger1">—</strong></div><div class="btcWyCard"><span>Trading Range</span><strong id="btcWyRange">—</strong></div><div class="btcWyCard"><span>السعر</span><strong id="btcWyPrice">—</strong></div><div class="btcWyCard"><span>الدخول</span><strong id="btcWyEntry">—</strong></div><div class="btcWyCard"><span>وقف الخسارة</span><strong id="btcWyStop">—</strong></div><div class="btcWyCard"><span>TP1</span><strong id="btcWyTp1">—</strong></div><div class="btcWyCard"><span>TP2</span><strong id="btcWyTp2">—</strong></div><div class="btcWyCard"><span>TP3</span><strong id="btcWyTp3">—</strong></div><div class="btcWyCard"><span>TP4</span><strong id="btcWyTp4">—</strong></div><div class="btcWyCard"><span>اللوت المقترح</span><strong id="btcWyLot">—</strong></div><div class="btcWyCard"><span>الاستراتيجية</span><strong>WYCKOFF</strong></div></div><p id="btcWyReason" class="btcWyNote">التجربة الحالية على BTC فقط: Spring/SOS/LPS للشراء وUTAD/SOW/LPSY للبيع، مع تأكيد 5m وتوقيت 1m.</p></section>';
  const js='<script id="btcWyckoffClient">(function(){const el=id=>document.getElementById(id),money=v=>v==null?"—":"$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2});async function run(){try{const r=await fetch("/api/btc-signal?_="+Date.now(),{cache:"no-store"}),d=await r.json(),w=d.wyckoff||{},rg=w.range||{},active=d.status==="ACTIVE"&&["BUY","SELL"].includes(d.action);const state=el("btcWyState");state.textContent=active?(d.action==="BUY"?"شراء":"بيع"):"WAIT";state.className=active?(d.action==="BUY"?"btcWyBuy":"btcWySell"):"btcWyWait";el("btcWyConfidence").textContent=Math.round(Number(d.confidence)||0)+"/100"+(d.status!=="ACTIVE"&&Number(d.contextStrength)>Number(d.confidence)?" • context "+Math.round(Number(d.contextStrength)):"");el("btcWySchematic").textContent=w.schematic||"—";el("btcWyPhase").textContent=w.phase||"—";el("btcWyEvent").textContent=w.primaryEvent?.type||"WAIT";el("btcWyTrigger5").textContent=w.trigger5?.type||"WAIT";el("btcWyTrigger1").textContent=w.trigger1?.type||"WAIT";el("btcWyRange").textContent=rg.support!=null?money(rg.support)+" – "+money(rg.resistance):"—";el("btcWyPrice").textContent=money(d.price);el("btcWyEntry").textContent=active?money(d.entry):"—";el("btcWyStop").textContent=active?money(d.stopLoss):"—";for(let i=1;i<=4;i++)el("btcWyTp"+i).textContent=active?money(d["target"+i]):"—";el("btcWyLot").textContent=active&&Number(d.lotSizing?.recommendedLot)>0?Number(d.lotSizing.recommendedLot).toFixed(2)+" lot":"—";el("btcWyReason").textContent=d.reason||"—";el("btcWyMeta").textContent="BTC-USD • Wyckoff experiment • تحديث كل 5 ثوانٍ • "+new Date(d.updatedAt||Date.now()).toLocaleTimeString("ar-SA",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch(e){el("btcWyMeta").textContent="تعذر تحميل BTC الآن";}setTimeout(run,5000)}run()})();</script>';
  return html.replace('</head>',css+'</head>').replace('</body>',panel+js+'</body>');
}
