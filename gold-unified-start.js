import http from 'node:http';
import { spawn } from 'node:child_process';

const BUILD_TAG='signal-failclosed-v2';
const PORT=Number(process.env.PORT||3000);
const UI_PORT=3001;
const AUTO_PORT=3002;
const SPX_PORT=3003;

const ui=spawn(process.execPath,['gold-target-range-fix-start.js'],{env:{...process.env,PORT:String(UI_PORT)},stdio:['ignore','inherit','inherit']});
const auto=spawn(process.execPath,['gold-app.js'],{env:{...process.env,PORT:String(AUTO_PORT)},stdio:['ignore','inherit','inherit']});
const spx=spawn(process.execPath,['spx-live-start.js'],{env:{...process.env,PORT:String(SPX_PORT)},stdio:['ignore','inherit','inherit']});
ui.on('exit',c=>console.error('gold UI child exited',c));
auto.on('exit',c=>console.error('gold AUTO child exited',c));
spx.on('exit',c=>console.error('isolated SPX child exited',c));
function shutdown(signal){for(const child of [ui,auto,spx]){if(!child.killed) child.kill(signal);}server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();}

function requestBuffer(port,req){return new Promise((resolve,reject)=>{const opts={hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}};const p=http.request(opts,r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode||502,headers:r.headers,body:Buffer.concat(chunks)}));});p.on('error',reject);if(req.method==='GET'||req.method==='HEAD')p.end();else req.pipe(p);});}

function waitPayload(detail='signal engine temporarily unavailable',upstreamStatus=503){return {
  status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,
  executable:false,degraded:true,provider:null,
  entry:null,entryLow:null,entryHigh:null,stopLoss:null,
  target1:null,target2:null,target3:null,target4:null,
  reason:'ENGINE_UNAVAILABLE: execution blocked until XAUUSD signal feed recovers',
  upstreamStatus,upstreamDetail:String(detail),build:BUILD_TAG,updatedAt:new Date().toISOString()
};}
function sendWait(res,detail,status=503){return res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}).end(JSON.stringify(waitPayload(detail,status)));}

