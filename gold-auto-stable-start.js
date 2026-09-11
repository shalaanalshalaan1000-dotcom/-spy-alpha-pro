import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./gold-app.js',import.meta.url);
const runtimePath=new URL('./.runtime-gold-app.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

// Normalize all MT5 samples to server arrival time. Broker clocks can differ from Render
// and must never prevent M1/M5 buckets from closing.
source=source.replace(
/function record\(q\)\{[\s\S]*?\n\}\nconst analyze=/,
`function record(q){
  const arrival=Date.now(),p=Number(q?.price); if(!Number.isFinite(p)||p<=0) return;
  const sourceT=Number(q?.t);
  const fromMt5=String(q?.provider||'').toUpperCase()==='MT5_BROKER';
  const saneSource=Number.isFinite(sourceT)&&Math.abs(sourceT-arrival)<=30_000;
  const t=fromMt5?arrival:(saneSource?sourceT:arrival);
  const row={t,p,price:p,bid:Number(q?.bid)||p,ask:Number(q?.ask)||p,sourceT:Number.isFinite(sourceT)?sourceT:null},last=state.samples.at(-1);
  if(!last||t-last.t>=3500) state.samples.push(row); else Object.assign(last,row);
  const cutoff=arrival-2*60*60_000; state.samples=state.samples.filter(x=>Number(x.t)>=cutoff).slice(-1800);
}
const analyze=`
);

// Ingest the heartbeat quote immediately. Previously samples were mainly recorded when
// the signal endpoint was polled, so any endpoint failure could leave M5 stuck at 0/1.
source=source.replace(
/const bid=Number\(body\.bid\),ask=Number\(body\.ask\),tickAt=timestampMs\(body\.tickAt,Date\.now\(\)\);\n\s*if\(Number\.isFinite\(bid\)&&bid>0&&Number\.isFinite\(ask\)&&ask>=bid\)\{state\.mt5\.quote=\{price:\(bid\+ask\)\/2,bid,ask,t:tickAt,updatedAt:new Date\(tickAt\)\.toISOString\(\)\};state\.quote=\{\.\.\.state\.mt5\.quote,provider:'MT5_BROKER',degraded:Date\.now\(\)-tickAt>30_000\};state\.quoteAt=Date\.now\(\);\}\n\s*scheduleMt5Scan\(\);return \{ok:true\};/,
`const bid=Number(body.bid),ask=Number(body.ask),sourceTickAt=timestampMs(body.tickAt,Date.now()),arrival=Date.now();
    if(Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>=bid){
      state.mt5.quote={price:(bid+ask)/2,bid,ask,t:arrival,sourceT:sourceTickAt,updatedAt:new Date(arrival).toISOString(),provider:'MT5_BROKER'};
      state.quote={...state.mt5.quote,degraded:false};state.quoteAt=arrival;
      record(state.quote);
      saveStore();
    }
    scheduleMt5Scan();return {ok:true,sampleCount:state.samples.length,serverAt:arrival};`
);

// Signal requests are fail-closed but always return HTTP 200 JSON to the EA. This avoids
// disabling the execution loop because a quote provider or reviewer had a transient error.
source=source.replace(
"if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal') return json(res,200,await signal(url.searchParams.get('observe')!=='1'));",
"if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){try{return json(res,200,await signal(url.searchParams.get('observe')!=='1'));}catch(e){return json(res,200,{status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,executable:false,degraded:true,entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,reason:'ENGINE_RECOVERING: '+String(e?.message||e),updatedAt:new Date().toISOString()});}}"
);

// Add ingestion diagnostics to health without changing existing consumers.
source=source.replace(
"quoteAgeMs:state.quote?.t?Math.max(0,Date.now()-Number(state.quote.t)):null,aiReviewer:",
"quoteAgeMs:state.quote?.t?Math.max(0,Date.now()-Number(state.quote.t)):null,sampleCount:state.samples.length,lastMt5SeenMs:state.mt5.lastSeen?Math.max(0,Date.now()-state.mt5.lastSeen):null,aiReviewer:"
);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
