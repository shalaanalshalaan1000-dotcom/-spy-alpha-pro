import http from 'node:http';
import { spawn } from 'node:child_process';

const BUILD_TAG='site-signal-noai-v1';
const PORT=Number(process.env.PORT||3000);
const UI_PORT=3001;
const AUTO_PORT=3002;
const SPX_PORT=3003;
const CAPITAL_PORT=3004;

const capital=spawn(process.execPath,['capital-market.js'],{env:{...process.env,PORT:String(CAPITAL_PORT),CAPITAL_DEMO:process.env.CAPITAL_DEMO||'false'},stdio:['ignore','inherit','inherit']});
const ui=spawn(process.execPath,['gold-target-range-fix-start.js'],{env:{...process.env,PORT:String(UI_PORT)},stdio:['ignore','inherit','inherit']});
const autoEnv={...process.env,PORT:String(AUTO_PORT)};
if(process.env.CAPITAL_API_KEY&&process.env.CAPITAL_IDENTIFIER&&process.env.CAPITAL_API_PASSWORD){
  autoEnv.GOLD_ALPHA_QUOTE_URL=`http://127.0.0.1:${CAPITAL_PORT}/api/capital/gold`;
  autoEnv.GOLD_ALPHA_CANDLES_URL=`http://127.0.0.1:${CAPITAL_PORT}/api/capital/candles?asset=gold&resolution=MINUTE&max=120`;
}
const auto=spawn(process.execPath,['gold-site-signal-engine.js'],{env:autoEnv,stdio:['ignore','inherit','inherit']});
const spx=spawn(process.execPath,['spx-live-start.js'],{env:{...process.env,PORT:String(SPX_PORT)},stdio:['ignore','inherit','inherit']});
const telegramEnabled=String(process.env.TELEGRAM_ENABLED||'false').toLowerCase()==='true'&&Boolean(process.env.TELEGRAM_BOT_TOKEN);
const telegramBot=telegramEnabled?spawn(process.execPath,['telegram-xau-bot.js'],{env:{...process.env,TELEGRAM_SIGNAL_URL:`http://127.0.0.1:${AUTO_PORT}/api/auto-trade/signal?observe=1`},stdio:['ignore','inherit','inherit']}):null;

for(const [name,child] of [['capital',capital],['ui',ui],['auto',auto],['spx',spx],['telegram',telegramBot]]){
  if(child) child.on('exit',c=>console.error(`${name} child exited`,c));
}
function shutdown(signal){for(const child of [capital,ui,auto,spx,telegramBot].filter(Boolean)){if(!child.killed)child.kill(signal);}server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();}

function requestBuffer(port,req){return new Promise((resolve,reject)=>{const opts={hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}};const p=http.request(opts,r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode||502,headers:r.headers,body:Buffer.concat(chunks)}));});p.on('error',reject);p.setTimeout(10000,()=>p.destroy(new Error('upstream timeout')));if(req.method==='GET'||req.method==='HEAD')p.end();else req.pipe(p);});}

