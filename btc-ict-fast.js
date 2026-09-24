const BTC_MIN_CONFIDENCE=Math.max(65,Math.min(90,Number(process.env.BTC_MIN_CONFIDENCE||70)||70));
const BTC_CACHE_MS=Math.max(5000,Math.min(30000,Number(process.env.BTC_CACHE_MS||12000)||12000));
const BTC_CONTRACT_SIZE=Math.max(.000001,Number(process.env.EXNESS_BTC_CONTRACT_SIZE||1));
const BTC_LOT_STEP=Math.max(.001,Number(process.env.EXNESS_BTC_LOT_STEP||.01));
const BTC_SAFE_RISK_USD=Math.max(1,Number(process.env.BTC_SAFE_RISK_USD||5));
const BTC_MAX_RISK_USD=Math.max(BTC_SAFE_RISK_USD,Number(process.env.BTC_MAX_RISK_USD||10));
const cache={expiresAt:0,value:null};
const lifecycle={signal:null,lastTerminal:null,cooldownUntil:0};

const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=2)=>{const x=num(v);return x==null?null:Number(x.toFixed(d))};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

async function coinbaseCandles(granularity){
  const url=new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
  url.searchParams.set('granularity',String(granularity));
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Gold-Alpha-BTC-ICT-Fast/1.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok||!Array.isArray(rows))throw new Error('Coinbase candles unavailable '+r.status);
  const now=Date.now(),span=granularity*1000;
  return rows.map(x=>({t:Number(x[0])*1000,low:Number(x[1]),high:Number(x[2]),open:Number(x[3]),close:Number(x[4]),volume:Number(x[5]||0)}))
    .filter(x=>Number.isFinite(x.close)&&x.t+span<=now+1000).sort((a,b)=>a.t-b.t);
}
function ema(values,period){
  if(!Array.isArray(values)||values.length<period)return null;
  const k=2/(period+1);let e=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<values.length;i++)e=values[i]*k+e*(1-k);
  return e;
}
function rsi(values,period=14){
  if(values.length<period+1)return null;let gain=0,loss=0;
  for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>0)gain+=d;else loss-=d;}
  if(loss===0)return 100;const rs=(gain/period)/(loss/period);return 100-(100/(1+rs));
}
function atr(rows,period=14){
  if(rows.length<period+1)return null;let sum=0;
  for(let i=rows.length-period;i<rows.length;i++){const c=rows[i],p=rows[i-1];sum+=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));}
  return sum/period;
}
function trend(rows){
  const closes=rows.map(x=>x.close),e20=ema(closes,20),e50=ema(closes,50),last=closes.at(-1);
  if(last==null||e20==null||e50==null)return'NEUTRAL';
  if(last>e20&&e20>e50)return'BULLISH';
  if(last<e20&&e20<e50)return'BEARISH';
  return'NEUTRAL';
}
function triggerState(rows){
  if(rows.length<20)return{bullMss:false,bearMss:false,bullDisp:false,bearDisp:false,sweepLow:false,sweepHigh:false};
  const last=rows.at(-1),prev=rows.slice(-9,-1),priorHigh=Math.max(...prev.map(x=>x.high)),priorLow=Math.min(...prev.map(x=>x.low)),a=atr(rows,14)||Math.max(1,last.close*.0005),body=Math.abs(last.close-last.open);
  return{
    bullMss:last.close>priorHigh,bearMss:last.close<priorLow,
    bullDisp:last.close>last.open&&body>=a*.75&&last.close>prev.at(-1).high,
    bearDisp:last.close<last.open&&body>=a*.75&&last.close<prev.at(-1).low,
    sweepLow:last.low<priorLow&&last.close>priorLow,
    sweepHigh:last.high>priorHigh&&last.close<priorHigh
  };
}
function fvg(rows){
  if(rows.length<3)return{bull:false,bear:false};
  const a=rows.at(-3),c=rows.at(-1);
  return{bull:c.low>a.high,bear:c.high<a.low};
}
function recentSwing(rows,side,count=10){
  const x=rows.slice(-Math.max(4,count));
  return side==='BUY'?Math.min(...x.map(v=>v.low)):Math.max(...x.map(v=>v.high));
}
function lotForRisk(entry,stop,riskUsd){
  const distance=Math.abs(Number(entry)-Number(stop));if(!(distance>0))return 0;
  const raw=riskUsd/(distance*BTC_CONTRACT_SIZE),steps=Math.floor((raw+1e-12)/BTC_LOT_STEP);
  return steps>0?Number((steps*BTC_LOT_STEP).toFixed(3)):0;
}
function lotSizing(entry,stop){
  const distance=Math.abs(Number(entry)-Number(stop)),safeLot=lotForRisk(entry,stop,BTC_SAFE_RISK_USD),maxLot=lotForRisk(entry,stop,BTC_MAX_RISK_USD),recommendedLot=safeLot>0?safeLot:(maxLot>0?BTC_LOT_STEP:0);
  return{recommendedLot,maxLot,stopDistance:round(distance,2),actualRiskUsd:recommendedLot>0?round(distance*BTC_CONTRACT_SIZE*recommendedLot,2):null,safeRiskUsd:BTC_SAFE_RISK_USD,maxRiskUsd:BTC_MAX_RISK_USD};
}
function analyze(data){
  const one=data.one,five=data.five,fifteen=data.fifteen,hour=data.hour;
  if(one.length<30||five.length<30||fifteen.length<50||hour.length<50)throw new Error('BTC history incomplete');
  const price=one.at(-1).close,ctx15=trend(fifteen),ctx1h=trend(hour),t1=triggerState(one),t5=triggerState(five),f1=fvg(one),f5=fvg(five),r5=rsi(five.map(x=>x.close),14),a1=atr(one,14)||price*.0006,a5=atr(five,14)||price*.0012;
  const bullMss=t1.bullMss||t5.bullMss,bearMss=t1.bearMss||t5.bearMss,bullDisp=t1.bullDisp||t5.bullDisp,bearDisp=t1.bearDisp||t5.bearDisp,bullFvg=f1.bull||f5.bull,bearFvg=f1.bear||f5.bear,sweepLow=t1.sweepLow||t5.sweepLow,sweepHigh=t1.sweepHigh||t5.sweepHigh;
  const bullTrigger=(bullMss&&(bullFvg||bullDisp))||(sweepLow&&bullDisp);
  const bearTrigger=(bearMss&&(bearFvg||bearDisp))||(sweepHigh&&bearDisp);
  let side=null;
  if(ctx15==='BULLISH'&&bullTrigger)side='BUY';
  else if(ctx15==='BEARISH'&&bearTrigger)side='SELL';
  else if(ctx15==='NEUTRAL'&&ctx1h==='BULLISH'&&bullTrigger)side='BUY';
  else if(ctx15==='NEUTRAL'&&ctx1h==='BEARISH'&&bearTrigger)side='SELL';

  let confidence=0;
  if(side){
    const up=side==='BUY';
    confidence=50;
    if((up&&ctx15==='BULLISH')||(!up&&ctx15==='BEARISH'))confidence+=16;
    if((up&&ctx1h==='BULLISH')||(!up&&ctx1h==='BEARISH'))confidence+=7;
    if(up?bullMss:bearMss)confidence+=10;
    if(up?bullFvg:bearFvg)confidence+=8;
    if(up?bullDisp:bearDisp)confidence+=7;
    if(up?sweepLow:sweepHigh)confidence+=4;
    if(r5!=null&&((up&&r5>=51)||(!up&&r5<=49)))confidence+=4;
  }
  confidence=clamp(Math.round(confidence),0,95);
  const active=Boolean(side&&confidence>=BTC_MIN_CONFIDENCE);
  if(!active){
    const direction=ctx15==='BULLISH'?'BUY':ctx15==='BEARISH'?'SELL':null;
    const missing=ctx15==='NEUTRAL'?'15m context not clear':direction==='BUY'&&!bullTrigger?'waiting 1m/5m bullish MSS + FVG/displacement':direction==='SELL'&&!bearTrigger?'waiting 1m/5m bearish MSS + FVG/displacement':confidence<BTC_MIN_CONFIDENCE?'setup score below minimum':'waiting ICT fast trigger';
    return{status:'WAIT',action:'WAIT',price:round(price,2),confidence,minimumConfidence:BTC_MIN_CONFIDENCE,strategy:'ICT_FAST_SCALP',trend:'15m '+ctx15+' / 1h '+ctx1h,reason:'ICT FAST WAIT — '+missing,ict:{context15:ctx15,trend1h:ctx1h,rsi5:round(r5,1),fvg1:f1,fvg5:f5,mss1:{bull:t1.bullMss,bear:t1.bearMss},mss5:{bull:t5.bullMss,bear:t5.bearMss},displacement1:{bull:t1.bullDisp,bear:t1.bearDisp},displacement5:{bull:t5.bullDisp,bear:t5.bearDisp},sweepLow,sweepHigh},updatedAt:new Date(one.at(-1).t).toISOString()};
  }

  const sign=side==='BUY'?1:-1,swing1=recentSwing(one,side,12),swing5=recentSwing(five,side,8),baseSwing=side==='BUY'?Math.min(swing1,swing5):Math.max(swing1,swing5),buffer=Math.max(a1*.35,price*.00018),stop=side==='BUY'?baseSwing-buffer:baseSwing+buffer,risk=Math.abs(price-stop);
  const tp1Dist=Math.max(a1*.9,a5*.32,risk*.60,price*.0008),tp2Dist=Math.max(a1*1.5,a5*.55,risk*1.00,tp1Dist*1.45),tp3Dist=Math.max(a1*2.2,a5*.80,risk*1.50,tp2Dist*1.30),tp4Dist=Math.max(a1*3.0,a5*1.10,risk*2.00,tp3Dist*1.25);
  const sizing=lotSizing(price,stop);
  return{
    status:'ACTIVE',action:side,price:round(price,2),entry:round(price,2),stopLoss:round(stop,2),
    target1:round(price+sign*tp1Dist,2),target2:round(price+sign*tp2Dist,2),target3:round(price+sign*tp3Dist,2),target4:round(price+sign*tp4Dist,2),
    confidence,minimumConfidence:BTC_MIN_CONFIDENCE,strategy:'ICT_FAST_SCALP',tradeStyle:'ICT_FAST_SCALP',trend:'15m '+ctx15+' / 1h '+ctx1h,lotSizing:sizing,
    reason:'ICT FAST CONFIRMED — 15m context + 1m/5m MSS/displacement + FVG/liquidity trigger',
    ict:{context15:ctx15,trend1h:ctx1h,rsi5:round(r5,1),fvg1:f1,fvg5:f5,mss1:{bull:t1.bullMss,bear:t1.bearMss},mss5:{bull:t5.bullMss,bear:t5.bearMss},displacement1:{bull:t1.bullDisp,bear:t1.bearDisp},displacement5:{bull:t5.bullDisp,bear:t5.bearDisp},sweepLow,sweepHigh,atr1:round(a1,2),atr5:round(a5,2)},
    updatedAt:new Date(one.at(-1).t).toISOString()
  };
}
async function freshCandidate(force=false){
  if(!force&&cache.value&&Date.now()<cache.expiresAt)return cache.value;
  const [one,five,fifteen,hour]=await Promise.all([coinbaseCandles(60),coinbaseCandles(300),coinbaseCandles(900),coinbaseCandles(3600)]);
  const value=analyze({one,five,fifteen,hour});cache.value=value;cache.expiresAt=Date.now()+BTC_CACHE_MS;return value;
}
function reached(side,price,target){return side==='BUY'?price>=target:price<=target;}
function lifecycleSignal(candidate,now=Date.now()){
  const price=Number(candidate.price);
  if(lifecycle.signal){
    const s=lifecycle.signal;
    const stopHit=s.action==='BUY'?price<=s.stopLoss:price>=s.stopLoss;
    if(stopHit){
      lifecycle.lastTerminal={type:'SL',side:s.action,price:round(price,2),at:new Date(now).toISOString(),signalId:s.signalId};
      lifecycle.signal=null;lifecycle.cooldownUntil=now+60000;
    }else{
      s.price=round(price,2);s.updatedAt=candidate.updatedAt;s.targetHits=[s.target1,s.target2,s.target3,s.target4].map(t=>reached(s.action,price,t));
      if(s.targetHits.every(Boolean)){lifecycle.lastTerminal={type:'TP4',side:s.action,price:round(price,2),at:new Date(now).toISOString(),signalId:s.signalId};lifecycle.signal=null;lifecycle.cooldownUntil=now+60000;}
      else return{...s,status:'ACTIVE',lockedTargets:true,terminalEvent:lifecycle.lastTerminal};
    }
  }
  if(now>=lifecycle.cooldownUntil&&candidate.status==='ACTIVE'){
    lifecycle.signal={...candidate,signalId:'BTC-'+now,issuedAtMs:now,targetHits:[false,false,false,false],lockedTargets:true};
    return{...lifecycle.signal,terminalEvent:lifecycle.lastTerminal};
  }
  return{...candidate,status:'WAIT',action:'WAIT',entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,signalId:null,terminalEvent:lifecycle.lastTerminal,cooldownRemainingMs:Math.max(0,lifecycle.cooldownUntil-now)};
}
export async function getBtcSignal(force=false){
  const candidate=await freshCandidate(force);
  return lifecycleSignal(candidate);
}

