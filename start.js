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

// Let the fast radar surface early directional WATCH setups instead of hiding them.
const quickSignalOld="  const signal=gap<12?'NO TRADE':confidence<70?'WATCH':direction;";
const quickSignalNew="  const signal=gap<8?'NO TRADE':confidence<65?'WATCH':direction;";
if(!source.includes(quickSignalOld))throw new Error('Quick signal anchor missing');
source=source.replace(quickSignalOld,quickSignalNew);

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

// Liquidity + market structure conviction layer. Keep the stable entrypoint and wrap the existing analyzer.
const coreAnchor='function analyzeCore(snapshot,settings={}){';
if(!source.includes(coreAnchor))throw new Error('Structure analyzeCore anchor missing');
source=source.replace(coreAnchor,'function analyzeCoreBase(snapshot,settings={}){');
const spxAnchor='function spxTradePolicy(date=new Date()){';
if(!source.includes(spxAnchor))throw new Error('Structure SPX anchor missing');
const structureEngine=`function structureEt(value){const d=value instanceof Date?value:new Date(value),parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return{day:parts.year+'-'+parts.month+'-'+parts.day,min:Number(parts.hour)*60+Number(parts.minute)}}
function structureLevels(intraday){const now=structureEt(new Date()),bars=(intraday||[]).map(x=>({...x,_t:structureEt(x.timestamp)})).filter(x=>x._t.day===now.day);const range=(a,b)=>bars.filter(x=>x._t.min>=a&&x._t.min<b),pre=range(240,570),opening=range(570,600),recent=bars.slice(-4);const hi=a=>a.length?Math.max(...a.map(x=>Number(x.high)).filter(Number.isFinite)):null,lo=a=>a.length?Math.min(...a.map(x=>Number(x.low)).filter(Number.isFinite)):null,c=recent.map(x=>Number(x.close)).filter(Number.isFinite);return{phase:now.min>=570&&now.min<960?'REGULAR':now.min>=240&&now.min<570?'PREMARKET':now.min>=960&&now.min<1200?'AFTER_HOURS':'OVERNIGHT',pmh:hi(pre),pml:lo(pre),orh:hi(opening),orl:lo(opening),up:c.length>=3&&c.at(-1)>c.at(-2)&&c.at(-2)>=c.at(-3),down:c.length>=3&&c.at(-1)<c.at(-2)&&c.at(-2)<=c.at(-3)}}
function structureHtf(daily){const c=(daily||[]).map(x=>Number(x.close)).filter(Number.isFinite);if(c.length<20)return'NEUTRAL';const e9=ema(c.slice(-40),9),e20=ema(c.slice(-60),20);return e9>e20?'CALL':e9<e20?'PUT':'NEUTRAL'}
function structureSessionOK(dir,spot,l){if(dir==='CALL'){if(l.phase==='REGULAR'&&((Number.isFinite(l.pmh)&&spot>l.pmh)||(Number.isFinite(l.orh)&&spot>l.orh)||l.up))return true;if(l.phase==='PREMARKET'&&l.up)return true}else if(dir==='PUT'){if(l.phase==='REGULAR'&&((Number.isFinite(l.pml)&&spot<l.pml)||(Number.isFinite(l.orl)&&spot<l.orl)||l.down))return true;if(l.phase==='PREMARKET'&&l.down)return true}return false}
function structureScore(dir,{spot,vw,smc,fvg,htf,levels}){const p={session:0,sweep:0,mss:0,fvg:0,vwap:0,htf:0};if(structureSessionOK(dir,spot,levels))p.session=20;if(dir==='CALL'&&smc.sweepLow)p.sweep=25;if(dir==='PUT'&&smc.sweepHigh)p.sweep=25;if(dir==='CALL'&&(smc.mssBull||smc.bosBull))p.mss=20;if(dir==='PUT'&&(smc.mssBear||smc.bosBear))p.mss=20;if(dir==='CALL'&&fvg.bull)p.fvg=15;if(dir==='PUT'&&fvg.bear)p.fvg=15;if(dir==='CALL'&&spot>vw)p.vwap=20;if(dir==='PUT'&&spot<vw)p.vwap=20;if(htf===dir)p.htf=10;const gate=(p.mss===20&&(p.session>0||p.sweep>0||p.fvg>0))||(p.sweep===25&&p.session>0&&p.vwap>0);return{parts:p,total:Object.values(p).reduce((a,b)=>a+b,0),gate}}
function analyzeCore(snapshot,settings={}){const base=analyzeCoreBase(snapshot,settings),intraday=snapshot.intraday||[],daily=snapshot.daily||[],spot=Number(base.spot),vw=Number(base.indicators?.vwap),smc=detectStructure(intraday),fvg=detectFVG(intraday),htf=structureHtf(daily),levels=structureLevels(intraday),call=structureScore('CALL',{spot,vw,smc,fvg,htf,levels}),put=structureScore('PUT',{spot,vw,smc,fvg,htf,levels});let dir=call.total>put.total?'CALL':put.total>call.total?'PUT':base.direction,chosen=dir==='CALL'?call:put,penalty=0,contractPenalty=0,extra=[];if(base.indicators?.atrConsumedPct>=100){penalty+=12;extra.push('ATR مستهلك بالكامل')}else if(base.indicators?.atrConsumedPct>=85){penalty+=7;extra.push('معظم ATR مستهلك')}else if(base.indicators?.atrConsumedPct>=70){penalty+=3}if(base.indicators?.pivotDistanceAtr>.55)penalty+=4;if(base.contract){if(base.contract.spreadPct==null){contractPenalty+=3;extra.push('Bid/Ask غير متوفر للعقد')}else if(base.contract.spreadPct>10){contractPenalty+=8;extra.push('Spread العقد واسع')}if((base.contract.openInterest||0)<200){contractPenalty+=4;extra.push('Open Interest منخفض')}if(Number(base.contract.rr)<2){contractPenalty+=8;extra.push('RR للعقد أقل من 1:2')}}let confidence=Math.max(0,Math.min(95,Math.round(chosen.total-penalty)));if(!chosen.gate&&confidence>69)confidence=69;const min=Math.max(70,Number(settings.minConfidence??70));let state='NO TRADE';if(chosen.gate&&confidence>=min)state=dir;else if(confidence>=55)state='WATCH';const reasons=[];if(chosen.parts.sweep)reasons.push(dir==='CALL'?'Liquidity Sweep للقاع +25':'Liquidity Sweep للقمة +25');if(chosen.parts.mss)reasons.push(dir==='CALL'?'MSS/BOS صاعد +20':'MSS/BOS هابط +20');if(chosen.parts.fvg)reasons.push(dir==='CALL'?'Bullish FVG +15':'Bearish FVG +15');if(chosen.parts.vwap)reasons.push(dir==='CALL'?'فوق VWAP +20':'تحت VWAP +20');if(chosen.parts.htf)reasons.push('HTF Bias +10');if(chosen.parts.session)reasons.push('Session confirmation +20');if(!chosen.gate)reasons.push('مراقبة مبكرة — بانتظار تأكيد بنيوي إضافي');const candidate=base.contract;base.direction=dir;base.confidence=confidence;base.state=state;base.structure={score:chosen.total,penalty,contractPenalty,gate:chosen.gate,components:chosen.parts,callScore:call.total,putScore:put.total,htfBias:htf,session:levels.phase,levels:{pmh:round(levels.pmh),pml:round(levels.pml),orh:round(levels.orh),orl:round(levels.orl)}};base.pivots={...base.pivots,pmh:round(levels.pmh),pml:round(levels.pml),orh:round(levels.orh),orl:round(levels.orl)};base.setup={...base.setup,reasons:[...new Set([...reasons,...extra,...(base.setup?.reasons||[])])].slice(0,16)};if(!['CALL','PUT'].includes(state)){base.candidateContract=candidate;base.contract=null}return base}
`;
source=source.replace(spxAnchor,structureEngine+spxAnchor);

