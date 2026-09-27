const BTC_CACHE_MS=Math.max(5000,Math.min(30000,Number(process.env.BTC_CACHE_MS||10000)||10000));
const BTC_CONTRACT_SIZE=Math.max(.000001,Number(process.env.EXNESS_BTC_CONTRACT_SIZE||1));
const BTC_LOT_STEP=Math.max(.001,Number(process.env.EXNESS_BTC_LOT_STEP||.01));
const BTC_SAFE_RISK_USD=Math.max(1,Number(process.env.BTC_SAFE_RISK_USD||5));
const BTC_MAX_RISK_USD=Math.max(BTC_SAFE_RISK_USD,Number(process.env.BTC_MAX_RISK_USD||10));
const BTC_MIN_CONFIDENCE=Math.max(60,Math.min(90,Number(process.env.BTC_MIN_CONFIDENCE||70)||70));
const cache={expiresAt:0,value:null};
const lifecycle={signal:null,lastTerminal:null,cooldownUntil:0};

const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=2)=>{const x=num(v);return x==null?null:Number(x.toFixed(d))};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
const median=xs=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};

async function coinbaseCandles(granularity){
  const url=new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
  url.searchParams.set('granularity',String(granularity));
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-Breakout/1.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok||!Array.isArray(rows))throw new Error('Coinbase candles unavailable '+r.status);
  const now=Date.now(),span=granularity*1000;
  return rows.map(x=>({t:Number(x[0])*1000,low:Number(x[1]),high:Number(x[2]),open:Number(x[3]),close:Number(x[4]),volume:Number(x[5]||0)}))
    .filter(x=>Number.isFinite(x.close)&&x.t+span<=now+1000).sort((a,b)=>a.t-b.t);
}
async function coinbaseTicker(){
  const r=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker',{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-Breakout/1.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error('Coinbase ticker unavailable '+r.status);
  return d;
}
function slope(rows,count=24){
  const x=rows.slice(-count);if(x.length<8)return 0;
  const n=Math.max(3,Math.floor(x.length/4));
  const first=mean(x.slice(0,n).map(c=>c.close)),last=mean(x.slice(-n).map(c=>c.close));
  return first?((last-first)/first):0;
}
function volumeStats(rows,count=30){
  const x=rows.slice(-count).map(c=>c.volume).filter(v=>Number.isFinite(v)&&v>=0);
  return{avg:mean(x)||0,median:median(x)||0,last:rows.at(-1)?.volume||0};
}
function candleStats(rows,count=30){
  const x=rows.slice(-(count+1),-1);
  const ranges=x.map(c=>Math.max(.01,c.high-c.low));
  const bodies=x.map(c=>Math.abs(c.close-c.open));
  return{medianRange:median(ranges)||1,medianBody:median(bodies)||1,avgRange:mean(ranges)||1};
}
function robustLevels(rows,count=42,exclude=4){
  const sample=rows.slice(-(count+exclude),-exclude);
  if(sample.length<24)return null;
  const highs=sample.map(c=>c.high).sort((a,b)=>a-b);
  const lows=sample.map(c=>c.low).sort((a,b)=>a-b);
  const n=Math.min(5,Math.max(3,Math.floor(sample.length*.12)));
  const resistance=median(highs.slice(-n)),support=median(lows.slice(0,n));
  if(!(resistance>support))return null;
  const mid=(support+resistance)/2;
  return{support:round(support),resistance:round(resistance),mid:round(mid),width:round(resistance-support)};
}
function contextBias(hour,fifteen){
  const h=slope(hour,28),m=slope(fifteen,28),score=h*.65+m*.35;
  return{bias:score>.0012?'UP':score<-.0012?'DOWN':'NEUTRAL',hourSlope:round(h*100,3),m15Slope:round(m*100,3)};
}
function candleQuality(c,side){
  const range=Math.max(.01,c.high-c.low),body=Math.abs(c.close-c.open),bodyRatio=body/range;
  const closePos=(c.close-c.low)/range;
  const directional=side==='BUY'?c.close>c.open:c.close<c.open;
  const nearExtreme=side==='BUY'?closePos>=.72:closePos<=.28;
  return{range,body,bodyRatio,closePos,directional,nearExtreme};
}
function microTiming(one,side){
  const x=one.slice(-10);if(x.length<8)return{aligned:false,type:'WAIT'};
  const last=x.at(-1),prev=x.slice(-7,-1);
  const hi=Math.max(...prev.map(c=>c.high)),lo=Math.min(...prev.map(c=>c.low));
  const q=candleQuality(last,side);
  if(side==='BUY'){
    const aligned=(last.close>hi)||(q.directional&&q.bodyRatio>=.5&&last.close>prev.at(-1).close);
    return{aligned,type:last.close>hi?'1M_BREAK':'1M_BULL_IMPULSE',t:last.t};
  }
  const aligned=(last.close<lo)||(q.directional&&q.bodyRatio>=.5&&last.close<prev.at(-1).close);
  return{aligned,type:last.close<lo?'1M_BREAK':'1M_BEAR_IMPULSE',t:last.t};
}
function strongBreakout(last,prev,levels,stats,volRatio){
  const buf=Math.max(5,stats.medianRange*.10);
  const bull=candleQuality(last,'BUY'),bear=candleQuality(last,'SELL');
  const up=last.close>levels.resistance+buf&&bull.directional&&bull.bodyRatio>=.55&&bull.nearExtreme&&last.close>prev.close;
  const dn=last.close<levels.support-buf&&bear.directional&&bear.bodyRatio>=.55&&bear.nearExtreme&&last.close<prev.close;
  const expansion=last.high-last.low>=stats.medianRange*1.05;
  const activity=volRatio>=1.05||expansion;
  if(up&&activity)return{type:'STRONG_BREAKOUT',side:'BUY',level:levels.resistance,triggerCandle:last,quality:bull};
  if(dn&&activity)return{type:'STRONG_BREAKOUT',side:'SELL',level:levels.support,triggerCandle:last,quality:bear};
  return null;
}
function recentBreakout(rows,side,level,stats){
  const x=rows.slice(-9,-1),buf=Math.max(5,stats.medianRange*.08);
  for(let i=x.length-1;i>=0;i--){
    const c=x[i],q=candleQuality(c,side);
    const ok=side==='BUY'
      ? c.close>level+buf&&q.directional&&q.bodyRatio>=.45
      : c.close<level-buf&&q.directional&&q.bodyRatio>=.45;
    if(ok)return c;
  }
  return null;
}
function breakoutRetest(rows,levels,stats){
  const last=rows.at(-1),tol=Math.max(8,stats.medianRange*.32);
  const buyBreak=recentBreakout(rows,'BUY',levels.resistance,stats);
  if(buyBreak){
    const q=candleQuality(last,'BUY');
    const touched=last.low<=levels.resistance+tol&&last.low>=levels.resistance-tol*1.4;
    const held=last.close>levels.resistance&&q.directional&&q.bodyRatio>=.30;
    const rejection=(last.close-last.low)>=Math.max(.01,last.high-last.low)*.58;
    if(touched&&held&&rejection)return{type:'BREAKOUT_RETEST',side:'BUY',level:levels.resistance,breakoutCandle:buyBreak,triggerCandle:last,quality:q};
  }
  const sellBreak=recentBreakout(rows,'SELL',levels.support,stats);
  if(sellBreak){
    const q=candleQuality(last,'SELL');
    const touched=last.high>=levels.support-tol&&last.high<=levels.support+tol*1.4;
    const held=last.close<levels.support&&q.directional&&q.bodyRatio>=.30;
    const rejection=(last.high-last.close)>=Math.max(.01,last.high-last.low)*.58;
    if(touched&&held&&rejection)return{type:'BREAKOUT_RETEST',side:'SELL',level:levels.support,breakoutCandle:sellBreak,triggerCandle:last,quality:q};
  }
  return null;
}
function falseBreakout(last,levels,stats){
  const buf=Math.max(5,stats.medianRange*.10);
  const range=Math.max(.01,last.high-last.low),body=Math.abs(last.close-last.open);
  const upperWick=last.high-Math.max(last.open,last.close),lowerWick=Math.min(last.open,last.close)-last.low;
  const bullTrap=last.high>levels.resistance+buf*.4&&last.close<levels.resistance&&last.close<last.open&&upperWick>=Math.max(body*.55,range*.18);
  if(bullTrap)return{type:'FALSE_BREAKOUT',side:'SELL',level:levels.resistance,triggerCandle:last,quality:candleQuality(last,'SELL'),trap:'BULL_TRAP'};
  const bearTrap=last.low<levels.support-buf*.4&&last.close>levels.support&&last.close>last.open&&lowerWick>=Math.max(body*.55,range*.18);
  if(bearTrap)return{type:'FALSE_BREAKOUT',side:'BUY',level:levels.support,triggerCandle:last,quality:candleQuality(last,'BUY'),trap:'BEAR_TRAP'};
  return null;
}
function chooseSetup(five,levels,stats,volRatio){
  const last=five.at(-1),prev=five.at(-2);
  return falseBreakout(last,levels,stats)||breakoutRetest(five,levels,stats)||strongBreakout(last,prev,levels,stats,volRatio);
}
function setupScore(setup,volRatio,bias,micro,price,stats){
  let score=setup.type==='BREAKOUT_RETEST'?64:setup.type==='FALSE_BREAKOUT'?62:58;
  const q=setup.quality||{};
  if((q.bodyRatio||0)>=.55)score+=7;else if((q.bodyRatio||0)>=.4)score+=4;
  if(q.nearExtreme)score+=4;
  if(volRatio>=1.35)score+=8;else if(volRatio>=1.10)score+=5;else if(volRatio>=.9)score+=2;
  if((setup.side==='BUY'&&bias.bias==='UP')||(setup.side==='SELL'&&bias.bias==='DOWN'))score+=6;
  else if(bias.bias==='NEUTRAL')score+=2;
  if(micro.aligned)score+=5;
  const dist=Math.abs(price-setup.level),chaseLimit=Math.max(35,stats.medianRange*1.55);
  if(dist<=stats.medianRange*.7)score+=4;
  if(dist>chaseLimit)score-=14;
  return clamp(Math.round(score),20,95);
}
function readinessScore(price,levels,stats,volRatio,bias,five,one){
  const last=five.at(-1);
  const distUp=Math.abs(levels.resistance-price),distDown=Math.abs(price-levels.support);
  let watchSide;
  if(bias.bias==='UP'&&distUp<=distDown*1.35)watchSide='BUY';
  else if(bias.bias==='DOWN'&&distDown<=distUp*1.35)watchSide='SELL';
  else watchSide=distUp<=distDown?'BUY':'SELL';
  const watchLevel=watchSide==='BUY'?levels.resistance:levels.support;
  const distance=Math.abs(price-watchLevel);
  const proximityWindow=Math.max(1,stats.medianRange*2,levels.width*.22);
  const proximity=1-clamp(distance/proximityWindow,0,1);
  const q=candleQuality(last,watchSide),micro=microTiming(one,watchSide);
  let score=20+Math.round(proximity*30);
  if(volRatio>=1.3)score+=14;
  else if(volRatio>=1.0)score+=10;
  else if(volRatio>=.7)score+=6;
  else if(volRatio>=.4)score+=3;
  if((watchSide==='BUY'&&bias.bias==='UP')||(watchSide==='SELL'&&bias.bias==='DOWN'))score+=10;
  else if(bias.bias==='NEUTRAL')score+=4;
  if(q.directional)score+=5;
  if(q.bodyRatio>=.55)score+=4;
  if(q.nearExtreme)score+=3;
  if(micro.aligned)score+=6;
  score=clamp(Math.round(score),20,69);
  return{
    score,watchSide,watchLevel:round(watchLevel),distance:round(distance),
    proximityPct:round(proximity*100,0),micro,
    components:{
      volumeRatio:round(volRatio,2),
      bias:bias.bias,
      directional:q.directional,
      bodyRatio:round(q.bodyRatio,2),
      nearExtreme:q.nearExtreme,
      oneMinuteAligned:Boolean(micro.aligned)
    }
  };
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
function makeTargets(side,entry,stop,stats,levels){
  const risk=Math.abs(entry-stop),dir=side==='BUY'?1:-1,minStep=Math.max(25,stats.medianRange*.55),out=[],labels=[];
  const add=(p,label)=>{if(Number.isFinite(p)&&(side==='BUY'?p>entry+minStep*.35:p<entry-minStep*.35)&&!out.some(x=>Math.abs(x-p)<minStep*.25)){out.push(round(p));labels.push(label);}};
  if(side==='BUY'&&levels.resistance>entry)add(levels.resistance,'STRUCTURE');
  if(side==='SELL'&&levels.support<entry)add(levels.support,'STRUCTURE');
  for(const [m,label] of [[.8,'0.8R'],[1.25,'1.25R'],[1.8,'1.8R'],[2.5,'2.5R']])add(entry+dir*Math.max(minStep,risk*m),label);
  let i=1;
  while(out.length<4&&i<=8){add(entry+dir*Math.max(minStep*i,risk*(.8+i*.45)),'TP'+(out.length+1));i++;}
  return{targets:out.slice(0,4),labels:labels.slice(0,4)};
}
function analyze(data){
  const one=data.one,five=data.five,fifteen=data.fifteen,hour=data.hour,ticker=data.ticker||{};
  if(one.length<80||five.length<80||fifteen.length<80||hour.length<80)throw new Error('BTC history incomplete');
  const price=Number(ticker.price??one.at(-1).close),levels5=robustLevels(five,42,4),levels15=robustLevels(fifteen,36,3);
  if(!levels5||!levels15)throw new Error('BTC price-action levels unavailable');
  const stats5=candleStats(five,30),v=volumeStats(five,24),volRatio=v.avg>0?(five.at(-1).volume/v.avg):1,bias=contextBias(hour,fifteen);
  const readiness=readinessScore(price,levels5,stats5,volRatio,bias,five,one);
  const setup=chooseSetup(five,levels5,stats5,volRatio);
  const breakout={
    version:'BTC_BREAKOUT_V2_READINESS',
    model:'PRICE_ACTION_BREAKOUT',
    levels5,levels15,bias,
    readiness,
    micro:readiness.micro,
    candle:{medianRange:round(stats5.medianRange),lastRange:round(five.at(-1).high-five.at(-1).low)},
    volume:{last5m:round(five.at(-1).volume,4),average5m:round(v.avg,4),ratio:round(volRatio,2)},
    setup:setup?{type:setup.type,side:setup.side,level:round(setup.level),trap:setup.trap||null,triggerTime:new Date(setup.triggerCandle.t).toISOString()}:null
  };
  const base={
    symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'BREAKOUT_ENGINE',tradeStyle:'PRICE_ACTION_BREAKOUT',
    confidence:readiness.score,readinessScore:readiness.score,watchSide:readiness.watchSide,watchLevel:readiness.watchLevel,contextStrength:readiness.score,minimumConfidence:BTC_MIN_CONFIDENCE,scoreMeaning:'READINESS_SCORE_NOT_WIN_PROBABILITY',
    price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,lotSizing:null,
    executionMode:'SIGNALS_ONLY',trend:'15m '+bias.bias+' / 5m breakout classification',breakout,updatedAt:new Date().toISOString(),
    reason:'BREAKOUT WAIT — readiness '+readiness.score+'/100 toward '+readiness.watchSide+' at '+readiness.watchLevel+'.'
  };
  if(!setup)return{...base,reason:'BREAKOUT WAIT — readiness '+readiness.score+'/100 toward '+readiness.watchSide+' at '+readiness.watchLevel+'; waiting for a CLOSED 5m strong breakout, retest, or false-breakout trigger.'};

  const micro=microTiming(one,setup.side),confidence=setupScore(setup,volRatio,bias,micro,price,stats5);
  breakout.micro=micro;
  const dist=Math.abs(price-setup.level),chaseLimit=Math.max(35,stats5.medianRange*1.55);
  if(setup.type==='STRONG_BREAKOUT'&&dist>chaseLimit){
    return{...base,confidence:Math.min(confidence,69),contextStrength:confidence,breakout,reason:'BREAKOUT WAIT — strong breakout confirmed but price is already extended; waiting for retest instead of chasing.'};
  }
  if(confidence<BTC_MIN_CONFIDENCE){
    return{...base,confidence,contextStrength:confidence,breakout,reason:'BREAKOUT WAIT — '+setup.type+' detected, but setup strength '+confidence+'/100 is below '+BTC_MIN_CONFIDENCE+'/100.'};
  }

  const c=setup.triggerCandle,buffer=Math.max(10,stats5.medianRange*.16);
  let stop;
  if(setup.side==='BUY'){
    if(setup.type==='FALSE_BREAKOUT')stop=c.low-buffer;
    else stop=Math.min(c.low,setup.level-buffer);
  }else{
    if(setup.type==='FALSE_BREAKOUT')stop=c.high+buffer;
    else stop=Math.max(c.high,setup.level+buffer);
  }
  let risk=Math.abs(price-stop),minRisk=Math.max(30,stats5.medianRange*.38),maxRisk=Math.max(180,stats5.medianRange*2.8);
  if(risk<minRisk){stop=setup.side==='BUY'?price-minRisk:price+minRisk;risk=minRisk;}
  if(risk>maxRisk){
    return{...base,confidence:Math.min(confidence,74),contextStrength:confidence,breakout,reason:'BREAKOUT WAIT — '+setup.type+' confirmed, but structural stop is too wide ('+round(risk)+').'};
  }

  const t=makeTargets(setup.side,price,stop,stats5,levels15),rr=t.targets[0]?Math.abs(t.targets[0]-price)/risk:null,half=Math.max(8,Math.min(45,stats5.medianRange*.18));
  const human=setup.type==='STRONG_BREAKOUT'?'STRONG BREAKOUT':setup.type==='BREAKOUT_RETEST'?'BREAKOUT + RETEST':'FALSE BREAKOUT REVERSAL';
  return{
    ...base,status:'ACTIVE',action:setup.side,side:setup.side,confidence,contextStrength:confidence,
    entry:round(price),entryLow:round(price-half),entryHigh:round(price+half),stopLoss:round(stop),
    target1:t.targets[0]??null,target2:t.targets[1]??null,target3:t.targets[2]??null,target4:t.targets[3]??null,targetLabels:t.labels,
    riskReward:rr==null?null:round(rr,2),lotSizing:lotSizing(price,stop),breakout,
    reason:human+' '+setup.side+' — 5m close confirmed at '+round(setup.level)+'; volume '+round(volRatio,2)+'x; 15m bias '+bias.bias+(micro.aligned?'; 1m timing aligned':'')+'; strength '+confidence+'/100.'
  };
}
async function freshCandidate(force=false){
  if(!force&&cache.value&&Date.now()<cache.expiresAt)return cache.value;
  const [one,five,fifteen,hour,ticker]=await Promise.all([coinbaseCandles(60),coinbaseCandles(300),coinbaseCandles(900),coinbaseCandles(3600),coinbaseTicker()]);
  const value=analyze({one,five,fifteen,hour,ticker});cache.value=value;cache.expiresAt=Date.now()+BTC_CACHE_MS;return value;
}
function reached(side,price,target){return Number.isFinite(Number(target))&&(side==='BUY'?price>=target:price<=target);}
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
    lifecycle.signal={...candidate,signalId:'BTC-BO-'+now,issuedAtMs:now,targetHits:[false,false,false,false],lockedTargets:true};
    return{...lifecycle.signal,terminalEvent:lifecycle.lastTerminal};
  }
  return{...candidate,status:'WAIT',action:'WAIT',entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,signalId:null,terminalEvent:lifecycle.lastTerminal,cooldownRemainingMs:Math.max(0,lifecycle.cooldownUntil-now)};
}
export async function getBtcSignal(force=false){return lifecycleSignal(await freshCandidate(force));}