export function injectBtcPanel(html){
  if(html.includes('btcIctFastPanel'))return html;
  const css='<style>#btcIctFastPanel{max-width:1280px;margin:16px auto 28px;padding:16px;border:1px solid #5f4724;border-radius:18px;background:linear-gradient(145deg,#17130d,#0b111b);direction:rtl;color:#eef2f7}#btcIctFastPanel h2{margin:0;color:#f2bd63;font-size:20px}.btcFastTag{display:inline-block;margin-right:8px;padding:5px 8px;border:1px solid #6d4b24;border-radius:999px;color:#ffc56e;font-size:11px}.btcFastGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}.btcFastCard{padding:10px;border:1px solid #343b48;border-radius:11px;background:#0c121d}.btcFastCard span{display:block;color:#95a1b4;font-size:10px}.btcFastCard strong{display:block;margin-top:5px;font-size:15px;direction:ltr;text-align:right}.btcFastBuy{color:#52e5a5}.btcFastSell{color:#ff718c}.btcFastWait{color:#ffd166}.btcFastNote{margin-top:10px;color:#a79a84;font-size:11px;line-height:1.7}@media(max-width:900px){.btcFastGrid{grid-template-columns:repeat(2,1fr)}}</style>';
  const panel='<section id="btcIctFastPanel"><div><h2>BTCUSD — ICT FAST SCALP <span class="btcFastTag">15m Context • 1m/5m Trigger</span></h2><p id="btcFastMeta" class="btcFastNote">جارٍ تحميل قراءة البيتكوين…</p></div><div class="btcFastGrid"><div class="btcFastCard"><span>الحالة</span><strong id="btcFastState">WAIT</strong></div><div class="btcFastCard"><span>الثقة</span><strong id="btcFastConfidence">—</strong></div><div class="btcFastCard"><span>السعر</span><strong id="btcFastPrice">—</strong></div><div class="btcFastCard"><span>15m Context</span><strong id="btcFastContext">—</strong></div><div class="btcFastCard"><span>1h Trend</span><strong id="btcFastTrend">—</strong></div><div class="btcFastCard"><span>الدخول</span><strong id="btcFastEntry">—</strong></div><div class="btcFastCard"><span>وقف الخسارة</span><strong id="btcFastStop">—</strong></div><div class="btcFastCard"><span>TP1</span><strong id="btcFastTp1">—</strong></div><div class="btcFastCard"><span>TP2</span><strong id="btcFastTp2">—</strong></div><div class="btcFastCard"><span>TP3</span><strong id="btcFastTp3">—</strong></div><div class="btcFastCard"><span>TP4</span><strong id="btcFastTp4">—</strong></div><div class="btcFastCard"><span>اللوت المقترح</span><strong id="btcFastLot">—</strong></div><div class="btcFastCard"><span>RSI 5m</span><strong id="btcFastRsi">—</strong></div><div class="btcFastCard"><span>FVG</span><strong id="btcFastFvg">—</strong></div><div class="btcFastCard"><span>MSS / Displacement</span><strong id="btcFastTrigger">—</strong></div></div><p id="btcFastReason" class="btcFastNote">ICT سريع: 15m يحدد السياق، و1m/5m للتنفيذ. الأهداف ثابتة بعد تفعيل الإشارة.</p></section>';
  const js='<script id="btcIctFastClient">(function(){const el=id=>document.getElementById(id),money=v=>v==null?"—":"$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2});async function run(){try{const r=await fetch("/api/btc-signal?_="+Date.now(),{cache:"no-store"}),d=await r.json(),ict=d.ict||{},active=d.status==="ACTIVE"&&["BUY","SELL"].includes(d.action);const state=el("btcFastState");state.textContent=active?(d.action==="BUY"?"شراء":"بيع"):"WAIT";state.className=active?(d.action==="BUY"?"btcFastBuy":"btcFastSell"):"btcFastWait";el("btcFastConfidence").textContent=Math.round(Number(d.confidence)||0)+"/100";el("btcFastPrice").textContent=money(d.price);el("btcFastContext").textContent=ict.context15||"—";el("btcFastTrend").textContent=ict.trend1h||"—";el("btcFastEntry").textContent=active?money(d.entry):"—";el("btcFastStop").textContent=active?money(d.stopLoss):"—";for(let i=1;i<=4;i++)el("btcFastTp"+i).textContent=active?money(d["target"+i]):"—";el("btcFastLot").textContent=active&&Number(d.lotSizing?.recommendedLot)>0?Number(d.lotSizing.recommendedLot).toFixed(2)+" lot":"—";el("btcFastRsi").textContent=ict.rsi5??"—";el("btcFastFvg").textContent=(ict.fvg1?.bull||ict.fvg5?.bull?"Bull ":"")+(ict.fvg1?.bear||ict.fvg5?.bear?"Bear":"")||"—";const bull=ict.mss1?.bull||ict.mss5?.bull||ict.displacement1?.bull||ict.displacement5?.bull,bear=ict.mss1?.bear||ict.mss5?.bear||ict.displacement1?.bear||ict.displacement5?.bear;el("btcFastTrigger").textContent=bull?"Bull ready":bear?"Bear ready":"WAIT";el("btcFastReason").textContent=d.reason||"—";el("btcFastMeta").textContent="BTC-USD • تحديث كل 5 ثوانٍ • "+(active?"إشارة مقفلة":"بحث عن ICT Fast")+" • "+new Date(d.updatedAt||Date.now()).toLocaleTimeString("ar-SA",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch(e){el("btcFastMeta").textContent="تعذر تحميل BTC الآن";}setTimeout(run,5000)}run()})();</script>';
  return html.replace('</head>',css+'</head>').replace('</body>',panel+js+'</body>');
}
