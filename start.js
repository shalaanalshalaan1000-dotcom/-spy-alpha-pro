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

// Gold must be requested server-side. Direct browser requests can fail because of CORS/provider blocking.
const goldBrowserFetch="const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store'}),raw=await r.json(),d=goldBrowserReading(raw);";
const goldProxyFetch="const r=await fetch('/api/gold',{cache:'no-store'}),raw=await r.json(),d=goldBrowserReading(raw);";
if(!source.includes(goldBrowserFetch))throw new Error('Gold browser fetch anchor missing');
source=source.replace(goldBrowserFetch,goldProxyFetch);

// Add a visible overnight/premarket status card rather than surfacing a raw ERROR.
const toolbarAnchor='<section class="toolbar">';
const nightCard='<article class="scanner" id="nightPanel"><div class="panelHead"><div><h2>القراءة الليلية — SPY</h2><p id="nightMeta" class="scanMeta">جارٍ فحص الجلسة وآخر بيانات متاحة…</p></div><button id="nightRefresh" class="compact">تحديث القراءة</button></div><div class="hero"><div><span>حالة الجلسة</span><strong id="nightState">—</strong></div><div><span>آخر سعر متاح</span><strong id="nightPrice">—</strong></div><div><span>أعلى القراءة</span><strong id="nightHigh">—</strong></div><div><span>أدنى القراءة</span><strong id="nightLow">—</strong></div><div><span>التغير</span><strong id="nightChange">—</strong></div><div><span>حداثة البيانات</span><strong id="nightAge">—</strong></div></div><p id="nightNote" class="chartNote">لن يتم اختلاق سعر ليلي: إذا لم يرسل المزود تداولات ممتدة حديثة ستظهر الحالة بوضوح كبيانات غير متاحة.</p></article>\n';
if(!source.includes(toolbarAnchor))throw new Error('Toolbar anchor missing');
source=source.replace(toolbarAnchor,nightCard+toolbarAnchor);

const runtimeVars="const $=s=>document.querySelector(s); let cfg,activeChartSymbol=null,scanLoading=false,specLoading=false,goldLoading=false,goldChartReady=false,goldSamples=[],analysisSeq=0,allContracts=[],suggestedContractSymbol=null,speculativeSymbols=new Set();";
const runtimeVarsNight="const $=s=>document.querySelector(s); let cfg,activeChartSymbol=null,scanLoading=false,specLoading=false,goldLoading=false,nightLoading=false,goldChartReady=false,goldSamples=[],analysisSeq=0,allContracts=[],suggestedContractSymbol=null,speculativeSymbols=new Set();";
if(!source.includes(runtimeVars))throw new Error('Runtime vars anchor missing');
source=source.replace(runtimeVars,runtimeVarsNight);

const loadGoldAnchor='async function loadGold(){';
const loadNightFn=`async function loadNight(){
  if(nightLoading)return;
  nightLoading=true;
  const button=$('#nightRefresh');if(button)button.disabled=true;
  try{
    const r=await fetch('/api/night',{cache:'no-store'}),d=await r.json();
    if(!r.ok||d.error)throw new Error(d.error||'تعذر تحميل القراءة الليلية');
    const labels={REGULAR:'السوق مفتوح',PREMARKET:'قبل الافتتاح',AFTER_HOURS:'بعد الإغلاق',OVERNIGHT:'تداول ليلي',MARKET_CLOSED:'السوق مغلق',NO_OVERNIGHT_FEED:'لا توجد قراءة ليلية حديثة'};
    $('#nightState').textContent=labels[d.session]||d.session||'—';
    $('#nightState').className=['REGULAR','PREMARKET','AFTER_HOURS','OVERNIGHT'].includes(d.session)&&!d.stale?'positive':d.stale?'WATCH':'muted';
    $('#nightPrice').textContent=d.price==null?'—':money(d.price);
    $('#nightHigh').textContent=d.high==null?'—':money(d.high);
    $('#nightLow').textContent=d.low==null?'—':money(d.low);
    $('#nightChange').textContent=d.changePct==null?'—':signedGoldPct(d.changePct);
    $('#nightChange').className=d.changePct==null?'':d.changePct>=0?'positive':'negative';
    $('#nightAge').textContent=d.ageMinutes==null?'—':(d.ageMinutes<1?'الآن':Math.round(d.ageMinutes)+' د');
    $('#nightAge').className=d.stale?'WATCH':'positive';
    $('#nightMeta').textContent=(d.provider||'MASSIVE')+' • آخر تحديث '+(d.updatedAt?new Date(d.updatedAt).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}):'غير متاح')+' بتوقيت الرياض';
    $('#nightNote').textContent=d.note||'—';
  }catch(e){
    $('#nightState').textContent='بيانات غير متاحة';$('#nightState').className='WATCH';
    $('#nightMeta').textContent='تعذر جلب القراءة الليلية';
    $('#nightNote').textContent=e.message;
  }finally{nightLoading=false;if(button)button.disabled=false;}
}
`;
if(!source.includes(loadGoldAnchor))throw new Error('loadGold anchor missing');
source=source.replace(loadGoldAnchor,loadNightFn+loadGoldAnchor);

