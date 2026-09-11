import http from 'node:http';
import {spawn} from 'node:child_process';

const BUILD_TAG='gold-resilient-v4-mt5-http-recovery';
const PORT=Number(process.env.PORT||3000);
const UI_PORT=3001,AUTO_PORT=3002,SPX_PORT=3003;
const children=new Map();
let shuttingDown=false;

function spawnChild(name,file,port){
  const child=spawn(process.execPath,[file],{env:{...process.env,PORT:String(port)},stdio:['ignore','inherit','inherit']});
  children.set(name,child);
  child.on('exit',code=>{
    console.error(name,'child exited',code);
    if(shuttingDown)return;
    setTimeout(()=>spawnChild(name,file,port),1000).unref();
  });
  return child;
}
spawnChild('ui','gold-target-range-fix-start.js',UI_PORT);
spawnChild('auto','gold-auto-stable-start.js',AUTO_PORT);
spawnChild('spx','spx-live-start.js',SPX_PORT);

function shutdown(signal){
  shuttingDown=true;
  for(const child of children.values()) if(child&&!child.killed) child.kill(signal);
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(1),5000).unref();
}

function requestBuffer(port,req){
  return new Promise((resolve,reject)=>{
    const opts={hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}};
    const p=http.request(opts,r=>{
      const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode||502,headers:r.headers,body:Buffer.concat(chunks)}));
    });
    p.setTimeout(7000,()=>p.destroy(new Error('internal request timeout')));
    p.on('error',reject);
    if(req.method==='GET'||req.method==='HEAD')p.end(); else req.pipe(p);
  });
}

