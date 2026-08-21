import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const downstreamWriteFileSync = fs.writeFileSync.bind(fs);

fs.writeFileSync = function ictFirstWriteFileSync(path, data, ...args) {
  const p = String(path);
  let out = data;
  if (p.endsWith('/.runtime-server.mjs') || p.endsWith('\\.runtime-server.mjs')) {
    const isBuffer = Buffer.isBuffer(data);
    let source = isBuffer ? data.toString('utf8') : String(data);

    // Add factual ICT-first fields without changing the market data source.
    source = source.replace(
      '<div><span>ICT Confirmation</span><strong id="ictConfirmationState">NOT CONFIRMED</strong></div><div><span>Execution</span><strong id="ictExecutionState">WAITING</strong></div>',
      '<div><span>ICT Confirmation</span><strong id="ictConfirmationState">NOT CONFIRMED</strong></div><div><span>HTF Bias</span><strong id="ictBiasState">PENDING</strong></div><div><span>Kill Zone</span><strong id="ictKillZoneState">OUTSIDE</strong></div><div><span>Execution</span><strong id="ictExecutionState">WAITING</strong></div>'
    );
    source = source.replace(
      'grid-template-columns:repeat(4,1fr)',
      'grid-template-columns:repeat(3,1fr)'
    );

    const renderAnchor = 'function renderGoldPlan(plan){';
    if (source.includes(renderAnchor)) {
      const ictFirst = `function ictFiveMinuteCandles(samples,now=Date.now()){const rows=(samples||[]).map(x=>({t:Number(x.t),price:Number(x.price)})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.price)&&x.price>0&&x.t<=now&&x.t>=now-8*60*60_000).sort((a,b)=>a.t-b.t),buckets=new Map();for(const r of rows){const key=Math.floor(r.t/300000)*300000;let c=buckets.get(key);if(!c){c={t:key,open:r.price,high:r.price,low:r.price,close:r.price};buckets.set(key,c)}else{c.high=Math.max(c.high,r.price);c.low=Math.min(c.low,r.price);c.close=r.price}}return[...buckets.values()].sort((a,b)=>a.t-b.t)}
function ictHourlyCandles(samples,now=Date.now()){const rows=(samples||[]).map(x=>({t:Number(x.t),price:Number(x.price)})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.price)&&x.price>0&&x.t<=now&&x.t>=now-12*60*60_000).sort((a,b)=>a.t-b.t),buckets=new Map();for(const r of rows){const key=Math.floor(r.t/3600000)*3600000;let c=buckets.get(key);if(!c){c={t:key,open:r.price,high:r.price,low:r.price,close:r.price};buckets.set(key,c)}else{c.high=Math.max(c.high,r.price);c.low=Math.min(c.low,r.price);c.close=r.price}}return[...buckets.values()].sort((a,b)=>a.t-b.t)}
function ictKillZone(now=Date.now()){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(now)),v=Object.fromEntries(parts.map(x=>[x.type,x.value])),m=(Number(v.hour)%24)*60+Number(v.minute||0);if(m>=120&&m<300)return'LONDON';if(m>=420&&m<600)return'NEW YORK AM';return'OUTSIDE'}
function ictFirstState(samples,price,now=Date.now()){const c=ictFiveMinuteCandles(samples,now),h=ictHourlyCandles(samples,now),liq=typeof ictLiquidityFromSamples==='function'?ictLiquidityFromSamples(samples,now):{pdh:null,pdl:null,asiaHigh:null,asiaLow:null},liquidityReady=[liq.pdh,liq.pdl,liq.asiaHigh,liq.asiaLow].filter(Number.isFinite).length>=2;let bias='PENDING';if(h.length>=3){const a=h.at(-3),b=h.at(-2),z=h.at(-1);if(z.close>b.high||z.close>b.close&&b.close>a.close)bias='BULLISH';else if(z.close<b.low||z.close<b.close&&b.close<a.close)bias='BEARISH';else bias='NEUTRAL'}let sweepBull=false,sweepBear=false,mssBull=false,mssBear=false,fvgBull=false,fvgBear=false;if(c.length>=9){for(let i=Math.max(6,c.length-5);i<c.length;i++){const prior=c.slice(i-6,i),hi=Math.max(...prior.map(x=>x.high)),lo=Math.min(...prior.map(x=>x.low)),bar=c[i];if(bar.low<lo&&bar.close>lo)sweepBull=true;if(bar.high>hi&&bar.close<hi)sweepBear=true}const last=c.at(-1),prior6=c.slice(-7,-1),hi=Math.max(...prior6.map(x=>x.high)),lo=Math.min(...prior6.map(x=>x.low));mssBull=sweepBull&&last.close>hi;mssBear=sweepBear&&last.close<lo;const a=c.at(-3),z=c.at(-1);fvgBull=z.low>a.high;fvgBear=z.high<a.low}const bullConfirm=sweepBull&&mssBull&&(fvgBull||bias==='BULLISH'),bearConfirm=sweepBear&&mssBear&&(fvgBear||bias==='BEARISH'),killZone=ictKillZone(now),direction=bullConfirm?'UP':bearConfirm?'DOWN':null,confirmed=Boolean(direction);return{bias,killZone,liquidityReady,sweepBull,sweepBear,mssBull,mssBear,fvgBull,fvgBear,direction,confirmed,candleCount:c.length,liquidity:liq,price:Number(price)}}
function applyIctFirstPlan(plan,samples,price){const ict=ictFirstState(samples,price),confirmation=document.querySelector('#ictConfirmationState'),biasNode=document.querySelector('#ictBiasState'),killNode=document.querySelector('#ictKillZoneState'),setupNode=document.querySelector('#ictSetupState'),execution=document.querySelector('#ictExecutionState');if(biasNode)biasNode.textContent=ict.bias;if(killNode)killNode.textContent=ict.killZone;if(confirmation)confirmation.textContent=ict.confirmed?(ict.direction==='UP'?'SWEEP + MSS • BULL':'SWEEP + MSS • BEAR'):(ict.candleCount<9?'DATA PENDING':'NOT CONFIRMED');const modelDirection=plan?.state==='UP'?'UP':plan?.state==='DOWN'?'DOWN':null,aligned=ict.confirmed&&modelDirection===ict.direction,sessionOk=ict.killZone!=='OUTSIDE';if(setupNode)setupNode.textContent=aligned&&sessionOk?(ict.direction==='UP'?'BUY SETUP':'SELL SETUP'):ict.confirmed?'WATCH':'NO SETUP';if(!aligned||!sessionOk){if(execution)execution.textContent=ict.confirmed&&!sessionOk?'OUTSIDE KILL ZONE':'WAITING';return{...plan,state:'WAIT',target1:null,target2:null,invalidation:null,eta1:null,eta2:null,locked:false,entry:null,note:ict.candleCount<9?'ICT-first: نحتاج شموع 5 دقائق أكثر قبل السماح بالدخول.':!ict.confirmed?'ICT-first: لا يوجد Sweep + MSS مؤكد؛ لا دخول.':!aligned?'ICT-first: اتجاه النموذج لا يطابق تأكيد ICT؛ لا دخول.':'ICT-first: التأكيد موجود لكننا خارج Kill Zone؛ لا دخول.'}}return{...plan,note:'ICT-FIRST • Liquidity/price action + Sweep + MSS متوافقة مع اتجاه النموذج وداخل Kill Zone. '+(plan.note||'')}}
`;
      source = source.replace(renderAnchor, ictFirst + renderAnchor);
    }

    source = source.replace(
      'renderGoldPlan(lockGoldPlan(d.plan,d.price));drawIctLiquidityLevels(d.samples||[],d.price);',
      'const ictPlan=applyIctFirstPlan(d.plan,d.samples||[],d.price);renderGoldPlan(lockGoldPlan(ictPlan,d.price));drawIctLiquidityLevels(d.samples||[],d.price);'
    );

    // Make the product intent explicit and avoid implying the current engine has a live news feed.
    source = source.replace(
      'XAUUSD ONLY • GOLD INTELLIGENCE TERMINAL',
      'XAUUSD • ICT-FIRST • PRICE ACTION • SESSION FILTER'
    );

    out = isBuffer ? Buffer.from(source, 'utf8') : source;
  }
  return downstreamWriteFileSync(path, out, ...args);
};

syncBuiltinESMExports();
await import('./gold-ui-clean-start.js');