function injectAuto(html){
  const css=`<style>
#alphaAutoDock{margin:14px 0;padding:14px;border:1px solid #2f6a57;border-radius:16px;background:linear-gradient(145deg,#0e1a18,#0b111b);direction:rtl}
#alphaAutoDock h3{margin:0 0 10px;color:#67e2b2}.alphaAutoGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.alphaAutoBox{padding:10px;border:1px solid #30445d;border-radius:11px;background:#0d1420}.alphaAutoBox span{display:block;color:#91a0b8;font-size:11px}.alphaAutoBox strong{display:block;margin-top:5px}.alphaAutoOk{color:#54e0a4}.alphaAutoBad{color:#ff718c}.alphaAutoWarn{color:#ffd166}@media(max-width:760px){.alphaAutoGrid{grid-template-columns:repeat(2,1fr)}}
</style>`;
  const panel=`<section style="margin:14px 0;text-align:left"><a href="/spx" style="display:inline-block;padding:10px 14px;border:1px solid #5275ad;border-radius:12px;color:#b9d1ff;text-decoration:none">فتح جدول SPX اللحظي</a></section><section id="alphaAutoDock"><h3>الرصد الآلي — لا إشارة قبل موافقة AI</h3><div class="alphaAutoGrid"><div class="alphaAutoBox"><span>حالة الروبوت</span><strong id="aaConn" class="alphaAutoWarn">جاري الفحص</strong></div><div class="alphaAutoBox"><span>موافقة AI</span><strong id="aaAi" class="alphaAutoWarn">بانتظار فرصة</strong></div><div class="alphaAutoBox"><span>الإشارة التنفيذية</span><strong id="aaAction" class="alphaAutoWarn">WAIT</strong></div><div class="alphaAutoBox"><span>نطاق الدخول</span><strong id="aaRange">—</strong></div><div class="alphaAutoBox"><span>دورة الصفقة</span><strong id="aaLife">—</strong></div><div class="alphaAutoBox"><span>الأهداف المحققة</span><strong id="aaTargets">—</strong></div><div class="alphaAutoBox"><span>آخر نتيجة</span><strong id="aaTerminal">—</strong></div><div class="alphaAutoBox"><span>مصدر السعر</span><strong id="aaProvider">—</strong></div><div class="alphaAutoBox"><span>سبب القرار</span><strong id="aaReason">—</strong></div></div></section>`;
  const js=`<script>
(function(){
 const m=v=>Number.isFinite(Number(v))?String.fromCharCode(36)+Number(v).toFixed(2):'—';
 async function aa(){try{const [sr,st]=await Promise.all([fetch('/api/auto-trade/signal?observe=1',{cache:'no-store'}),fetch('/api/auto-trade/status',{cache:'no-store'})]);if(!sr.ok||!st.ok)throw new Error('engine unavailable');const s=await sr.json(),x=await st.json();const c=document.getElementById('aaConn'),ai=document.getElementById('aaAi'),a=document.getElementById('aaAction'),r=document.getElementById('aaRange'),n=document.getElementById('aaReason');if(!c)return;const connected=!!x.mt5?.connected;c.textContent=connected?'MT5 متصل':'MT5 غير متصل';c.className=connected?'alphaAutoOk':'alphaAutoBad';const review=s.aiReview||{},reviewOk=review.status==='APPROVED'&&review.decision==='ALLOW';ai.textContent=reviewOk?'موافق':review.configured===false?'غير مهيأ':(['DENIED','ERROR'].includes(review.status)?'لم يوافق':'بانتظار فرصة');ai.className=reviewOk?'alphaAutoOk':(['DENIED','ERROR'].includes(review.status)||review.configured===false?'alphaAutoBad':'alphaAutoWarn');const act=['BUY','SELL'].includes(s.action)?s.action:'WAIT',actionable=['BUY','SELL'].includes(act)&&s.status==='ACTIVE'&&reviewOk;a.textContent=act;a.className=act==='BUY'?'alphaAutoOk':act==='SELL'?'alphaAutoBad':'alphaAutoWarn';r.textContent=actionable&&s.entryLow?m(s.entryLow)+' — '+m(s.entryHigh):'—';document.getElementById('aaLife').textContent=(s.status||'WAIT')+' • '+(s.entryConfirmation||'—');document.getElementById('aaTargets').textContent=(s.targetHits||[]).map((v,i)=>v?'TP'+(i+1):'—').filter(v=>v!=='—').join(' • ')||'لا شيء';document.getElementById('aaTerminal').textContent=x.lastTerminal?.outcome||'—';document.getElementById('aaProvider').textContent=(s.provider||'—')+(s.degraded?' • متأخر':'');n.textContent=s.reason||'—';}catch(e){const c=document.getElementById('aaConn');if(c){c.textContent='تعذر تحديث المحرك';c.className='alphaAutoBad';}}}
 (async function loop(){await aa();setTimeout(loop,1000)})();
})();
</script>`;
  if(!html.includes('alphaAutoDock')){
    html=html.replace('</style></head>',css+'</style></head>');
    html=html.replace('</main>',panel+'</main>');
    html=html.replace('</body>',js+'</body>');
  }
  return html;
}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&u.pathname==='/api/build') return res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({ok:true,build:BUILD_TAG}));
  try{
    const autoPath=u.pathname.startsWith('/api/auto-trade/')||u.pathname==='/api/health'||u.pathname==='/api/gold'||u.pathname==='/api/gold-live'||u.pathname==='/api/performance/journal';
    const spxPath=u.pathname==='/spx'||u.pathname.startsWith('/api/spx-');
    const port=spxPath?SPX_PORT:(autoPath?AUTO_PORT:UI_PORT);
    const out=await requestBuffer(port,req);

    if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal'&&out.status>=500){
      let detail='signal engine temporarily unavailable';
      try{const parsed=JSON.parse(out.body.toString('utf8'));detail=String(parsed?.detail||parsed?.error||detail);}catch{}
      return sendWait(res,detail,out.status);
    }

    const headers={...out.headers};delete headers['content-length'];
    if(!autoPath && req.method==='GET' && u.pathname==='/'){
      const html=injectAuto(out.body.toString('utf8'));
      headers['content-type']='text/html; charset=utf-8';headers['cache-control']='no-store';
      res.writeHead(out.status,headers);return res.end(html);
    }
    res.writeHead(out.status,headers);res.end(out.body);
  }catch(e){
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal') return sendWait(res,e?.message||e,503);
    res.writeHead(502,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('Gold Alpha temporarily unavailable');
  }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Unified Gold Alpha ${BUILD_TAG} listening on ${PORT}; UI=${UI_PORT}; AUTO=${AUTO_PORT}`));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
