import http from 'node:http';
import { spawn } from 'node:child_process';

const BUILD_TAG='site-signal-noai-v3';
const PORT=Number(process.env.PORT||3000);
const UI_PORT=3001;
const AUTO_PORT=3002;
const SPX_PORT=3003;
const CAPITAL_PORT=3004;

const capital=spawn(process.execPath,['capital-market.js'],{env:{...process.env,PORT:String(CAPITAL_PORT),CAPITAL_DEMO:process.env.CAPITAL_DEMO||'false'},stdio:['ignore','inherit','inherit']});
const ui=spawn(process.execPath,['gold-site-ui-start.js'],{env:{...process.env,PORT:String(UI_PORT)},stdio:['ignore','inherit','inherit']});
const autoEnv={...process.env,PORT:String(AUTO_PORT)};
if(process.env.CAPITAL_API_KEY&&process.env.CAPITAL_IDENTIFIER&&process.env.CAPITAL_API_PASSWORD){
  autoEnv.GOLD_ALPHA_QUOTE_URL=`http://127.0.0.1:${CAPITAL_PORT}/api/capital/gold`;
  autoEnv.GOLD_ALPHA_CANDLES_URL=`http://127.0.0.1:${CAPITAL_PORT}/api/capital/candles?asset=gold&resolution=MINUTE&max=120`;
}
const auto=spawn(process.execPath,['gold-site-signal-engine-v3.js'],{env:autoEnv,stdio:['ignore','inherit','inherit']});
const spx=spawn(process.execPath,['spx-live-start.js'],{env:{...process.env,PORT:String(SPX_PORT)},stdio:['ignore','inherit','inherit']});
const telegramEnabled=String(process.env.TELEGRAM_ENABLED||'false').toLowerCase()==='true'&&Boolean(process.env.TELEGRAM_BOT_TOKEN);
const telegramBot=telegramEnabled?spawn(process.execPath,['telegram-xau-bot.js'],{env:{...process.env,TELEGRAM_SIGNAL_URL:`http://127.0.0.1:${AUTO_PORT}/api/auto-trade/signal?observe=1`},stdio:['ignore','inherit','inherit']}):null;

for(const [name,child] of [['capital',capital],['ui',ui],['auto',auto],['spx',spx],['telegram',telegramBot]]) if(child) child.on('exit',c=>console.error(`${name} child exited`,c));
function shutdown(signal){for(const child of [capital,ui,auto,spx,telegramBot].filter(Boolean))if(!child.killed)child.kill(signal);server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();}
function requestBuffer(port,req){return new Promise((resolve,reject)=>{const opts={hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}};const p=http.request(opts,r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode||502,headers:r.headers,body:Buffer.concat(chunks)}));});p.on('error',reject);p.setTimeout(10000,()=>p.destroy(new Error('upstream timeout')));if(req.method==='GET'||req.method==='HEAD')p.end();else req.pipe(p);});}
function waitPayload(detail='signal engine temporarily unavailable',upstreamStatus=503){return{status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,executable:false,degraded:true,provider:null,entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,reason:'ENGINE_UNAVAILABLE: XAUUSD site signal feed is unavailable',upstreamStatus,upstreamDetail:String(detail),build:BUILD_TAG,noAI:true,updatedAt:new Date().toISOString()};}
function sendWait(res,detail,status=503){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-alpha-build':BUILD_TAG});res.end(JSON.stringify(waitPayload(detail,status)));}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&u.pathname==='/api/build'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','x-gold-alpha-build':BUILD_TAG});return res.end(JSON.stringify({ok:true,build:BUILD_TAG,telegram:telegramEnabled,noAI:true,signalOnly:true}));}
  try{
    const capitalPath=u.pathname.startsWith('/api/capital/');
    const autoPath=u.pathname.startsWith('/api/auto-trade/')||u.pathname==='/api/health'||u.pathname==='/api/gold'||u.pathname==='/api/gold-live'||u.pathname==='/api/performance/journal';
    const spxPath=u.pathname==='/spx'||u.pathname.startsWith('/api/spx-');
    const port=capitalPath?CAPITAL_PORT:(spxPath?SPX_PORT:(autoPath?AUTO_PORT:UI_PORT));
    const out=await requestBuffer(port,req);
    if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal'&&out.status>=500){let detail='signal engine temporarily unavailable';try{const parsed=JSON.parse(out.body.toString('utf8'));detail=String(parsed?.detail||parsed?.error||detail);}catch{}return sendWait(res,detail,out.status);}
    const headers={...out.headers};delete headers['content-length'];headers['x-gold-alpha-build']=BUILD_TAG;headers['cache-control']='no-store';
    res.writeHead(out.status,headers);res.end(out.body);
  }catch(e){if(req.method==='GET'&&u.pathname==='/api/auto-trade/signal')return sendWait(res,e?.message||e,503);res.writeHead(502,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-gold-alpha-build':BUILD_TAG});res.end('Gold Alpha temporarily unavailable');}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Unified Gold Alpha ${BUILD_TAG} listening on ${PORT}; UI=${UI_PORT}; AUTO=${AUTO_PORT}; CAPITAL=${CAPITAL_PORT}; Telegram=${telegramEnabled?'on':'off'}`));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
