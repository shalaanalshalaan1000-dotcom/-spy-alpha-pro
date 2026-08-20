import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);
const replaceIfPresent=(s,a,b)=>s.includes(a)?s.replace(a,b):s;

function applyGoldServerEngine(source){
  const backendAnchor='const server=http.createServer(async(req,res)=>{';
  if(source.includes(backendAnchor)){
    const backend=`const GOLD_SERVER_STORE='/tmp/gold-alpha-samples.json';
const goldServerState={samples:[],lastError:null,lastCollectedAt:null,running:false};
async function loadGoldServerStore(){try{const {readFile}=await import('node:fs/promises'),raw=JSON.parse(await readFile(GOLD_SERVER_STORE,'utf8')),now=Date.now();goldServerState.samples=(Array.isArray(raw)?raw:[]).map(x=>({price:Number(x.price),t:Number(x.t)})).filter(x=>Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.t)&&x.t>=now-24*60*60_000&&x.t<=now+60_000).sort((a,b)=>a.t-b.t).slice(-3000)}catch{}}
async function saveGoldServerStore(){try{const {writeFile}=await import('node:fs/promises');await writeFile(GOLD_SERVER_STORE,JSON.stringify(goldServerState.samples.slice(-3000)))}catch{}}
async function collectGoldServerSample(){if(goldServerState.running)return;goldServerState.running=true;try{const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store',headers:{'user-agent':'GoldAlphaPro/2.0'},signal:AbortSignal.timeout(12000)}),d=await r.json().catch(()=>({})),price=Number(d.price),stamp=new Date(d.updatedAt||Date.now()).getTime();if(!r.ok||!Number.isFinite(price)||price<=0||!Number.isFinite(stamp))throw new Error(d.error||'Invalid gold feed');const last=goldServerState.samples.at(-1);if(!last||stamp>last.t)goldServerState.samples.push({price,t:stamp});else if(stamp===last.t)last.price=price;const cutoff=Date.now()-24*60*60_000;goldServerState.samples=goldServerState.samples.filter(x=>x.t>=cutoff).slice(-3000);goldServerState.lastCollectedAt=new Date().toISOString();goldServerState.lastError=null;await saveGoldServerStore()}catch(e){goldServerState.lastError=String(e.message||e).slice(0,220)}finally{goldServerState.running=false}}
function goldBars(minutes){const width=Math.max(1,minutes)*60_000,buckets=new Map();for(const s of goldServerState.samples){const bucket=Math.floor(s.t/width)*width,bar=buckets.get(bucket);if(!bar)buckets.set(bucket,{t:bucket,open:s.price,high:s.price,low:s.price,close:s.price,count:1});else{bar.high=Math.max(bar.high,s.price);bar.low=Math.min(bar.low,s.price);bar.close=s.price;bar.count++}}return[...buckets.values()].sort((a,b)=>a.t-b.t)}
async function goldServerSnapshot(){if(!goldServerState.samples.length)await collectGoldServerSample();return{samples:goldServerState.samples.slice(-720),bars:{m1:goldBars(1).slice(-360),m5:goldBars(5).slice(-144),m15:goldBars(15).slice(-96),h1:goldBars(60).slice(-48)},lastCollectedAt:goldServerState.lastCollectedAt,lastError:goldServerState.lastError,serverManaged:true}}
void(async()=>{await loadGoldServerStore();await collectGoldServerSample();const timer=setInterval(()=>void collectGoldServerSample(),30000);timer.unref()})();
`;
    source=source.replace(backendAnchor,backend+backendAnchor);
  }

  const healthAnchor="if(req.method==='GET'&&url.pathname==='/api/health')return sendJSON(res,200,{ok:true,...currentMode(),telegram:telegramPublicStatus(),access:accessStatus()});";
  if(source.includes(healthAnchor))source=source.replace(healthAnchor,"if(req.method==='GET'&&url.pathname==='/api/gold-series')return sendJSON(res,200,await goldServerSnapshot());\n    "+healthAnchor);

  const loadGoldAnchor='async function loadGold(){';
  if(source.includes(loadGoldAnchor)){
    const frontend=`async function hydrateGoldFromServer(){try{const r=await fetch('/api/gold-series',{cache:'no-store'}),d=await r.json();if(!r.ok||!Array.isArray(d.samples))return;const local=Array.isArray(goldSamples)?goldSamples:[],merged=[...d.samples,...local].map(x=>({price:Number(x.price),t:Number(x.t)})).filter(x=>Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.t)).sort((a,b)=>a.t-b.t),unique=[];for(const row of merged){const last=unique.at(-1);if(last&&last.t===row.t)last.price=row.price;else unique.push(row)}goldSamples=unique.filter(x=>x.t>=Date.now()-24*60*60_000).slice(-3000);saveGoldSamples()}catch{}}
`;
    source=source.replace(loadGoldAnchor,frontend+loadGoldAnchor);
  }

  source=replaceIfPresent(source,'goldSamples=restoreGoldSamples();\n  await loadConfig();','goldSamples=restoreGoldSamples();\n  await hydrateGoldFromServer();\n  await loadConfig();');
  source=replaceIfPresent(source,"$('#goldMeta').textContent='Gold API • آخر تحديث ","$('#goldMeta').textContent='Server Gold Feed • آخر تحديث ");
  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string')data=applyGoldServerEngine(data);
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./gold-terminal-start.js');