function waitPayload(detail='signal engine temporarily unavailable',upstreamStatus=503){return {
  status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,executable:false,degraded:true,provider:null,
  entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,
  reason:'ENGINE_RECOVERING: execution blocked until signal engine is healthy',
  upstreamStatus,upstreamDetail:String(detail),build:BUILD_TAG,updatedAt:new Date().toISOString()
};}
function statusFallback(detail='auto engine unavailable',upstreamStatus=503){return {
  mt5:{connected:false,lastSeen:0,tradingEnabled:false,positionOpen:false},
  engine:{healthy:false,build:BUILD_TAG,error:String(detail),upstreamStatus},
  lastTerminal:null,trades:[]
};}
function sendJson(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-alpha-build':BUILD_TAG});res.end(JSON.stringify(body));}

function injectAuto(html){
  const css=`<style id="goldAutoUiV3">
#alphaAutoDock{margin:16px 0;padding:16px;border:1px solid #2f6a57;border-radius:16px;background:linear-gradient(145deg,#0e1a18,#0b111b);direction:rtl}
#alphaAutoDock h3{margin:0 0 10px;color:#67e2b2}.alphaAutoGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.alphaAutoBox{padding:10px;border:1px solid #30445d;border-radius:11px;background:#0d1420}.alphaAutoBox span{display:block;color:#91a0b8;font-size:11px}.alphaAutoBox strong{display:block;margin-top:5px}.alphaAutoOk{color:#54e0a4}.alphaAutoBad{color:#ff718c}.alphaAutoWarn{color:#ffd166}.alphaAutoInfo{color:#9fc4ff}@media(max-width:760px){.alphaAutoGrid{grid-template-columns:repeat(2,1fr)}}
</style>`;
  const panel=`<section id="alphaAutoDock"><h3>التداول الآلي — Gold Alpha</h3><div class="alphaAutoGrid"><div class="alphaAutoBox"><span>حالة MT5</span><strong id="aaConn" class="alphaAutoWarn">جاري الفحص</strong></div><div class="alphaAutoBox"><span>موافقة النظام</span><strong id="aaAi" class="alphaAutoWarn">بانتظار فرصة</strong></div><div class="alphaAutoBox"><span>الإشارة</span><strong id="aaAction" class="alphaAutoWarn">WAIT</strong></div><div class="alphaAutoBox"><span>نطاق الدخول</span><strong id="aaRange">—</strong></div><div class="alphaAutoBox"><span>حالة الصفقة</span><strong id="aaLife">—</strong></div><div class="alphaAutoBox"><span>الأهداف المحققة</span><strong id="aaTargets">—</strong></div><div class="alphaAutoBox"><span>آخر نتيجة</span><strong id="aaTerminal">—</strong></div><div class="alphaAutoBox"><span>مصدر السعر</span><strong id="aaProvider">—</strong></div><div class="alphaAutoBox" style="grid-column:1/-1"><span>سبب القرار</span><strong id="aaReason">—</strong></div></div></section>`;
  const js=`<script id="goldAutoRefreshV3">
(function(){
 const money=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';
 const set=(id,text,cls)=>{const el=document.getElementById(id);if(!el)return;if(text!==undefined)el.textContent=text;if(cls)el.className=cls;};
 function ensurePredictionBoxes(){
   const grid=document.querySelector('#alphaAutoDock .alphaAutoGrid');if(!grid||document.getElementById('aaPrediction'))return;
   grid.insertAdjacentHTML('beforeend','<div class="alphaAutoBox"><span>توقع الحركة القادمة</span><strong id="aaPrediction" class="alphaAutoInfo">—</strong></div><div class="alphaAutoBox"><span>BUY / SELL score</span><strong id="aaScores" class="alphaAutoInfo">—</strong></div><div class="alphaAutoBox"><span>الشموع المقروءة</span><strong id="aaHistory" class="alphaAutoInfo">—</strong></div><div class="alphaAutoBox"><span>ثقة المحرك</span><strong id="aaConfidence" class="alphaAutoInfo">—</strong></div>');
 }
 async function refreshAuto(){
  ensurePredictionBoxes();
  try{
   const [sr,st]=await Promise.all([fetch('/api/auto-trade/signal?observe=1&_='+Date.now(),{cache:'no-store'}),fetch('/api/auto-trade/status?_='+Date.now(),{cache:'no-store'})]);
   const s=await sr.json().catch(()=>({})),x=await st.json().catch(()=>({}));
   if(!sr.ok||!st.ok)throw new Error(x?.engine?.error||s?.upstreamDetail||'engine unavailable');
   const connected=!!x.mt5?.connected;
   set('aaConn',connected?'MT5 متصل':'MT5 غير متصل',connected?'alphaAutoOk':'alphaAutoBad');
   const review=s.aiReview||{},approved=review.status==='APPROVED'&&review.decision==='ALLOW';
   set('aaAi',approved?'موافق':(['DENIED','ERROR'].includes(review.status)?'مرفوض مؤقتًا':'بانتظار فرصة'),approved?'alphaAutoOk':(['DENIED','ERROR'].includes(review.status)?'alphaAutoBad':'alphaAutoWarn'));
   const act=['BUY','SELL'].includes(s.action)?s.action:'WAIT';
   set('aaAction',act,act==='BUY'?'alphaAutoOk':act==='SELL'?'alphaAutoBad':'alphaAutoWarn');
   set('aaRange',['BUY','SELL'].includes(act)&&s.entryLow!=null?money(s.entryLow)+' — '+money(s.entryHigh):'—');
   set('aaLife',(s.status||'WAIT')+' • '+(s.entryConfirmation||s.candidateAction||'—'));
   set('aaTargets',(s.targetHits||[]).map((v,i)=>v?'TP'+(i+1):'').filter(Boolean).join(' • ')||'لا شيء');
   set('aaTerminal',x.lastTerminal?.outcome||'—');
   set('aaProvider',(s.provider||'—')+(s.degraded?' • متأخر':''));
   set('aaReason',s.reason||'—');
   const p=s.prediction||{};
   set('aaPrediction',p.side||'NEUTRAL',p.side==='BUY'?'alphaAutoOk':p.side==='SELL'?'alphaAutoBad':'alphaAutoInfo');
   set('aaScores','BUY '+String(p.buyScore??'—')+' / SELL '+String(p.sellScore??'—'));
   const h=s.historyWindow||{};set('aaHistory',String(h.m1??0)+'×1m • '+String(h.m5??0)+'×5m • '+String(h.m15??0)+'×15m');
   set('aaConfidence',String(s.signalConfidence??s.confidence??0)+'%');
  }catch(e){
   set('aaConn','تعذر تحديث المحرك','alphaAutoBad');
   set('aaReason','ENGINE ERROR: '+String(e?.message||e),'alphaAutoBad');
  }
 }
 refreshAuto();setInterval(refreshAuto,1500);
})();
</script>`;

  if(!html.includes('goldAutoUiV3')){
    if(html.includes('</head>'))html=html.replace('</head>',css+'</head>');else html=css+html;
  }
  if(!html.includes('id="alphaAutoDock"')){
    if(html.includes('</main>'))html=html.replace('</main>',panel+'</main>');
    else if(html.includes('</body>'))html=html.replace('</body>',panel+'</body>');
    else html+=panel;
  }
  // Critical: an older page may already contain the panel but not its refresh script.
  // Never return early just because alphaAutoDock exists.
  if(!html.includes('goldAutoRefreshV3')){
    if(html.includes('</body>'))html=html.replace('</body>',js+'</body>');else html+=js;
  }
  return html;
}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&u.pathname==='/api/build')return sendJson(res,200,{ok:true,build:BUILD_TAG});
  try{
    const autoPath=u.pathname.startsWith('/api/auto-trade/')||u.pathname==='/api/health'||u.pathname==='/api/gold'||u.pathname==='/api/gold-live'||u.pathname==='/api/performance/journal';
    const spxPath=u.pathname==='/spx'||u.pathname.startsWith('/api/spx-');
    const port=spxPath?SPX_PORT:(autoPath?AUTO_PORT:UI_PORT);
    const out=await requestBuffer(port,req);
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal'&&(out.status<200||out.status>=300)){
      let detail='internal signal engine failure';try{const j=JSON.parse(out.body.toString('utf8'));detail=j.detail||j.error||detail}catch{}
      return sendJson(res,200,waitPayload(detail,out.status));
    }
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/status'&&(out.status<200||out.status>=300)){
      let detail='auto status unavailable';try{const j=JSON.parse(out.body.toString('utf8'));detail=j.detail||j.error||detail}catch{}
      return sendJson(res,200,statusFallback(detail,out.status));
    }
    const headers={...out.headers};delete headers['content-length'];headers['cache-control']='no-store';headers['x-gold-alpha-build']=BUILD_TAG;
    if(req.method==='GET'&&u.pathname==='/'&&!autoPath){
      const html=injectAuto(out.body.toString('utf8'));
      headers['content-type']='text/html; charset=utf-8';
      res.writeHead(out.status,headers);return res.end(html);
    }
    res.writeHead(out.status,headers);res.end(out.body);
  }catch(e){
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal')return sendJson(res,200,waitPayload(e?.message||e,503));
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/status')return sendJson(res,200,statusFallback(e?.message||e,503));
    sendJson(res,503,{error:'Service unavailable',detail:String(e?.message||e),build:BUILD_TAG});
  }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Unified Gold Alpha ${BUILD_TAG} listening on ${PORT}`));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