const goldClick="$('#goldRefresh').onclick=loadGold;";
const goldNightClick="$('#goldRefresh').onclick=loadGold;\n$('#nightRefresh').onclick=loadNight;";
if(!source.includes(goldClick))throw new Error('Gold click anchor missing');
source=source.replace(goldClick,goldNightClick);

const initialLoads="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);";
const initialLoadsNight="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold(),loadNight()]);";
if(!source.includes(initialLoads))throw new Error('Initial loads anchor missing');
source=source.replace(initialLoads,initialLoadsNight);

const goldInterval="setInterval(()=>{if($('#auto').checked)loadGold()},30000);";
const goldNightInterval="setInterval(()=>{if($('#auto').checked)loadGold()},30000);\n  setInterval(()=>{if($('#auto').checked)loadNight()},60000);";
if(!source.includes(goldInterval))throw new Error('Gold interval anchor missing');
source=source.replace(goldInterval,goldNightInterval);

// Add authenticated server-side APIs for gold and overnight session data.
const rootRoute="    if(req.method==='GET'&&url.pathname==='/'){\n      return sendHTML(res,200,HTML);\n    }";
const extraRoutes=`    if(req.method==='GET'&&url.pathname==='/api/gold'){
      try{
        const response=await fetch('https://api.gold-api.com/price/XAU',{headers:{accept:'application/json','user-agent':'SPY-Alpha-Pro/4.0'},signal:AbortSignal.timeout(10000)});
        const data=await response.json().catch(()=>({}));
        const price=Number(data.price),rawTime=data.updatedAt||data.updated_at||data.timestamp||data.time||Date.now(),updatedAt=new Date(typeof rawTime==='number'&&rawTime<1e12?rawTime*1000:rawTime);
        if(!response.ok||!Number.isFinite(price)||price<=0||Number.isNaN(updatedAt.getTime()))throw new Error('Gold provider returned invalid data');
        return sendJSON(res,200,{price,updatedAt:updatedAt.toISOString(),provider:'GOLD-API'});
      }catch(error){
        return sendJSON(res,502,{error:'تعذر جلب سعر الذهب من المزود الآن',detail:String(error.message||error).slice(0,160)});
      }
    }
    if(req.method==='GET'&&url.pathname==='/api/night'){
      try{
        const snap=await fetchSnapshot('SPY'),bars=Array.isArray(snap.intraday)?snap.intraday:[],last=bars.at(-1);
        if(!last)throw new Error('No intraday bars available');
        const now=Date.now(),lastMs=new Date(last.timestamp).getTime(),ageMinutes=Math.max(0,(now-lastMs)/60000),clock=easternClock(),weekend=['Sat','Sun'].includes(clock.weekday),m=clock.minutes;
        let session=weekend?'MARKET_CLOSED':m>=570&&m<960?'REGULAR':m>=240&&m<570?'PREMARKET':m>=960&&m<1200?'AFTER_HOURS':'OVERNIGHT';
        const windowBars=bars.filter(b=>{const t=new Date(b.timestamp).getTime();return Number.isFinite(t)&&t>=now-12*60*60_000&&t<=now+60_000});
        const active=windowBars.length?windowBars:[last],prices=active.map(b=>Number(b.close)).filter(Number.isFinite),highs=active.map(b=>Number(b.high)).filter(Number.isFinite),lows=active.map(b=>Number(b.low)).filter(Number.isFinite),first=Number(active[0]?.close),price=Number(last.close),changePct=Number.isFinite(first)&&first!==0?(price-first)/first*100:null;
        const stale=ageMinutes>20;
        if(session==='OVERNIGHT'&&stale)session='NO_OVERNIGHT_FEED';
        const note=session==='NO_OVERNIGHT_FEED'?'المزود لا يرسل تداولات ليلية حديثة الآن؛ أعرض آخر سعر حقيقي فقط ولا أستبدله بسعر تقديري.':stale?'آخر بيانات السوق أقدم من 20 دقيقة؛ تعامل معها كمرجع وليست قراءة لحظية.':'القراءة مبنية على آخر بيانات SPY الحقيقية المتاحة من Massive.';
        return sendJSON(res,200,{session,price:Number.isFinite(price)?price:null,high:highs.length?Math.max(...highs):null,low:lows.length?Math.min(...lows):null,changePct:Number.isFinite(changePct)?Number(changePct.toFixed(3)):null,updatedAt:new Date(lastMs).toISOString(),ageMinutes:Number(ageMinutes.toFixed(1)),stale,provider:snap.provider||'MASSIVE',note});
      }catch(error){
        const status=Number(error.statusCode)||502;
        return sendJSON(res,status,{error:status===503?'بيانات السوق غير مهيأة على الخادم':'تعذر جلب القراءة الليلية الآن',detail:String(error.message||error).slice(0,160)});
      }
    }
${rootRoute}`;
if(!source.includes(rootRoute))throw new Error('Root route anchor missing');
source=source.replace(rootRoute,extraRoutes);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
