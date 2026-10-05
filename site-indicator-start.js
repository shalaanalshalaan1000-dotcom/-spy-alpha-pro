import http from 'node:http';
import { spawn } from 'node:child_process';
import { renderTradeJournalPage } from './trade-journal.js';
import { configureTelegramWebhook, handleTelegramWebhook } from './telegram-command-webhook.js';
import { orchestrateGoldAgents, applyAgentExecutionGate } from './gold-agent-orchestrator.js';

const PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.GOLD_ALPHA_INNER_PORT || 3100);
const BUILD_TAG = 'site-indicator-v23-gold-snr-advisory';

const app = spawn(process.execPath, ['gold-unified-start.js'], {
  env: { ...process.env, PORT: String(INNER_PORT) },
  stdio: ['ignore', 'inherit', 'inherit']
});

app.on('exit', code => console.error('gold unified child exited', code));

function shutdown(signal) {
  if (!app.killed) app.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

function proxy(req) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: INNER_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${INNER_PORT}` }
    };
    const upstream = http.request(options, response => {
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

function getJson(path) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: INNER_PORT, path, headers: { accept: 'application/json' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode || 500, data: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(8000, () => request.destroy(new Error('indicator upstream timeout')));
  });
}

function mapIndicator(source = {}) {
  const raw = ['BUY', 'SELL'].includes(source.action)
    ? source.action
    : ['BUY', 'SELL'].includes(source.candidateAction)
      ? source.candidateAction
      : null;

  const newsRisk = source.newsRisk || null;
  const blockedByNews = Boolean(newsRisk?.blockEntries);
  const signal = blockedByNews ? 'WAIT' : raw === 'BUY' ? 'BULL' : raw === 'SELL' ? 'BEAR' : 'WAIT';
  const confidence = Number(source.signalConfidence ?? source.confidence ?? 0);
  const scenarioPlan = source.scenarioPlan || source.momentum?.scenarioPlan || null;
  const agentStack = orchestrateGoldAgents(source);

  return {
    signal,
    source: 'GOLD_ALPHA_SITE',
    executable: Boolean(agentStack.decision?.executable),
    confidence: Number.isFinite(confidence) ? confidence : 0,
    price: Number.isFinite(Number(source.price)) ? Number(source.price) : null,
    timeframe: '1h/15m context / 5m multi-model confluence / 1m timing',
    provider: source.provider || null,
    status: blockedByNews ? 'NEWS_BLOCK' : (source.status || 'WAIT'),
    scenarioPlan,
    tradeStyle: source.tradeStyle || source.strategy || 'MULTI_MODEL_CONFLUENCE',
    newsRisk,
    ict: source.ict || source.liquidityContext || null,
    riskFramework: source.riskFramework || source.ict?.month2Risk || source.liquidityContext?.month2Risk || null,
    ictMonth3: source.ictMonth3 || source.confluence?.month3Sponsorship || agentStack.agents?.month3Sponsorship || null,
    luxalgo: source.luxalgo || null,
    confluence: source.confluence || null,
    multiTimeframe: source.multiTimeframe || source.confluence?.multiTimeframe || null,
    importantCandles: source.importantCandles || null,
    month5Context: source.month5Context || source.confluence?.month5Context || null,
    snr: agentStack.agents?.snr || null,
    architecture: agentStack.architecture,
    agentMode: agentStack.mode,
    agentDecision: agentStack.decision,
    decisionSchema: agentStack.decisionSchema,
    agents: agentStack.agents,
    reason: blockedByNews ? (newsRisk.reason || 'USD news blackout') : (source.reason || 'بانتظار اكتمال شروط إشارة الموقع'),
    updatedAt: source.updatedAt || new Date().toISOString()
  };
}

function injectIndicator(html) {
  if (html.includes('siteOwnedIndicator')) return html;

  const css = `<style>
#siteOwnedIndicator{margin:14px 0;padding:16px;border:1px solid #36516f;border-radius:16px;background:#0c1320;direction:rtl}
#siteOwnedIndicator h3{margin:0 0 12px;font-size:18px}
#siteSignalWord{font-size:34px;font-weight:900;letter-spacing:1px}
.siteBull{color:#45e6a7}.siteBear{color:#ff6f8b}.siteWait{color:#ffd166}.siteNewsBlock{color:#ff8c5a}
.siteIndicatorMeta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.siteIndicatorMeta div{padding:9px;border:1px solid #26384f;border-radius:10px;background:#0a101a}
.siteIndicatorMeta span{display:block;color:#8fa0b8;font-size:11px}.siteIndicatorMeta strong{display:block;margin-top:4px}
.siteIndicatorTop{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.siteIndicatorTop h3{margin:0}.journalLink{display:inline-flex;padding:8px 11px;border:1px solid #3b5879;border-radius:10px;color:#dce9ff;background:#111c2c;text-decoration:none;font-size:12px;font-weight:900}
@media(max-width:760px){.siteIndicatorMeta{grid-template-columns:1fr 1fr}}
</style>`;

  const panel = `<section id="siteOwnedIndicator"><div class="siteIndicatorTop"><h3>مؤشر الموقع — المصدر الوحيد للإشارة</h3><a class="journalLink" href="/journal">Trade Journal</a></div><div id="siteSignalWord" class="siteWait">WAIT</div><div class="siteIndicatorMeta"><div><span>درجة الإعداد</span><strong id="siteSignalConfidence">0/100</strong></div><div><span>السعر</span><strong id="siteSignalPrice">—</strong></div><div><span>الحالة</span><strong id="siteSignalStatus">WAIT</strong></div><div><span>Market Bias</span><strong id="siteMarketBias">—</strong></div><div><span>SNR — عامل مساعد</span><strong id="siteGoldSnr">—</strong></div><div><span>BUY Zone</span><strong id="siteBuyZone">—</strong></div><div><span>SELL Zone</span><strong id="siteSellZone">—</strong></div><div><span>5m Trigger</span><strong id="siteZoneTrigger">WAIT</strong></div><div><span>الشمعة المهمة</span><strong id="siteKeyCandle">—</strong></div><div><span>HTF FVG — دعم إضافي</span><strong id="siteHtfFvg">—</strong></div><div><span>ICT Month 1 — Price Delivery</span><strong id="siteIctDelivery">—</strong></div><div><span>Premium / Discount + EQ</span><strong id="siteIctLocation">—</strong></div><div><span>External Liquidity Draw</span><strong id="siteIctDraw">—</strong></div><div><span>ICT Reference Point</span><strong id="siteIctReference">—</strong></div><div><span>ICT Month 3 — Sponsorship</span><strong id="siteIctMonth3">—</strong></div><div><span>Month 3 Evidence</span><strong id="siteIctMonth3Detail">—</strong></div><div><span>M5 MSS — دعم إضافي</span><strong id="siteM5Mss">—</strong></div><div><span>M5 Retest</span><strong id="siteM5Retest">—</strong></div><div><span>Confluence</span><strong id="siteConfluence">WAITING</strong></div><div><span>ICT Month 5 — Institutional Swing</span><strong id="siteMonth5Swing">—</strong></div><div><span>ICT Month 5 — Open Float</span><strong id="siteMonth5Float">—</strong></div><div><span>ICT Month 5 — PD Arrays</span><strong id="siteMonth5Pd">—</strong></div><div><span>ICT Month 5 — 20/40/60D</span><strong id="siteMonth5Quarterly">—</strong></div><div><span>Macro Bias</span><strong id="siteMacroBias">—</strong></div><div><span>Top-down TFs</span><strong id="siteTimeframeChain">—</strong></div><div><span>ICT Month 6 — HTF Support</span><strong id="siteMonth6Htf">—</strong></div><div><span>ICT Month 6 — PD Array</span><strong id="siteMonth6Pd">—</strong></div><div><span>حالة الأخبار</span><strong id="siteNewsRisk">جارٍ الفحص…</strong></div><div><span>الخبر المؤثر</span><strong id="siteNewsEvent">—</strong></div><div><span>التنفيذ</span><strong id="siteSignalExecutable">غير تنفيذي</strong></div><div><span>المصدر</span><strong>Gold Alpha Site</strong></div><div><span>Agent Stage</span><strong id="siteAgentStage">WAIT</strong></div><div><span>Risk Agent</span><strong id="siteRiskAgent">—</strong></div><div><span>Trade Manager</span><strong id="siteTradeManager">OBSERVE</strong></div><div><span>Agent Mode</span><strong id="siteAgentMode">OBSERVE_ONLY</strong></div><div><span>BRAIN</span><strong id="siteBrain">NEUTRAL</strong></div><div><span>REFLEX</span><strong id="siteReflex">WAIT</strong></div><div><span>Risk State</span><strong id="siteRiskState">BLOCKED</strong></div><div><span>ICT Month 2 — Risk</span><strong id="siteMonth2Risk">—</strong></div><div><span>سبب القرار</span><strong id="siteSignalReason">—</strong></div></div></section>`;

  const js = `<script>
(function(){
 async function refreshSiteIndicator(){
  try{
   const r=await fetch('/api/site-indicator',{cache:'no-store'});const s=await r.json();
   const word=document.getElementById('siteSignalWord');if(!word)return;
   word.textContent=s.signal||'WAIT';word.className=s.status==='NEWS_BLOCK'?'siteNewsBlock':s.signal==='BULL'?'siteBull':s.signal==='BEAR'?'siteBear':'siteWait';
   document.getElementById('siteSignalConfidence').textContent=Math.round(Number(s.confidence)||0)+'/100';
   document.getElementById('siteSignalPrice').textContent=Number.isFinite(Number(s.price))?Number(s.price).toFixed(2):'—';
   document.getElementById('siteSignalStatus').textContent=s.status||'WAIT';
   const sp=s.scenarioPlan||{},buy=sp.buy||{},sell=sp.sell||{};
   const money=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';
   document.getElementById('siteMarketBias').textContent=sp.bias||'RANGE';
   const snr=s.snr||{},snrSup=snr.nearestSupport?.level,snrRes=snr.nearestResistance?.level;document.getElementById('siteGoldSnr').textContent='S '+money(snrSup)+' • R '+money(snrRes)+' • '+(snr.alignment||'NEUTRAL')+' • advisory only';
   document.getElementById('siteBuyZone').textContent=buy.zoneLow!=null?money(buy.zoneLow)+' – '+money(buy.zoneHigh):'—';
   document.getElementById('siteSellZone').textContent=sell.zoneLow!=null?money(sell.zoneLow)+' – '+money(sell.zoneHigh):'—';
   const inBuy=Boolean(buy.insideZone),inSell=Boolean(sell.insideZone),buyTrig=Boolean(buy?.trigger?.ready),sellTrig=Boolean(sell?.trigger?.ready);
   document.getElementById('siteZoneTrigger').textContent=inBuy?(buyTrig?'BUY trigger ready':'داخل BUY zone — انتظر 5m'):inSell?(sellTrig?'SELL trigger ready':'داخل SELL zone — انتظر 5m'):'WAIT FOR ZONE';
   const kc=s.importantCandles?.primary||null;document.getElementById('siteKeyCandle').textContent=kc?(kc.pattern+' • '+kc.side+' • '+Math.round(Number(kc.score)||0)+'/100 • '+(kc.status||'CANDIDATE')):'—';
   const tc=s.ict?.trendContinuation||{},hf=tc.htfFvg||{};
   document.getElementById('siteHtfFvg').textContent=hf.valid?(hf.timeframe+' '+money(hf.low)+' – '+money(hf.high)):'غير متوفر — اختياري';
   const ict=s.ict||{},phase=String(ict.phase||'').toUpperCase();
   let delivery='WAIT / BALANCE';
   if(phase.includes('RETRACE'))delivery='RETRACEMENT';
   else if(phase.includes('EXPANSION')||phase.includes('CONTINUATION')||phase.includes('DISPLACEMENT'))delivery='EXPANSION';
   else if(phase.includes('LIQUIDITY_TAKEN')||ict.hasSweep)delivery='REVERSAL WATCH';
   const range=ict.rangeContext||{},location=range.location||ict.location||'—',eq=range.equilibrium??ict.equilibrium;
   document.getElementById('siteIctDelivery').textContent=delivery+(phase?(' • '+phase):'');
   document.getElementById('siteIctLocation').textContent=location+(Number.isFinite(Number(eq))?(' • EQ '+money(eq)):'');
   const draw=ict.primaryLiquidity||ict.mainLiquidity||ict.secondaryLiquidity||null;
   document.getElementById('siteIctDraw').textContent=draw?((draw.label||draw.role||'EXTERNAL')+' • '+money(draw.price??draw.level)):'—';
   const refs=[];
   if(ict.legSweep?.name)refs.push('Sweep '+String(ict.legSweep.name).toUpperCase()+' '+money(ict.legSweep.level));
   if(ict.originFvg)refs.push('FVG '+money(ict.originFvg.low)+'–'+money(ict.originFvg.high));
   if(ict.orderBlock)refs.push('OB '+money(ict.orderBlock.low)+'–'+money(ict.orderBlock.high));
   document.getElementById('siteIctReference').textContent=refs.length?refs.join(' • '):'—';
   const m3=s.ictMonth3||{},m3Checks=Number(m3.confirmations)||0,m3Total=Number(m3.totalChecks)||4;
   document.getElementById('siteIctMonth3').textContent=m3.available===false?'غير متوفر':(m3.side&&m3.side!=='WAIT'?(m3.side+' • '+m3Checks+'/'+m3Total+' دعم فقط'):(m3Checks+'/'+m3Total+' دعم فقط'));
   const mark=x=>x?.supported?'✓':'–';
   document.getElementById('siteIctMonth3Detail').textContent='HTF '+mark(m3.higherTimeFramePriceDisplacement)+' • Liquidity '+mark(m3.intermediateTermImbalance)+' • Target '+mark(m3.shortTermExitLiquidity)+' • Time '+mark(m3.timeOfDayInfluence);
   document.getElementById('siteM5Mss').textContent=tc.mss?.confirmed?('مؤكد • '+money(tc.mss.level)):'غير متوفر — اختياري';
   document.getElementById('siteM5Retest').textContent=tc.retested?'إعادة اختبار مؤكدة':'انتظار إعادة الاختبار';
   const cf=s.confluence||{},scores=cf.scores||{};
   const support=cf.imageSupport||{};
   document.getElementById('siteConfluence').textContent=(support.advisoryOnly?('دعم الصور +'+(support.bonus||0)+'/100 • '):'')+'BUY '+Math.round(Number(scores.BUY)||0)+'/100 • SELL '+Math.round(Number(scores.SELL)||0)+'/100';
   const mtf=s.multiTimeframe||{},tf=mtf.reads||{};
   document.getElementById('siteMacroBias').textContent=(mtf.side||'NEUTRAL')+' • HTF '+(mtf.macroAligned??0)+'/4 • Intraday '+(mtf.intradayAligned??0)+'/3';
   document.getElementById('siteTimeframeChain').textContent='MN1 '+(tf.MN1?.side||'—')+' • W1 '+(tf.W1?.side||'—')+' • 2D '+(tf.D2?.side||'—')+' • D1 '+(tf.D1?.side||'—')+' • H4 '+(tf.H4?.side||'—')+' • H1 '+(tf.H1?.side||'—')+' • M15 '+(tf.M15?.side||'—')+' • M5 '+(tf.M5?.side||'—')+' • M1 '+(tf.M1?.side||'—');
   const m6=mtf.month6Support||s.agents?.market?.context?.month6Support||{},m6tf=m6.reads||{};
   const m6Chain='MN1 '+(m6tf.MN1||'—')+' → W1 '+(m6tf.W1||'—')+' → D1 '+(m6tf.D1||'—')+' → H4 '+(m6tf.H4||'—');
   document.getElementById('siteMonth6Htf').textContent=m6.mode==='SUPPORT_ONLY'?('SUPPORT ONLY • '+m6Chain+' • '+(m6.aligned??0)+'/4'+(m6.htfConflict?' • W1/D1 conflict':'')).replace(/undefined/g,'—'):'—';
   const m6Draw=m6.drawOnLiquidity||null,m6Poi=m6.poiType||'—';
   document.getElementById('siteMonth6Pd').textContent=m6.pdLocation?((m6.pdLocation||'UNKNOWN')+(m6.pdPreferred?' ✓ preferred':' • context')+' • '+m6Poi+(m6Draw?(' → '+(m6Draw.label||'LIQUIDITY')+' '+money(m6Draw.price)):'')+' • non-blocking'):'—';
   document.getElementById('siteSignalExecutable').textContent=s.executable?'تنفيذي':'قراءة فقط';
   const nr=s.newsRisk||{};
   const newsLabel=nr.blockEntries?'⛔ إيقاف صفقات — خبر مؤثر':nr.dayHasHighImpactUsd?'⚠️ يوم أخبار USD':'✅ أخبار طبيعية';
   document.getElementById('siteNewsRisk').textContent=nr.available===false?'⚠️ مصدر الأخبار غير متاح — الصفقات موقوفة':newsLabel;
   const ev=nr.activeEvent||nr.nextEvent||null;
   document.getElementById('siteNewsEvent').textContent=ev?.title||'لا يوجد خبر أمريكي مؤثر قريب';
   const ad=s.agentDecision||{},ags=s.agents||{},risk=ags.risk||{},tm=ags.tradeManager||{};
   document.getElementById('siteAgentStage').textContent=(ad.stage||'WAIT')+' • '+(ad.side||'WAIT');
   document.getElementById('siteRiskAgent').textContent=risk.recommendedLot!=null?('Lot '+Number(risk.recommendedLot).toFixed(2)+' • Risk USD '+Number(risk.estimatedRiskUsd||0).toFixed(2)):(risk.allowed?'READY':'WAIT');
   document.getElementById('siteTradeManager').textContent=(tm.action||'OBSERVE')+(tm.suggestedProtection?' • MOVE SL TO BE':'');
   document.getElementById('siteAgentMode').textContent=s.agentMode||'OBSERVE_ONLY';
   const brain=ags.brain||{},reflex=ags.reflex||{},schema=s.decisionSchema||{};
   document.getElementById('siteBrain').textContent=(brain.direction||'NEUTRAL')+' • '+(brain.regime||'TRANSITION')+' • Q'+(brain.setupQuality??0);
   document.getElementById('siteReflex').textContent=(reflex.action||'WAIT')+(reflex.executable?' • EXECUTE':' • GATED');
   document.getElementById('siteRiskState').textContent=schema.riskState||'BLOCKED';
   const m2=s.riskFramework||s.ict?.month2Risk||{};
   const m2El=document.getElementById('siteMonth2Risk');
   if(m2El)m2El.textContent=m2.riskDistance!=null?(m2.primaryBeyond3R?('3R '+money(m2.threeRPrice)+' • 50% اختياري ثم Primary liquidity'):('Primary liquidity قبل 3R • لا نفرض هدف 3R')):'—';
   document.getElementById('siteSignalReason').textContent=(ad.reason?('[Agents] '+ad.reason+' • '):'')+(s.reason||'—');
  }catch(e){const word=document.getElementById('siteSignalWord');if(word){word.textContent='WAIT';word.className='siteWait';}}
 }
 // Three seconds is fast enough for a 5m execution model and cuts needless internal polling by ~67%.
 (async function loop(){await refreshSiteIndicator();setTimeout(loop,3000)})();
})();
</script>`;

  html = html.replace('</head>', `${css}</head>`);
  html = html.replace('<main', `${panel}<main`);
  html = html.replace('</body>', `${js}</body>`);
  return html;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/api/telegram/webhook') {
    return handleTelegramWebhook(req, res);
  }

  if (req.method === 'GET' && (url.pathname === '/journal' || url.pathname === '/trade-journal')) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-gold-alpha-build': BUILD_TAG
    });
    return res.end(renderTradeJournalPage());
  }

  if (req.method === 'GET' && (url.pathname === '/api/btc-signal' || url.pathname === '/api/btc')) {
    res.writeHead(410, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-gold-alpha-build': BUILD_TAG
    });
    return res.end(JSON.stringify({
      ok: false,
      status: 'DISABLED',
      symbol: 'BTCUSD',
      reason: 'BTC trading and signals are disabled. Gold-only mode is active.'
    }));
  }

  if (req.method === 'GET' && url.pathname === '/api/auto-trade/signal') {
    try {
      const upstream = await getJson(req.url || '/api/auto-trade/signal');
      const observeOnly = url.searchParams.get('observe') === '1';
      const payload = observeOnly
        ? {...upstream.data, agentStack:orchestrateGoldAgents(upstream.data)}
        : applyAgentExecutionGate(upstream.data);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-gold-alpha-build': BUILD_TAG
      });
      return res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-gold-alpha-build': BUILD_TAG
      });
      return res.end(JSON.stringify({
        status:'WAIT', action:'WAIT', executable:false,
        reason:'AGENT GATE UNAVAILABLE — fail closed',
        architecture:'GOLD_AGENT_STACK_V2_BRAIN_REFLEX',
        updatedAt:new Date().toISOString()
      }));
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/agents/status') {
    try {
      const upstream = await getJson('/api/auto-trade/signal?observe=1');
      const payload = orchestrateGoldAgents(upstream.data);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-gold-alpha-build': BUILD_TAG
      });
      return res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({architecture:'GOLD_AGENT_STACK_V2_BRAIN_REFLEX',symbol:'XAUUSD',mode:'OBSERVE_ONLY',decision:{stage:'WAIT',side:'WAIT',ready:false,executable:false,reason:'Agent upstream unavailable'},agents:{},updatedAt:new Date().toISOString()}));
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/site-indicator') {
    try {
      const upstream = await getJson('/api/auto-trade/signal?observe=1');
      const payload = mapIndicator(upstream.data);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-gold-alpha-build': BUILD_TAG
      });
      return res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({
        signal: 'WAIT', source: 'GOLD_ALPHA_SITE', executable: false, confidence: 0,
        status: 'ENGINE_UNAVAILABLE', reason: 'محرك الموقع غير متاح مؤقتاً', updatedAt: new Date().toISOString()
      }));
    }
  }

  try {
    const out = await proxy(req);
    const headers = { ...out.headers, 'x-gold-alpha-build': BUILD_TAG };
    delete headers['content-length'];

    if (req.method === 'GET' && url.pathname === '/' && String(headers['content-type'] || '').includes('text/html')) {
      const html = injectIndicator(out.body.toString('utf8'));
      headers['content-type'] = 'text/html; charset=utf-8';
      headers['cache-control'] = 'no-store';
      res.writeHead(out.status, headers);
      return res.end(html);
    }

    res.writeHead(out.status, headers);
    res.end(out.body);
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Gold Alpha temporarily unavailable');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Site indicator ${BUILD_TAG} listening on ${PORT}; inner=${INNER_PORT}`);
  configureTelegramWebhook().catch(error => console.error('[telegram-webhook] setup failed', error?.message || error));
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
