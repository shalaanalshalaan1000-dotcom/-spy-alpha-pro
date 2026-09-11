import http from 'node:http';
import {spawn} from 'node:child_process';

const BUILD_TAG='gold-resilient-v1';
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
function sendJson(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(body));}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&u.pathname==='/api/build')return sendJson(res,200,{ok:true,build:BUILD_TAG});
  try{
    const autoPath=u.pathname.startsWith('/api/auto-trade/')||u.pathname==='/api/health'||u.pathname==='/api/gold'||u.pathname==='/api/gold-live'||u.pathname==='/api/performance/journal';
    const spxPath=u.pathname==='/spx'||u.pathname.startsWith('/api/spx-');
    const port=spxPath?SPX_PORT:(autoPath?AUTO_PORT:UI_PORT);
    const out=await requestBuffer(port,req);
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal'&&out.status>=500){
      let detail='internal signal engine failure';try{const j=JSON.parse(out.body.toString('utf8'));detail=j.detail||j.error||detail}catch{}
      return sendJson(res,200,waitPayload(detail,out.status));
    }
    const headers={...out.headers};delete headers['content-length'];headers['cache-control']='no-store';
    res.writeHead(out.status,headers);res.end(out.body);
  }catch(e){
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal')return sendJson(res,200,waitPayload(e?.message||e,503));
    sendJson(res,503,{error:'Service unavailable',detail:String(e?.message||e),build:BUILD_TAG});
  }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Unified Gold Alpha ${BUILD_TAG} listening on ${PORT}`));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
