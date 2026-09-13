import http from 'node:http';

const PORT = Number(process.env.PORT || 3004);
const API_KEY = String(process.env.CAPITAL_API_KEY || '').trim();
const IDENTIFIER = String(process.env.CAPITAL_IDENTIFIER || '').trim();
const PASSWORD = String(process.env.CAPITAL_API_PASSWORD || '').trim();
const DEMO = String(process.env.CAPITAL_DEMO || 'false').toLowerCase() === 'true';
const BASE = DEMO ? 'https://demo-api-capital.backend-capital.com' : 'https://api-capital.backend-capital.com';
const BUILD = 'capital-readonly-v1';

let session = { cst:'', security:'', createdAt:0 };
let epicCache = { gold:null, bitcoin:null, at:0 };
const quoteCache = new Map();
const candleCache = new Map();

function json(res,status,body){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-capital-bridge-build':BUILD});
  res.end(JSON.stringify(body));
}
function configured(){ return Boolean(API_KEY && IDENTIFIER && PASSWORD); }

async function startSession(force=false){
  const now=Date.now();
  if(!force && session.cst && session.security && now-session.createdAt < 8*60_000) return session;
  if(!configured()) throw new Error('CAPITAL_CONFIG_MISSING');
  const r=await fetch(`${BASE}/api/v1/session`,{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json','X-CAP-API-KEY':API_KEY},
    body:JSON.stringify({identifier:IDENTIFIER,password:PASSWORD,encryptedPassword:false}),
    signal:AbortSignal.timeout(8000)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`CAPITAL_AUTH_${r.status}:${d?.errorCode||d?.message||'failed'}`);
  const cst=r.headers.get('cst');
  const security=r.headers.get('x-security-token');
  if(!cst||!security) throw new Error('CAPITAL_AUTH_TOKENS_MISSING');
  session={cst,security,createdAt:now};
  return session;
}

async function api(path,{retry=true}={}){
  const s=await startSession(false);
  const r=await fetch(`${BASE}${path}`,{
    headers:{accept:'application/json',CST:s.cst,'X-SECURITY-TOKEN':s.security},
    cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  if((r.status===401||r.status===403) && retry){
    session={cst:'',security:'',createdAt:0};
    await startSession(true);
    return api(path,{retry:false});
  }
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`CAPITAL_API_${r.status}:${d?.errorCode||d?.message||'failed'}`);
  return d;
}

function marketScore(m,kind){
  const text=`${m?.epic||''} ${m?.instrumentName||''} ${m?.instrument?.name||''} ${m?.symbol||''}`.toLowerCase();
  let score=0;
  if(kind==='gold'){
    if(text.includes('gold')) score+=10;
    if(text.includes('xau')) score+=8;
    if(text.includes('spot')) score+=3;
    if(text.includes('usd')) score+=2;
  } else {
    if(text.includes('bitcoin')) score+=10;
    if(text.includes('btc')) score+=8;
    if(text.includes('usd')) score+=3;
  }
  const status=String(m?.marketStatus||m?.snapshot?.marketStatus||'');
  if(status==='TRADEABLE') score+=2;
  return score;
}

async function discoverEpic(kind){
  const now=Date.now();
  if(epicCache[kind] && now-epicCache.at<30*60_000) return epicCache[kind];
  const terms=kind==='gold'?['Gold','XAU']:['Bitcoin','BTC'];
  const all=[];
  for(const term of terms){
    try{
      const d=await api(`/api/v1/markets?searchTerm=${encodeURIComponent(term)}`);
      if(Array.isArray(d.markets)) all.push(...d.markets);
    }catch{}
  }
  const ranked=[...new Map(all.filter(x=>x?.epic).map(x=>[x.epic,x])).values()].sort((a,b)=>marketScore(b,kind)-marketScore(a,kind));
  const best=ranked[0];
  if(!best?.epic) throw new Error(`CAPITAL_${kind.toUpperCase()}_EPIC_NOT_FOUND`);
  epicCache={...epicCache,[kind]:best.epic,at:now};
  return best.epic;
}

function tsFrom(snapshot){
  const raw=snapshot?.updateTimeUTC||snapshot?.updateTime;
  const t=Date.parse(raw||'');
  return Number.isFinite(t)?t:Date.now();
}

async function quote(kind,force=false){
  const cached=quoteCache.get(kind),now=Date.now();
  if(!force && cached && now-cached.cachedAt<1800) return cached.data;
  const epic=await discoverEpic(kind);
  const d=await api(`/api/v1/markets/${encodeURIComponent(epic)}`);
  const snap=d.snapshot||{};
  const bid=Number(snap.bid),ask=Number(snap.offer);
  const price=Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:Number.isFinite(bid)?bid:Number.isFinite(ask)?ask:NaN;
  if(!Number.isFinite(price)||price<=0) throw new Error(`CAPITAL_${kind.toUpperCase()}_QUOTE_INVALID`);
  const t=tsFrom(snap);
  const data={kind,epic,price,bid:Number.isFinite(bid)?bid:price,ask:Number.isFinite(ask)?ask:price,t,updatedAt:new Date(t).toISOString(),provider:'CAPITAL_COM',marketStatus:snap.marketStatus||null,degraded:Date.now()-t>30_000,live:!DEMO,readOnly:true};
  quoteCache.set(kind,{cachedAt:now,data});
  return data;
}

async function candles(kind,resolution='MINUTE',max=120){
  const allowed=new Set(['MINUTE','MINUTE_5']);
  if(!allowed.has(resolution)) resolution='MINUTE';
  max=Math.max(1,Math.min(500,Number(max)||120));
  const key=`${kind}:${resolution}:${max}`,now=Date.now(),cached=candleCache.get(key);
  if(cached && now-cached.cachedAt<4000) return cached.data;
  const epic=await discoverEpic(kind);
  const d=await api(`/api/v1/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=${max}`);
  const rows=(Array.isArray(d.prices)?d.prices:[]).map(x=>({
    t:Date.parse(x.snapshotTimeUTC||x.snapshotTime||'')||Date.now(),
    open:Number(x.openPrice?.bid??x.openPrice?.ask),high:Number(x.highPrice?.bid??x.highPrice?.ask),low:Number(x.lowPrice?.bid??x.lowPrice?.ask),close:Number(x.closePrice?.bid??x.closePrice?.ask)
  })).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
  const data={kind,epic,resolution,prices:rows,provider:'CAPITAL_COM',readOnly:true};
  candleCache.set(key,{cachedAt:now,data});
  return data;
}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  try{
    if(req.method!=='GET') return json(res,405,{ok:false,error:'READ_ONLY_BRIDGE'});
    if(u.pathname==='/api/capital/status'){
      const body={ok:true,configured:configured(),mode:DEMO?'DEMO':'LIVE',base:DEMO?'demo':'live',readOnly:true,build:BUILD,epics:{gold:epicCache.gold,bitcoin:epicCache.bitcoin}};
      if(configured()){
        try{await startSession(false);body.authenticated=true;}catch(e){body.authenticated=false;body.error=String(e?.message||e);}
      } else body.authenticated=false;
      return json(res,200,body);
    }
    if(u.pathname==='/api/capital/gold') return json(res,200,await quote('gold',u.searchParams.get('force')==='1'));
    if(u.pathname==='/api/capital/bitcoin') return json(res,200,await quote('bitcoin',u.searchParams.get('force')==='1'));
    if(u.pathname==='/api/capital/candles'){
      const kind=u.searchParams.get('asset')==='bitcoin'?'bitcoin':'gold';
      return json(res,200,await candles(kind,u.searchParams.get('resolution')||'MINUTE',u.searchParams.get('max')||120));
    }
    return json(res,404,{ok:false,error:'NOT_FOUND'});
  }catch(e){
    return json(res,503,{ok:false,error:String(e?.message||e),mode:DEMO?'DEMO':'LIVE',readOnly:true,build:BUILD});
  }
});

server.listen(PORT,'0.0.0.0',()=>console.log(`[capital-market] ${BUILD} listening on ${PORT}; mode=${DEMO?'DEMO':'LIVE'}; readOnly=true`));
