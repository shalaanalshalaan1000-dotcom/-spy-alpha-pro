import http from 'node:http';
import https from 'node:https';

const PORT=Number(process.env.PORT||3005);
const BUILD='gold-data-bridge-v1';
let quoteCache={at:0,data:null};
let histCache={at:0,data:null};

function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-data-bridge':BUILD});res.end(JSON.stringify(body));}
function getJson(url,timeout=7000){return new Promise((resolve,reject)=>{const req=https.get(url,{family:4,headers:{accept:'application/json','user-agent':'GoldAlphaBridge/1.0'}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>{let d={};try{d=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return reject(new Error('invalid JSON'))}if((r.statusCode||500)<200||(r.statusCode||500)>=300)return reject(new Error(String(d?.error||`HTTP_${r.statusCode}`)));resolve(d);});});req.setTimeout(timeout,()=>req.destroy(new Error('timeout')));req.on('error',reject);});}
function tms(v){const n=Number(v);if(Number.isFinite(n)&&n>0)return n>1e12?n:n>1e9?n*1000:Date.now();const p=Date.parse(v);return Number.isFinite(p)?p:Date.now();}

async function quote(force=false){const now=Date.now();if(!force&&quoteCache.data&&now-quoteCache.at<2000)return quoteCache.data;const d=await getJson('https://api.gold-api.com/price/XAU',6000);const price=Number(d.price);if(!Number.isFinite(price)||price<=0)throw new Error('invalid Gold API quote');const t=tms(d.updatedAt??d.timestamp);const data={price,bid:price,ask:price,t,updatedAt:new Date(t).toISOString(),provider:'GOLD_API_IPV4',degraded:now-t>120000};quoteCache={at:now,data};return data;}

async function candles(force=false){const now=Date.now();if(!force&&histCache.data&&now-histCache.at<30000)return histCache.data;const d=await getJson(`https://xaus.com/api/v1/intraday?symbol=xau&hours=2&fresh=${now}`,8000);const pts=Array.isArray(d.points)?d.points:[];const prices=[];for(const x of pts){const p=Number(x.p),t=tms(x.t);if(!Number.isFinite(p)||p<=0||!Number.isFinite(t))continue;prices.push({t,open:p,high:p,low:p,close:p});}if(prices.length<3)throw new Error('XAUS intraday insufficient');const data={kind:'gold',resolution:'MINUTE',prices,provider:'XAUS_INTRADAY_IPV4',readOnly:true,count:prices.length};histCache={at:now,data};return data;}

const server=http.createServer(async(req,res)=>{const u=new URL(req.url||'/','http://localhost');try{if(req.method==='GET'&&u.pathname==='/api/gold/quote')return json(res,200,await quote(u.searchParams.get('force')==='1'));if(req.method==='GET'&&u.pathname==='/api/gold/candles')return json(res,200,await candles(u.searchParams.get('force')==='1'));if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,build:BUILD,quoteCached:Boolean(quoteCache.data),historyCached:Boolean(histCache.data),historyCount:histCache.data?.count||0});return json(res,404,{error:'Not found'});}catch(e){console.error('[gold-data-bridge]',u.pathname,String(e?.message||e));return json(res,503,{error:String(e?.message||e),build:BUILD});}});
server.listen(PORT,'0.0.0.0',async()=>{console.log(`[gold-data-bridge] ${BUILD} listening on ${PORT}`);try{await Promise.all([quote(true),candles(true)])}catch(e){console.error('[gold-data-bridge] warmup',String(e?.message||e));}});