export function injectBtcPanel(html){
  if(html.includes('btcBreakoutPanel'))return html;
  const css='<style>#btcBreakoutPanel{max-width:1280px;margin:16px auto 28px;padding:16px;border:1px solid #315d73;border-radius:18px;background:linear-gradient(145deg,#0d1720,#0b111b);direction:rtl;color:#eef2f7}#btcBreakoutPanel h2{margin:0;color:#68d3ff;font-size:20px}.btcBoTag{display:inline-block;margin-right:8px;padding:5px 8px;border:1px solid #315d73;border-radius:999px;color:#8ee1ff;font-size:11px}.btcBoGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}.btcBoCard{padding:10px;border:1px solid #343b48;border-radius:11px;background:#0c121d}.btcBoCard span{display:block;color:#95a1b4;font-size:10px}.btcBoCard strong{display:block;margin-top:5px;font-size:15px;direction:ltr;text-align:right}.btcBoBuy{color:#52e5a5}.btcBoSell{color:#ff718c}.btcBoWait{color:#ffd166}.btcBoNote{margin-top:10px;color:#a6b4c5;font-size:11px;line-height:1.7}@media(max-width:900px){.btcBoGrid{grid-template-columns:repeat(2,1fr)}}</style>';
  const panel='<section id="btcBreakoutPanel"><div><h2>BTCUSD — BREAKOUT ENGINE <span class="btcBoTag">15m Context • CLOSED 5m Confirmation • Price Action + Volume</span></h2><p id="btcBoMeta" class="btcBoNote">جارٍ تحميل قراءة الاختراق…</p></div><div class="btcBoGrid"><div class="btcBoCard"><span>الحالة</span><strong id="btcBoState">WAIT</strong></div><div class="btcBoCard"><span>Readiness / قوة الإعداد</span><strong id="btcBoConfidence">—</strong></div><div class="btcBoCard"><span>نوع الاختراق</span><strong id="btcBoType">—</strong></div><div class="btcBoCard"><span>15m Bias</span><strong id="btcBoBias">—</strong></div><div class="btcBoCard"><span>Break Level</span><strong id="btcBoLevel">—</strong></div><div class="btcBoCard"><span>5m Volume</span><strong id="btcBoVolume">—</strong></div><div class="btcBoCard"><span>1m Timing</span><strong id="btcBoMicro">—</strong></div><div class="btcBoCard"><span>5m Range</span><strong id="btcBoRange">—</strong></div><div class="btcBoCard"><span>السعر</span><strong id="btcBoPrice">—</strong></div><div class="btcBoCard"><span>الدخول</span><strong id="btcBoEntry">—</strong></div><div class="btcBoCard"><span>وقف الخسارة</span><strong id="btcBoStop">—</strong></div><div class="btcBoCard"><span>TP1</span><strong id="btcBoTp1">—</strong></div><div class="btcBoCard"><span>TP2</span><strong id="btcBoTp2">—</strong></div><div class="btcBoCard"><span>TP3</span><strong id="btcBoTp3">—</strong></div><div class="btcBoCard"><span>TP4</span><strong id="btcBoTp4">—</strong></div><div class="btcBoCard"><span>اللوت المقترح</span><strong id="btcBoLot">—</strong></div><div class="btcBoCard"><span>الاستراتيجية</span><strong>BREAKOUT PA</strong></div></div><p id="btcBoReason" class="btcBoNote">BTC فقط: Strong Breakout / Breakout + Retest / False Breakout. لا دخول قبل إغلاق شمعة 5 دقائق.</p></section>';
  const js='<script id="btcBreakoutClient">(function(){const el=id=>document.getElementById(id),money=v=>v==null?"—":"$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2});async function run(){try{const r=await fetch("/api/btc-signal?_="+Date.now(),{cache:"no-store"}),d=await r.json(),b=d.breakout||{},s=b.setup||{},lv=b.levels5||{},active=d.status==="ACTIVE"&&["BUY","SELL"].includes(d.action);const state=el("btcBoState");state.textContent=active?(d.action==="BUY"?"شراء":"بيع"):"WAIT";state.className=active?(d.action==="BUY"?"btcBoBuy":"btcBoSell"):"btcBoWait";el("btcBoConfidence").textContent=Math.round(Number(active?d.confidence:(d.readinessScore??d.confidence))||0)+"/100"+(active?" • SETUP":" • READY");el("btcBoType").textContent=s.type?String(s.type).replaceAll("_"," "):("WATCH "+(d.watchSide||b.readiness?.watchSide||"—"));el("btcBoBias").textContent=b.bias?.bias||"—";el("btcBoLevel").textContent=s.level!=null?money(s.level):(d.watchLevel!=null?money(d.watchLevel):(b.readiness?.watchLevel!=null?money(b.readiness.watchLevel):"—"));el("btcBoVolume").textContent=b.volume?.ratio!=null?Number(b.volume.ratio).toFixed(2)+"x":"—";el("btcBoMicro").textContent=b.micro?.aligned?b.micro.type:"WAIT";el("btcBoRange").textContent=lv.support!=null?money(lv.support)+" – "+money(lv.resistance):"—";el("btcBoPrice").textContent=money(d.price);el("btcBoEntry").textContent=active?money(d.entry):"—";el("btcBoStop").textContent=active?money(d.stopLoss):"—";for(let i=1;i<=4;i++)el("btcBoTp"+i).textContent=active?money(d["target"+i]):"—";el("btcBoLot").textContent=active&&Number(d.lotSizing?.recommendedLot)>0?Number(d.lotSizing.recommendedLot).toFixed(2)+" lot":"—";el("btcBoReason").textContent=d.reason||"—";el("btcBoMeta").textContent="BTC-USD • Breakout experiment • تحديث كل 5 ثوانٍ • "+new Date(d.updatedAt||Date.now()).toLocaleTimeString("ar-SA",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch(e){el("btcBoMeta").textContent="تعذر تحميل BTC الآن";}setTimeout(run,5000)}run()})();</script>';
  return html.replace('</head>',css+'</head>').replace('</body>',panel+js+'</body>');
}