function waitPayload(detail='signal engine temporarily unavailable',upstreamStatus=503){return{status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,executable:false,degraded:true,provider:null,entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,reason:'ENGINE_UNAVAILABLE: XAUUSD site signal feed is unavailable',upstreamStatus,upstreamDetail:String(detail),build:BUILD_TAG,noAI:true,updatedAt:new Date().toISOString()};}
function sendWait(res,detail,status=503){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-alpha-build':BUILD_TAG});res.end(JSON.stringify(waitPayload(detail,status)));}

function injectLivePanels(html){
  html=html.replace(/DEMO\s*\/\s*DEMO/gi,'LIVE / CAPITAL');
  html=html.replace(/XAUUSD\s+ONLY/gi,'XAUUSD + BTCUSD');
  html=html.replace(/GOLD\s+ONLY/gi,'GOLD + BITCOIN');
  html=html.replace(/حالة\s*MT5/g,'حالة Capital.com');

  const css=`<style>
#capitalLiveStrip{margin:14px 0;padding:14px;border:1px solid #2f6a57;border-radius:16px;background:#0d1716;direction:rtl}
#capitalLiveStrip h3{margin:0 0 10px;color:#67e2b2}.capGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.capBox{padding:10px;border:1px solid #30445d;border-radius:11px;background:#0d1420}.capBox span{display:block;color:#91a0b8;font-size:11px}.capBox strong{display:block;margin-top:5px}.ok{color:#54e0a4}.bad{color:#ff718c}.warn{color:#ffd166}
#bitcoinTop{margin:14px 0;padding:16px;border:1px solid #7a6327;border-radius:16px;background:linear-gradient(145deg,#1b1710,#0c111a);direction:rtl}#bitcoinTop h3{margin:0 0 12px;color:#f3ba2f;font-size:22px}.btcPrice{font-size:30px;color:#f3ba2f}.btcGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.btcBox{padding:10px;border:1px solid #4a4029;border-radius:11px;background:#0d1420}.btcBox span{display:block;color:#a89b7b;font-size:11px}.btcBox strong{display:block;margin-top:5px}.btcLink{display:inline-block;margin-top:10px;padding:8px 10px;border:1px solid #7a6327;border-radius:10px;color:#f3ba2f;text-decoration:none}
@media(max-width:760px){.capGrid,.btcGrid{grid-template-columns:repeat(2,1fr)}}
</style>`;
  const panels=`<section id="bitcoinTop"><h3>Bitcoin BTCUSD — Capital.com LIVE</h3><div class="btcGrid"><div class="btcBox"><span>السعر</span><strong id="btcPrice" class="btcPrice">—</strong></div><div class="btcBox"><span>Bid</span><strong id="btcBid">—</strong></div><div class="btcBox"><span>Ask</span><strong id="btcAsk">—</strong></div><div class="btcBox"><span>حالة السوق</span><strong id="btcStatus">—</strong></div><div class="btcBox"><span>Epic</span><strong id="btcEpic">—</strong></div><div class="btcBox"><span>آخر تحديث</span><strong id="btcUpdated">—</strong></div><div class="btcBox"><span>المصدر</span><strong>Capital.com</strong></div><div class="btcBox"><span>الوضع</span><strong id="btcMode">LIVE</strong></div></div><a class="btcLink" href="/api/capital/bitcoin" target="_blank" rel="noopener">فتح بيانات Bitcoin</a></section><section id="capitalLiveStrip"><h3>Capital.com — الاتصال المباشر</h3><div class="capGrid"><div class="capBox"><span>الحساب</span><strong id="capMode" class="warn">LIVE</strong></div><div class="capBox"><span>الاتصال</span><strong id="capAuth" class="warn">جاري الفحص</strong></div><div class="capBox"><span>مصدر الذهب</span><strong id="capGold">Capital.com</strong></div><div class="capBox"><span>مصدر Bitcoin</span><strong id="capBtc">Capital.com</strong></div></div></section>`;
  const js=`<script>(function(){
const money=v=>Number.isFinite(Number(v))?'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
async function refreshCapital(){try{const [s,b]=await Promise.all([fetch('/api/capital/status',{cache:'no-store'}),fetch('/api/capital/bitcoin?force=1',{cache:'no-store'})]);const st=await s.json().catch(()=>({})),btc=await b.json().catch(()=>({}));const auth=document.getElementById('capAuth');if(auth){auth.textContent=st.authenticated?'متصل':'غير متصل';auth.className=st.authenticated?'ok':'bad';}const mode=document.getElementById('capMode');if(mode)mode.textContent=st.mode||'LIVE';const p=document.getElementById('btcPrice');if(p)p.textContent=Number.isFinite(Number(btc.price))?money(btc.price):(btc.error||'غير متاح');const bid=document.getElementById('btcBid');if(bid)bid.textContent=money(btc.bid);const ask=document.getElementById('btcAsk');if(ask)ask.textContent=money(btc.ask);const ms=document.getElementById('btcStatus');if(ms)ms.textContent=btc.marketStatus||btc.error||'—';const ep=document.getElementById('btcEpic');if(ep)ep.textContent=btc.epic||'—';const up=document.getElementById('btcUpdated');if(up)up.textContent=btc.updatedAt?new Date(btc.updatedAt).toLocaleTimeString():'—';const bm=document.getElementById('btcMode');if(bm)bm.textContent=btc.live===false?'DEMO':'LIVE';}catch(e){const auth=document.getElementById('capAuth');if(auth){auth.textContent='خطأ اتصال';auth.className='bad';}const p=document.getElementById('btcPrice');if(p)p.textContent='تعذر جلب Bitcoin';}}
(async function loop(){await refreshCapital();setTimeout(loop,2000)})();})();</script>`;
  if(!html.includes('bitcoinTop')){
    html=html.replace('</head>',css+'</head>');
    html=html.replace(/<main([^>]*)>/i,m=>m+panels);
    html=html.replace('</body>',js+'</body>');
  }
  return html;
}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&u.pathname==='/api/build'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','x-gold-alpha-build':BUILD_TAG});return res.end(JSON.stringify({ok:true,build:BUILD_TAG,capital:true,bitcoinPanel:true,telegram:telegramEnabled,noAI:true,signalOnly:true}));}
  try{
    const capitalPath=u.pathname.startsWith('/api/capital/');
    const autoPath=u.pathname.startsWith('/api/auto-trade/')||u.pathname==='/api/health'||u.pathname==='/api/gold'||u.pathname==='/api/gold-live'||u.pathname==='/api/performance/journal';
    const spxPath=u.pathname==='/spx'||u.pathname.startsWith('/api/spx-');
    const port=capitalPath?CAPITAL_PORT:(spxPath?SPX_PORT:(autoPath?AUTO_PORT:UI_PORT));
    const out=await requestBuffer(port,req);
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal'&&out.status>=500){let detail='signal engine temporarily unavailable';try{const parsed=JSON.parse(out.body.toString('utf8'));detail=String(parsed?.detail||parsed?.error||detail);}catch{}return sendWait(res,detail,out.status);}
    const headers={...out.headers};delete headers['content-length'];headers['x-gold-alpha-build']=BUILD_TAG;
    if(!autoPath&&!capitalPath&&req.method==='GET'&&u.pathname==='/'){const html=injectLivePanels(out.body.toString('utf8'));headers['content-type']='text/html; charset=utf-8';headers['cache-control']='no-store';res.writeHead(out.status,headers);return res.end(html);}
    res.writeHead(out.status,headers);res.end(out.body);
  }catch(e){if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal')return sendWait(res,e?.message||e,503);res.writeHead(502,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-gold-alpha-build':BUILD_TAG});res.end('Gold Alpha temporarily unavailable');}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Unified Gold Alpha ${BUILD_TAG} listening on ${PORT}; UI=${UI_PORT}; AUTO=${AUTO_PORT}; CAPITAL=${CAPITAL_PORT}; Telegram=${telegramEnabled?'on':'off'}`));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));