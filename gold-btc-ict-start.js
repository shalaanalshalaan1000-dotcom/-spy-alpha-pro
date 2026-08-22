import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function patchedReadFileSync(path, ...args) {
  const data = originalReadFileSync(path, ...args);
  const p = String(path);
  if (!p.endsWith('/server.js') && !p.endsWith('\\server.js')) return data;

  const isBuffer = Buffer.isBuffer(data);
  let source = isBuffer ? data.toString('utf8') : String(data);

  source = source.replace('<title>SPY Alpha Pro V4</title>', '<title>Gold + Bitcoin Alpha Pro</title>');
  source = source.replace('<h1>SPY Alpha Pro V4</h1><p>XAUUSD FOCUS • LEADERS • SPX 0DTE • AUTO OPTIONS RADAR</p>', '<h1>Gold + Bitcoin Alpha Pro</h1><p>XAUUSD + BTCUSD • ICT / SMC LIQUIDITY ENGINE</p>');

  const btcCss = `
.btcPanel{margin:14px 0 0;border:1px solid #714b24;border-radius:18px;background:linear-gradient(145deg,#17130e,#0b111b);padding:16px}
.btcHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.btcTitle{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.btcTitle h2{margin:0;color:#f3bf66;font-size:18px}.btcTag{display:inline-flex;padding:6px 9px;border:1px solid #76512c;border-radius:999px;color:#ffc56e;background:#25180c;font-size:11px;font-weight:900;direction:ltr}
.btcMetrics{display:grid;grid-template-columns:1.4fr repeat(4,1fr);gap:9px;margin-bottom:12px}.btcMetric{padding:11px 12px;border:1px solid #463627;border-radius:12px;background:#101621}.btcMetric span,.btcCard span,.btcCard small{display:block;color:#a79278;font-size:11px}.btcMetric strong{display:block;margin-top:6px;font-size:17px;direction:ltr;text-align:right}.btcMetric.price strong{font-size:26px;color:#ffc56e}.btcGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-bottom:12px}.btcCard{padding:11px;border:1px solid #3c342d;border-radius:11px;background:#0d1421}.btcCard strong{display:block;margin:6px 0;font-size:18px;direction:ltr;text-align:right}.btcLevels{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}.btcLevel{padding:9px 10px;border:1px dashed #58452f;border-radius:10px;background:#0c121c}.btcLevel span{display:block;color:#9e8c75;font-size:10px}.btcLevel b{display:block;margin-top:4px;direction:ltr;font-size:13px}.btcChart{height:460px;border:1px solid #282d38;border-radius:16px;overflow:hidden;background:#090e17}.btcNote{margin:10px 0 0;color:#9f927f;font-size:11px;line-height:1.7}.btcError{padding:10px;border:1px solid #693044;border-radius:10px;color:#ff8aa0;background:#2b1420;margin-bottom:10px}.btcPositive{color:#52e5a5}.btcNegative{color:#ff718c}.btcWait{color:#ffd166}
@media(max-width:900px){.btcMetrics{grid-template-columns:repeat(2,1fr)}.btcGrid{grid-template-columns:repeat(2,1fr)}.btcLevels{grid-template-columns:repeat(2,1fr)}.btcChart{height:400px}.btcHead{flex-direction:column}}
`;
  source = source.replace('</style></head>', btcCss + '</style></head>');

  const btcHtml = `<article class="btcPanel"><div class="btcHead"><div><div class="btcTitle"><h2>BTCUSD — Bitcoin</h2><span class="btcTag">SPOT • ICT / SMC</span></div><p id="btcMeta" class="scanMeta">جارٍ تحميل تحليل البيتكوين…</p></div><button id="btcRefresh" class="compact">تحديث BTC</button></div><div id="btcError" class="btcError" hidden></div><section class="btcMetrics"><div class="btcMetric price"><span>السعر</span><strong id="btcPrice">—</strong></div><div class="btcMetric"><span>HTF Bias</span><strong id="btcBias">—</strong></div><div class="btcMetric"><span>الإشارة</span><strong id="btcState">—</strong></div><div class="btcMetric"><span>الثقة</span><strong id="btcConfidence">—</strong></div><div class="btcMetric"><span>التغير 24h</span><strong id="btcChange">—</strong></div></section><section class="btcLevels"><div class="btcLevel"><span>PDH</span><b id="btcPdh">—</b></div><div class="btcLevel"><span>PDL</span><b id="btcPdl">—</b></div><div class="btcLevel"><span>ASIA HIGH</span><b id="btcAsiaHigh">—</b></div><div class="btcLevel"><span>ASIA LOW</span><b id="btcAsiaLow">—</b></div></section><section class="btcGrid"><div class="btcCard"><span>الدخول</span><strong id="btcEntry">—</strong><small id="btcTrigger">بانتظار Sweep + MSS</small></div><div class="btcCard"><span>الهدف 1</span><strong id="btcTarget1">—</strong><small>السيولة الأقرب / 1R+</small></div><div class="btcCard"><span>الهدف 2</span><strong id="btcTarget2">—</strong><small>السيولة التالية / امتداد</small></div><div class="btcCard"><span>إلغاء السيناريو</span><strong id="btcStop">—</strong><small>خلف منطقة الـ Sweep</small></div><div class="btcCard"><span>ICT Confirmation</span><strong id="btcConfirm">—</strong><small id="btcSetupText">—</small></div></section><div id="btcChart" class="btcChart"></div><p class="btcNote">BTC يعمل 24/7. الاتجاه من 4H و1H، البنية من 15m/5m، والدخول من 1m/5m بعد Liquidity Sweep ثم MSS مع FVG/Displacement. لا تُعرض صفقة مكتملة إذا لم تتجاوز الثقة 75%.</p></article>`;
  source = source.replace('</main><script>', btcHtml + '</main><script>');

  const btcServer = `
const btcCache={expiresAt:0,value:null};
async function binanceKlines(interval,limit=300){
  const url=new URL('https://api.binance.com/api/v3/klines');url.searchParams.set('symbol','BTCUSDT');url.searchParams.set('interval',interval);url.searchParams.set('limit',String(limit));
  const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Binance '+r.status);const rows=await r.json();
  return (Array.isArray(rows)?rows:[]).map(x=>({timestamp:new Date(Number(x[0])).toISOString(),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5]||0)})).filter(x=>Number.isFinite(x.close));
}
function nyParts(ts){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return{day:parts.year+'-'+parts.month+'-'+parts.day,hour:Number(parts.hour),minute:Number(parts.minute)}}
function btcLiquidity(candles,now=Date.now()){
  const today=nyParts(now).day,days=[...new Set(candles.map(c=>nyParts(c.timestamp).day))].filter(x=>x<=today).sort(),prev=days.filter(x=>x<today).at(-1),prevRows=prev?candles.filter(c=>nyParts(c.timestamp).day===prev):[],todayRows=candles.filter(c=>nyParts(c.timestamp).day===today),asia=todayRows.filter(c=>{const h=nyParts(c.timestamp).hour;return h>=20||h<1});
  const hi=a=>a.length?Math.max(...a.map(x=>x.high)):null,lo=a=>a.length?Math.min(...a.map(x=>x.low)):null;return{pdh:hi(prevRows),pdl:lo(prevRows),asiaHigh:hi(asia),asiaLow:lo(asia)};
}
function btcTrend(candles){const closes=candles.map(x=>x.close),e20=ema(closes,20),e50=ema(closes,50),last=closes.at(-1);if(!Number.isFinite(last)||!Number.isFinite(e20)||!Number.isFinite(e50))return'NEUTRAL';if(last>e20&&e20>e50)return'BULLISH';if(last<e20&&e20<e50)return'BEARISH';return'NEUTRAL'}
function nearestDirectionalLiquidity(price,levels,direction){const vals=Object.values(levels).filter(Number.isFinite);const pool=direction==='UP'?vals.filter(v=>v>price).sort((a,b)=>a-b):vals.filter(v=>v<price).sort((a,b)=>b-a);return pool[0]??null}
function analyzeBtcICT(data){
  const one=data.one,five=data.five,fifteen=data.fifteen,hour=data.hour,four=data.four;if(one.length<20||five.length<20||fifteen.length<20||hour.length<50||four.length<50)throw new Error('BTC history is incomplete');
  const price=one.at(-1).close,levels=btcLiquidity(five),trend4=btcTrend(four),trend1=btcTrend(hour),s15=detectStructure(fifteen),s5=detectStructure(five),s1=detectStructure(one),fvg5=detectFVG(five),fvg1=detectFVG(one),rsi5=rsi(five.map(x=>x.close),14),atr5=atr(five,14)||price*.003,atr1=atr(one,14)||price*.001;
  const last=five.at(-1),prev=five.slice(-8,-1),recentHigh=Math.max(...prev.map(x=>x.high)),recentLow=Math.min(...prev.map(x=>x.low));
  const sweepLow=s5.sweepLow||s1.sweepLow||(last.low<recentLow&&last.close>recentLow)||[levels.pdl,levels.asiaLow].some(v=>Number.isFinite(v)&&last.low<v&&last.close>v),sweepHigh=s5.sweepHigh||s1.sweepHigh||(last.high>recentHigh&&last.close<recentHigh)||[levels.pdh,levels.asiaHigh].some(v=>Number.isFinite(v)&&last.high>v&&last.close<v);
  const mssBull=s5.mssBull||s1.mssBull,mssBear=s5.mssBear||s1.mssBear,bullFvg=fvg5.bull||fvg1.bull,bearFvg=fvg5.bear||fvg1.bear;
  let bull=0,bear=0,reasons=[];
  if(trend4==='BULLISH'){bull+=18;reasons.push('4H bullish')}else if(trend4==='BEARISH'){bear+=18;reasons.push('4H bearish')}
  if(trend1==='BULLISH'){bull+=16;reasons.push('1H bullish')}else if(trend1==='BEARISH'){bear+=16;reasons.push('1H bearish')}
  if(s15.mssBull||s15.bosBull){bull+=12;reasons.push('15m MSS/BOS up')}if(s15.mssBear||s15.bosBear){bear+=12;reasons.push('15m MSS/BOS down')}
  if(sweepLow){bull+=18;reasons.push('sell-side liquidity sweep')}if(sweepHigh){bear+=18;reasons.push('buy-side liquidity sweep')}
  if(mssBull){bull+=18;reasons.push('1m/5m bullish MSS')}if(mssBear){bear+=18;reasons.push('1m/5m bearish MSS')}
  if(bullFvg){bull+=8;reasons.push('bullish FVG')}if(bearFvg){bear+=8;reasons.push('bearish FVG')}
  if(rsi5!=null&&rsi5>52)bull+=4;if(rsi5!=null&&rsi5<48)bear+=4;
  const direction=bull>bear?'UP':bear>bull?'DOWN':'WAIT',raw=Math.max(bull,bear),hasTrigger=direction==='UP'?(sweepLow&&mssBull):direction==='DOWN'?(sweepHigh&&mssBear):false,hasFvg=direction==='UP'?bullFvg:direction==='DOWN'?bearFvg:false;
  let confidence=Math.min(94,Math.round(38+raw*.62));if(!hasTrigger)confidence-=18;if(!hasFvg)confidence-=6;if(trend4==='NEUTRAL'||trend1==='NEUTRAL')confidence-=5;if(trend4!==trend1&&trend4!=='NEUTRAL'&&trend1!=='NEUTRAL')confidence-=12;confidence=Math.max(0,confidence);
  const active=direction!=='WAIT'&&confidence>=75&&hasTrigger,dir=direction==='UP'?1:-1,buffer=Math.max(atr1*1.2,price*.0008),sweepExtreme=direction==='UP'?Math.min(last.low,one.slice(-12).reduce((m,x)=>Math.min(m,x.low),Infinity)):Math.max(last.high,one.slice(-12).reduce((m,x)=>Math.max(m,x.high),-Infinity)),stop=active?sweepExtreme-dir*buffer:null,risk=active?Math.abs(price-stop):null,liq=active?nearestDirectionalLiquidity(price,levels,direction):null,target1=active?(liq&&Math.abs(liq-price)>=risk*.8?liq:price+dir*Math.max(risk*1.25,atr5*.8)):null,target2=active?(price+dir*Math.max(risk*2,atr5*1.5)):null;
  const setup=[sweepLow?'SSL Sweep':sweepHigh?'BSL Sweep':'No Sweep',mssBull?'Bull MSS':mssBear?'Bear MSS':'No MSS',bullFvg?'Bull FVG':bearFvg?'Bear FVG':'No FVG'].join(' • ');
  return{price:round(price,2),state:active?direction:'WAIT',bias:trend4==='BULLISH'&&trend1==='BULLISH'?'BULLISH':trend4==='BEARISH'&&trend1==='BEARISH'?'BEARISH':'MIXED',confidence,entry:active?round(price,2):null,target1:round(target1,2),target2:round(target2,2),invalidation:round(stop,2),levels:Object.fromEntries(Object.entries(levels).map(([k,v])=>[k,round(v,2)])),confirmations:{sweepLow,sweepHigh,mssBull,mssBear,bullFvg,bearFvg,setup,reasons:reasons.slice(0,8)},updatedAt:one.at(-1).timestamp};
}
async function fetchBtcICT(force=false){
  if(!force&&btcCache.value&&Date.now()<btcCache.expiresAt)return btcCache.value;
  const [one,five,fifteen,hour,four,ticker]=await Promise.all([binanceKlines('1m',500),binanceKlines('5m',1000),binanceKlines('15m',400),binanceKlines('1h',300),binanceKlines('4h',200),fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',{signal:AbortSignal.timeout(12000)}).then(r=>r.ok?r.json():Promise.reject(new Error('BTC ticker unavailable')))]);
  const value={...analyzeBtcICT({one,five,fifteen,hour,four}),change24h:round(Number(ticker.priceChangePercent),2),provider:'BINANCE',symbol:'BTCUSDT'};btcCache.value=value;btcCache.expiresAt=Date.now()+20_000;return value;
}
`;
  source = source.replace("const sendJSON=(res,status,obj)=>{", btcServer + "\nconst sendJSON=(res,status,obj)=>{");
  source = source.replace("if(req.method==='GET'&&url.pathname==='/api/health')", "if(req.method==='GET'&&url.pathname==='/api/btc'){const result=await fetchBtcICT(url.searchParams.get('force')==='1');return sendJSON(res,200,result)}\n    if(req.method==='GET'&&url.pathname==='/api/health')");

  const btcClient = `
let btcLoading=false,btcChartReady=false;
const btcMoney=v=>v==null?'—':'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function renderBtcChart(){if(btcChartReady)return;btcChartReady=true;const host=$('#btcChart');if(!host)return;host.innerHTML='<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:calc(100% - 28px);width:100%"></div><div class="tradingview-widget-copyright" style="height:28px;padding-top:5px;text-align:center;font-size:11px"><a href="https://www.tradingview.com/symbols/BTCUSD/" rel="noopener nofollow" target="_blank" style="color:#9f927f">BTCUSD chart by TradingView</a></div></div>';const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';script.type='text/javascript';script.async=true;script.textContent=JSON.stringify({autosize:true,symbol:'BINANCE:BTCUSDT',interval:'5',timezone:'Asia/Riyadh',theme:'dark',backgroundColor:'rgba(8, 11, 18, 1)',style:'1',locale:'en',allow_symbol_change:false,hide_side_toolbar:false,withdateranges:true,save_image:false,details:false,hotlist:false,calendar:false,support_host:'https://www.tradingview.com'});host.firstElementChild.appendChild(script)}
async function loadBtc(force=false){if(btcLoading)return;btcLoading=true;const button=$('#btcRefresh');if(button)button.disabled=true;const error=$('#btcError');if(error)error.hidden=true;try{const r=await fetch('/api/btc'+(force?'?force=1':''),{cache:'no-store'}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'BTC request failed');$('#btcPrice').textContent=btcMoney(d.price);$('#btcBias').textContent=d.bias;$('#btcBias').className=d.bias==='BULLISH'?'btcPositive':d.bias==='BEARISH'?'btcNegative':'btcWait';$('#btcState').textContent=d.state==='UP'?'شراء':d.state==='DOWN'?'بيع':'انتظار';$('#btcState').className=d.state==='UP'?'btcPositive':d.state==='DOWN'?'btcNegative':'btcWait';$('#btcConfidence').textContent=d.confidence+'%';$('#btcChange').textContent=(d.change24h>0?'+':'')+d.change24h+'%';$('#btcChange').className=d.change24h>=0?'btcPositive':'btcNegative';$('#btcPdh').textContent=btcMoney(d.levels?.pdh);$('#btcPdl').textContent=btcMoney(d.levels?.pdl);$('#btcAsiaHigh').textContent=btcMoney(d.levels?.asiaHigh);$('#btcAsiaLow').textContent=btcMoney(d.levels?.asiaLow);$('#btcEntry').textContent=btcMoney(d.entry);$('#btcTarget1').textContent=btcMoney(d.target1);$('#btcTarget2').textContent=btcMoney(d.target2);$('#btcStop').textContent=btcMoney(d.invalidation);$('#btcConfirm').textContent=d.state==='WAIT'?'WAIT':(d.state+' • '+d.confidence+'%');$('#btcSetupText').textContent=d.confirmations?.setup||'—';$('#btcTrigger').textContent=d.state==='WAIT'?'لا دخول حتى Sweep + MSS + ≥75%':'ENTRY ACTIVE • Sweep + MSS confirmed';$('#btcMeta').textContent='Binance • 4H/1H Bias → 15m/5m Structure → 1m/5m Entry • آخر شمعة '+new Date(d.updatedAt).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Riyadh'})+' بتوقيت الرياض';}catch(e){$('#btcMeta').textContent='تعذر تحميل BTC';if(error){error.textContent=e.message;error.hidden=false}}finally{btcLoading=false;if(button)button.disabled=false}}
`;
  source = source.replace('(async()=>{', btcClient + "\n$('#btcRefresh').onclick=()=>loadBtc(true);\n(async()=>{");
  source = source.replace("renderGoldChart();\n  await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);", "renderGoldChart();\n  renderBtcChart();\n  await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold(),loadBtc()]);");
  source = source.replace("setInterval(()=>{if($('#auto').checked)loadGold()},30000);", "setInterval(()=>{if($('#auto').checked)loadGold()},30000);\n  setInterval(()=>loadBtc(),30000);");

  return isBuffer ? Buffer.from(source, 'utf8') : source;
};

syncBuiltinESMExports();
await import('./gold-ict-history-start.js');
