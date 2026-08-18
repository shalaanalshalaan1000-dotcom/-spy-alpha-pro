import http from 'node:http';
import {createHmac,createPublicKey,randomBytes,timingSafeEqual,verify as verifySignature} from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const MASSIVE_BASE = 'https://api.massive.com';
const STOCK_WATCHLIST = ['SPY','QQQ','IWM','NVDA'];
const WATCHLIST = [...STOCK_WATCHLIST,'SPX'];
const INDEX_ETFS = new Set(['SPY','QQQ','IWM','SPX']);
const SPECULATIVE_LIMIT = 6;
const SPECULATIVE_VERIFY_LIMIT = 12;

const HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SPY Alpha Pro V4</title><style>
:root{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#080b12;color:#eef2ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#111a2d,#080b12 42%);min-height:100vh}header{display:flex;justify-content:space-between;align-items:center;padding:20px max(16px,5vw);border-bottom:1px solid #26324a;background:#0c111ddd;position:sticky;top:0;backdrop-filter:blur(12px);z-index:2}h1{margin:0;font-size:25px}header p{margin:4px 0 0;color:#c8b66f;font-size:12px}.badge{padding:8px 12px;border:1px solid #405071;border-radius:999px;font-weight:800}main{max-width:1120px;margin:auto;padding:18px}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.toolbar .logout{margin-inline-start:auto;color:#b9c7e4;text-decoration:none;border:1px solid #334155;border-radius:10px;padding:9px 12px;font-weight:800;font-size:12px}.stockLabel{color:#93a4c5;font-size:12px;font-weight:900}select,button{background:#111827;color:white;border:1px solid #334155;border-radius:10px;padding:10px 14px;font-weight:800}button{cursor:pointer}.hero{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}.hero>div,article{background:#0e1524;border:1px solid #243149;border-radius:16px;padding:15px}.hero span{display:block;color:#8ea0c0;font-size:12px}.hero strong{font-size:23px;display:block;margin-top:6px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}h2{font-size:15px;margin:0 0 12px;color:#c8d4ee}.kv{display:grid;grid-template-columns:1fr auto;gap:8px;padding:7px 0;border-bottom:1px dashed #26344e}.kv:last-child{border:0}.muted{color:#8ea0c0}.contract{margin-top:10px}.contractGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.pill{padding:8px;background:#131d31;border-radius:10px;overflow-wrap:anywhere}.risk{color:#8b98b3;font-size:12px;line-height:1.7}.CALL{color:#52e5a5}.PUT{color:#ff718c}.WATCH{color:#ffd166}.NO-TRADE{color:#a3acc0}.warn{color:#ffd166;font-size:12px}.err{color:#ff718c}.small{font-size:11px;color:#8ea0c0}@media(max-width:760px){.hero{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.contractGrid{grid-template-columns:repeat(2,1fr)}header{padding:14px}main{padding:12px}}

.hero{grid-template-columns:repeat(6,minmax(0,1fr))}
.chartCard,.scanner{margin-bottom:12px}
.panelHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
.panelHead h2{margin:0}.chartWrap{height:520px;border-radius:12px;overflow:hidden;background:#0a0f1a}
.chartNote,.scanMeta{margin:9px 0 0;color:#8ea0c0;font-size:11px}
.compact{padding:7px 10px;font-size:12px}.bestNow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;margin-bottom:10px;border:1px solid #2c4665;border-radius:12px;background:linear-gradient(90deg,#10233a,#111a2d)}
.bestNow span{color:#93a4c5;font-size:12px}.bestNow strong{font-size:19px}.tableWrap{overflow-x:auto;border:1px solid #243149;border-radius:12px}
.scanTable{width:100%;border-collapse:collapse;min-width:670px}.scanTable th,.scanTable td{padding:11px 12px;border-bottom:1px solid #243149;text-align:right;white-space:nowrap}
.scanTable th{color:#8ea0c0;font-size:11px;background:#101827}.scanTable td{font-size:13px}.scanTable tbody tr{cursor:pointer;transition:background .15s}.scanTable tbody tr:hover,.scanTable tbody tr.top{background:#14223a}.scanTable tbody tr:last-child td{border-bottom:0}
.num{direction:ltr;text-align:left!important}.nearHigh{color:#52e5a5;font-weight:800}.positive{color:#52e5a5}.negative{color:#ff718c}.loadingRow{text-align:center!important;color:#8ea0c0!important}
.specScanner{border-color:#5c3558;background:linear-gradient(145deg,#191121,#0e1524 58%)}.verified{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid #3e755e;border-radius:999px;color:#70e4ae;background:#10271f;font-size:11px;font-weight:900}.specNote{margin:9px 0 0;color:#a994bd;font-size:11px;line-height:1.7}
.instrumentPolicy{margin:-4px 0 14px;padding:9px 12px;border:1px solid #334155;border-radius:10px;color:#93a4c5;background:#0c1320;font-size:11px;line-height:1.7}.instrumentPolicy.spx{border-color:#71552b;color:#e9cf82;background:#211b10}.spxRow{box-shadow:inset -3px 0 #d6ad52}
.chain{margin-top:12px}.chainControls{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:10px}.chainControls label{display:grid;gap:5px;color:#8ea0c0;font-size:11px}.chainCount{padding:7px 10px;border:1px solid #334155;border-radius:999px;color:#c8d4ee;font-size:12px;font-weight:800}
.chainWrap{max-height:680px;overflow:auto;border:1px solid #243149;border-radius:12px}.chainTable{width:100%;border-collapse:separate;border-spacing:0;min-width:1780px}.chainTable th,.chainTable td{padding:10px 11px;border-bottom:1px solid #243149;text-align:right;white-space:nowrap;font-size:12px}.chainTable th{position:sticky;top:0;z-index:1;background:#101827;color:#8ea0c0;font-size:11px}.chainTable tbody tr:hover{background:#121f34}.chainTable tbody tr.suggested{background:#123027;box-shadow:inset -4px 0 #52e5a5}.chainTable tbody tr:last-child td{border-bottom:0}.typeTag,.signalTag{display:inline-flex;justify-content:center;min-width:72px;padding:5px 8px;border-radius:999px;background:#131d31;font-weight:900}.chainNote{margin:8px 0 10px;color:#8ea0c0;font-size:11px;line-height:1.6}.contractCode{direction:ltr;text-align:left!important;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.goldPanel{margin-bottom:12px;border-color:#80652d;background:linear-gradient(145deg,#18170f,#0e1524 52%);box-shadow:inset 0 1px #e7c86b22}.goldHead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.goldTitle{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.goldTitle h2{margin:0;color:#f4dfa0;font-size:18px}.goldTag{display:inline-flex;padding:6px 9px;border:1px solid #9b7932;border-radius:999px;color:#f5d773;background:#241f10;font-size:11px;font-weight:900;direction:ltr}.goldMetrics{display:grid;grid-template-columns:1.4fr repeat(5,1fr);gap:9px;margin-bottom:12px}.goldMetric{padding:11px 12px;border:1px solid #4d4328;border-radius:12px;background:#111725}.goldMetric span{display:block;color:#a99d79;font-size:11px}.goldMetric strong{display:block;margin-top:6px;font-size:17px;direction:ltr;text-align:right}.goldMetric.price strong{font-size:27px;color:#f5d773}.goldPlan{padding:13px;margin-bottom:12px;border:1px solid #5f502b;border-radius:13px;background:#121723}.goldPlanHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.goldPlanHead h3{margin:0;color:#e9d89f;font-size:14px}.goldPlanStatus{padding:6px 9px;border:1px solid #5f502b;border-radius:999px;font-size:11px;font-weight:900}.goldPlanGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.goldPlanCard{padding:11px;border:1px solid #393a33;border-radius:11px;background:#0d1421}.goldPlanCard span,.goldPlanCard small{display:block;color:#9b977f;font-size:11px}.goldPlanCard strong{display:block;margin:6px 0;font-size:19px;direction:ltr;text-align:right}.goldPlanNote{margin:10px 0 0;color:#a99d79;font-size:11px;line-height:1.7}.goldChartWrap{height:440px;border-radius:12px;overflow:hidden;background:#0a0f1a}.goldNote{margin:9px 0 0;color:#a99d79;font-size:11px;line-height:1.7}.goldError{padding:10px;border:1px solid #693044;border-radius:10px;color:#ff8aa0;background:#2b1420;margin-bottom:10px}
@media(max-width:980px){.hero{grid-template-columns:repeat(3,1fr)}}
@media(max-width:980px){.goldMetrics{grid-template-columns:repeat(3,1fr)}.goldPlanGrid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:760px){.hero{grid-template-columns:repeat(2,1fr)}.chartWrap{height:430px}.goldChartWrap{height:390px}.goldMetrics,.goldPlanGrid{grid-template-columns:repeat(2,1fr)}.goldHead{flex-direction:column}.goldPlanHead{align-items:flex-start;flex-direction:column}.panelHead{align-items:flex-start}.bestNow{align-items:flex-start;flex-direction:column}.scanTable th,.scanTable td{padding:10px 9px}}

</style></head><body><header><div><h1>SPY Alpha Pro V4</h1><p>XAUUSD FOCUS • 4 CORE • SPX 0DTE • AUTO OPTIONS RADAR</p></div><div class="badge" id="mode">...</div></header><main>
<article class="goldPanel"><div class="goldHead"><div><div class="goldTitle"><h2>XAUUSD — الذهب الفوري</h2><span class="goldTag">SPOT • NO OPTIONS</span></div><p id="goldMeta" class="scanMeta">جارٍ تحميل القراءة اللحظية…</p></div><button id="goldRefresh" class="compact">تحديث الذهب</button></div><div id="goldError" class="goldError" hidden></div><section class="goldMetrics"><div class="goldMetric price"><span>سعر الأونصة بالدولار</span><strong id="goldPrice">—</strong></div><div class="goldMetric"><span>اتجاه القراءة القصيرة</span><strong id="goldDirection">—</strong></div><div class="goldMetric"><span>التغير خلال نافذة الرصد</span><strong id="goldChange">—</strong></div><div class="goldMetric"><span>أعلى قراءة</span><strong id="goldHigh">—</strong></div><div class="goldMetric"><span>أدنى قراءة</span><strong id="goldLow">—</strong></div><div class="goldMetric"><span>حداثة السعر</span><strong id="goldFreshness">—</strong></div></section><section class="goldPlan"><div class="goldPlanHead"><h3>أهداف الذهب التقديرية — نموذج 15 دقيقة</h3><span id="goldPlanStatus" class="goldPlanStatus muted">جمع البيانات</span></div><div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div><div class="goldPlanCard"><span>الهدف الأول</span><strong id="goldTarget1">—</strong><small id="goldEta1">المدة: —</small></div><div class="goldPlanCard"><span>الهدف الثاني</span><strong id="goldTarget2">—</strong><small id="goldEta2">المدة: —</small></div><div class="goldPlanCard"><span>إلغاء السيناريو</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">بيانات الرصد: —</small></div></div><p id="goldPlanNote" class="goldPlanNote">تُعرض الأهداف بعد اكتمال 15 دقيقة من العينات ووصول التأكيد إلى 75%؛ وإلا تبقى القراءة انتظار.</p></section><div id="goldChart" class="goldChartWrap"></div><p class="goldNote">قراءة XAU/USD الفورية فقط وليست عقودًا. السعر من Gold API ويُفحص كل 30 ثانية؛ الشارت 15 دقيقة من OANDA عبر TradingView وقد يظهر فرق بسيط بين المصدرين.</p></article>
<section class="toolbar"><span class="stockLabel">الأساسية + SPX + اختيارات الرادار</span><select id="symbol"></select><button id="refresh">تحليل الآن</button><label><input type="checkbox" id="auto" checked> تحديث تلقائي</label><a class="logout" id="logout" href="/logout" hidden>تسجيل الخروج</a></section><p id="instrumentPolicy" class="instrumentPolicy">SPY / QQQ / IWM / NVDA تعمل بالقواعد الأساسية. اختر SPX لمسار 0DTE المستقل.</p>
<section class="hero"><div><span>الإشارة</span><strong id="state">—</strong></div><div><span>الثقة</span><strong id="conf">—</strong></div><div><span>السعر</span><strong id="spot">—</strong></div><div><span>هاي اليوم</span><strong id="dayHigh">—</strong></div><div><span>لو اليوم</span><strong id="dayLow">—</strong></div><div><span>ATR(14) Daily</span><strong id="atr">—</strong></div></section>
<article class="scanner"><div class="panelHead"><div><h2>الإشارات الأساسية + SPX المستقل</h2><p id="scanMeta" class="scanMeta">تحميل الرادار…</p></div><button id="scanRefresh" class="compact">تحديث الإشارات</button></div><div id="scanBest" class="bestNow"><span>جارٍ حساب أقوى إشارة</span><strong>—</strong></div><div class="tableWrap"><table class="scanTable"><thead><tr><th>الرمز</th><th>الإشارة</th><th class="num">التأكيد</th><th class="num">السعر</th><th class="num">هاي اليوم</th><th class="num">عن الهاي</th><th class="num">تغير اليوم</th><th>السوق</th></tr></thead><tbody id="scanBody"><tr><td colspan="8" class="loadingRow">جارٍ التحميل…</td></tr></tbody></table></div></article>
<article class="scanner specScanner"><div class="panelHead"><div><h2>رادار أسهم العقود المضاربية — تلقائي</h2><p id="specMeta" class="scanMeta">فحص الأسهم المتحركة والتحقق من وجود العقود…</p></div><button id="specRefresh" class="compact">تحديث الرادار</button></div><div id="specBest" class="bestNow"><span>جارٍ اختيار أقوى سهم بعقود</span><strong>—</strong></div><div class="tableWrap"><table class="scanTable"><thead><tr><th>الرمز</th><th>الإشارة</th><th class="num">التأكيد</th><th class="num">السعر</th><th class="num">تغير اليوم</th><th class="num">الحجم</th><th class="num">سيولة $</th><th class="num">مدى اليوم</th><th>العقود</th></tr></thead><tbody id="specBody"><tr><td colspan="9" class="loadingRow">جارٍ الفحص…</td></tr></tbody></table></div><p class="specNote">الاختيار آلي من أقوى الأسهم صعودًا وهبوطًا، بشرط الحركة والسيولة والتحقق من وجود عقود نشطة. البيانات حسب تأخير باقة Massive وليست توصية شراء.</p></article>
<article class="chartCard"><div class="panelHead"><h2>الشارت — <span id="chartSymbol">SPY</span></h2><span class="small">5 دقائق • TradingView</span></div><div id="chart" class="chartWrap"></div><p class="chartNote">الشارت من TradingView، وأرقام الهاي والتحليل من Massive حسب تأخير باقة البيانات.</p></article>
<section class="grid"><article><h2>مناطق الارتكاز</h2><div id="pivots"></div></article><article><h2>ATR والحركة</h2><div id="atrbox"></div></article><article><h2>التأكيدات</h2><div id="indicators"></div></article><article><h2>خطة السهم</h2><div id="setup"></div></article></section>
<article class="contract"><h2>العقد المقترح وتسعيره</h2><div id="contract">—</div><div id="optionNote" class="warn"></div></article>
<article class="chain"><div class="panelHead"><div><h2>سلسلة العقود كاملة — <span id="chainSymbol">SPY</span></h2><p class="scanMeta">SPX يعرض عقود 0DTE لليوم فقط؛ بقية الرموز حتى 14 يومًا. العقد المقترح مميز بالأخضر.</p></div><span id="chainCount" class="chainCount">—</span></div><div class="chainControls"><label>نوع العقد<select id="chainType"><option value="ALL">CALL + PUT</option><option value="CALL">CALL فقط</option><option value="PUT">PUT فقط</option></select></label><label>تاريخ الانتهاء<select id="chainExpiry"><option value="ALL">كل التواريخ</option></select></label></div><div id="chainNote" class="chainNote">جارٍ تحميل العقود…</div><div class="chainWrap"><table class="chainTable"><thead><tr><th>العقد</th><th>النوع</th><th>الانتهاء</th><th class="num">DTE</th><th class="num">Strike</th><th class="num">بيع Bid</th><th class="num">شراء Ask</th><th class="num">السعر</th><th class="num">الهدف %</th><th class="num">الوقف %</th><th class="num">IV %</th><th class="num">Delta</th><th class="num">Gamma</th><th class="num">Theta</th><th class="num">Volume</th><th class="num">OI</th><th class="num">Spread</th><th>مصدر السعر</th></tr></thead><tbody id="optionChainBody"><tr><td colspan="18" class="loadingRow">جارٍ التحميل…</td></tr></tbody></table></div></article>
<article><h2>سبب الإشارة</h2><ul id="reasons"></ul></article><p class="risk">أداة تحليلية وليست ضمانًا للربح. يتم خفض الإشارة عند ضعف السيولة أو استهلاك ATR أو سوء RR، وتُعرض NO TRADE عند البيانات القديمة.</p>
</main><script>
const $=s=>document.querySelector(s); let cfg,activeChartSymbol=null,scanLoading=false,specLoading=false,goldLoading=false,goldChartReady=false,goldSamples=[],analysisSeq=0,allContracts=[],suggestedContractSymbol=null,speculativeSymbols=new Set();
const TV_EXCHANGE={SPY:'AMEX',QQQ:'NASDAQ',IWM:'AMEX',NVDA:'NASDAQ',SPX:'SP'};
const kv=(k,v)=>'<div class="kv"><span class="muted">'+k+'</span><b>'+(v??'—')+'</b></div>';
const money=v=>v==null?'—':'$'+Number(v).toFixed(2); const pct=v=>v==null?'—':Number(v).toFixed(1)+'%';
const sourceLabel=s=>({NBBO_MID:'Bid/Ask',LAST_TRADE:'آخر صفقة',DELAYED_DAY_CLOSE:'إغلاق متأخر',DELAYED_DAY_VWAP:'VWAP متأخر'}[s]||s||'—');
const signedPct=v=>v==null?'—':(Number(v)>0?'+':'')+Number(v).toFixed(1)+'%';
const signedGoldPct=v=>v==null?'—':(Number(v)>0?'+':'')+Number(v).toFixed(3)+'%';
const whole=v=>v==null?'—':Number(v).toLocaleString('en-US');
const compact=v=>v==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(v));
const GOLD_SAMPLE_KEY='spyAlphaGoldSamplesV2',GOLD_MIN_CONFIDENCE=75;
function prepareOptionChain(symbol){
  if($('#chainSymbol').textContent===symbol)return;
  $('#chainSymbol').textContent=symbol;
  $('#chainCount').textContent='...';
  $('#chainNote').textContent='جارٍ تحميل عقود '+symbol+'…';
  $('#optionChainBody').innerHTML='<tr><td colspan="18" class="loadingRow">جارٍ التحميل…</td></tr>';
}
function renderOptionChain(){
  const expiry=$('#chainExpiry').value||'ALL',type=$('#chainType').value||'ALL';
  const rows=allContracts.filter(c=>(expiry==='ALL'||c.expiry===expiry)&&(type==='ALL'||c.type===type));
  $('#chainCount').textContent=rows.length+' / '+allContracts.length;
  if(!rows.length){
    $('#optionChainBody').innerHTML='<tr><td colspan="18" class="loadingRow">لا توجد عقود مطابقة</td></tr>';
    return;
  }
  $('#optionChainBody').innerHTML=rows.map(c=>{
    const suggested=c.symbol===suggestedContractSymbol,typeClass=c.type==='CALL'?'CALL':'PUT';
    return '<tr class="'+(suggested?'suggested':'')+'"><td class="contractCode">'+c.symbol+(suggested?' ★':'')+'</td><td><span class="typeTag '+typeClass+'">'+c.type+'</span></td><td>'+c.expiry+'</td><td class="num">'+(c.dte??'—')+'</td><td class="num"><b>'+money(c.strike)+'</b></td><td class="num">'+money(c.bid)+'</td><td class="num">'+money(c.ask)+'</td><td class="num"><b>'+money(c.mid)+'</b></td><td class="num '+((c.targetPct||0)>=0?'positive':'negative')+'">'+signedPct(c.targetPct)+'</td><td class="num '+((c.stopPct||0)>=0?'positive':'negative')+'">'+signedPct(c.stopPct)+'</td><td class="num">'+(c.iv==null?'—':c.iv+'%')+'</td><td class="num">'+(c.delta??'—')+'</td><td class="num">'+(c.gamma??'—')+'</td><td class="num">'+(c.theta??'—')+'</td><td class="num">'+whole(c.volume)+'</td><td class="num">'+whole(c.openInterest)+'</td><td class="num">'+(c.spreadPct==null?'—':c.spreadPct+'%')+'</td><td>'+sourceLabel(c.priceSource)+'</td></tr>';
  }).join('');
}
function setOptionChain(items,suggested,diagnostics={}){
  const oldExpiry=$('#chainExpiry').value||'ALL',oldType=$('#chainType').value||'ALL';
  allContracts=Array.isArray(items)?items:[];
  suggestedContractSymbol=suggested||null;
  const expiries=[...new Set(allContracts.map(c=>c.expiry).filter(Boolean))].sort();
  $('#chainExpiry').innerHTML='<option value="ALL">كل التواريخ</option>'+expiries.map(x=>'<option value="'+x+'">'+x+'</option>').join('');
  $('#chainExpiry').value=expiries.includes(oldExpiry)?oldExpiry:'ALL';
  $('#chainType').value=['ALL','CALL','PUT'].includes(oldType)?oldType:'ALL';
  const quotes=Number(diagnostics.withQuotes||0);
  $('#chainNote').textContent=allContracts.length?('تم تحميل '+allContracts.length+' عقد'+(quotes===0?' • باقة Starter لا تعرض Bid/Ask؛ السعر مرجعي ومتأخر.':' • اضغط المرشحات لتضييق القائمة.')):'لم تصل عقود من مزود البيانات.';
  renderOptionChain();
}
async function loadConfig(){cfg=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json()); $('#mode').textContent=cfg.mode+' / '+cfg.provider; $('#symbol').innerHTML=cfg.watchlist.map(s=>'<option value="'+s+'">'+(s==='SPX'?'SPX • 0DTE مستقل':s)+'</option>').join(''); $('#logout').hidden=!cfg.user;}
const tvSymbol=s=>TV_EXCHANGE[s]?TV_EXCHANGE[s]+':'+s:s;
function renderChart(symbol){
  if(activeChartSymbol===symbol)return;
  activeChartSymbol=symbol;
  $('#chartSymbol').textContent=symbol;
  const host=$('#chart');
  host.innerHTML='<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:calc(100% - 28px);width:100%"></div><div class="tradingview-widget-copyright" style="height:28px;padding-top:5px;text-align:center;font-size:11px"><a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank" style="color:#8ea0c0">Chart by TradingView</a></div></div>';
  const script=document.createElement('script');
  script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  script.type='text/javascript';
  script.async=true;
  script.textContent=JSON.stringify({autosize:true,symbol:tvSymbol(symbol),interval:'5',timezone:'America/New_York',theme:'dark',backgroundColor:'rgba(8, 11, 18, 1)',style:'1',locale:'en',allow_symbol_change:false,hide_side_toolbar:false,withdateranges:true,save_image:false,details:false,hotlist:false,calendar:false,support_host:'https://www.tradingview.com'});
  host.firstElementChild.appendChild(script);
}
function renderGoldChart(){
  if(goldChartReady)return;
  goldChartReady=true;
  const host=$('#goldChart');
  host.innerHTML='<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:calc(100% - 28px);width:100%"></div><div class="tradingview-widget-copyright" style="height:28px;padding-top:5px;text-align:center;font-size:11px"><a href="https://www.tradingview.com/symbols/XAUUSD/" rel="noopener nofollow" target="_blank" style="color:#a99d79">XAUUSD chart by TradingView</a></div></div>';
  const script=document.createElement('script');
  script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  script.type='text/javascript';
  script.async=true;
  script.textContent=JSON.stringify({autosize:true,symbol:'OANDA:XAUUSD',interval:'15',timezone:'Asia/Riyadh',theme:'dark',backgroundColor:'rgba(8, 11, 18, 1)',style:'1',locale:'en',allow_symbol_change:false,hide_side_toolbar:false,withdateranges:true,save_image:false,details:false,hotlist:false,calendar:false,support_host:'https://www.tradingview.com'});
  host.firstElementChild.appendChild(script);
}
const goldAgeLabel=seconds=>{const age=Math.max(0,Number(seconds)||0);if(age<5)return'الآن';if(age<60)return Math.round(age)+' ث';return Math.round(age/60)+' د'};
function restoreGoldSamples(){
  try{
    const now=Date.now(),rows=JSON.parse(localStorage.getItem(GOLD_SAMPLE_KEY)||'[]'),clean=(Array.isArray(rows)?rows:[]).map(x=>({price:Number(x.price),t:Number(x.t)})).filter(x=>Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.t)&&x.t>=now-2*60*60_000&&x.t<=now+60_000).sort((a,b)=>a.t-b.t),unique=[];
    for(const row of clean){const last=unique.at(-1);if(last&&last.t===row.t)last.price=row.price;else unique.push(row)}
    return unique.slice(-240);
  }catch{return[]}
}
function saveGoldSamples(){try{localStorage.setItem(GOLD_SAMPLE_KEY,JSON.stringify(goldSamples.slice(-240)))}catch{}}
function computeGoldPlan(samples,price,now,stale){
  const fixed=(value,digits=2)=>Number.isFinite(value)?Number(value.toFixed(digits)):null,windowed=samples.filter(x=>x.t>=now-60*60_000&&x.t<=now+60_000);let continuousFrom=0;for(let i=1;i<windowed.length;i++)if(windowed[i].t-windowed[i-1].t>3*60_000)continuousFrom=i;const recent=windowed.slice(continuousFrom),n=recent.length,span=n>1?(recent.at(-1).t-recent[0].t)/60_000:0,base={state:'COLLECTING',confidence:0,target1:null,target2:null,invalidation:null,eta1:null,eta2:null,sampleCount:n,spanMinutes:fixed(span,1),channel:null};
  if(stale)return{...base,state:'STALE',note:'سعر الذهب قديم؛ أوقفت الأهداف حتى تصل قراءة حديثة.'};
  if(n<10||span<15)return{...base,note:'جمع '+fixed(span,1)+' من 15 دقيقة مطلوبة لبناء القناة وتقدير المدة.'};
  const firstT=recent[0].t,times=recent.map(x=>(x.t-firstT)/60_000),meanT=times.reduce((a,b)=>a+b,0)/n,meanP=recent.reduce((a,b)=>a+b.price,0)/n,varianceT=times.reduce((a,t)=>a+(t-meanT)*(t-meanT),0);
  if(varianceT<=0)return{...base,note:'العينات الحالية لا تكفي لحساب اتجاه زمني.'};
  const slope=recent.reduce((sum,x,i)=>sum+(times[i]-meanT)*(x.price-meanP),0)/varianceT,intercept=meanP-slope*meanT,predicted=intercept+slope*times.at(-1),residuals=recent.map((x,i)=>x.price-(intercept+slope*times[i])),rmse=Math.sqrt(residuals.reduce((sum,x)=>sum+x*x,0)/n);
  let logSquares=0,elapsed=0;
  for(let i=1;i<n;i++){const dt=(recent[i].t-recent[i-1].t)/60_000;if(dt<=0)continue;const r=Math.log(recent[i].price/recent[i-1].price);logSquares+=r*r;elapsed+=dt}
  const sigmaPerSqrtMinute=elapsed>0?price*Math.sqrt(logSquares/elapsed):0,expected15=sigmaPerSqrtMinute*Math.sqrt(15),prices=recent.map(x=>x.price),range=Math.max(...prices)-Math.min(...prices),totalMove=slope*span,noise=Math.max(rmse,expected15*.55,price*.00005),snr=Math.abs(totalMove)/noise,aligned=Math.abs(price-predicted)<=Math.max(rmse,price*.00005)||(slope>0?price>predicted:price<predicted);
  let confidence=Math.round(45+Math.min(23,snr*7)+Math.min(12,span*.8)+Math.min(8,n/4));
  if(!aligned)confidence-=8;
  if(Math.abs(totalMove)<price*.00025)confidence-=10;
  confidence=Math.max(0,Math.min(92,confidence));
  const channel=Math.abs(totalMove)<price*.0001?'FLAT':slope>0?'RISING':'FALLING';
  if(confidence<GOLD_MIN_CONFIDENCE)return{...base,state:'WAIT',confidence,channel,slopePerMinute:fixed(slope,3),note:'التأكيد '+confidence+'% أقل من 75%؛ لا أعرض هدفًا حتى تتضح الحركة.'};
  const move=Math.min(price*.006,Math.max(price*.0004,expected15,rmse*1.5,range*.28)),direction=slope>0?1:-1,target1=price+direction*move,target2=price+direction*move*1.75,channelHalf=Math.max(rmse*1.6,move*.55),invalidation=price-direction*Math.max(move*.75,channelHalf),pace=Math.max(Math.abs(slope),move/30),eta=(distance,min,max)=>{const center=distance/pace,round5=value=>Math.max(5,Math.round(value/5)*5),low=Math.max(min,Math.min(max,round5(center*.7))),high=Math.max(low+5,Math.min(max,round5(center*1.5)));return low+'–'+high+' دقيقة'};
  return{...base,state:direction>0?'UP':'DOWN',confidence,channel,slopePerMinute:fixed(slope,3),expectedMove15:fixed(move),target1:fixed(target1),target2:fixed(target2),invalidation:fixed(invalidation),eta1:eta(move,5,120),eta2:eta(move*1.75,10,240),note:'المدة نطاق تقديري مشروط باستمرار زخم القناة؛ لمس مستوى الإلغاء يبطل السيناريو.'};
}
function goldBrowserReading(raw){
  const price=Number(raw.price),updatedAt=new Date(raw.updatedAt),now=Date.now();
  if(!Number.isFinite(price)||price<=0||Number.isNaN(updatedAt.getTime()))throw new Error('مصدر الذهب أعاد قراءة غير صالحة');
  const normalizedAt=updatedAt.toISOString(),sampleTime=updatedAt.getTime(),last=goldSamples.at(-1);
  if(!last||sampleTime>last.t)goldSamples.push({price,t:sampleTime});else if(sampleTime===last.t)last.price=price;
  goldSamples=goldSamples.filter(x=>x.t>=now-2*60*60_000&&x.t<=now+60_000).slice(-240);saveGoldSamples();
  const displaySamples=goldSamples.filter(x=>x.t>=now-60*60_000),oldest=displaySamples[0]||{price,t:sampleTime},prices=displaySamples.length?displaySamples.map(x=>x.price):[price],changePct=oldest.price>0?(price-oldest.price)/oldest.price*100:null;
  let direction='COLLECTING';
  if(displaySamples.length>=3)direction=Math.abs(changePct)<.02?'FLAT':changePct>0?'UP':'DOWN';
  const fixed=(value,digits=2)=>Number.isFinite(value)?Number(value.toFixed(digits)):null;
  const stale=now-updatedAt.getTime()>120_000;
  return{price:fixed(price),updatedAt:normalizedAt,ageSeconds:Math.max(0,Math.round((now-updatedAt.getTime())/1000)),stale,direction,changePct:fixed(changePct,3),windowHigh:fixed(Math.max(...prices)),windowLow:fixed(Math.min(...prices)),windowMinutes:fixed(Math.max(0,(sampleTime-oldest.t)/60_000),1),plan:computeGoldPlan(goldSamples,price,now,stale)};
}
function renderGoldPlan(plan){
  const labels={UP:'صاعد',DOWN:'هابط',WAIT:'انتظار',COLLECTING:'جمع البيانات',STALE:'متوقف'},classes={UP:'positive',DOWN:'negative',WAIT:'WATCH',COLLECTING:'muted',STALE:'negative'},active=['UP','DOWN'].includes(plan.state),channelLabel=plan.channel==='RISING'?'قناة صاعدة':plan.channel==='FALLING'?'قناة هابطة':plan.channel==='FLAT'?'حركة متوازنة':'قناة قيد البناء';
  $('#goldPlanStatus').textContent=labels[plan.state]||'انتظار';$('#goldPlanStatus').className='goldPlanStatus '+(classes[plan.state]||'muted');
  $('#goldScenario').textContent=labels[plan.state]||'انتظار';$('#goldScenario').className=classes[plan.state]||'muted';
  $('#goldConfidence').textContent=plan.state==='COLLECTING'?(plan.sampleCount+' عينة • '+plan.spanMinutes+' / 15 د'):('التأكيد '+plan.confidence+'% • المطلوب 75%');
  $('#goldTarget1').textContent=active?money(plan.target1):'—';$('#goldTarget1').className=plan.state==='UP'?'positive':plan.state==='DOWN'?'negative':'';
  $('#goldTarget2').textContent=active?money(plan.target2):'—';$('#goldTarget2').className=plan.state==='UP'?'positive':plan.state==='DOWN'?'negative':'';
  $('#goldEta1').textContent='المدة: '+(plan.eta1||'—');$('#goldEta2').textContent='المدة: '+(plan.eta2||'—');
  $('#goldInvalidation').textContent=active?money(plan.invalidation):'—';$('#goldInvalidation').className=active?'WATCH':'';
  $('#goldModelWindow').textContent=channelLabel+' • رصد '+plan.spanMinutes+' د';$('#goldPlanNote').textContent=plan.note;
}
async function loadGold(){
  if(goldLoading)return;
  goldLoading=true;
  $('#goldRefresh').disabled=true;
  $('#goldError').hidden=true;
  try{
    const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store'}),raw=await r.json(),d=goldBrowserReading(raw);
    if(!r.ok||d.error)throw new Error(d.error||'Gold request failed');
    const labels={UP:'صاعد',DOWN:'هابط',FLAT:'متوازن',COLLECTING:'جمع البيانات'},classes={UP:'positive',DOWN:'negative',FLAT:'WATCH',COLLECTING:'muted'};
    $('#goldPrice').textContent=money(d.price);
    $('#goldDirection').textContent=labels[d.direction]||'—';
    $('#goldDirection').className=classes[d.direction]||'';
    $('#goldChange').textContent=signedGoldPct(d.changePct);
    $('#goldChange').className=d.changePct==null?'':(d.changePct>=0?'positive':'negative');
    $('#goldHigh').textContent=money(d.windowHigh);
    $('#goldLow').textContent=money(d.windowLow);
    $('#goldFreshness').textContent=goldAgeLabel(d.ageSeconds);
    $('#goldFreshness').className=d.stale?'negative':'positive';
    renderGoldPlan(d.plan);
    $('#goldMeta').textContent='Gold API • آخر تحديث '+new Date(d.updatedAt).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Riyadh'})+' بتوقيت الرياض • نافذة الرصد '+(d.windowMinutes<1?'< 1':Math.round(d.windowMinutes))+' د';
  }catch(e){
    $('#goldMeta').textContent='تعذر تحميل قراءة الذهب';
    $('#goldError').textContent=e.message;
    $('#goldError').hidden=false;
  }finally{goldLoading=false;$('#goldRefresh').disabled=false;}
}
const fmtScanTime=v=>{if(!v)return'غير معروف';try{return new Intl.DateTimeFormat('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}).format(new Date(v))+' نيويورك'}catch{return new Date(v).toISOString()}};
function renderScan(d){
  const items=Array.isArray(d.items)?d.items:[];
  const best=items.find(x=>!x.stale&&['CALL','PUT'].includes(x.signal))||items.find(x=>!x.stale)||items[0];
  $('#scanMeta').textContent='إشارة سريعة لكل سهم • اضغط السهم للتحليل الكامل • آخر بيانات: '+fmtScanTime(d.updatedAt)+(d.mode==='LIVE'?' • Starter متأخرة 15 دقيقة':' • وضع تجريبي');
  if(best){
    $('#scanBest').innerHTML='<span>أقوى إشارة الآن</span><strong class="'+best.signal.replaceAll(' ','-')+'">'+best.symbol+' • '+best.signal+' • '+pct(best.confidence)+'</strong>';
  }else $('#scanBest').innerHTML='<span>لا توجد إشارات متاحة</span><strong>—</strong>';
  $('#scanBody').innerHTML=items.length?items.map((x,i)=>{
    const dist=x.distanceToHighPct==null?'—':(x.distanceToHighPct<=.05?'عند الهاي':pct(x.distanceToHighPct));
    const changeClass=(x.changePct||0)>=0?'positive':'negative',signalClass=(x.signal||'NO TRADE').replaceAll(' ','-');
    const rowClass=(i===0?'top ':'')+(x.symbol==='SPX'?'spxRow':'');
    return '<tr data-symbol="'+x.symbol+'" class="'+rowClass.trim()+'"><td><b>'+x.symbol+(x.symbol==='SPX'?' • 0DTE':'')+'</b></td><td><span class="signalTag '+signalClass+'">'+x.signal+'</span></td><td class="num"><b>'+pct(x.confidence)+'</b></td><td class="num">'+money(x.price)+'</td><td class="num">'+money(x.high)+'</td><td class="num '+(x.distanceToHighPct!=null&&x.distanceToHighPct<=.20?'nearHigh':'')+'">'+dist+'</td><td class="num '+changeClass+'">'+signedPct(x.changePct)+'</td><td class="'+(x.dataError?'err':'')+'">'+(x.dataError?(x.marketStatus||'بيانات SPX غير متاحة'):(x.stale?(x.symbol==='SPX'&&x.marketStatus?x.marketStatus:'بيانات قديمة'):(x.marketStatus||'متاح')))+'</td></tr>';
  }).join(''):'<tr><td colspan="8" class="loadingRow">لا توجد بيانات</td></tr>';
}
async function loadScan(force=false){
  if(scanLoading)return;
  scanLoading=true;
  $('#scanRefresh').disabled=true;
  try{
    const r=await fetch('/api/scan'+(force?'?force=1':''),{cache:'no-store'});
    const d=await r.json();
    if(!r.ok||d.error)throw new Error(d.error||'Scanner request failed');
    renderScan(d);
  }catch(e){
    $('#scanMeta').textContent='تعذر تحديث القائمة';
    $('#scanBody').innerHTML='<tr><td colspan="6" class="loadingRow err">'+e.message+'</td></tr>';
  }finally{scanLoading=false;$('#scanRefresh').disabled=false;}
}
function syncSpeculativeSelector(items){
  const select=$('#symbol'),selected=select.value;
  speculativeSymbols=new Set(items.map(x=>x.symbol));
  select.querySelectorAll('option[data-auto]').forEach(x=>x.remove());
  for(const symbol of speculativeSymbols){const option=document.createElement('option');option.value=symbol;option.textContent=symbol+' • AUTO';option.dataset.auto='1';select.appendChild(option)}
  if(cfg?.watchlist?.includes(selected)||speculativeSymbols.has(selected))select.value=selected;
  else{select.value=cfg?.watchlist?.[0]||'SPY';void analyze()}
}
function renderSpeculative(d){
  const items=Array.isArray(d.items)?d.items:[];
  syncSpeculativeSelector(items);
  const best=items.find(x=>!x.stale&&['CALL','PUT'].includes(x.signal))||items.find(x=>!x.stale)||items[0];
  const delay=d.mode==='LIVE'?' • بيانات Starter متأخرة 15 دقيقة':' • يحتاج MASSIVE_API_KEY للوضع الحي';
  const status=d.error?(items.length?'تعذر التحديث؛ أعرض آخر نتيجة ناجحة':'تعذر الوصول إلى بيانات الرادار مؤقتًا'):(items.length?'تم التحقق من العقود النشطة • اضغط السهم للتحليل الكامل':'لا توجد أسهم اجتازت شروط الحركة والسيولة والعقود');
  $('#specMeta').textContent=status+' • آخر فحص: '+fmtScanTime(d.updatedAt)+delay+(d.cached?' • نسخة مخزنة':'');
  if(best)$('#specBest').innerHTML='<span>أقوى سهم مضاربي بعقود الآن</span><strong class="'+best.signal.replaceAll(' ','-')+'">'+best.symbol+' • '+best.signal+' • '+pct(best.confidence)+'</strong>';
  else $('#specBest').innerHTML='<span>لا توجد نتيجة مؤهلة حاليًا</span><strong>—</strong>';
  $('#specBody').innerHTML=items.length?items.map((x,i)=>{
    const changeClass=(x.changePct||0)>=0?'positive':'negative',signalClass=(x.signal||'NO TRADE').replaceAll(' ','-');
    return '<tr data-symbol="'+x.symbol+'" class="'+(i===0?'top':'')+'"><td><b>'+x.symbol+'</b></td><td><span class="signalTag '+signalClass+'">'+x.signal+'</span></td><td class="num"><b>'+pct(x.confidence)+'</b></td><td class="num">'+money(x.price)+'</td><td class="num '+changeClass+'">'+signedPct(x.changePct)+'</td><td class="num">'+compact(x.volume)+'</td><td class="num">$'+compact(x.dollarVolume)+'</td><td class="num">'+pct(x.rangePct)+'</td><td><span class="verified">✓ نشطة</span></td></tr>';
  }).join(''):'<tr><td colspan="9" class="loadingRow">لا توجد نتيجة مؤهلة الآن</td></tr>';
}
async function loadSpeculative(force=false){
  if(specLoading)return;
  specLoading=true;$('#specRefresh').disabled=true;
  try{
    const r=await fetch('/api/speculative'+(force?'?force=1':''),{cache:'no-store'}),d=await r.json();
    if(!r.ok)throw new Error(d.error||'Speculative scanner request failed');
    renderSpeculative(d);
  }catch(e){
    $('#specMeta').textContent='تعذر تحديث رادار أسهم العقود';
    $('#specBody').innerHTML='<tr><td colspan="9" class="loadingRow err"></td></tr>';
    $('#specBody td').textContent=e.message;
  }finally{specLoading=false;$('#specRefresh').disabled=false;}
}
function showInstrumentPolicy(symbol,policy=null){
  const node=$('#instrumentPolicy');
  if(symbol!=='SPX'){node.className='instrumentPolicy';node.textContent='القواعد الأساسية لهذا الرمز؛ SPX وحده يستخدم مسار 0DTE مستقل.';return}
  node.className='instrumentPolicy spx';
  node.textContent=policy?.message||'SPX: عقود 0DTE OTM فقط، تكلفة العقد بحد أقصى $150، والاقتراح يعمل 15:30–15:58 بتوقيت نيويورك.';
}
async function selectSymbol(symbol){
  if(!cfg?.watchlist?.includes(symbol)&&!speculativeSymbols.has(symbol))return;
  $('#symbol').value=symbol;
  await analyze();
  document.querySelector('.chartCard').scrollIntoView({behavior:'smooth',block:'start'});
}
async function analyze(){
  const s=$('#symbol').value,seq=++analysisSeq;
  showInstrumentPolicy(s);
  renderChart(s);
  prepareOptionChain(s);
  $('#state').textContent='...';
  $('#optionNote').textContent='';
  try{
    const r=await fetch('/api/analyze/'+s,{cache:'no-store'});
    const d=await r.json();
    if(seq!==analysisSeq)return;
    if(!r.ok||d.error)throw new Error(d.error||'Request failed');
    showInstrumentPolicy(s,d.instrumentPolicy);
    $('#state').textContent=d.state;
    $('#state').className=d.state.replaceAll(' ','-');
    $('#conf').textContent=d.confidence+'%';
    $('#spot').textContent=money(d.spot);
    $('#dayHigh').textContent=money(d.session?.high);
    $('#dayLow').textContent=money(d.session?.low);
    $('#atr').textContent=money(d.indicators.atr14)+' • '+pct(d.indicators.atrPct);
    $('#mode').textContent=d.mode+' / '+d.provider;
    $('#pivots').innerHTML=kv('PDH',money(d.pivots.pdh))+kv('PDL',money(d.pivots.pdl))+kv('Prev Close',money(d.pivots.prevClose))+kv('Swing High',money(d.pivots.swingHigh))+kv('Swing Low',money(d.pivots.swingLow))+kv('Whole Dollar',money(d.pivots.whole));
    $('#atrbox').innerHTML=kv('هاي اليوم',money(d.session?.high))+kv('لو اليوم',money(d.session?.low))+kv('المسافة عن الهاي',d.session?.distanceToHighPct==null?'—':pct(d.session.distanceToHighPct))+kv('ATR(14) Daily',money(d.indicators.atr14))+kv('ATR%',pct(d.indicators.atrPct))+kv('المستهلك اليوم',pct(d.indicators.atrConsumedPct))+kv('المتبقي',pct(d.indicators.atrRemainingPct))+kv('بعد السعر عن Pivot',(d.indicators.pivotDistanceAtr??'—')+' ATR');
    $('#indicators').innerHTML=kv(d.indicators.vwapReference?('VWAP مرجع '+d.indicators.vwapReference):'VWAP',money(d.indicators.vwap))+kv('EMA 9 / 20',money(d.indicators.ema9)+' / '+money(d.indicators.ema20))+kv('RSI(14)',d.indicators.rsi14)+kv('RVOL',(d.indicators.rvol??'—')+'x');
    $('#setup').innerHTML=kv('الاتجاه',d.direction)+kv(s==='SPX'?'هدف المؤشر':'هدف السهم',money(d.setup.stockTarget))+kv('Invalidation',money(d.setup.invalidation))+kv('Fresh',d.freshness.stale?'NO':'YES')+kv('تأخر البيانات',(d.freshness.ageMinutes??'—')+' دقيقة')+(d.instrumentPolicy?kv('نافذة SPX',d.instrumentPolicy.active?'مفتوحة حتى 15:58 ET':'مغلقة'):'');
    if(d.contract){
      const c=d.contract;
      $('#contract').innerHTML='<div class="contractGrid"><div class="pill"><small>Contract</small><br><b>'+c.symbol+'</b></div><div class="pill"><small>Expiry / DTE</small><br><b>'+c.expiry+' / '+c.dte+'</b></div><div class="pill"><small>Bid / Ask</small><br><b>'+money(c.bid)+' / '+money(c.ask)+'</b></div><div class="pill"><small>Premium now</small><br><b>'+money(c.mid)+'</b></div><div class="pill"><small>مصدر السعر</small><br><b>'+sourceLabel(c.priceSource)+'</b></div><div class="pill"><small>Target premium / %</small><br><b>'+money(c.estimatedAtTarget)+' <span class="positive">('+signedPct(c.targetPct)+')</span></b></div><div class="pill"><small>Stop premium / %</small><br><b>'+money(c.estimatedAtStop)+' <span class="negative">('+signedPct(c.stopPct)+')</span></b></div><div class="pill"><small>RR</small><br><b>'+(c.rr??'—')+'R</b></div><div class="pill"><small>IV / Delta</small><br><b>'+c.iv+'% / '+c.delta+'</b></div><div class="pill"><small>Gamma / Theta</small><br><b>'+c.gamma+' / '+c.theta+'</b></div><div class="pill"><small>Spread / OI / Vol</small><br><b>'+(c.spreadPct==null?'—':c.spreadPct+'%')+' / '+c.openInterest+' / '+c.volume+'</b></div></div>';
    }else $('#contract').textContent=d.instrumentPolicy&&!d.instrumentPolicy.active?'خارج نافذة SPX؛ لا يوجد اقتراح عقد.':'لا يوجد عقد مناسب/بيانات عقود غير متوفرة';
    if(d.optionDataError)$('#optionNote').textContent='Options data: '+d.optionDataError;
    else if(d.optionDiagnostics&&d.optionDiagnostics.totalContracts===0)$('#optionNote').textContent='لم تصل سلسلة عقود من مزود البيانات.';
    else if(d.optionDiagnostics&&d.optionDiagnostics.withQuotes===0)$('#optionNote').textContent='سلسلة العقود وصلت، لكن الباقة لا توفر Bid/Ask؛ السعر المعروض مرجعي ومتأخر.';
    setOptionChain(d.optionChain||[],d.contract?.symbol||null,d.optionDiagnostics||{});
    $('#reasons').innerHTML=d.setup.reasons.map(x=>'<li>'+x+'</li>').join('');
  }catch(e){
    if(seq!==analysisSeq)return;
    $('#state').textContent='ERROR';
    $('#state').className='err';
    $('#reasons').innerHTML='<li class="err">'+e.message+'</li>';
    $('#chainNote').textContent='تعذر تحميل العقود: '+e.message;
  }
}
$('#refresh').onclick=()=>{analyze();loadScan(true)};
$('#scanRefresh').onclick=()=>loadScan(true);
$('#specRefresh').onclick=()=>loadSpeculative(true);
$('#goldRefresh').onclick=loadGold;
$('#symbol').onchange=analyze;
$('#scanBody').onclick=e=>{const row=e.target.closest('tr[data-symbol]');if(row)selectSymbol(row.dataset.symbol)};
$('#specBody').onclick=e=>{const row=e.target.closest('tr[data-symbol]');if(row)selectSymbol(row.dataset.symbol)};
$('#chainType').onchange=renderOptionChain;
$('#chainExpiry').onchange=renderOptionChain;
(async()=>{
  goldSamples=restoreGoldSamples();
  await loadConfig();
  renderGoldChart();
  await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);
  setInterval(()=>{if($('#auto').checked)analyze()},30000);
  setInterval(()=>{if($('#auto').checked)loadScan()},60000);
  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);
  setInterval(()=>{if($('#auto').checked)loadGold()},30000);
})();
</script></body></html>`;

const AUTH_COOKIE='spy_alpha_session';
const OAUTH_STATE_COOKIE='spy_alpha_oauth_state';
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const allowedEmails=()=>new Set(String(process.env.ALLOWED_EMAILS||'').split(',').map(normalizeEmail).filter(Boolean));
const authEnabled=()=>String(process.env.AUTH_ENABLED||'false').toLowerCase()==='true';
const authReady=()=>authEnabled()&&allowedEmails().size>0&&Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&String(process.env.SESSION_SECRET||'').length>=32);
function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    try{out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}catch{}
  }
  return out;
}
function safeEqual(a,b){
  const left=Buffer.from(String(a||'')),right=Buffer.from(String(b||''));
  return left.length===right.length&&left.length>0&&timingSafeEqual(left,right);
}
function signValue(value){return createHmac('sha256',String(process.env.SESSION_SECRET||'')).update(value).digest('base64url')}
function createSession(email){
  const value=Buffer.from(JSON.stringify({email:normalizeEmail(email),exp:Date.now()+12*60*60*1000})).toString('base64url');
  return value+'.'+signValue(value);
}
function readSession(req){
  if(!authReady())return null;
  const token=parseCookies(req)[AUTH_COOKIE];
  if(!token)return null;
  const split=token.lastIndexOf('.');
  if(split<1)return null;
  const value=token.slice(0,split),signature=token.slice(split+1);
  if(!safeEqual(signature,signValue(value)))return null;
  try{
    const session=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    const email=normalizeEmail(session.email);
    return Number(session.exp)>Date.now()&&allowedEmails().has(email)?{email}:null;
  }catch{return null}
}
function requestBaseUrl(req){
  const forwarded=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim();
  const protocol=forwarded||((process.env.NODE_ENV==='production')?'https':'http');
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'localhost:'+PORT).split(',')[0].trim();
  return String(process.env.APP_BASE_URL||protocol+'://'+host).replace(/\/$/,'');
}
function cookieLine(name,value,req,{maxAge=600}={}){
  const secure=requestBaseUrl(req).startsWith('https://')?'; Secure':'';
  return name+'='+encodeURIComponent(value)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+secure;
}
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function loginPage({title='دخول SPY Alpha Pro V4',message='استخدم حساب Google المصرّح به.',error='' }={}){
  const ready=authReady();
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>:root{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#eef2ff;background:#080b12}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at top,#182741,#080b12 48%)}main{width:min(440px,100%);padding:28px;border:1px solid #2d3c58;border-radius:20px;background:#0e1524;box-shadow:0 22px 70px #0008}h1{margin:0 0 8px;font-size:24px}p{color:#9aaccb;line-height:1.8}.error{color:#ff8aa0;background:#301521;border:1px solid #6f2b42;padding:11px;border-radius:10px}.login{display:block;text-align:center;margin-top:20px;padding:13px 16px;border-radius:11px;background:#eef2ff;color:#101827;text-decoration:none;font-weight:900}.note{font-size:12px;color:#7183a5;margin-top:16px}</style></head><body><main><h1>${escapeHTML(title)}</h1><p>${escapeHTML(message)}</p>${error?'<p class="error">'+escapeHTML(error)+'</p>':''}${ready?'<a class="login" href="/auth/google">الدخول بواسطة Google</a>':'<p class="error">حماية الدخول لم يكتمل إعدادها بعد.</p>'}<p class="note">لن يُسمح إلا بالحسابات الموجودة في قائمة الإيميلات المعتمدة.</p></main></body></html>`;
}
function sendHTML(res,status,html,headers={}){res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer',...headers});res.end(html)}
function redirect(res,location,headers={}){res.writeHead(303,{location,'cache-control':'no-store',...headers});res.end()}
function accessStatus(){return{enabled:authEnabled(),ready:authReady()}}

function ema(values,period){if(!values?.length)return null;const k=2/(period+1);let out=values[0];for(let i=1;i<values.length;i++)out=values[i]*k+out*(1-k);return out}
function sma(values,period){if(!values?.length)return null;const n=Math.min(period,values.length);return values.slice(-n).reduce((a,b)=>a+b,0)/n}
function rsi(values,period=14){if(!values||values.length<period+1)return null;let gains=0,losses=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>=0)gains+=d;else losses-=d}if(losses===0)return 100;const rs=(gains/period)/(losses/period);return 100-100/(1+rs)}
function atr(candles,period=14){if(!candles||candles.length<period+1)return null;const trs=[];for(let i=candles.length-period;i<candles.length;i++){const c=candles[i],pc=candles[i-1].close;trs.push(Math.max(c.high-c.low,Math.abs(c.high-pc),Math.abs(c.low-pc)))}return trs.reduce((a,b)=>a+b,0)/trs.length}
function erf(x){const sign=x>=0?1:-1;x=Math.abs(x);const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911,t=1/(1+p*x),y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);return sign*y}
const N=x=>.5*(1+erf(x/Math.sqrt(2)));
function blackScholes({S,K,T,r=.04,sigma,type='call'}){if(T<=0||sigma<=0||S<=0||K<=0)return Math.max(type==='call'?S-K:K-S,0);const d1=(Math.log(S/K)+(r+.5*sigma*sigma)*T)/(sigma*Math.sqrt(T)),d2=d1-sigma*Math.sqrt(T);return type==='call'?S*N(d1)-K*Math.exp(-r*T)*N(d2):K*Math.exp(-r*T)*N(-d2)-S*N(-d1)}
const round=(n,d=2)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
function pivots(daily){const prev=daily[daily.length-2],recent=daily.slice(-20);return{pdh:prev.high,pdl:prev.low,prevClose:prev.close,swingHigh:Math.max(...recent.map(c=>c.high)),swingLow:Math.min(...recent.map(c=>c.low)),whole:Math.round(daily.at(-1).close)}}
function vwap(candles){let pv=0,v=0;for(const c of candles){const tp=(c.high+c.low+c.close)/3;pv+=tp*c.volume;v+=c.volume}return v?pv/v:null}
function detectFVG(c){if(c.length<3)return{bull:false,bear:false};const a=c.at(-3),z=c.at(-1);return{bull:z.low>a.high,bear:z.high<a.low}}
function detectStructure(c){if(c.length<8)return{bosBull:false,bosBear:false,mssBull:false,mssBear:false,sweepLow:false,sweepHigh:false};const last=c.at(-1),prevs=c.slice(-7,-1),hi=Math.max(...prevs.map(x=>x.high)),lo=Math.min(...prevs.map(x=>x.low)),prev=c.at(-2),sweepLow=last.low<lo&&last.close>lo,sweepHigh=last.high>hi&&last.close<hi,bosBull=last.close>hi,bosBear=last.close<lo,mssBull=(prev.close<lo||sweepLow)&&last.close>prev.high,mssBear=(prev.close>hi||sweepHigh)&&last.close<prev.low;return{bosBull,bosBear,mssBull,mssBear,sweepLow,sweepHigh}}
function optionPrice(o){if(!o)return null;if(o.bid>0&&o.ask>0)return(o.bid+o.ask)/2;if(o.referencePrice>0)return o.referencePrice;return null}
function spreadPct(o){if(!o||!(o.bid>0)||!(o.ask>0))return null;const mid=(o.bid+o.ask)/2;return mid?(o.ask-o.bid)/mid*100:null}
function optionChainForClient(options=[],spot,target,stop){
  return options.map(o=>{
    const mid=optionPrice(o),estimatedAtTarget=mid>0?estimateContract(o,spot,target,.35):null,estimatedAtStop=mid>0?estimateContract(o,spot,stop,.15):null;
    return{symbol:o.symbol,type:String(o.type||'').toUpperCase(),strike:round(o.strike),expiry:o.expiry,dte:round(o.daysToExpiry,1),bid:o.bid>0?round(o.bid):null,ask:o.ask>0?round(o.ask):null,mid:round(mid),priceSource:o.priceSource,iv:round(o.iv*100,1),delta:round(o.delta,2),gamma:round(o.gamma,3),theta:round(o.theta,3),vega:round(o.vega,3),volume:o.volume,openInterest:o.openInterest,spreadPct:round(spreadPct(o),1),estimatedAtTarget:round(estimatedAtTarget),estimatedAtStop:round(estimatedAtStop),targetPct:round(mid>0?(estimatedAtTarget-mid)/mid*100:null,1),stopPct:round(mid>0?(estimatedAtStop-mid)/mid*100:null,1)};
  }).sort((a,b)=>String(a.expiry).localeCompare(String(b.expiry))||a.strike-b.strike||a.type.localeCompare(b.type));
}
function optionScore(o,symbol,spot){const sp=spreadPct(o),mid=optionPrice(o)||0,absDelta=Math.abs(o.delta||0),dte=o.daysToExpiry??99;let s=0;if(sp!=null){if(sp<=4)s+=22;else if(sp<=7)s+=15;else if(sp<=10)s+=7;else s-=15}else if(mid>0)s+=2;if((o.openInterest||0)>=2000)s+=16;else if((o.openInterest||0)>=750)s+=10;else if((o.openInterest||0)>=200)s+=4;if((o.volume||0)>=1000)s+=14;else if((o.volume||0)>=250)s+=9;else if((o.volume||0)>=50)s+=3;if(absDelta>=.30&&absDelta<=.55)s+=16;else if(absDelta>=.20&&absDelta<=.65)s+=8;if(mid>=.40&&mid<=3.50)s+=12;else if(mid>3.50&&mid<=6)s+=5;else if(mid<.20)s-=10;if(INDEX_ETFS.has(symbol)){if(dte<=1.2)s+=14;else if(dte<=3.2)s+=10;else if(dte<=7.2)s+=3}else{if(dte>=2&&dte<=7.5)s+=14;else if(dte>7.5&&dte<=14.5)s+=9;else if(dte<1)s-=8}const distancePct=Math.abs(o.strike-spot)/spot*100;if(distancePct<=.8)s+=12;else if(distancePct<=1.8)s+=7;else if(distancePct>4)s-=12;return s}
function chooseContract(chain,direction,spot,symbol){
  if(!chain?.length||!['CALL','PUT'].includes(direction))return null;
  const type=direction==='CALL'?'call':'put';
  let candidates=chain.filter(o=>o.type===type&&optionPrice(o)>0&&(spreadPct(o)==null||spreadPct(o)<=15));
  if(symbol==='SPX')candidates=candidates.filter(o=>(o.daysToExpiry??99)<=1.2&&optionPrice(o)<=1.5&&(type==='call'?o.strike>spot:o.strike<spot));
  if(!candidates.length)return null;
  let pool=candidates.filter(o=>type==='call'?o.strike>=spot&&o.strike<=spot*1.04:o.strike<=spot&&o.strike>=spot*.96);
  if(!pool.length)pool=candidates;
  return pool.sort((a,b)=>optionScore(b,symbol,spot)-optionScore(a,symbol,spot))[0];
}
function estimateContract(option,spotNow,spotTarget,elapsedDays=.35){if(!option)return null;const marketMid=optionPrice(option)||0,dS=spotTarget-spotNow;if(Number.isFinite(option.delta)&&Number.isFinite(option.gamma)&&marketMid>0){const est=marketMid+option.delta*dS+.5*(option.gamma||0)*dS*dS+(option.theta||0)*Math.max(elapsedDays,0);if(Number.isFinite(est)&&est>0)return Math.max(est,.01)}const days=Math.max(option.daysToExpiry??1,.05),T=days/365,sigma=Number.isFinite(option.iv)&&option.iv>0?option.iv:.45,r=Number(process.env.RISK_FREE_RATE||.04),nowBS=blackScholes({S:spotNow,K:option.strike,T,r,sigma,type:option.type}),targetBS=blackScholes({S:spotTarget,K:option.strike,T:Math.max(T-elapsedDays/365,.0001),r,sigma,type:option.type}),basis=marketMid>0&&nowBS>0?marketMid/nowBS:1;return Math.max(targetBS*basis,.01)}
function nearestPivotDistance(spot,p){const levels=[p.pdh,p.pdl,p.swingHigh,p.swingLow,p.whole].filter(Number.isFinite);return Math.min(...levels.map(x=>Math.abs(spot-x)))}
function analyzeCore(snapshot,settings={}){const{symbol,daily,intraday,options=[]}=snapshot;if(!daily?.length||!intraday?.length)throw new Error('Missing bars');const closes=intraday.map(c=>c.close),spot=closes.at(-1),dailyAtr=atr(daily,14),p=pivots(daily),vw=vwap(intraday),ema9=ema(closes.slice(-60),9),ema20=ema(closes.slice(-80),20),rs=rsi(closes,14),avgVol=sma(intraday.slice(-21,-1).map(c=>c.volume),20)||1,rvol=intraday.at(-1).volume/avgVol,fvg=detectFVG(intraday),smc=detectStructure(intraday),dayHigh=Math.max(...intraday.map(c=>c.high)),dayLow=Math.min(...intraday.map(c=>c.low)),consumed=dailyAtr?(dayHigh-dayLow)/dailyAtr*100:null,remainingPct=consumed==null?null:Math.max(0,100-consumed),pivotDistance=nearestPivotDistance(spot,p),pivotDistanceAtr=dailyAtr?pivotDistance/dailyAtr:null;let bull=0,bear=0,reasons=[];if(spot>vw){bull+=10;reasons.push('فوق VWAP')}else{bear+=10;reasons.push('تحت VWAP')}if(ema9>ema20){bull+=8;reasons.push('EMA 9 فوق EMA 20')}else{bear+=8;reasons.push('EMA 9 تحت EMA 20')}if(rs!=null&&rs>=52)bull+=5;if(rs!=null&&rs<=48)bear+=5;if(rvol>=1.4){bull+=4;bear+=4;reasons.push('RVOL مرتفع')}if(smc.sweepLow){bull+=12;reasons.push('Liquidity sweep للقاع')}if(smc.sweepHigh){bear+=12;reasons.push('Liquidity sweep للقمة')}if(smc.mssBull||smc.bosBull){bull+=14;reasons.push('MSS/BOS صاعد')}if(smc.mssBear||smc.bosBear){bear+=14;reasons.push('MSS/BOS هابط')}if(fvg.bull){bull+=6;reasons.push('Bullish FVG')}if(fvg.bear){bear+=6;reasons.push('Bearish FVG')}if(spot>p.pdh){bull+=12;reasons.push('اختراق PDH')}if(spot<p.pdl){bear+=12;reasons.push('كسر PDL')}const pivotBand=Math.max((dailyAtr||spot*.01)*.08,spot*.0015);if(Math.abs(spot-p.pdh)<=pivotBand)reasons.push('قرب مقاومة PDH');if(Math.abs(spot-p.pdl)<=pivotBand)reasons.push('قرب دعم PDL');let direction=bull>bear?'CALL':bear>bull?'PUT':'NO TRADE',raw=Math.max(bull,bear),confidence=Math.min(95,Math.round(45+raw*.75));if(consumed!=null&&consumed>=100){confidence-=16;reasons.push('ATR اليومي مستهلك بالكامل تقريبًا')}else if(consumed!=null&&consumed>=85){confidence-=10;reasons.push('معظم ATR اليومي مستهلك')}else if(consumed!=null&&consumed>=70){confidence-=5;reasons.push('ATR مستهلك جزئيًا')}if(pivotDistanceAtr!=null&&pivotDistanceAtr>.45){confidence-=6;reasons.push('السعر بعيد عن منطقة ارتكاز واضحة')}const minConfidence=Number(settings.minConfidence??70);let state=confidence>=minConfidence?direction:(confidence>=minConfidence-8?'WATCH':'NO TRADE');const atrMove=dailyAtr||spot*.02;let stockTarget=spot,invalidation=spot;if(direction==='CALL'){const structuralTarget=Math.max(p.pdh,spot+.55*atrMove);stockTarget=Math.min(structuralTarget,spot+.9*atrMove);invalidation=Math.max(dayLow,spot-.35*atrMove)}else if(direction==='PUT'){const structuralTarget=Math.min(p.pdl,spot-.55*atrMove);stockTarget=Math.max(structuralTarget,spot-.9*atrMove);invalidation=Math.min(dayHigh,spot+.35*atrMove)}const contract=chooseContract(options,direction,spot,symbol);let premiumNow=null,premiumTarget=null,premiumStop=null,rr=null,spPct=null;if(contract){premiumNow=optionPrice(contract);premiumTarget=estimateContract(contract,spot,stockTarget,.35);premiumStop=estimateContract(contract,spot,invalidation,.15);const reward=Math.max(premiumTarget-premiumNow,0),risk=Math.max(premiumNow-premiumStop,.01);rr=reward/risk;spPct=spreadPct(contract);if(spPct!=null&&spPct>10){confidence-=10;reasons.push('Spread العقد واسع')}else if(spPct==null){confidence-=4;reasons.push('سعر العقد مرجعي متأخر؛ Bid/Ask غير متوفر')}if((contract.openInterest||0)<200){confidence-=5;reasons.push('Open Interest منخفض')}if(rr<2){confidence-=8;reasons.push('RR للعقد أقل من 1:2')}}else if(['CALL','PUT'].includes(direction)){confidence-=8;reasons.push('لا يوجد عقد سائل مناسب')}confidence=Math.max(0,Math.min(95,confidence));if(confidence<minConfidence&&state!=='NO TRADE')state=confidence>=minConfidence-8?'WATCH':'NO TRADE';if(direction==='NO TRADE')state='NO TRADE';return{symbol,state,direction,confidence,spot:round(spot),session:{high:round(dayHigh),low:round(dayLow),distanceToHigh:round(Math.max(0,dayHigh-spot)),distanceToHighPct:round(dayHigh?Math.max(0,(dayHigh-spot)/dayHigh*100):null,2)},indicators:{atr14:round(dailyAtr),atrPct:round(dailyAtr/spot*100),atrConsumedPct:round(consumed),atrRemainingPct:round(remainingPct),pivotDistanceAtr:round(pivotDistanceAtr,2),vwap:round(vw),ema9:round(ema9),ema20:round(ema20),rsi14:round(rs,1),rvol:round(rvol,2)},pivots:{pdh:round(p.pdh),pdl:round(p.pdl),prevClose:round(p.prevClose),swingHigh:round(p.swingHigh),swingLow:round(p.swingLow),whole:p.whole},setup:{stockTarget:round(stockTarget),invalidation:round(invalidation),reasons:[...new Set(reasons)].slice(0,10)},contract:contract?{symbol:contract.symbol,strike:contract.strike,type:contract.type,expiry:contract.expiry,dte:round(contract.daysToExpiry,1),bid:contract.bid>0?round(contract.bid):null,ask:contract.ask>0?round(contract.ask):null,mid:round(premiumNow),priceSource:contract.priceSource,hasQuote:spPct!=null,referencePrice:round(contract.referencePrice),iv:round(contract.iv*100,1),delta:round(contract.delta,2),gamma:round(contract.gamma,3),theta:round(contract.theta,3),vega:round(contract.vega,3),volume:contract.volume,openInterest:contract.openInterest,spreadPct:round(spPct,1),estimatedAtTarget:round(premiumTarget),estimatedAtStop:round(premiumStop),targetPct:round(premiumNow>0?(premiumTarget-premiumNow)/premiumNow*100:null,1),stopPct:round(premiumNow>0?(premiumStop-premiumNow)/premiumNow*100:null,1),rr:round(rr,2),score:optionScore(contract,symbol,spot)}:null,freshness:{timestamp:snapshot.timestamp,ageMinutes:round((Date.now()-new Date(snapshot.timestamp).getTime())/60_000,1),stale:Date.now()-new Date(snapshot.timestamp).getTime()>20*60_000}}}
function spxTradePolicy(date=new Date()){
  const clock=easternClock(date),tradingDay=!['Sat','Sun'].includes(clock.weekday),active=tradingDay&&clock.minutes>=15*60+30&&clock.minutes<=15*60+58;
  const message=!tradingDay?'SPX: السوق الأمريكي مغلق اليوم؛ لا يوجد اقتراح عقد.':active?'SPX: نافذة 0DTE مفتوحة الآن حتى 15:58 ET؛ OTM فقط وبحد تكلفة $150 للعقد.':clock.minutes<15*60+30?'SPX: ينتظر نافذة 0DTE من 15:30 إلى 15:58 ET؛ لا يوجد اقتراح عقد قبلها.':'SPX: انتهت نافذة 0DTE اليوم؛ لا يوجد اقتراح عقد بعد 15:58 ET.';
  return{active,startEt:'15:30',exitByEt:'15:58',maxContractCostUsd:150,contractMode:'0DTE OTM',message};
}
function analyze(snapshot,settings={}){
  const result=analyzeCore(snapshot,settings);
  if(snapshot.symbol!=='SPX')return result;
  const policy=spxTradePolicy();
  result.assetKind='INDEX';
  result.instrumentPolicy=policy;
  result.indicators.vwapReference=snapshot.volumeReference?.symbol?'SPY للحجم':null;
  result.setup.reasons=[policy.active?'نافذة SPX 0DTE مفتوحة':'خارج نافذة SPX 0DTE',...result.setup.reasons].slice(0,10);
  if(!policy.active||!['CALL','PUT'].includes(result.state))result.contract=null;
  if(!policy.active)result.state='NO TRADE';
  return result;
}

const isoDate=d=>d.toISOString().slice(0,10); const daysAgo=n=>{const d=new Date();d.setUTCDate(d.getUTCDate()-n);return d}; const daysAhead=n=>{const d=new Date();d.setUTCDate(d.getUTCDate()+n);return d};
const massiveMarketTicker=symbol=>symbol==='SPX'?'I:SPX':symbol;
const optionsUnderlying=symbol=>symbol==='SPX'?'SPX':symbol;
const displayTicker=ticker=>ticker==='I:SPX'?'SPX':ticker;
async function massiveGet(path,params={}){const apiKey=process.env.MASSIVE_API_KEY;if(!apiKey)throw new Error('MASSIVE_API_KEY is not configured');const url=new URL(path.startsWith('http')?path:MASSIVE_BASE+path);for(const[k,v]of Object.entries(params))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));url.searchParams.set('apiKey',apiKey);const r=await fetch(url,{headers:{accept:'application/json'}});if(!r.ok){const body=await r.text().catch(()=> '');const error=new Error('Massive '+r.status+': '+body.slice(0,180));error.providerStatus=r.status;throw error}return r.json()}
function mapBars(rows=[]){return rows.map(x=>({open:Number(x.o),high:Number(x.h),low:Number(x.l),close:Number(x.c),volume:Number(x.v||0),vwap:x.vw==null?null:Number(x.vw),timestamp:new Date(Number(x.t)).toISOString()})).filter(x=>Number.isFinite(x.close))}
function latestSessionBars(bars=[]){if(!bars.length)return[];const latestDay=bars.at(-1).timestamp.slice(0,10);return bars.filter(x=>x.timestamp.slice(0,10)===latestDay)}
function applyReferenceVolumes(targetBars=[],referenceBars=[]){
  const byTime=new Map(referenceBars.map(x=>[x.timestamp,x.volume])),offset=Math.max(0,referenceBars.length-targetBars.length);
  return targetBars.map((bar,index)=>({...bar,volume:Number(byTime.get(bar.timestamp)??referenceBars[offset+index]?.volume??bar.volume??0)}));
}
function spxUnavailable(cause){
  const error=new Error('بيانات SPX اللحظية غير متاحة. يلزم تفعيل بيانات Massive Indices (Starter على الأقل للبيانات المتأخرة 15 دقيقة).');
  error.statusCode=503;
  error.cause=cause;
  return error;
}
async function fetchAllOptions(symbol,spot){
  const today=isoDate(new Date()),isSpx=symbol==='SPX',end=isSpx?today:isoDate(daysAhead(Number(process.env.OPTIONS_MAX_DTE||14))),pct=isSpx ? .03 : Number(process.env.OPTIONS_STRIKE_WINDOW_PCT||.10),lo=Math.max(.01,spot*(1-pct)),hi=spot*(1+pct),all=[];
  for(const type of ['call','put']){
    let next=MASSIVE_BASE+'/v3/snapshot/options/'+encodeURIComponent(optionsUnderlying(symbol)),page=0;
    while(next&&page<3){
      const data=await massiveGet(next,page===0?{contract_type:type,'expiration_date.gte':today,'expiration_date.lte':end,'strike_price.gte':lo.toFixed(2),'strike_price.lte':hi.toFixed(2),limit:250,sort:'expiration_date',order:'asc'}:{});
      for(const x of data.results||[]){
        const expiry=x.details?.expiration_date;
        if(!expiry)continue;
        const bid=Number(x.last_quote?.bid||0),ask=Number(x.last_quote?.ask||0),quoteMid=bid>0&&ask>0?(bid+ask)/2:0,lastTrade=Number(x.last_trade?.price||0),dayClose=Number(x.day?.close||0),dayVwap=Number(x.day?.vwap||0),referencePrice=quoteMid||lastTrade||dayClose||dayVwap||0;
        const priceSource=quoteMid?'NBBO_MID':lastTrade?'LAST_TRADE':dayClose?'DELAYED_DAY_CLOSE':dayVwap?'DELAYED_DAY_VWAP':'UNAVAILABLE';
        const dte=Math.max(0,(new Date(expiry+'T20:00:00Z').getTime()-Date.now())/86400000);
        all.push({symbol:x.details?.ticker,type:x.details?.contract_type,strike:Number(x.details?.strike_price),expiry,daysToExpiry:dte,bid,ask,referencePrice,priceSource,iv:Number(x.implied_volatility||0),delta:Number(x.greeks?.delta||0),gamma:Number(x.greeks?.gamma||0),theta:Number(x.greeks?.theta||0),vega:Number(x.greeks?.vega||0),volume:Number(x.day?.volume||0),openInterest:Number(x.open_interest||0)});
      }
      next=data.next_url||null;
      page++;
    }
  }
  return all;
}
async function fetchMassiveSnapshot(symbol){
  const dataTicker=massiveMarketTicker(symbol),isSpx=symbol==='SPX',dailyPath='/v2/aggs/ticker/'+encodeURIComponent(dataTicker)+'/range/1/day/'+isoDate(daysAgo(70))+'/'+isoDate(new Date()),intradayPath='/v2/aggs/ticker/'+encodeURIComponent(dataTicker)+'/range/5/minute/'+isoDate(daysAgo(7))+'/'+isoDate(new Date());
  let dailyData,intradayData,referenceData=null;
  try{
    [dailyData,intradayData,referenceData]=await Promise.all([
      massiveGet(dailyPath,{adjusted:true,sort:'asc',limit:120}),
      massiveGet(intradayPath,{adjusted:true,sort:'asc',limit:50000}),
      isSpx?massiveGet('/v2/aggs/ticker/SPY/range/5/minute/'+isoDate(daysAgo(7))+'/'+isoDate(new Date()),{adjusted:true,sort:'asc',limit:50000}):Promise.resolve(null)
    ]);
  }catch(error){if(isSpx)throw spxUnavailable(error);throw error}
  const daily=mapBars(dailyData.results||[]);
  if(daily.length<20){if(isSpx)throw spxUnavailable();throw new Error('Not enough daily bars for '+symbol)}
  let intraday=latestSessionBars(mapBars(intradayData.results||[]));
  if(!intraday.length){if(isSpx)throw spxUnavailable();throw new Error('No intraday bars for '+symbol)}
  let volumeReference=null;
  if(isSpx){
    const referenceBars=latestSessionBars(mapBars(referenceData?.results||[]));
    if(!referenceBars.length)throw spxUnavailable();
    intraday=applyReferenceVolumes(intraday,referenceBars);
    volumeReference={symbol:'SPY'};
  }
  const spot=intraday.at(-1).close;
  let options=[],optionDataError=null;
  try{options=await fetchAllOptions(symbol,spot)}catch(e){optionDataError=e.message}
  const optionDiagnostics={totalContracts:options.length,withQuotes:options.filter(o=>o.bid>0&&o.ask>0).length,withReferencePrice:options.filter(o=>optionPrice(o)>0).length,priceSources:[...new Set(options.map(o=>o.priceSource))]};
  return{symbol,daily,intraday,options,optionDataError,optionDiagnostics,volumeReference,timestamp:intraday.at(-1).timestamp,mode:'LIVE',provider:'MASSIVE'};
}
function seeded(seed){let x=seed;return()=>{x=(x*1664525+1013904223)%4294967296;return x/4294967296}}
const bases={SPY:645,QQQ:575,IWM:225,NVDA:182,SPX:6500};
function demoSnapshot(symbol='SPY'){const rnd=seeded([...symbol].reduce((a,c)=>a+c.charCodeAt(0),0));let p=bases[symbol]||100;const daily=[];for(let i=0;i<35;i++){const move=(rnd()-.48)*p*.025,open=p,close=Math.max(1,p+move),hi=Math.max(open,close)*(1+rnd()*.012),lo=Math.min(open,close)*(1-rnd()*.012);daily.push({open,high:hi,low:lo,close,volume:1e7+rnd()*3e7});p=close}const intraday=[];let q=daily.at(-1).close;for(let i=0;i<78;i++){const move=(rnd()-.49)*q*.0025,open=q,close=q+move,high=Math.max(open,close)*(1+rnd()*.0012),low=Math.min(open,close)*(1-rnd()*.0012);intraday.push({open,high,low,close,volume:2e5+rnd()*1.2e6,timestamp:new Date(Date.now()-(77-i)*300000).toISOString()});q=close}const step=q>300?5:q>100?2.5:1,center=Math.round(q/step)*step,options=[];for(const type of ['call','put'])for(let i=-3;i<=3;i++){const strike=center+i*step,otm=type==='call'?Math.max(strike-q,0):Math.max(q-strike,0),base=symbol==='SPX'?Math.max(.35,1.45-otm*.07):Math.max(.35,q*.012-otm*.35),mid=base*(.9+rnd()*.3);options.push({symbol:symbol+'-'+type[0].toUpperCase()+'-'+strike,type,strike,expiry:symbol==='SPX'?isoDate(new Date()):'Nearest',daysToExpiry:symbol==='SPX'?0:1,bid:Math.max(.01,mid-.04),ask:mid+.04,referencePrice:mid,priceSource:'NBBO_MID',iv:.35+rnd()*.35,delta:type==='call'?.25+rnd()*.35:-.25-rnd()*.35,gamma:.01+rnd()*.04,theta:-.05-rnd()*.2,vega:.02+rnd()*.12,volume:100+Math.floor(rnd()*3000),openInterest:300+Math.floor(rnd()*7000)})}return{symbol,daily,intraday,options,volumeReference:symbol==='SPX'?{symbol:'SPY'}:null,timestamp:new Date().toISOString(),mode:'DEMO',provider:'DEMO'}}
async function fetchSnapshot(symbol){return process.env.MASSIVE_API_KEY?fetchMassiveSnapshot(symbol):demoSnapshot(symbol)}
const scanCache={expiresAt:0,value:null};
const speculativeCache={expiresAt:0,value:null,inflight:null};
function marketTimestampIso(value){
  const raw=Number(value);
  if(!Number.isFinite(raw)||raw<=0)return null;
  const ms=raw>1e17?raw/1e6:raw>1e14?raw/1e3:raw>1e11?raw:raw*1000;
  const date=new Date(ms);
  return Number.isNaN(date.getTime())?null:date.toISOString();
}
const finiteOrNull=value=>{const n=Number(value);return Number.isFinite(n)?n:null};
function quickSignal({price,open,high,low,vwap,previousClose,changePct,stale}){
  if(stale||!Number.isFinite(price))return{signal:'NO TRADE',direction:'NO TRADE',confidence:0};
  let bull=0,bear=0;
  if(Number.isFinite(vwap)){if(price>vwap)bull+=22;else bear+=22}
  if(Number.isFinite(open)){if(price>open)bull+=13;else bear+=13}
  if(Number.isFinite(previousClose)){if(price>previousClose)bull+=15;else bear+=15}
  if(Number.isFinite(changePct)){if(changePct>=.5)bull+=12;else if(changePct<=-.5)bear+=12;else if(changePct>0)bull+=6;else if(changePct<0)bear+=6}
  const range=Number.isFinite(high)&&Number.isFinite(low)?high-low:0,position=range>0?(price-low)/range:null;
  if(position!=null){if(position>=.75)bull+=18;else if(position<=.25)bear+=18;else if(position>=.55)bull+=7;else if(position<=.45)bear+=7}
  const gap=Math.abs(bull-bear),direction=bull>bear?'CALL':bear>bull?'PUT':'NO TRADE',confidence=Math.min(88,Math.round(50+gap*.4));
  const signal=gap<12?'NO TRADE':confidence<70?'WATCH':direction;
  return{signal,direction,confidence};
}
function rankScan(items){
  const priority={CALL:0,PUT:0,WATCH:1,'NO TRADE':2};
  return items.sort((a,b)=>(priority[a.signal]??3)-(priority[b.signal]??3)||(b.confidence??0)-(a.confidence??0)||Number(a.stale)-Number(b.stale)||(a.distanceToHighPct??999)-(b.distanceToHighPct??999));
}
function normalizeSnapshotItem(x,{symbol=displayTicker(x?.ticker),spx=false}={}){
  const session=x?.session||{},price=finiteOrNull(spx?(x?.value??session.price??session.close):(session.price??session.close??x?.last_minute?.close??x?.last_trade?.price)),high=finiteOrNull(session.high),low=finiteOrNull(session.low),open=finiteOrNull(session.open),vwapValue=finiteOrNull(session.vwap),previousClose=finiteOrNull(session.previous_close),changePct=finiteOrNull(session.change_percent),updatedAt=marketTimestampIso(session.last_updated??x?.last_updated??x?.last_minute?.last_updated??x?.last_trade?.last_updated),ageMinutes=updatedAt?(Date.now()-new Date(updatedAt).getTime())/60000:null,stale=ageMinutes==null||ageMinutes>20;
  let signal=quickSignal({price,open,high,low,vwap:vwapValue,previousClose,changePct,stale}),instrumentPolicy=null,marketStatus=x?.market_status||null;
  if(spx){
    instrumentPolicy=spxTradePolicy();
    if(!instrumentPolicy.active)signal={...signal,signal:'NO TRADE'};
    marketStatus=stale?'بيانات SPX قديمة — تحقق من باقة Indices Starter':instrumentPolicy.active?(marketStatus||'نافذة SPX مفتوحة'):'خارج نافذة 15:30–15:58 ET';
  }
  return{symbol,price:round(price),high:round(high),low:round(low),open:round(open),vwap:round(vwapValue),previousClose:round(previousClose),changePct:round(changePct,2),distanceToHighPct:round(price!=null&&high>0?Math.max(0,(high-price)/high*100):null,2),marketStatus,updatedAt,ageMinutes:round(ageMinutes,1),stale,instrumentPolicy,...signal};
}
function spxScanPlaceholder(error){
  return{symbol:'SPX',price:null,high:null,low:null,open:null,vwap:null,previousClose:null,changePct:null,distanceToHighPct:null,marketStatus:'SPX يحتاج بيانات Massive Indices Starter',updatedAt:null,ageMinutes:null,stale:true,dataError:true,signal:'NO TRADE',direction:'NO TRADE',confidence:0,instrumentPolicy:spxTradePolicy(),error:error?.message||null};
}
async function fetchMassiveScan(){
  const [stockResult,spxResult]=await Promise.allSettled([
    massiveGet('/v3/snapshot',{'ticker.any_of':STOCK_WATCHLIST.join(','),limit:STOCK_WATCHLIST.length,sort:'ticker',order:'asc'}),
    massiveGet('/v3/snapshot',{ticker:'I:SPX',limit:1})
  ]);
  if(stockResult.status==='rejected')throw stockResult.reason;
  const stockRows=Array.isArray(stockResult.value?.results)?stockResult.value.results:[],items=stockRows.filter(x=>STOCK_WATCHLIST.includes(x.ticker)).map(x=>normalizeSnapshotItem(x));
  if(spxResult.status==='fulfilled'){
    const rows=Array.isArray(spxResult.value?.results)?spxResult.value.results:spxResult.value?.results?[spxResult.value.results]:[],spxRow=rows.find(x=>x.ticker==='I:SPX'||x.ticker==='SPX')||rows[0];
    items.push(spxRow?normalizeSnapshotItem(spxRow,{symbol:'SPX',spx:true}):spxScanPlaceholder());
  }else items.push(spxScanPlaceholder(spxResult.reason));
  return{items:rankScan(items),updatedAt:items.map(x=>x.updatedAt).filter(Boolean).sort().at(-1)||new Date().toISOString(),mode:'LIVE',provider:'MASSIVE'};
}
function demoScan(){
  const items=WATCHLIST.map(symbol=>{
    const snap=demoSnapshot(symbol),spot=snap.intraday.at(-1).close,high=Math.max(...snap.intraday.map(x=>x.high)),low=Math.min(...snap.intraday.map(x=>x.low)),open=snap.intraday[0].open,vwapValue=vwap(snap.intraday),previousClose=snap.daily.at(-2).close,changePct=(spot-previousClose)/previousClose*100,stale=false;
    const policy=symbol==='SPX'?spxTradePolicy():null,quick=quickSignal({price:spot,open,high,low,vwap:vwapValue,previousClose,changePct,stale});
    if(policy&&!policy.active)quick.signal='NO TRADE';
    return{symbol,price:round(spot),high:round(high),low:round(low),open:round(open),vwap:round(vwapValue),previousClose:round(previousClose),changePct:round(changePct,2),distanceToHighPct:round(Math.max(0,(high-spot)/high*100),2),marketStatus:policy?(policy.active?'نافذة SPX مفتوحة':'خارج نافذة 15:30–15:58 ET'):'demo',updatedAt:snap.timestamp,ageMinutes:0,stale,instrumentPolicy:policy,...quick};
  });
  return{items:rankScan(items),updatedAt:new Date().toISOString(),mode:'DEMO',provider:'DEMO'};
}
async function fetchMarketScan(force=false){
  if(!force&&scanCache.value&&Date.now()<scanCache.expiresAt)return scanCache.value;
  const value=process.env.MASSIVE_API_KEY?await fetchMassiveScan():demoScan();
  scanCache.value=value;
  scanCache.expiresAt=Date.now()+60_000;
  return value;
}
function normalizeMover(row){
  const symbol=String(row?.ticker||'').trim().toUpperCase();
  if(!/^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(symbol)||WATCHLIST.includes(symbol))return null;
  const day=row.day||{},minute=row.min||{},previous=row.prevDay||{},price=finiteOrNull(day.c??minute.c??row.lastTrade?.p),high=finiteOrNull(day.h),low=finiteOrNull(day.l),open=finiteOrNull(day.o),vwapValue=finiteOrNull(day.vw),previousClose=finiteOrNull(previous.c),volume=finiteOrNull(day.v??minute.av??minute.v),rawChange=finiteOrNull(row.todaysChangePerc),changePct=rawChange??(price!=null&&previousClose>0?(price-previousClose)/previousClose*100:null),updatedAt=marketTimestampIso(row.updated??minute.t??row.lastTrade?.t),ageMinutes=updatedAt?(Date.now()-new Date(updatedAt).getTime())/60000:null,stale=ageMinutes==null||ageMinutes>20,dollarVolume=price!=null&&volume!=null?price*volume:null,rangePct=price>0&&high!=null&&low!=null?(high-low)/price*100:null;
  if(price==null||price<3||price>500||volume==null||volume<1_000_000||dollarVolume<20_000_000||changePct==null||Math.abs(changePct)<2)return null;
  const signal=quickSignal({price,open,high,low,vwap:vwapValue,previousClose,changePct,stale}),liquidityPoints=Math.max(0,Math.min(28,(Math.log10(dollarVolume)-7)*11)),speculativeScore=Math.abs(changePct)*6+(rangePct||0)*2+liquidityPoints;
  return{symbol,price:round(price),high:round(high),low:round(low),open:round(open),vwap:round(vwapValue),previousClose:round(previousClose),changePct:round(changePct,2),distanceToHighPct:round(price!=null&&high>0?Math.max(0,(high-price)/high*100):null,2),volume:Math.round(volume),dollarVolume:Math.round(dollarVolume),rangePct:round(rangePct,2),updatedAt,ageMinutes:round(ageMinutes,1),stale,marketStatus:'options verified',speculativeScore:round(speculativeScore,2),...signal};
}
async function activeOptionsContract(symbol){
  const data=await massiveGet('/v3/reference/options/contracts',{underlying_ticker:symbol,expired:false,'expiration_date.gte':isoDate(new Date()),limit:1,sort:'expiration_date',order:'asc'});
  return Array.isArray(data.results)&&data.results.length>0;
}
async function buildSpeculativeScan(){
  const directions=['gainers','losers'],responses=await Promise.allSettled(directions.map(direction=>massiveGet('/v2/snapshot/locale/us/markets/stocks/'+direction,{include_otc:false}))),successful=responses.filter(x=>x.status==='fulfilled');
  if(!successful.length)throw responses.find(x=>x.status==='rejected')?.reason||new Error('Top movers are unavailable');
  const unique=new Map();
  for(const response of successful)for(const row of response.value?.tickers||response.value?.results||[]){const item=normalizeMover(row);if(item&&(!unique.has(item.symbol)||item.speculativeScore>unique.get(item.symbol).speculativeScore))unique.set(item.symbol,item)}
  const candidates=[...unique.values()].sort((a,b)=>b.speculativeScore-a.speculativeScore).slice(0,SPECULATIVE_VERIFY_LIMIT);let verificationFailures=0;
  const checked=await Promise.all(candidates.map(async item=>{try{return await activeOptionsContract(item.symbol)?{...item,optionsVerified:true}:null}catch{verificationFailures++;return null}}));
  if(candidates.length&&verificationFailures===candidates.length)throw new Error('Active options verification is temporarily unavailable');
  const items=checked.filter(Boolean).sort((a,b)=>b.speculativeScore-a.speculativeScore).slice(0,SPECULATIVE_LIMIT),updatedAt=items.map(x=>x.updatedAt).filter(Boolean).sort().at(-1)||new Date().toISOString();
  return{items,updatedAt,mode:'LIVE',provider:'MASSIVE',candidateCount:candidates.length,verificationFailures,filters:{minPrice:3,maxPrice:500,minVolume:1_000_000,minDollarVolume:20_000_000,minAbsoluteChangePct:2},delayedMinutes:15};
}
async function fetchSpeculativeScan(force=false){
  if(!process.env.MASSIVE_API_KEY)return{items:[],updatedAt:new Date().toISOString(),mode:'DEMO',provider:'DEMO',note:'Automatic options radar requires live Massive data'};
  if(!force&&speculativeCache.value&&Date.now()<speculativeCache.expiresAt)return speculativeCache.value;
  if(speculativeCache.inflight)return speculativeCache.inflight;
  speculativeCache.inflight=(async()=>{
    try{
      const value=await buildSpeculativeScan();speculativeCache.value=value;speculativeCache.expiresAt=Date.now()+15*60_000;return value;
    }catch(error){
      const message=String(error.message||error).slice(0,240);
      if(speculativeCache.value){speculativeCache.expiresAt=Date.now()+60_000;return{...speculativeCache.value,cached:true,error:message}}
      return{items:[],updatedAt:new Date().toISOString(),mode:'LIVE',provider:'MASSIVE',error:message};
    }
  })();
  try{return await speculativeCache.inflight}finally{speculativeCache.inflight=null}
}
async function analysisSymbolAllowed(symbol){
  if(WATCHLIST.includes(symbol))return true;
  if(!process.env.MASSIVE_API_KEY)return false;
  const scan=await fetchSpeculativeScan();
  return(scan.items||[]).some(x=>x.symbol===symbol&&x.optionsVerified===true);
}
const telegramState={dayKey:null,sentToday:0,seen:new Set(),lastRunAt:null,lastSentAt:null,lastSignal:null,lastError:null,running:false};
const GITHUB_OIDC_ISSUER='https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS=GITHUB_OIDC_ISSUER+'/.well-known/jwks';
const GITHUB_OIDC_AUDIENCE='spy-alpha-pro-v4-render';
const GITHUB_REPOSITORY='shalaanalshalaan1000-dotcom/-spy-alpha-pro';
const GITHUB_WORKFLOW_REF=GITHUB_REPOSITORY+'/.github/workflows/telegram-signals.yml@refs/heads/main';
const githubOidcCache={expiresAt:0,keys:[]},githubOidcReplay=new Map();
function jwtPart(value){return JSON.parse(Buffer.from(value,'base64url').toString('utf8'))}
async function githubOidcKeys(force=false){
  if(!force&&githubOidcCache.keys.length&&Date.now()<githubOidcCache.expiresAt)return githubOidcCache.keys;
  const response=await fetch(GITHUB_OIDC_JWKS,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)}),data=await response.json().catch(()=>({}));
  if(!response.ok||!Array.isArray(data.keys))throw new Error('Unable to load GitHub signing keys');
  githubOidcCache.keys=data.keys;githubOidcCache.expiresAt=Date.now()+6*60*60*1000;
  return githubOidcCache.keys;
}
async function verifyGitHubWorkflowToken(token){
  if(!token||token.length>20_000)throw new Error('Missing workflow token');
  const parts=token.split('.');
  if(parts.length!==3)throw new Error('Invalid workflow token');
  const header=jwtPart(parts[0]),claims=jwtPart(parts[1]);
  if(header.alg!=='RS256'||!header.kid)throw new Error('Unsupported workflow token');
  let keys=await githubOidcKeys(),jwk=keys.find(key=>key.kid===header.kid);
  if(!jwk){keys=await githubOidcKeys(true);jwk=keys.find(key=>key.kid===header.kid)}
  if(!jwk||!verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw new Error('Invalid workflow signature');
  const now=Math.floor(Date.now()/1000),audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==GITHUB_OIDC_ISSUER||!audiences.includes(GITHUB_OIDC_AUDIENCE))throw new Error('Invalid workflow issuer');
  if(Number(claims.exp)<=now||Number(claims.nbf||0)>now+30||Number(claims.iat)<now-900||Number(claims.iat)>now+60)throw new Error('Expired workflow token');
  if(claims.repository!==GITHUB_REPOSITORY||claims.ref!=='refs/heads/main'||claims.workflow_ref!==GITHUB_WORKFLOW_REF)throw new Error('Workflow is not trusted');
  if(!['push','schedule','workflow_dispatch'].includes(claims.event_name)||claims.runner_environment!=='github-hosted')throw new Error('Workflow event is not trusted');
  for(const[jti,expiresAt]of githubOidcReplay)if(expiresAt<=now)githubOidcReplay.delete(jti);
  if(!claims.jti||githubOidcReplay.has(claims.jti))throw new Error('Workflow token was already used');
  githubOidcReplay.set(claims.jti,Number(claims.exp));
  return claims;
}
function envNumber(key,fallback,min,max){const n=Number(process.env[key]);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function telegramConfigured(){return Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID)}
function telegramConfig(){
  return{
    minConfidence:envNumber('TELEGRAM_MIN_CONFIDENCE',Number(process.env.MIN_CONFIDENCE||70),50,95),
    minRR:envNumber('TELEGRAM_MIN_RR',2,1,10),
    maxPerDay:Math.round(envNumber('MAX_TELEGRAM_SIGNALS_PER_DAY',3,1,10)),
    cooldownMinutes:envNumber('TELEGRAM_COOLDOWN_MINUTES',90,5,360),
    scanSeconds:envNumber('TELEGRAM_SCAN_INTERVAL_SECONDS',300,60,3600),
    candidateLimit:Math.round(envNumber('TELEGRAM_CANDIDATE_LIMIT',3,1,6)),
    marketOnly:String(process.env.TELEGRAM_MARKET_ONLY||'true').toLowerCase()!=='false'
  };
}
function easternClock(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return{dayKey:parts.year+'-'+parts.month+'-'+parts.day,weekday:parts.weekday,minutes:Number(parts.hour)*60+Number(parts.minute),time:parts.hour+':'+parts.minute+' ET'};
}
function resetTelegramDay(){
  const clock=easternClock();
  if(telegramState.dayKey!==clock.dayKey){telegramState.dayKey=clock.dayKey;telegramState.sentToday=0;telegramState.seen.clear();telegramState.lastSentAt=null;telegramState.lastSignal=null}
  return clock;
}
function inRegularMarketWindow(){
  const clock=resetTelegramDay();
  return!['Sat','Sun'].includes(clock.weekday)&&clock.minutes>=9*60+35&&clock.minutes<=15*60+55;
}
function telegramPublicStatus(){
  const config=telegramConfig();resetTelegramDay();
  return{configured:telegramConfigured(),automatic:telegramConfigured()&&Boolean(process.env.MASSIVE_API_KEY),marketOnly:config.marketOnly,maxPerDay:config.maxPerDay,sentToday:telegramState.sentToday,lastRunAt:telegramState.lastRunAt,lastSentAt:telegramState.lastSentAt,lastSignal:telegramState.lastSignal,lastError:telegramState.lastError};
}
async function sendTelegramMessage(text){
  if(!telegramConfigured())throw new Error('Telegram is not configured');
  const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,text:String(text).slice(0,4000),disable_web_page_preview:true}),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw new Error('Telegram rejected the message: '+String(data.description||response.status));
  return data.result;
}
const telegramMoney=value=>Number.isFinite(Number(value))?'$'+Number(value).toFixed(2):'—';
function telegramSignalText(result){
  const c=result.contract||{},direction=result.direction==='CALL'?'CALL 🟢':'PUT 🔴',source=c.hasQuote?'Bid/Ask مباشر':'سعر مرجعي متأخر',reasons=(result.setup?.reasons||[]).slice(0,4).join(' • '),clock=easternClock(),asset=result.symbol==='SPX'?'المؤشر':'السهم';
  return[
    '🚨 SPY Alpha Pro V4',
    result.symbol+' — '+direction+' — تأكيد '+result.confidence+'%',
    '',
    asset+' الآن: '+telegramMoney(result.spot),
    'هدف '+asset+': '+telegramMoney(result.setup?.stockTarget),
    'إلغاء الفكرة: '+telegramMoney(result.setup?.invalidation),
    '',
    'العقد: '+String(c.symbol||'—'),
    'الانتهاء: '+String(c.expiry||'—')+' | Strike: '+String(c.strike??'—'),
    'دخول العقد: '+telegramMoney(c.mid)+' ('+source+')',
    'هدف العقد: '+telegramMoney(c.estimatedAtTarget)+' / '+String(c.targetPct??'—')+'%',
    'وقف العقد: '+telegramMoney(c.estimatedAtStop)+' / '+String(c.stopPct??'—')+'%',
    'العائد للمخاطرة: 1:'+String(c.rr??'—'),
    '',
    'التأكيدات: '+(reasons||'—'),
    'الوقت: '+clock.dayKey+' '+clock.time,
    '',
    'تنبيه تحليلي وليس ضمانًا للربح.'
  ].join('\n');
}
async function runTelegramSignalScan({ignoreMarketHours=false}={}){
  if(telegramState.running||!telegramConfigured()||!process.env.MASSIVE_API_KEY)return null;
  const config=telegramConfig(),clock=resetTelegramDay();
  if(config.marketOnly&&!ignoreMarketHours&&!inRegularMarketWindow())return null;
  if(telegramState.sentToday>=config.maxPerDay)return null;
  if(telegramState.lastSentAt&&Date.now()-new Date(telegramState.lastSentAt).getTime()<config.cooldownMinutes*60_000)return null;
  telegramState.running=true;telegramState.lastRunAt=new Date().toISOString();telegramState.lastError=null;
  try{
    const[scan,speculative]=await Promise.all([fetchMarketScan(true),fetchSpeculativeScan()]),quickCandidates=rankScan([...(scan.items||[]),...(speculative.items||[])]).filter(x=>['CALL','PUT'].includes(x.signal)&&!x.stale&&Number(x.confidence)>=config.minConfidence).slice(0,config.candidateLimit),detailed=[];
    for(const candidate of quickCandidates){
      try{
        const snapshot=await fetchSnapshot(candidate.symbol),result=analyze(snapshot,{minConfidence:config.minConfidence});
        if(result.freshness.stale||!['CALL','PUT'].includes(result.state)||result.state!==result.direction||Number(result.confidence)<config.minConfidence||!result.contract||Number(result.contract.rr)<config.minRR)continue;
        const key=[clock.dayKey,result.symbol,result.direction,result.contract.symbol].join('|');
        if(telegramState.seen.has(key))continue;
        detailed.push({result,key});
      }catch(error){telegramState.lastError='Candidate '+candidate.symbol+': '+String(error.message||error).slice(0,240)}
    }
    detailed.sort((a,b)=>b.result.confidence-a.result.confidence-(Number(a.result.contract?.rr)||0)+(Number(b.result.contract?.rr)||0));
    const best=detailed[0];
    if(!best)return null;
    await sendTelegramMessage(telegramSignalText(best.result));
    telegramState.seen.add(best.key);telegramState.sentToday+=1;telegramState.lastSentAt=new Date().toISOString();telegramState.lastSignal={symbol:best.result.symbol,direction:best.result.direction,confidence:best.result.confidence,contract:best.result.contract.symbol};telegramState.lastError=null;
    return best.result;
  }catch(error){telegramState.lastError=String(error.message||error).slice(0,300);console.error('Telegram signal scan failed:',telegramState.lastError);return null}
  finally{telegramState.running=false}
}
function startTelegramWorker(){
  if(!telegramConfigured()||!process.env.MASSIVE_API_KEY)return;
  const config=telegramConfig();
  const first=setTimeout(()=>void runTelegramSignalScan(),20_000);first.unref();
  const timer=setInterval(()=>void runTelegramSignalScan(),config.scanSeconds*1000);timer.unref();
  console.log('Telegram signal worker enabled — max '+config.maxPerDay+'/day, every '+config.scanSeconds+'s');
}
function currentMode(){return process.env.MASSIVE_API_KEY?{mode:'LIVE',provider:'MASSIVE'}:{mode:'DEMO',provider:'DEMO'}}
const sendJSON=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj))};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='POST'&&url.pathname==='/api/telegram/run'){
      try{await verifyGitHubWorkflowToken(String(req.headers.authorization||'').replace(/^Bearer\s+/i,''))}catch{return sendJSON(res,401,{error:'Untrusted workflow request'})}
      const queued=telegramConfigured()&&Boolean(process.env.MASSIVE_API_KEY)&&!telegramState.running;
      void runTelegramSignalScan();
      return sendJSON(res,202,{ok:true,queued,telegram:telegramPublicStatus()});
    }
    if(req.method==='GET'&&url.pathname==='/api/health')return sendJSON(res,200,{ok:true,...currentMode(),telegram:telegramPublicStatus(),access:accessStatus()});
    if(req.method==='GET'&&url.pathname==='/login'){
      if(!authEnabled())return redirect(res,'/');
      const error=url.searchParams.get('error');
      return sendHTML(res,authReady()?200:503,loginPage({error:error==='denied'?'هذا الإيميل غير موجود في قائمة المسموح لهم.':error==='oauth'?'تعذر إكمال تسجيل الدخول. حاول مرة أخرى.':''}));
    }
    if(req.method==='GET'&&url.pathname==='/auth/google'){
      if(!authReady())return sendHTML(res,503,loginPage());
      const state=randomBytes(32).toString('base64url'),redirectUri=requestBaseUrl(req)+'/auth/google/callback',params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:'openid email',state,prompt:'select_account'});
      return redirect(res,'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString(),{'set-cookie':cookieLine(OAUTH_STATE_COOKIE,state,req,{maxAge:600})});
    }
    if(req.method==='GET'&&url.pathname==='/auth/google/callback'){
      if(!authReady())return sendHTML(res,503,loginPage());
      const savedState=parseCookies(req)[OAUTH_STATE_COOKIE],state=url.searchParams.get('state'),code=url.searchParams.get('code');
      if(!safeEqual(savedState,state)||!code)return redirect(res,'/login?error=oauth');
      const redirectUri=requestBaseUrl(req)+'/auth/google/callback',tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectUri,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)}),tokens=await tokenResponse.json().catch(()=>({}));
      if(!tokenResponse.ok||!tokens.access_token)return redirect(res,'/login?error=oauth');
      const profileResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(15000)}),profile=await profileResponse.json().catch(()=>({})),email=normalizeEmail(profile.email);
      if(!profileResponse.ok||profile.email_verified!==true||!allowedEmails().has(email))return redirect(res,'/login?error=denied');
      return redirect(res,'/',{'set-cookie':[cookieLine(AUTH_COOKIE,createSession(email),req,{maxAge:12*60*60}),cookieLine(OAUTH_STATE_COOKIE,'',req,{maxAge:0})]});
    }
    if(req.method==='GET'&&url.pathname==='/logout')return redirect(res,authEnabled()?'/login':'/',{'set-cookie':cookieLine(AUTH_COOKIE,'',req,{maxAge:0})});
    const session=readSession(req);
    if(authEnabled()&&!authReady())return url.pathname.startsWith('/api/')?sendJSON(res,503,{error:'Access control is not fully configured'}):sendHTML(res,503,loginPage());
    if(authEnabled()&&!session)return url.pathname.startsWith('/api/')?sendJSON(res,401,{error:'Authentication required'}):redirect(res,'/login');
    if(req.method==='GET'&&url.pathname==='/'){
      return sendHTML(res,200,HTML);
    }
    if(req.method==='GET'&&url.pathname==='/api/config')return sendJSON(res,200,{watchlist:WATCHLIST,minConfidence:Number(process.env.MIN_CONFIDENCE||70),user:session?.email||null,...currentMode()});
    if(req.method==='GET'&&url.pathname==='/api/telegram/status')return sendJSON(res,200,telegramPublicStatus());
    if(req.method==='POST'&&url.pathname==='/api/telegram/test'){
      if(!authEnabled()||!session)return sendJSON(res,403,{error:'Enable authenticated access before using the Telegram test'});
      const result=await sendTelegramMessage('✅ SPY Alpha Pro V4\nتم ربط Telegram بنجاح. ستصل الإشارات المؤكدة تلقائيًا أثناء السوق.');
      return sendJSON(res,200,{ok:true,messageId:result.message_id});
    }
    if(req.method==='GET'&&url.pathname==='/api/scan'){
      const result=await fetchMarketScan(url.searchParams.get('force')==='1');
      return sendJSON(res,200,result);
    }
    if(req.method==='GET'&&url.pathname==='/api/speculative'){
      const result=await fetchSpeculativeScan(url.searchParams.get('force')==='1');
      return sendJSON(res,200,result);
    }
    const m=url.pathname.match(/^\/api\/analyze\/([A-Za-z.-]{1,8})$/);
    if(req.method==='GET'&&m){
      const symbol=m[1].toUpperCase();
      if(!await analysisSymbolAllowed(symbol))return sendJSON(res,400,{error:'Unsupported symbol'});
      const snap=await fetchSnapshot(symbol),result=analyze(snap,{minConfidence:Number(process.env.MIN_CONFIDENCE||70)});
      if(result.freshness.stale)result.state='NO TRADE';
      return sendJSON(res,200,{...result,mode:snap.mode,provider:snap.provider,optionDataError:snap.optionDataError||null,optionDiagnostics:snap.optionDiagnostics||null,optionChain:optionChainForClient(snap.options,snap.intraday.at(-1).close,result.setup.stockTarget,result.setup.invalidation)});
    }
    return sendJSON(res,404,{error:'Not found'});
  }catch(e){return sendJSON(res,Number.isInteger(e.statusCode)?e.statusCode:500,{error:e.message})}
});
server.listen(PORT,'0.0.0.0',()=>{console.log('SPY Alpha Pro V4 listening on '+PORT+' — '+currentMode().provider);startTelegramWorker()});
