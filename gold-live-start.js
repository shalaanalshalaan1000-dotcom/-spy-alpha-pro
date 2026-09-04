import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Gold live patch target was not found: ' + label);
  return source.replace(before, after);
}

function applyGoldLiveFeed(source) {
  const backendAnchor = 'const server=http.createServer(async(req,res)=>{';
  const backend = `const GOLD_LIVE_MASSIVE_CACHE_MS=4500,GOLD_LIVE_FALLBACK_CACHE_MS=25000,GOLD_LIVE_RETRY_CACHE_MS=15000;
const goldLiveState={value:null,expiresAt:0,inFlight:null,massiveBlockedUntil:0,lastError:null};
function normalizeGoldTimestamp(value){let n=Number(value);if(Number.isFinite(n)){if(n>1e17)n/=1e6;else if(n>1e14)n/=1e3;else if(n<1e11)n*=1000;const d=new Date(n);if(!Number.isNaN(d.getTime()))return d.toISOString()}const d=new Date(value||Date.now());return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString()}
function goldMassiveFailure(error){const status=Number(error?.providerStatus||0);return status===401||status===403?'MASSIVE_CURRENCIES_NOT_AVAILABLE':'MASSIVE_UNAVAILABLE'}
async function fetchMassiveGoldQuote(){const apiKey=process.env.MASSIVE_API_KEY;if(!apiKey){const e=new Error('Massive key is not configured');e.providerStatus=401;throw e}const url=new URL(MASSIVE_BASE+'/v1/last_quote/currencies/XAU/USD');url.searchParams.set('apiKey',apiKey);const r=await fetch(url,{headers:{accept:'application/json','user-agent':'GoldAlphaPro/4.2'},signal:AbortSignal.timeout(7000)}),raw=await r.json().catch(()=>({}));if(!r.ok){const e=new Error('Massive gold quote failed');e.providerStatus=r.status;throw e}const quote=raw.last||raw.results?.last||raw.results||{},bid=Number(quote.bid??quote.b),ask=Number(quote.ask??quote.a),price=Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>0?(bid+ask)/2:Number.isFinite(bid)&&bid>0?bid:ask;if(!Number.isFinite(price)||price<=0)throw new Error('Massive returned an invalid gold quote');return{price:Number(price.toFixed(3)),bid:Number.isFinite(bid)?bid:null,ask:Number.isFinite(ask)?ask:null,updatedAt:normalizeGoldTimestamp(quote.timestamp??quote.t??raw.updatedAt),provider:'MASSIVE',symbol:'C:XAUUSD',live:true,sourceCadenceMs:5000}}
async function fetchGoldApiQuote(reason){const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store',headers:{accept:'application/json','user-agent':'GoldAlphaPro/4.3'},signal:AbortSignal.timeout(25000)}),raw=await r.json().catch(()=>({})),price=Number(raw.price);if(!r.ok||!Number.isFinite(price)||price<=0)throw new Error('Gold API quote failed');return{price:Number(price.toFixed(3)),bid:null,ask:null,updatedAt:normalizeGoldTimestamp(raw.updatedAt),provider:'GOLD_API',symbol:'XAUUSD',live:false,sourceCadenceMs:30000,fallbackReason:reason}}
async function fetchGoldPriceQuote(reason){const r=await fetch('https://data-asg.goldprice.org/dbXRates/USD',{cache:'no-store',headers:{accept:'application/json, text/plain, */*',origin:'https://goldprice.org',referer:'https://goldprice.org/','user-agent':'Mozilla/5.0 GoldAlphaPro/4.3'},signal:AbortSignal.timeout(25000)}),raw=await r.json().catch(()=>({})),item=Array.isArray(raw.items)?raw.items[0]:null,price=Number(item?.xauPrice);if(!r.ok||!Number.isFinite(price)||price<=0)throw new Error('GoldPrice quote failed');return{price:Number(price.toFixed(3)),bid:null,ask:null,updatedAt:normalizeGoldTimestamp(raw.ts??raw.tsj),provider:'GOLDPRICE_ORG',symbol:'XAUUSD',live:false,sourceCadenceMs:30000,fallbackReason:reason}}
async function fetchFallbackGoldQuote(reason){if(!goldLiveState.value){try{return await Promise.any([fetchGoldApiQuote(reason),fetchGoldPriceQuote(reason)])}catch{throw new Error('All fallback gold quotes failed')}}try{return await fetchGoldApiQuote(reason)}catch{return fetchGoldPriceQuote(reason)}}
async function refreshGoldLiveQuote(){if(goldLiveState.inFlight)return goldLiveState.inFlight;goldLiveState.inFlight=(async()=>{let value,reason=process.env.MASSIVE_API_KEY?'MASSIVE_UNAVAILABLE':'MASSIVE_API_KEY_NOT_CONFIGURED',now=Date.now();if(process.env.MASSIVE_API_KEY&&now>=goldLiveState.massiveBlockedUntil){try{value=await fetchMassiveGoldQuote()}catch(error){reason=goldMassiveFailure(error);goldLiveState.massiveBlockedUntil=now+(reason==='MASSIVE_CURRENCIES_NOT_AVAILABLE'?6*60*60_000:60_000)}}else if(process.env.MASSIVE_API_KEY){reason='MASSIVE_CURRENCIES_NOT_AVAILABLE'}if(!value)value=await fetchFallbackGoldQuote(reason);goldLiveState.value=value;goldLiveState.expiresAt=Date.now()+(value.live?GOLD_LIVE_MASSIVE_CACHE_MS:GOLD_LIVE_FALLBACK_CACHE_MS);goldLiveState.lastError=null;return value})();try{return await goldLiveState.inFlight}catch(error){goldLiveState.lastError=String(error?.message||error).slice(0,180);goldLiveState.expiresAt=Date.now()+GOLD_LIVE_RETRY_CACHE_MS;if(goldLiveState.value)return{...goldLiveState.value,degraded:true};throw error}finally{goldLiveState.inFlight=null}}
async function getGoldLiveQuote(){const now=Date.now();if(goldLiveState.value&&now<goldLiveState.expiresAt)return goldLiveState.value;if(goldLiveState.value){void refreshGoldLiveQuote().catch(()=>{});return{...goldLiveState.value,refreshing:true,degraded:Boolean(goldLiveState.lastError)}}return refreshGoldLiveQuote()}
`;
  source = replaceRequired(source, backendAnchor, backend + backendAnchor, 'server anchor');

  const routeAnchor = "if(req.method==='GET'&&url.pathname==='/api/config')return sendJSON(res,200,{watchlist:WATCHLIST,minConfidence:Number(process.env.MIN_CONFIDENCE||70),user:session?.email||null,...currentMode()});";
  const goldRoute = "if(req.method==='GET'&&url.pathname==='/api/gold-live'){try{return sendJSON(res,200,await getGoldLiveQuote())}catch(error){return sendJSON(res,502,{error:'Gold feed unavailable'})}}\n    ";
  source = replaceRequired(source, routeAnchor, goldRoute + routeAnchor, 'gold route');

  source = replaceRequired(
    source,
    "const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store'}),raw=await r.json(),d=goldBrowserReading(raw);",
    "const r=await fetch('/api/gold-live',{cache:'no-store'}),raw=await r.json(),d=goldBrowserReading(raw);",
    'browser gold request'
  );
  source = replaceRequired(
    source,
    "const normalizedAt=updatedAt.toISOString(),sampleTime=now,last=goldSamples.at(-1);",
    "const normalizedAt=updatedAt.toISOString(),sampleTime=raw.live===true?now:updatedAt.getTime(),last=goldSamples.at(-1);",
    'gold sample clock'
  );
  source = replaceRequired(
    source,
    "return{price:fixed(price),updatedAt:normalizedAt,ageSeconds:",
    "return{price:fixed(price),provider:String(raw.provider||'GOLD_API'),live:raw.live===true,bid:fixed(Number(raw.bid)),ask:fixed(Number(raw.ask)),sourceCadenceMs:Number(raw.sourceCadenceMs)||null,updatedAt:normalizedAt,ageSeconds:",
    'gold feed metadata'
  );
  source = replaceRequired(
    source,
    "$('#goldMeta').textContent='Gold API • آخر تحديث '+new Date(d.updatedAt).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Riyadh'})+' بتوقيت الرياض • نافذة الرصد '+(d.windowMinutes<1?'< 1':Math.round(d.windowMinutes))+' د';",
    "const goldProviderLabel=d.provider==='MASSIVE'?'Massive XAUUSD • تحديث كل 5 ثوانٍ':d.provider==='GOLDPRICE_ORG'?'GoldPrice احتياطي • فحص كل 5 ثوانٍ':'Gold API احتياطي • فحص كل 5 ثوانٍ';$('#goldMeta').textContent=goldProviderLabel+(d.live?'':'، والمصدر ينشر قراءة كل نحو 30 ثانية')+' • آخر سعر '+new Date(d.updatedAt).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Riyadh'})+' بتوقيت الرياض • نافذة الرصد '+(d.windowMinutes<1?'< 1':Math.round(d.windowMinutes))+' د';",
    'gold status text'
  );
  source = replaceRequired(source, 'setInterval(loadGold,20000)', 'setInterval(loadGold,5000)', 'five-second refresh');
  source = source.replaceAll('slice(-240)', 'slice(-1440)');
  source = source.replace(
    'السعر من Gold API ويُفحص كل 20 ثانية؛ الشارت 1 دقيقة من OANDA عبر TradingView. الهدف والمدة تقديران محافظان وليسا ضمانًا.',
    'تُفحص قراءة الذهب كل 5 ثوانٍ. يستخدم السعر اللحظي من Massive عند توفر باقة العملات، وإلا ينتقل تلقائيًا إلى Gold API الاحتياطي. الشارت 1 دقيقة من OANDA عبر TradingView، والهدف والمدة تقديران وليسا ضمانًا.'
  );

  for (const marker of ["url.pathname==='/api/gold-live'", "fetch('/api/gold-live'", 'setInterval(loadGold,5000)', "provider:String(raw.provider||'GOLD_API')"]) {
    if (!source.includes(marker)) throw new Error('Gold live patch failed: ' + marker);
  }
  return source;
}

fs.writeFileSync = function patchedWriteFileSync(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return originalWriteFileSync(path, data, ...args);
  }
  const isBuffer = Buffer.isBuffer(data);
  const source = applyGoldLiveFeed(isBuffer ? data.toString('utf8') : String(data));
  return originalWriteFileSync(path, isBuffer ? Buffer.from(source, 'utf8') : source, ...args);
};

syncBuiltinESMExports();
await import('./gold-fix-start.js');
