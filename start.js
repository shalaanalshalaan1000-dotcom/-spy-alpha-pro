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

// Persist every suggested options contract in browser storage so it does not disappear when the live signal changes.
const contractAnchor='<article class="contract"><h2>العقد المقترح وتسعيره</h2><div id="contract">—</div><div id="optionNote" class="warn"></div></article>';
const contractWithHistory=contractAnchor+'<article class="chain" id="contractHistoryCard"><div class="panelHead"><div><h2>سجل العقود المقترحة</h2><p class="scanMeta">يبقى الاقتراح محفوظًا حتى بعد تغير الإشارة أو تحديث الصفحة.</p></div><button id="clearContractHistory" class="compact">مسح السجل</button></div><div class="tableWrap"><table class="scanTable" style="min-width:980px"><thead><tr><th>الوقت</th><th>الرمز</th><th>الاتجاه</th><th>العقد</th><th>الانتهاء</th><th class="num">Strike</th><th class="num">الدخول</th><th class="num">الهدف</th><th class="num">الوقف</th><th class="num">الثقة</th></tr></thead><tbody id="contractHistoryBody"><tr><td colspan="10" class="loadingRow">لا توجد عقود مسجلة بعد</td></tr></tbody></table></div></article>';
if(!source.includes(contractAnchor))throw new Error('Contract history anchor missing');
source=source.replace(contractAnchor,contractWithHistory);

const runtimeVars="const $=s=>document.querySelector(s); let cfg,activeChartSymbol=null,scanLoading=false,specLoading=false,goldLoading=false,goldChartReady=false,goldSamples=[],analysisSeq=0,allContracts=[],suggestedContractSymbol=null,speculativeSymbols=new Set();";
const runtimeVarsHistory=runtimeVars+"\nconst CONTRACT_HISTORY_KEY='spyAlphaContractHistoryV1';";
if(!source.includes(runtimeVars))throw new Error('Runtime variables anchor missing');
source=source.replace(runtimeVars,runtimeVarsHistory);

const loadConfigAnchor='async function loadConfig(){';
const historyFunctions=`function readContractHistory(){try{const rows=JSON.parse(localStorage.getItem(CONTRACT_HISTORY_KEY)||'[]');return Array.isArray(rows)?rows:[]}catch{return[]}}
function writeContractHistory(rows){try{localStorage.setItem(CONTRACT_HISTORY_KEY,JSON.stringify(rows.slice(0,150)))}catch{}}
function contractHistoryTime(v){try{return new Intl.DateTimeFormat('ar-SA',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}).format(new Date(v))}catch{return'—'}}
function renderContractHistory(){
  const body=$('#contractHistoryBody');if(!body)return;
  const rows=readContractHistory();
  if(!rows.length){body.innerHTML='<tr><td colspan="10" class="loadingRow">لا توجد عقود مسجلة بعد</td></tr>';return}
  body.innerHTML=rows.map(x=>'<tr><td>'+contractHistoryTime(x.firstSeenAt)+'</td><td><b>'+x.underlying+'</b></td><td class="'+(x.direction==='CALL'?'CALL':'PUT')+'"><b>'+x.direction+'</b></td><td class="contractCode">'+x.contractSymbol+'</td><td>'+x.expiry+'</td><td class="num">'+money(x.strike)+'</td><td class="num">'+money(x.entry)+'</td><td class="num positive">'+money(x.target)+'</td><td class="num negative">'+money(x.stop)+'</td><td class="num">'+x.confidence+'%</td></tr>').join('');
}
function saveSuggestedContract(underlying,d){
  const c=d?.contract;if(!c?.symbol)return;
  const now=new Date().toISOString(),rows=readContractHistory(),key=[underlying,c.symbol,d.direction].join('|'),i=rows.findIndex(x=>x.key===key),record={key,underlying,direction:d.direction,contractSymbol:c.symbol,expiry:c.expiry,strike:c.strike,entry:c.mid,target:c.estimatedAtTarget,stop:c.estimatedAtStop,targetPct:c.targetPct,stopPct:c.stopPct,confidence:d.confidence,firstSeenAt:i>=0?rows[i].firstSeenAt:now,lastSeenAt:now};
  if(i>=0)rows.splice(i,1);rows.unshift(record);writeContractHistory(rows);renderContractHistory();
}
function latestSavedContract(underlying){return readContractHistory().find(x=>x.underlying===underlying)||null}
function savedContractHTML(x){return '<div class="warn" style="margin-bottom:10px">لا توجد إشارة عقد جديدة الآن — هذا آخر عقد مسجل سابقًا ولا يُعتبر إشارة حالية.</div><div class="contractGrid"><div class="pill"><small>Contract</small><br><b>'+x.contractSymbol+'</b></div><div class="pill"><small>Direction</small><br><b class="'+(x.direction==='CALL'?'CALL':'PUT')+'">'+x.direction+'</b></div><div class="pill"><small>Expiry</small><br><b>'+x.expiry+'</b></div><div class="pill"><small>Strike</small><br><b>'+money(x.strike)+'</b></div><div class="pill"><small>Entry recorded</small><br><b>'+money(x.entry)+'</b></div><div class="pill"><small>Target recorded</small><br><b class="positive">'+money(x.target)+'</b></div><div class="pill"><small>Stop recorded</small><br><b class="negative">'+money(x.stop)+'</b></div><div class="pill"><small>Confidence</small><br><b>'+x.confidence+'%</b></div></div>'}
`;
if(!source.includes(loadConfigAnchor))throw new Error('History function anchor missing');
source=source.replace(loadConfigAnchor,historyFunctions+loadConfigAnchor);

const contractIf='    if(d.contract){\n      const c=d.contract;';
const contractIfSave='    if(d.contract){\n      saveSuggestedContract(s,d);\n      const c=d.contract;';
if(!source.includes(contractIf))throw new Error('Contract save anchor missing');
source=source.replace(contractIf,contractIfSave);

const noContractLine="    }else $('#contract').textContent=d.instrumentPolicy&&!d.instrumentPolicy.active?'خارج نافذة SPX؛ لا يوجد اقتراح عقد.':'لا يوجد عقد مناسب/بيانات عقود غير متوفرة';";
const noContractPersist="    }else{const saved=latestSavedContract(s);if(saved)$('#contract').innerHTML=savedContractHTML(saved);else $('#contract').textContent=d.instrumentPolicy&&!d.instrumentPolicy.active?'خارج نافذة SPX؛ لا يوجد اقتراح عقد.':'لا يوجد عقد مناسب/بيانات عقود غير متوفرة'};";
if(!source.includes(noContractLine))throw new Error('No-contract display anchor missing');
source=source.replace(noContractLine,noContractPersist);

const chainClick="$('#chainExpiry').onchange=renderOptionChain;";
const historyClick="$('#chainExpiry').onchange=renderOptionChain;\n$('#clearContractHistory').onclick=()=>{if(confirm('مسح سجل العقود المقترحة بالكامل؟')){writeContractHistory([]);renderContractHistory()}};";
if(!source.includes(chainClick))throw new Error('History button anchor missing');
source=source.replace(chainClick,historyClick);

const initAnchor='  goldSamples=restoreGoldSamples();\n  await loadConfig();';
const initHistory='  goldSamples=restoreGoldSamples();\n  renderContractHistory();\n  await loadConfig();';
if(!source.includes(initAnchor))throw new Error('History init anchor missing');
source=source.replace(initAnchor,initHistory);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
