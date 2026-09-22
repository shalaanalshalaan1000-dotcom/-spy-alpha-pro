import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 10000);
const INNER_PORT = Number(process.env.GOLD_ALPHA_SITE_INNER_PORT || 3200);
const BUILD = 'gold-alpha-btc-williams-v2';
let stopping = false;

const child = spawn(process.execPath, ['site-indicator-start.js'], {
  env: { ...process.env, PORT: String(INNER_PORT) },
  stdio: ['ignore', 'inherit', 'inherit']
});

child.on('exit', code => {
  console.error('[render-start] site indicator exited', code);
  if (!stopping) process.exit(code || 1);
});

function shutdown(signal) {
  stopping = true;
  if (!child.killed) child.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

function proxy(req) {
  return new Promise((resolve, reject) => {
    const upstream = http.request({
      hostname: '127.0.0.1',
      port: INNER_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${INNER_PORT}` }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode || 502,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    upstream.on('error', reject);
    upstream.setTimeout(10000, () => upstream.destroy(new Error('upstream timeout')));
    if (req.method === 'GET' || req.method === 'HEAD') upstream.end();
    else req.pipe(upstream);
  });
}

const btcCache = { expiresAt: 0, value: null, pending: null };

async function externalJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Gold-Alpha-Pro/4.3' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`BTC source HTTP ${response.status}`);
  return response.json();
}

function normalizeCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({
    t: Number(row?.[0]) * 1000,
    low: Number(row?.[1]),
    high: Number(row?.[2]),
    open: Number(row?.[3]),
    close: Number(row?.[4]),
    volume: Number(row?.[5] || 0)
  })).filter(c => [c.t, c.low, c.high, c.open, c.close].every(Number.isFinite) && c.close > 0)
    .sort((a, b) => a.t - b.t);
}

function ema(values, period) {
  const data = values.filter(Number.isFinite);
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let out = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const value of data.slice(period)) out = value * k + out * (1 - k);
  return out;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) gains += delta;
    else losses -= delta;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const values = [];
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const c = candles[i], prev = candles[i - 1];
    values.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const round = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;

function btcWilliamsR(candles,period=14){
  const xs=candles.slice(-period);if(xs.length<3)return -50;
  const hh=Math.max(...xs.map(c=>c.high)),ll=Math.min(...xs.map(c=>c.low)),close=xs.at(-1).close;
  return hh>ll?-100*(hh-close)/(hh-ll):-50;
}
function btcSlope(values=[]){return values.length>1?(values.at(-1)-values[0])/Math.max(1,values.length-1):0;}
function btcStructure(candles=[]){
  const xs=candles.slice(-8);let score=0;
  for(let i=1;i<xs.length;i++){
    if(xs[i].high>xs[i-1].high&&xs[i].low>=xs[i-1].low)score++;
    if(xs[i].low<xs[i-1].low&&xs[i].high<=xs[i-1].high)score--;
  }
  return score;
}
function btcTrend15(fifteen,price){
  const xs=fifteen.slice(-24),closes=xs.map(c=>c.close);
  const fast=ema(closes,5),slow=ema(closes,10),a15=atr(xs,10)||price*.003,sl=btcSlope(closes.slice(-6)),structure=btcStructure(xs);
  const up=Number.isFinite(fast)&&Number.isFinite(slow)&&fast>slow&&sl>0&&structure>=0&&price>=fast-a15*.20;
  const down=Number.isFinite(fast)&&Number.isFinite(slow)&&fast<slow&&sl<0&&structure<=0&&price<=fast+a15*.20;
  const side=up&&!down?'BUY':down&&!up?'SELL':null;
  const separation=side?Math.abs(fast-slow)/Math.max(a15,.01):0;
  return{side,strength:side?Math.min(22,Math.round(8+separation*10+Math.abs(structure)*1.5)):0,emaFast:round(fast,2),emaSlow:round(slow,2),atr15:round(a15,2),structure,slope:round(sl,2)};
}
function btcVolatilityExplosion(five,side){
  const xs=five.slice(-12);if(xs.length<8)return{ready:false,ratio:0,breakLevel:null,bodyShare:0};
  const current=xs.at(-1),prior=xs.slice(-7,-1),trs=[];
  for(let i=0;i<prior.length;i++){const p=prior[i-1]?.close??xs.at(-8)?.close;trs.push(Math.max(prior[i].high-prior[i].low,Math.abs(prior[i].high-p),Math.abs(prior[i].low-p)));}
  const base=trs.reduce((a,b)=>a+b,0)/Math.max(1,trs.length);
  const prev=xs.at(-2)?.close,currentTR=Math.max(current.high-current.low,Math.abs(current.high-prev),Math.abs(current.low-prev));
  const ratio=currentTR/Math.max(base,.01),range=Math.max(.01,current.high-current.low),bodyShare=Math.abs(current.close-current.open)/range;
  const priorHigh=Math.max(...prior.map(c=>c.high)),priorLow=Math.min(...prior.map(c=>c.low));
  const directional=side==='BUY'?current.close>current.open:current.close<current.open;
  const breakout=side==='BUY'?current.close>priorHigh:current.close<priorLow;
  return{ready:ratio>=1.15&&bodyShare>=.48&&directional&&breakout,ratio:round(ratio,2),breakLevel:round(side==='BUY'?priorHigh:priorLow,2),bodyShare:round(bodyShare,2)};
}
function btcTiming1m(one,side){
  const xs=one.slice(-10),wpr=btcWilliamsR(xs,7),structure=btcStructure(xs),impulse=btcSlope(xs.slice(-4).map(c=>c.close));
  const ready=side==='BUY'?(wpr>-72&&structure>=0&&impulse>=0):(wpr<-28&&structure<=0&&impulse<=0);
  return{ready,williamsR:round(wpr,1),structure,impulse:round(impulse,2)};
}
function btcSwingLevels(candles,side,price){
  const xs=candles.slice(-48),out=[];
  for(let i=2;i<xs.length-2;i++){
    const c=xs[i];
    if(side==='BUY'&&c.high>=xs[i-1].high&&c.high>=xs[i-2].high&&c.high>xs[i+1].high&&c.high>=xs[i+2].high&&c.high>price)out.push(c.high);
    if(side==='SELL'&&c.low<=xs[i-1].low&&c.low<=xs[i-2].low&&c.low<xs[i+1].low&&c.low<=xs[i+2].low&&c.low<price)out.push(c.low);
  }
  return [...new Set(out.map(v=>round(v,2)))].sort((a,b)=>side==='BUY'?a-b:b-a);
}
function btcSnapTarget(raw,levels,side,a5){
  const tol=Math.max(25,a5*.45),near=levels.filter(v=>Math.abs(v-raw)<=tol);
  if(!near.length)return raw;
  return near.sort((a,b)=>Math.abs(a-raw)-Math.abs(b-raw))[0];
}
function buildBtcSignal(one,five,fifteen,ticker){
  const price=Number(ticker?.price??one.at(-1)?.close);
  if(!Number.isFinite(price)||one.length<40||five.length<60||fifteen.length<24)throw new Error('BTC history incomplete');

  const trend=btcTrend15(fifteen,price);
  if(!trend.side){
    return{symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'LARRY_WILLIAMS_WAIT',confidence:52,minConfidence:82,executable:false,executionMode:'SIGNALS_ONLY',timeframe:'15m trend / 5m volatility / 1m timing',price:round(price,2),entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,trend:'NEUTRAL',williams:{trend},reason:'WAIT: no clear 15m trend in Larry Williams framework.',updatedAt:new Date().toISOString()};
  }

  const side=trend.side,explosion=btcVolatilityExplosion(five,side),timing=btcTiming1m(one,side),a5=atr(five,14)||price*.003,wpr5=btcWilliamsR(five,14),structure5=btcStructure(five);
  let confidence=58+trend.strength;
  if(explosion.ratio>=1.15)confidence+=6;
  if(explosion.ready)confidence+=9;
  if(timing.ready)confidence+=5;
  if(side==='BUY'&&wpr5>-80&&wpr5<-5)confidence+=3;
  if(side==='SELL'&&wpr5<-20&&wpr5>-95)confidence+=3;
  if(side==='BUY'&&structure5>=2)confidence+=3;
  if(side==='SELL'&&structure5<=-2)confidence+=3;
  confidence=Math.min(94,Math.max(0,Math.round(confidence)));

  const williams={trend,volatilityExpansion:explosion,timing,williamsR5:round(wpr5,1),atr5:round(a5,2),structure5m:structure5};
  if(!explosion.ready){
    return{symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'LARRY_WILLIAMS_WAIT',confidence,minConfidence:82,executable:false,executionMode:'SIGNALS_ONLY',timeframe:'15m trend / 5m volatility / 1m timing',price:round(price,2),entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,trend:side==='BUY'?'BULLISH':'BEARISH',williams,reason:'WAIT: 15m trend exists, but no confirmed 5m volatility breakout.',updatedAt:new Date().toISOString()};
  }

  const breakLevel=Number(explosion.breakLevel),chase=Math.abs(price-breakLevel),maxChase=Math.max(35,a5*.65);
  if(chase>maxChase){
    return{symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'LARRY_WILLIAMS_NO_CHASE',confidence,minConfidence:82,executable:false,executionMode:'SIGNALS_ONLY',timeframe:'15m trend / 5m volatility / 1m timing',price:round(price,2),entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,trend:side==='BUY'?'BULLISH':'BEARISH',williams,reason:'NO CHASE: breakout moved too far from the Williams entry level.',updatedAt:new Date().toISOString()};
  }

  const recent5=five.slice(-7),swing=side==='BUY'?Math.min(...recent5.map(c=>c.low)):Math.max(...recent5.map(c=>c.high)),buffer=Math.max(18,a5*.18);
  let stop=side==='BUY'?swing-buffer:swing+buffer;
  const minRisk=Math.max(30,a5*.35),maxRisk=Math.max(160,a5*2.2);
  let risk=Math.abs(price-stop);
  if(risk<minRisk)stop=side==='BUY'?price-minRisk:price+minRisk;
  risk=Math.abs(price-stop);
  if(risk>maxRisk){
    return{symbol:'BTCUSD',source:'COINBASE_SPOT',status:'WAIT',action:'WAIT',side:null,strategy:'LARRY_WILLIAMS_RISK_GUARD',confidence,minConfidence:82,executable:false,executionMode:'SIGNALS_ONLY',timeframe:'15m trend / 5m volatility / 1m timing',price:round(price,2),entry:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,trend:side==='BUY'?'BULLISH':'BEARISH',williams,reason:'WAIT: structural BTC stop is too wide for this setup.',updatedAt:new Date().toISOString()};
  }

  const direction=side==='BUY'?1:-1,levels=btcSwingLevels(fifteen.concat(five),side,price);
  const raw=[price+direction*Math.max(risk*1.2,a5*.95),price+direction*Math.max(risk*2,a5*1.65),price+direction*Math.max(risk*3,a5*2.45),price+direction*Math.max(risk*4,a5*3.3)];
  const targets=[];let prev=price;
  for(const x of raw){
    let t=btcSnapTarget(x,levels,side,a5),step=Math.max(20,a5*.18);
    if(side==='BUY'&&t<=prev+step)t=x>prev+step?x:prev+step;
    if(side==='SELL'&&t>=prev-step)t=x<prev-step?x:prev-step;
    t=round(t,2);targets.push(t);prev=t;
  }

  const active=confidence>=82,entry=active?breakLevel:null;
  return{
    symbol:'BTCUSD',source:'COINBASE_SPOT',status:active?'ACTIVE':'WAIT',action:active?side:'WAIT',side:active?side:null,
    strategy:'LARRY_WILLIAMS_VOLATILITY_BREAKOUT',confidence,minConfidence:82,executable:false,executionMode:'SIGNALS_ONLY',
    timeframe:'15m trend / 5m volatility breakout / 1m + Williams %R timing',price:round(price,2),entry:round(entry,2),
    stopLoss:round(active?stop:null,2),target1:round(active?targets[0]:null,2),target2:round(active?targets[1]:null,2),target3:round(active?targets[2]:null,2),target4:round(active?targets[3]:null,2),
    riskReward:active?round(Math.abs(targets[3]-price)/risk,2):null,trend:side==='BUY'?'BULLISH':'BEARISH',williams,
    targetLabels:['Williams 1.2R / structure','Williams 2R / structure','Williams 3R / structure','Williams 4R / expansion'],
    reason:active?`LARRY WILLIAMS CONFIRMED: 15m trend + 5m volatility breakout + Williams %R timing; expansion ${explosion.ratio}x; %R ${round(wpr5,1)}.`:`WAIT: Williams setup score ${confidence}% is below 82%.`,
    updatedAt:new Date().toISOString()
  };
}
async function getBtcSignal() {
  const now = Date.now();
  if (btcCache.value && btcCache.expiresAt > now) return btcCache.value;
  if (btcCache.pending) return btcCache.pending;
  btcCache.pending = (async () => {
    const [oneRows, fiveRows, ticker] = await Promise.all([
      externalJson('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60'),
      externalJson('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300'),
      externalJson('https://api.exchange.coinbase.com/products/BTC-USD/ticker')
    ]);
    const signal = buildBtcSignal(normalizeCandles(oneRows), normalizeCandles(fiveRows), ticker);
    btcCache.value = signal;
    btcCache.expiresAt = Date.now() + 5000;
    return signal;
  })();
  try { return await btcCache.pending; }
  finally { btcCache.pending = null; }
}

function injectBtc(html) {
  if (html.includes('btcOwnedIndicator')) return html;
  const css = `<style>
#btcOwnedIndicator{margin:14px 0;padding:16px;border:1px solid #8c6329;border-radius:16px;background:linear-gradient(145deg,#17120d,#0c1320);direction:rtl}
#btcOwnedIndicator h3{margin:0 0 12px;font-size:18px}#btcSignalWord{font-size:34px;font-weight:900;letter-spacing:1px}
.btcIndicatorMeta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.btcIndicatorMeta div{padding:9px;border:1px solid #3d3328;border-radius:10px;background:#0a101a}.btcIndicatorMeta span{display:block;color:#a99577;font-size:11px}.btcIndicatorMeta strong{display:block;margin-top:4px}.btcAccent{color:#f2b84b}.btcBuy{color:#45e6a7}.btcSell{color:#ff6f8b}.btcWait{color:#ffd166}
@media(max-width:760px){.btcIndicatorMeta{grid-template-columns:1fr 1fr}}
</style>`;
  const panel = `<section id="btcOwnedIndicator"><h3>BTCUSD — Bitcoin <span class="btcAccent">• مستقل عن الذهب</span></h3><div id="btcSignalWord" class="btcWait">WAIT</div><div class="btcIndicatorMeta"><div><span>السعر</span><strong id="btcPrice">—</strong></div><div><span>الثقة</span><strong id="btcConfidence">0%</strong></div><div><span>الاستراتيجية</span><strong id="btcStrategy">WAIT</strong></div><div><span>الاتجاه</span><strong id="btcTrend">—</strong></div><div><span>الدخول</span><strong id="btcEntry">—</strong></div><div><span>وقف الخسارة</span><strong id="btcStop">—</strong></div><div><span>TP1</span><strong id="btcTp1">—</strong></div><div><span>TP2</span><strong id="btcTp2">—</strong></div><div><span>TP3</span><strong id="btcTp3">—</strong></div><div><span>TP4</span><strong id="btcTp4">—</strong></div><div><span>التنفيذ</span><strong>إشارات فقط — لا تداول آلي</strong></div><div><span>سبب القرار</span><strong id="btcReason">بانتظار البيانات…</strong></div></div></section>`;
  const js = `<script>(function(){async function refreshBtc(){try{const r=await fetch('/api/btc-signal',{cache:'no-store'}),s=await r.json(),word=document.getElementById('btcSignalWord');if(!word)return;word.textContent=s.action||'WAIT';word.className=s.action==='BUY'?'btcBuy':s.action==='SELL'?'btcSell':'btcWait';const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';document.getElementById('btcPrice').textContent=fmt(s.price);document.getElementById('btcConfidence').textContent=Math.round(Number(s.confidence)||0)+'%';document.getElementById('btcStrategy').textContent=s.strategy||'WAIT';document.getElementById('btcTrend').textContent=s.trend||'—';document.getElementById('btcEntry').textContent=fmt(s.entry);document.getElementById('btcStop').textContent=fmt(s.stopLoss);document.getElementById('btcTp1').textContent=fmt(s.target1);document.getElementById('btcTp2').textContent=fmt(s.target2);document.getElementById('btcTp3').textContent=fmt(s.target3);document.getElementById('btcTp4').textContent=fmt(s.target4);document.getElementById('btcReason').textContent=s.reason||'—';}catch(e){const w=document.getElementById('btcSignalWord');if(w){w.textContent='WAIT';w.className='btcWait';}const x=document.getElementById('btcReason');if(x)x.textContent='BTC data temporarily unavailable';}}(async function loop(){await refreshBtc();setTimeout(loop,5000)})();})();</script>`;
  html = html.replace('</head>', `${css}</head>`);
  html = html.replace('<main', `${panel}<main`);
  html = html.replace('</body>', `${js}</body>`);
  return html;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/btc-signal') {
    try {
      const payload = await getBtcSignal();
      res.writeHead(200, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-alpha-build':BUILD});
      return res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(200, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      return res.end(JSON.stringify({symbol:'BTCUSD',status:'WAIT',action:'WAIT',executable:false,executionMode:'SIGNALS_ONLY',confidence:0,strategy:'WAIT',reason:`BTC data unavailable: ${String(error?.message || error)}`,updatedAt:new Date().toISOString()}));
    }
  }

  try {
    const out = await proxy(req);
    const headers = { ...out.headers, 'x-gold-alpha-build': BUILD };
    delete headers['content-length'];
    if (req.method === 'GET' && url.pathname === '/' && String(headers['content-type'] || '').includes('text/html')) {
      const html = injectBtc(out.body.toString('utf8'));
      headers['content-type'] = 'text/html; charset=utf-8';
      headers['cache-control'] = 'no-store';
      res.writeHead(out.status, headers);
      return res.end(html);
    }
    res.writeHead(out.status, headers);
    res.end(out.body);
  } catch (error) {
    res.writeHead(502, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    res.end('Gold Alpha temporarily unavailable');
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`[render-start] ${BUILD} listening on ${PORT}; gold-inner=${INNER_PORT}; BTCUSD signals-only=on`));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
