import http from 'node:http';
import { spawn } from 'node:child_process';
import { getBtcSignal as getBtcNarrativeSignal } from './btc-ict-fast.js';

const PORT = Number(process.env.PORT || 10000);
const INNER_PORT = Number(process.env.GOLD_ALPHA_SITE_INNER_PORT || 3200);
const BUILD = 'gold-alpha-btc-confluence-v1';
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

async function getBtcSignal() {
  const now = Date.now();
  if (btcCache.value && btcCache.expiresAt > now) return btcCache.value;
  if (btcCache.pending) return btcCache.pending;
  btcCache.pending = (async () => {
    const [oneRows, fiveRows, fifteenRows, hourRows, ticker] = await Promise.all([
      externalJson('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60'),
      externalJson('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300'),
      externalJson('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900'),
      externalJson('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600'),
      externalJson('https://api.exchange.coinbase.com/products/BTC-USD/ticker')
    ]);
    const signal = buildBtcMurphySignal(
      normalizeCandles(oneRows),
      normalizeCandles(fiveRows),
      normalizeCandles(fifteenRows),
      normalizeCandles(hourRows),
      ticker
    );
    btcCache.value = signal;
    btcCache.expiresAt = Date.now() + 15000;
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
  const panel = `<section id="btcOwnedIndicator"><h3>BTCUSD — Multi-Model Confluence <span class="btcAccent">• تجربة حية 24/7</span></h3><div id="btcSignalWord" class="btcWait">WAIT</div><div class="btcIndicatorMeta"><div><span>السعر</span><strong id="btcPrice">—</strong></div><div><span>درجة الإعداد</span><strong id="btcConfidence">0/100</strong></div><div><span>BUY / SELL</span><strong id="btcConfluence">0 / 0</strong></div><div><span>الاستراتيجية</span><strong id="btcStrategy">WAIT</strong></div><div><span>الاتجاه</span><strong id="btcTrend">—</strong></div><div><span>الدخول</span><strong id="btcEntry">—</strong></div><div><span>وقف الخسارة</span><strong id="btcStop">—</strong></div><div><span>TP1</span><strong id="btcTp1">—</strong></div><div><span>TP2</span><strong id="btcTp2">—</strong></div><div><span>TP3</span><strong id="btcTp3">—</strong></div><div><span>TP4</span><strong id="btcTp4">—</strong></div><div><span>التنفيذ</span><strong>إشارات فقط — لا تداول آلي</strong></div><div><span>سبب القرار</span><strong id="btcReason">بانتظار البيانات…</strong></div></div></section>`;
  const js = `<script>(function(){async function refreshBtc(){try{const r=await fetch('/api/btc-signal',{cache:'no-store'}),s=await r.json(),word=document.getElementById('btcSignalWord');if(!word)return;word.textContent=s.action||'WAIT';word.className=s.action==='BUY'?'btcBuy':s.action==='SELL'?'btcSell':'btcWait';const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';document.getElementById('btcPrice').textContent=fmt(s.price);document.getElementById('btcConfidence').textContent=Math.round(Number(s.confidence)||0)+'/100';const sc=s.confluence?.scores||{};const cf=document.getElementById('btcConfluence');if(cf)cf.textContent=Math.round(Number(sc.BUY)||0)+' / '+Math.round(Number(sc.SELL)||0);document.getElementById('btcStrategy').textContent=s.strategy||'WAIT';document.getElementById('btcTrend').textContent=s.trend||'—';document.getElementById('btcEntry').textContent=fmt(s.entry);document.getElementById('btcStop').textContent=fmt(s.stopLoss);document.getElementById('btcTp1').textContent=fmt(s.target1);document.getElementById('btcTp2').textContent=fmt(s.target2);document.getElementById('btcTp3').textContent=fmt(s.target3);document.getElementById('btcTp4').textContent=fmt(s.target4);document.getElementById('btcReason').textContent=s.reason||'—';}catch(e){const w=document.getElementById('btcSignalWord');if(w){w.textContent='WAIT';w.className='btcWait';}const x=document.getElementById('btcReason');if(x)x.textContent='BTC data temporarily unavailable';}}(async function loop(){await refreshBtc();setTimeout(loop,5000)})();})();</script>`;
  html = html.replace('</head>', `${css}</head>`);
  html = html.replace('<main', `${panel}<main`);
  html = html.replace('</body>', `${js}</body>`);
  return html;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/btc-signal') {
    try {
      const payload = await getBtcNarrativeSignal();
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

server.listen(PORT, '0.0.0.0', () => console.log(`[render-start] ${BUILD} listening on ${PORT}; gold-inner=${INNER_PORT}; BTCUSD multi-model confluence signals-only=on`));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
