import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./server.js',import.meta.url);
const runtimePath=new URL('./.runtime-server.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

// Never fall back to generated DEMO market prices.
const snapshotFallback="async function fetchSnapshot(symbol){return process.env.MASSIVE_API_KEY?fetchMassiveSnapshot(symbol):demoSnapshot(symbol)}";
const snapshotLive="async function fetchSnapshot(symbol){if(!process.env.MASSIVE_API_KEY){const e=new Error('Market data unavailable');e.statusCode=503;throw e}return fetchMassiveSnapshot(symbol)}";
if(!source.includes(snapshotFallback))throw new Error('Snapshot fallback anchor missing');
source=source.replace(snapshotFallback,snapshotLive);

const scanFallback="  const value=process.env.MASSIVE_API_KEY?await fetchMassiveScan():demoScan();";
const scanLive="  if(!process.env.MASSIVE_API_KEY){const e=new Error('Market data unavailable');e.statusCode=503;throw e}\n  const value=await fetchMassiveScan();";
if(!source.includes(scanFallback))throw new Error('Scan fallback anchor missing');
source=source.replace(scanFallback,scanLive);

// Pull the official previous-session OHLC directly from Massive /prev.
const fetchDecl="  let dailyData,intradayData,referenceData=null;";
const fetchDeclPrev="  let dailyData,intradayData,referenceData=null,previousDayData=null;";
if(!source.includes(fetchDecl))throw new Error('Massive snapshot declaration anchor missing');
source=source.replace(fetchDecl,fetchDeclPrev);

const promiseDecl="    [dailyData,intradayData,referenceData]=await Promise.all([";
const promiseDeclPrev="    [dailyData,intradayData,referenceData,previousDayData]=await Promise.all([";
if(!source.includes(promiseDecl))throw new Error('Massive Promise anchor missing');
source=source.replace(promiseDecl,promiseDeclPrev);

const promiseTail="      isSpx?massiveGet('/v2/aggs/ticker/SPY/range/5/minute/'+isoDate(daysAgo(7))+'/'+isoDate(new Date()),{adjusted:true,sort:'asc',limit:50000}):Promise.resolve(null)\n    ]);";
const promiseTailPrev="      isSpx?massiveGet('/v2/aggs/ticker/SPY/range/5/minute/'+isoDate(daysAgo(7))+'/'+isoDate(new Date()),{adjusted:true,sort:'asc',limit:50000}):Promise.resolve(null),\n      massiveGet('/v2/aggs/ticker/'+encodeURIComponent(dataTicker)+'/prev',{adjusted:true})\n    ]);";
if(!source.includes(promiseTail))throw new Error('Massive Promise tail anchor missing');
source=source.replace(promiseTail,promiseTailPrev);

const dailyMap="  const daily=mapBars(dailyData.results||[]);";
const dailyMapPrev="  const daily=mapBars(dailyData.results||[]);\n  const previousDay=mapBars(previousDayData?.results||[]).at(-1)||null;";
if(!source.includes(dailyMap))throw new Error('Daily map anchor missing');
source=source.replace(dailyMap,dailyMapPrev);

const snapshotReturn="  return{symbol,daily,intraday,options,optionDataError,optionDiagnostics,volumeReference,timestamp:intraday.at(-1).timestamp,mode:'LIVE',provider:'MASSIVE'};";
const snapshotReturnPrev="  return{symbol,daily,intraday,options,optionDataError,optionDiagnostics,volumeReference,previousDay,timestamp:intraday.at(-1).timestamp,mode:'LIVE',provider:'MASSIVE'};";
if(!source.includes(snapshotReturn))throw new Error('Snapshot return anchor missing');
source=source.replace(snapshotReturn,snapshotReturnPrev);

const pivotsOld="function pivots(daily){const prev=daily[daily.length-2],recent=daily.slice(-20);return{pdh:prev.high,pdl:prev.low,prevClose:prev.close,swingHigh:Math.max(...recent.map(c=>c.high)),swingLow:Math.min(...recent.map(c=>c.low)),whole:Math.round(daily.at(-1).close)}}";
const pivotsNew="function pivots(daily,previousDay=null){const prev=previousDay||daily[daily.length-2],recent=daily.slice(-20);return{pdh:prev.high,pdl:prev.low,prevClose:prev.close,swingHigh:Math.max(...recent.map(c=>c.high)),swingLow:Math.min(...recent.map(c=>c.low)),whole:Math.round(daily.at(-1).close)}}";
if(!source.includes(pivotsOld))throw new Error('Pivots anchor missing');
source=source.replace(pivotsOld,pivotsNew);

const analyzePivot="dailyAtr=atr(daily,14),p=pivots(daily),vw=vwap(intraday)";
const analyzePivotPrev="dailyAtr=atr(daily,14),p=pivots(daily,snapshot.previousDay),vw=vwap(intraday)";
if(!source.includes(analyzePivot))throw new Error('Analyze pivot anchor missing');
source=source.replace(analyzePivot,analyzePivotPrev);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
