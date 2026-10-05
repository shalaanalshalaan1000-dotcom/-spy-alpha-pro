import http from 'node:http';
import { spawn } from 'node:child_process';
import { getBtcSignal } from './btc-snr-engine.js';

const PORT = Number(process.env.PORT || 10000);
const INNER_PORT = Number(process.env.GOLD_ALPHA_SITE_INNER_PORT || 3200);
const BUILD = 'gold-alpha-btc-snr-v1';
let stopping = false;

const child = spawn(process.execPath, ['site-indicator-start.js'], {
  env: { ...process.env, PORT: String(INNER_PORT) },
  stdio: ['ignore', 'inherit', 'inherit']
});

const btcTelegramEnabled = String(process.env.BTC_TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false'
  && String(process.env.TELEGRAM_ENABLED || 'true').toLowerCase() !== 'false'
  && Boolean(process.env.TELEGRAM_BOT_TOKEN)
  && Boolean(process.env.TELEGRAM_CHAT_ID);

const btcTelegram = btcTelegramEnabled ? spawn(process.execPath, ['btc-telegram-bot.js'], {
  env: { ...process.env, BTC_TELEGRAM_SIGNAL_URL: `http://127.0.0.1:${PORT}/api/btc-signal` },
  stdio: ['ignore', 'inherit', 'inherit']
}) : null;

child.on('exit', code => {
  console.error('[render-start] site indicator exited', code);
  if (!stopping) process.exit(code || 1);
});
if (btcTelegram) btcTelegram.on('exit', code => console.error('[render-start] BTC SNR Telegram exited', code));

function shutdown(signal) {
  stopping = true;
  if (!child.killed) child.kill(signal);
  if (btcTelegram && !btcTelegram.killed) btcTelegram.kill(signal);
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

function injectBtc(html) {
  if (html.includes('btcSnrIndicator')) return html;
  const css = `<style>
#btcSnrIndicator{margin:14px 0;padding:16px;border:1px solid #8c6329;border-radius:16px;background:linear-gradient(145deg,#17120d,#0c1320);direction:rtl}
#btcSnrIndicator h3{margin:0 0 12px;font-size:18px}#btcSignalWord{font-size:34px;font-weight:900;letter-spacing:1px}
.btcIndicatorMeta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.btcIndicatorMeta div{padding:9px;border:1px solid #3d3328;border-radius:10px;background:#0a101a}.btcIndicatorMeta span{display:block;color:#a99577;font-size:11px}.btcIndicatorMeta strong{display:block;margin-top:4px}.btcAccent{color:#f2b84b}.btcBuy{color:#45e6a7}.btcSell{color:#ff6f8b}.btcWait{color:#ffd166}
@media(max-width:760px){.btcIndicatorMeta{grid-template-columns:1fr 1fr}}
</style>`;
  const panel = `<section id="btcSnrIndicator"><h3>🟣 BTCUSD — SNR ONLY <span class="btcAccent">• Support / Resistance + Price Action</span></h3><div id="btcSignalWord" class="btcWait">WAIT</div><div class="btcIndicatorMeta"><div><span>السعر</span><strong id="btcPrice">—</strong></div><div><span>قوة الإعداد</span><strong id="btcConfidence">0/100</strong></div><div><span>نوع الإعداد</span><strong id="btcSetupType">—</strong></div><div><span>أقرب دعم</span><strong id="btcSupport">—</strong></div><div><span>أقرب مقاومة</span><strong id="btcResistance">—</strong></div><div><span>التأكيد</span><strong id="btcTrigger">—</strong></div><div><span>الاستراتيجية</span><strong>SNR_CLASSICAL</strong></div><div><span>الدخول</span><strong id="btcEntry">—</strong></div><div><span>وقف الخسارة</span><strong id="btcStop">—</strong></div><div><span>TP1</span><strong id="btcTp1">—</strong></div><div><span>TP2</span><strong id="btcTp2">—</strong></div><div><span>TP3</span><strong id="btcTp3">—</strong></div><div><span>TP4</span><strong id="btcTp4">—</strong></div><div><span>التنفيذ</span><strong>إشارات فقط — لا تداول آلي</strong></div><div><span>سبب القرار</span><strong id="btcReason">بانتظار SNR…</strong></div></div></section>`;
  const js = `<script>(function(){async function refreshBtc(){try{const r=await fetch('/api/btc-signal',{cache:'no-store'}),s=await r.json(),snr=s.snr||{},word=document.getElementById('btcSignalWord');if(!word)return;word.textContent=s.action||'WAIT';word.className=s.action==='BUY'?'btcBuy':s.action==='SELL'?'btcSell':'btcWait';const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';document.getElementById('btcPrice').textContent=fmt(s.price);const q=Math.round(Number(s.confidence)||0);document.getElementById('btcConfidence').textContent=q+'/100'+(q>=72?' • ممتاز':'');document.getElementById('btcSetupType').textContent=snr.setupType||'WAIT';document.getElementById('btcSupport').textContent=fmt(snr.nearestSupport?.mid);document.getElementById('btcResistance').textContent=fmt(snr.nearestResistance?.mid);document.getElementById('btcTrigger').textContent=(s.priceAction?.triggers||[]).join(' + ')||'WAIT';document.getElementById('btcEntry').textContent=fmt(s.entry);document.getElementById('btcStop').textContent=fmt(s.stopLoss);document.getElementById('btcTp1').textContent=fmt(s.target1);document.getElementById('btcTp2').textContent=fmt(s.target2);document.getElementById('btcTp3').textContent=fmt(s.target3);document.getElementById('btcTp4').textContent=fmt(s.target4);document.getElementById('btcReason').textContent=s.reason||'—';}catch(e){const w=document.getElementById('btcSignalWord');if(w){w.textContent='WAIT';w.className='btcWait';}const x=document.getElementById('btcReason');if(x)x.textContent='BTC data temporarily unavailable';}}(async function loop(){await refreshBtc();setTimeout(loop,5000)})();})();</script>`;
  return html.replace('</head>', `${css}</head>`).replace('<main', `${panel}<main`).replace('</body>', `${js}</body>`);
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
      return res.end(JSON.stringify({symbol:'BTCUSD',status:'WAIT',action:'WAIT',executable:false,executionMode:'SIGNALS_ONLY',confidence:0,strategy:'SNR_CLASSICAL',reason:`BTC data unavailable: ${String(error?.message || error)}`,updatedAt:new Date().toISOString()}));
    }
  }

  try {
    const out = await proxy(req);
    const headers = { ...out.headers, 'x-gold-alpha-build': BUILD };
    delete headers['content-length'];
    if (req.method === 'GET' && url.pathname === '/' && String(headers['content-type'] || '').includes('text/html')) {
      headers['content-type'] = 'text/html; charset=utf-8';
      headers['cache-control'] = 'no-store';
      res.writeHead(out.status, headers);
      return res.end(injectBtc(out.body.toString('utf8')));
    }
    res.writeHead(out.status, headers);
    res.end(out.body);
  } catch {
    res.writeHead(502, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    res.end('Gold Alpha temporarily unavailable');
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`[render-start] ${BUILD} listening on ${PORT}; gold-inner=${INNER_PORT}; BTCUSD SNR-only signals-only=on; btc-telegram=${btcTelegramEnabled?'on':'off'}`));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
