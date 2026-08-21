import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function patchedReadFileSync(path, ...args) {
  const data = originalReadFileSync(path, ...args);
  const p = String(path);
  if (!p.endsWith('/server.js') && !p.endsWith('\\server.js')) return data;

  const isBuffer = Buffer.isBuffer(data);
  let source = isBuffer ? data.toString('utf8') : String(data);

  // Keep substantially more gold history in browser storage.
  source = source.replaceAll('now-2*60*60_000', 'now-72*60*60_000');
  source = source.replaceAll('slice(-240)', 'slice(-9000)');
  source = source.replaceAll("goldSamples=goldSamples.filter(x=>x.t>=now-2*60*60_000&&x.t<=now+60_000).slice(-240)", "goldSamples=goldSamples.filter(x=>x.t>=now-72*60*60_000&&x.t<=now+60_000).slice(-9000)");

  // Backend historical XAUUSD minute bars from Massive. This keeps the API key server-side.
  const mapBarsAnchor = "function mapBars(rows=[]){return rows.map(x=>({open:Number(x.o),high:Number(x.h),low:Number(x.l),close:Number(x.c),volume:Number(x.v||0),vwap:x.vw==null?null:Number(x.vw),timestamp:new Date(Number(x.t)).toISOString()})).filter(x=>Number.isFinite(x.close))}";
  if (source.includes(mapBarsAnchor)) {
    const historyFn = mapBarsAnchor + "\nasync function fetchGoldHistoricalSamples(){const from=isoDate(daysAgo(3)),to=isoDate(new Date()),data=await massiveGet('/v2/aggs/ticker/C:XAUUSD/range/1/minute/'+from+'/'+to,{adjusted:true,sort:'asc',limit:50000});return (data.results||[]).map(x=>({t:Number(x.t),price:Number(x.c)})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.price)&&x.price>0)}";
    source = source.replace(mapBarsAnchor, historyFn);
  }

  const configRoute = "if(req.method==='GET'&&url.pathname==='/api/config')return sendJSON(res,200,{watchlist:WATCHLIST,minConfidence:Number(process.env.MIN_CONFIDENCE||70),user:session?.email||null,...currentMode()});";
  if (source.includes(configRoute)) {
    source = source.replace(configRoute, configRoute + "\n    if(req.method==='GET'&&url.pathname==='/api/gold-history'){if(!process.env.MASSIVE_API_KEY)return sendJSON(res,503,{error:'MASSIVE_API_KEY is required for historical XAUUSD'});const samples=await fetchGoldHistoricalSamples();return sendJSON(res,200,{samples,count:samples.length,provider:'MASSIVE'});}");
  }

  // Load historical bars once in the browser, then merge them with live Gold API samples.
  const varsAnchor = "const $=s=>document.querySelector(s); let cfg,activeChartSymbol=null,scanLoading=false,specLoading=false,goldLoading=false,goldChartReady=false,goldSamples=[],analysisSeq=0,allContracts=[],suggestedContractSymbol=null,speculativeSymbols=new Set();";
  if (source.includes(varsAnchor)) {
    source = source.replace(varsAnchor, varsAnchor + "\nlet goldHistoryLoaded=false;async function ensureGoldHistory(){if(goldHistoryLoaded)return;goldHistoryLoaded=true;try{const r=await fetch('/api/gold-history',{cache:'no-store'}),d=await r.json();if(!r.ok||!Array.isArray(d.samples))throw new Error(d.error||'Historical gold request failed');const merged=[...(d.samples||[]),...goldSamples].map(x=>({t:Number(x.t),price:Number(x.price)})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.price)&&x.price>0).sort((a,b)=>a.t-b.t),unique=[];for(const row of merged){const last=unique.at(-1);if(last&&last.t===row.t)last.price=row.price;else unique.push(row)}goldSamples=unique.slice(-9000);saveGoldSamples()}catch(e){goldHistoryLoaded=false;console.warn('Gold history unavailable:',e.message)}}";
  }

  const loadGoldAnchor = "async function loadGold(){\n  if(goldLoading)return;";
  if (source.includes(loadGoldAnchor)) {
    source = source.replace(loadGoldAnchor, "async function loadGold(){\n  if(goldLoading)return;\n  await ensureGoldHistory();");
  }

  return isBuffer ? Buffer.from(source, 'utf8') : source;
};

syncBuiltinESMExports();
await import('./gold-ict-levels-start.js');
