import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT=Number(process.env.PORT||3000);
const UI_PORT=3001;
const AUTO_PORT=3002;

const ui=spawn(process.execPath,['gold-news-start.js'],{env:{...process.env,PORT:String(UI_PORT)},stdio:['ignore','inherit','inherit']});
const auto=spawn(process.execPath,['gold-app.js'],{env:{...process.env,PORT:String(AUTO_PORT)},stdio:['ignore','inherit','inherit']});
ui.on('exit',c=>console.error('gold UI child exited',c));
auto.on('exit',c=>console.error('gold AUTO child exited',c));

function requestBuffer(port,req){return new Promise((resolve,reject)=>{const opts={hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}};const p=http.request(opts,r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode||502,headers:r.headers,body:Buffer.concat(chunks)}));});p.on('error',reject);if(req.method==='GET'||req.method==='HEAD')p.end();else req.pipe(p);});}

function injectAuto(html){
  const css=`<style>
#alphaAutoDock{margin:14px 0;padding:14px;border:1px solid #2f6a57;border-radius:16px;background:linear-gradient(145deg,#0e1a18,#0b111b);direction:rtl}
#alphaAutoDock h3{margin:0 0 10px;color:#67e2b2}.alphaAutoGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.alphaAutoBox{padding:10px;border:1px solid #30445d;border-radius:11px;background:#0d1420}.alphaAutoBox span{display:block;color:#91a0b8;font-size:11px}.alphaAutoBox strong{display:block;margin-top:5px}.alphaAutoOk{color:#54e0a4}.alphaAutoBad{color:#ff718c}.alphaAutoWarn{color:#ffd166}@media(max-width:760px){.alphaAutoGrid{grid-template-columns:repeat(2,1fr)}}
</style>`;
  const panel=`<section id="alphaAutoDock"><h3>الرصد الآلي — Gold Alpha</h3><div class="alphaAutoGrid"><div class="alphaAutoBox"><span>حالة الروبوت</span><strong id="aaConn" class="alphaAutoWarn">جاري الفحص</strong></div><div class="alphaAutoBox"><span>الإشارة التنفيذية</span><strong id="aaAction" class="alphaAutoWarn">WAIT</strong></div><div class="alphaAutoBox"><span>نطاق الدخول</span><strong id="aaRange">—</strong></div><div class="alphaAutoBox"><span>سبب القرار</span><strong id="aaReason">—</strong></div></div></section>`;
  const js=`<script>
(function(){
 const m=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';
 async function aa(){try{const [sr,st]=await Promise.all([fetch('/api/auto-trade/signal?observe=1',{cache:'no-store'}),fetch('/api/auto-trade/status',{cache:'no-store'})]);const s=await sr.json(),x=await st.json();const c=document.getElementById('aaConn'),a=document.getElementById('aaAction'),r=document.getElementById('aaRange'),n=document.getElementById('aaReason');if(!c)return;const connected=!!x.mt5?.connected;c.textContent=connected?'V9.1 متصل ويعمل':'غير متصل';c.className=connected?'alphaAutoOk':'alphaAutoBad';const act=s.action&&s.action!=='WAIT'?s.action:(s.status==='ACTIVE'&&['BUY','SELL'].includes(s.candidateAction)?s.candidateAction:'WAIT');a.textContent=act;a.className=act==='BUY'?'alphaAutoOk':act==='SELL'?'alphaAutoBad':'alphaAutoWarn';r.textContent=s.entryLow?m(s.entryLow)+' — '+m(s.entryHigh):'—';n.textContent=s.reason||'—';}catch(e){const c=document.getElementById('aaConn');if(c){c.textContent='تعذر التحديث';c.className='alphaAutoBad';}}}
 aa();setInterval(aa,5000);
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
  try{
    const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    const autoPath=u.pathname.startsWith('/api/auto-trade/');
    const port=autoPath?AUTO_PORT:UI_PORT;
    const out=await requestBuffer(port,req);
    const headers={...out.headers};delete headers['content-length'];
    if(!autoPath && req.method==='GET' && u.pathname==='/'){
      const html=injectAuto(out.body.toString('utf8'));
      headers['content-type']='text/html; charset=utf-8';headers['cache-control']='no-store';
      res.writeHead(out.status,headers);return res.end(html);
    }
    res.writeHead(out.status,headers);res.end(out.body);
  }catch(e){res.writeHead(502,{'content-type':'text/plain; charset=utf-8'});res.end('Gold Alpha temporarily unavailable');}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Unified Gold Alpha listening on ${PORT}; UI=${UI_PORT}; AUTO=${AUTO_PORT}`));