// Re-align target, invalidation and options contract after the final structure direction is known.
const analyzeAnchor='function analyze(snapshot,settings={}){';
if(!source.includes(analyzeAnchor))throw new Error('Final contract analyze anchor missing');
source=source.replace(analyzeAnchor,'function analyzeBase(snapshot,settings={}){');
const isoAnchor='const isoDate=d=>d.toISOString().slice(0,10);';
if(!source.includes(isoAnchor))throw new Error('Final contract iso anchor missing');
const finalContractEngine=`function finalContractObject(raw,symbol,spot,target,stop){if(!raw)return null;const premiumNow=optionPrice(raw),premiumTarget=estimateContract(raw,spot,target,.35),premiumStop=estimateContract(raw,spot,stop,.15),sp=spreadPct(raw),reward=Math.max((premiumTarget||0)-(premiumNow||0),0),risk=Math.max((premiumNow||0)-(premiumStop||0),.01),rr=reward/risk;return{symbol:raw.symbol,strike:raw.strike,type:raw.type,expiry:raw.expiry,dte:round(raw.daysToExpiry,1),bid:raw.bid>0?round(raw.bid):null,ask:raw.ask>0?round(raw.ask):null,mid:round(premiumNow),priceSource:raw.priceSource,hasQuote:sp!=null,referencePrice:round(raw.referencePrice),iv:round(raw.iv*100,1),delta:round(raw.delta,2),gamma:round(raw.gamma,3),theta:round(raw.theta,3),vega:round(raw.vega,3),volume:raw.volume,openInterest:raw.openInterest,spreadPct:round(sp,1),estimatedAtTarget:round(premiumTarget),estimatedAtStop:round(premiumStop),targetPct:round(premiumNow>0?(premiumTarget-premiumNow)/premiumNow*100:null,1),stopPct:round(premiumNow>0?(premiumStop-premiumNow)/premiumNow*100:null,1),rr:round(rr,2),score:optionScore(raw,symbol,spot)}}
function alignFinalContract(snapshot,result){if(!result||!['CALL','PUT'].includes(result.direction))return result;const dir=result.direction,spot=Number(result.spot),atrMove=Number(result.indicators?.atr14)||spot*.02,dayHigh=Number(result.session?.high),dayLow=Number(result.session?.low),pdh=Number(result.pivots?.pdh),pdl=Number(result.pivots?.pdl);let target=spot,stop=spot;if(dir==='CALL'){const structural=Number.isFinite(pdh)?Math.max(pdh,spot+.55*atrMove):spot+.55*atrMove;target=Math.min(structural,spot+.9*atrMove);stop=Math.max(Number.isFinite(dayLow)?dayLow:spot-.35*atrMove,spot-.35*atrMove)}else{const structural=Number.isFinite(pdl)?Math.min(pdl,spot-.55*atrMove):spot-.55*atrMove;target=Math.max(structural,spot-.9*atrMove);stop=Math.min(Number.isFinite(dayHigh)?dayHigh:spot+.35*atrMove,spot+.35*atrMove)}result.setup={...result.setup,stockTarget:round(target),invalidation:round(stop)};const raw=chooseContract(snapshot.options||[],dir,spot,snapshot.symbol);result.contract=finalContractObject(raw,snapshot.symbol,spot,target,stop);const contractGood=Boolean(result.contract)&&Number(result.contract.rr)>=2&&(result.contract.spreadPct==null||Number(result.contract.spreadPct)<=10)&&Number(result.contract.openInterest||0)>=100;result.contractStatus=['CALL','PUT'].includes(result.state)&&Number(result.confidence)>=70&&contractGood?'CONFIRMED':'WATCH';if(!result.contract)result.setup.reasons=[...new Set(['لم يوجد عقد '+dir+' مناسب رغم وصول سلسلة العقود',...(result.setup?.reasons||[])])].slice(0,16);else if(!contractGood)result.setup.reasons=[...new Set(['اتجاه السهم قائم لكن العقد الحالي لم يجتز فلتر RR/السيولة',...(result.setup?.reasons||[])])].slice(0,16);return result}
function analyze(snapshot,settings={}){return alignFinalContract(snapshot,analyzeBase(snapshot,settings))}
`;
source=source.replace(isoAnchor,finalContractEngine+isoAnchor);

// Persist every confirmed suggested options contract in browser storage so it does not disappear when the live signal changes.
const contractAnchor='<article class="contract"><h2>العقد المقترح وتسعيره</h2><div id="contract">—</div><div id="optionNote" class="warn"></div></article>';
const contractWithHistory=contractAnchor+'<article class="chain" id="contractHistoryCard"><div class="panelHead"><div><h2>سجل العقود المقترحة</h2><p class="scanMeta">يبقى الاقتراح محفوظًا حتى بعد تغير الإشارة أو تحديث الصفحة. لا يسجل إلا عقد اجتاز فلتر الجودة مع تأكيد 70% فأعلى.</p></div><button id="clearContractHistory" class="compact">مسح السجل</button></div><div class="tableWrap"><table class="scanTable" style="min-width:980px"><thead><tr><th>الوقت</th><th>الرمز</th><th>الاتجاه</th><th>العقد</th><th>الانتهاء</th><th class="num">Strike</th><th class="num">الدخول</th><th class="num">الهدف</th><th class="num">الوقف</th><th class="num">الثقة</th></tr></thead><tbody id="contractHistoryBody"><tr><td colspan="10" class="loadingRow">لا توجد عقود مسجلة بعد</td></tr></tbody></table></div></article>';
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
function renderContractHistory(){const body=$('#contractHistoryBody');if(!body)return;const rows=readContractHistory();if(!rows.length){body.innerHTML='<tr><td colspan="10" class="loadingRow">لا توجد عقود مسجلة بعد</td></tr>';return}body.innerHTML=rows.map(x=>'<tr><td>'+contractHistoryTime(x.firstSeenAt)+'</td><td><b>'+x.underlying+'</b></td><td class="'+(x.direction==='CALL'?'CALL':'PUT')+'"><b>'+x.direction+'</b></td><td class="contractCode">'+x.contractSymbol+'</td><td>'+x.expiry+'</td><td class="num">'+money(x.strike)+'</td><td class="num">'+money(x.entry)+'</td><td class="num positive">'+money(x.target)+'</td><td class="num negative">'+money(x.stop)+'</td><td class="num">'+x.confidence+'%</td></tr>').join('')}
function saveSuggestedContract(underlying,d){const c=d?.contract;if(!c?.symbol||d.contractStatus!=='CONFIRMED'||Number(d.confidence)<70||!['CALL','PUT'].includes(d.state))return;const now=new Date().toISOString(),rows=readContractHistory(),key=[underlying,c.symbol,d.direction].join('|'),i=rows.findIndex(x=>x.key===key),record={key,underlying,direction:d.direction,contractSymbol:c.symbol,expiry:c.expiry,strike:c.strike,entry:c.mid,target:c.estimatedAtTarget,stop:c.estimatedAtStop,targetPct:c.targetPct,stopPct:c.stopPct,confidence:d.confidence,firstSeenAt:i>=0?rows[i].firstSeenAt:now,lastSeenAt:now};if(i>=0)rows.splice(i,1);rows.unshift(record);writeContractHistory(rows);renderContractHistory()}
function latestSavedContract(underlying){return readContractHistory().find(x=>x.underlying===underlying)||null}
function savedContractHTML(x){return '<div class="warn" style="margin-bottom:10px">لا توجد إشارة عقد مؤكدة جديدة الآن — هذا آخر عقد مسجل سابقًا ولا يُعتبر إشارة حالية.</div><div class="contractGrid"><div class="pill"><small>Contract</small><br><b>'+x.contractSymbol+'</b></div><div class="pill"><small>Direction</small><br><b class="'+(x.direction==='CALL'?'CALL':'PUT')+'">'+x.direction+'</b></div><div class="pill"><small>Expiry</small><br><b>'+x.expiry+'</b></div><div class="pill"><small>Strike</small><br><b>'+money(x.strike)+'</b></div><div class="pill"><small>Entry recorded</small><br><b>'+money(x.entry)+'</b></div><div class="pill"><small>Target recorded</small><br><b class="positive">'+money(x.target)+'</b></div><div class="pill"><small>Stop recorded</small><br><b class="negative">'+money(x.stop)+'</b></div><div class="pill"><small>Confidence</small><br><b>'+x.confidence+'%</b></div></div>'}
`;
if(!source.includes(loadConfigAnchor))throw new Error('History function anchor missing');
source=source.replace(loadConfigAnchor,historyFunctions+loadConfigAnchor);

const contractIf='    if(d.contract){\n      const c=d.contract;';
const contractIfSave="    if(d.contract){\n      if(d.contractStatus==='CONFIRMED')saveSuggestedContract(s,d);\n      const c=d.contract;";
if(!source.includes(contractIf))throw new Error('Contract display anchor missing');
source=source.replace(contractIf,contractIfSave);

const noContractLine="    }else $('#contract').textContent=d.instrumentPolicy&&!d.instrumentPolicy.active?'خارج نافذة SPX؛ لا يوجد اقتراح عقد.':'لا يوجد عقد مناسب/بيانات عقود غير متوفرة';";
const noContractPersist="    }else{const saved=latestSavedContract(s);if(saved)$('#contract').innerHTML=savedContractHTML(saved);else $('#contract').textContent=d.instrumentPolicy&&!d.instrumentPolicy.active?'خارج نافذة SPX؛ لا يوجد اقتراح عقد.':'لا يوجد عقد مناسب/بيانات عقود غير متوفرة'};";
if(!source.includes(noContractLine))throw new Error('No-contract display anchor missing');
source=source.replace(noContractLine,noContractPersist);

// Make the visible option chain follow the final signal direction automatically.
const chainCall="    setOptionChain(d.optionChain||[],d.contract?.symbol||null,d.optionDiagnostics||{});";
const chainCallSynced="    setOptionChain(d.optionChain||[],d.contract?.symbol||null,d.optionDiagnostics||{});\n    if(['CALL','PUT'].includes(d.direction)){ $('#chainType').value=d.direction; renderOptionChain(); }\n    if(d.contract&&d.contractStatus==='WATCH'&&!d.optionDataError)$('#optionNote').textContent='اتجاه قائم، لكن العقد الحالي مراقبة فقط حتى يجتاز RR والسيولة.';";
if(!source.includes(chainCall))throw new Error('Chain direction sync anchor missing');
source=source.replace(chainCall,chainCallSynced);

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