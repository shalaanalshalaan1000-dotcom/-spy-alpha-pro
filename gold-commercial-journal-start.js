import fs from 'node:fs';
import path from 'node:path';

const PORT=Number(process.env.PORT||3000);
const DATA_DIR=process.env.GOLD_ALPHA_DATA_DIR||'/tmp/gold-alpha-commercial';
const JOURNAL_FILE=path.join(DATA_DIR,'xau-forward-journal.json');
const POLL_MS=1000;

fs.mkdirSync(DATA_DIR,{recursive:true});

function load(){try{const x=JSON.parse(fs.readFileSync(JOURNAL_FILE,'utf8'));return Array.isArray(x)?x:[]}catch{return[]}}
let journal=load();
let booted=false;
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const hit=(side,p,t)=>side==='BUY'?p>=t:p<=t;
const save=()=>{const tmp=JOURNAL_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(journal,null,2));fs.renameSync(tmp,JOURNAL_FILE)};
function get(id){return journal.find(x=>x.signalId===id)}
function upsertSignal(s){
  if(!s?.signalId||!['BUY','SELL'].includes(s.side||s.candidateAction))return null;
  let row=get(s.signalId);
  if(!row){row={signalId:s.signalId,symbol:'XAUUSD',side:s.side||s.candidateAction,strategy:s.strategy||null,confidence:n(s.confidence),issuedAt:s.issuedAt||new Date().toISOString(),entryLow:n(s.entryLow),entryHigh:n(s.entryHigh),plannedEntry:n(s.entry),stopLoss:n(s.stopLoss),target1:n(s.target1),target2:n(s.target2),target3:n(s.target3),target4:n(s.target4),status:'SIGNAL',executed:false,executedAt:null,executedPrice:null,tp1:false,tp2:false,tp3:false,tp4:false,stopped:false,closedAt:null,result:null,maxFavorablePrice:null,maxAdversePrice:null,lastPrice:null,lastSeenAt:null};journal.push(row);save()}
  return row;
}
function update(s){
  const row=upsertSignal(s);if(!row)return;
  const p=n(s.price);if(p==null)return;
  let changed=false;row.lastPrice=p;row.lastSeenAt=new Date().toISOString();
  if(!row.executed&&(s.entered===true||String(s.status).toUpperCase()==='MANAGING')){row.executed=true;row.executedAt=s.enteredAtMs?new Date(s.enteredAtMs).toISOString():new Date().toISOString();row.executedPrice=n(s.entry)??p;row.status='OPEN';changed=true}
  if(row.executed&&!row.closedAt){
    row.maxFavorablePrice=row.maxFavorablePrice==null?p:(row.side==='BUY'?Math.max(row.maxFavorablePrice,p):Math.min(row.maxFavorablePrice,p));
    row.maxAdversePrice=row.maxAdversePrice==null?p:(row.side==='BUY'?Math.min(row.maxAdversePrice,p):Math.max(row.maxAdversePrice,p));
    for(const k of [1,2,3,4]){const key='tp'+k,t=n(row['target'+k]);if(!row[key]&&t!=null&&hit(row.side,p,t)){row[key]=true;row[key+'At']=new Date().toISOString();changed=true}}
    const sl=n(row.stopLoss),stopHit=sl!=null&&(row.side==='BUY'?p<=sl:p>=sl);
    if(stopHit){row.stopped=true;row.status='CLOSED';row.closedAt=new Date().toISOString();row.result='SL';changed=true}
    else if(row.tp4){row.status='CLOSED';row.closedAt=new Date().toISOString();row.result='TP4';changed=true}
    else if(row.tp3)row.result='TP3+';else if(row.tp2)row.result='TP2+';else if(row.tp1)row.result='TP1+';
  }
  if(changed)save();
}
async function poll(){try{const r=await fetch(`http://127.0.0.1:${PORT}/api/auto-trade/signal?observe=1`,{cache:'no-store',signal:AbortSignal.timeout(4000)});if(r.ok)update(await r.json())}catch{}}

await import('./gold-no-chase-start.js');
booted=true;
console.log(`Gold commercial journal enabled: ${JOURNAL_FILE}${DATA_DIR.startsWith('/tmp/')?' (EPHEMERAL: configure GOLD_ALPHA_DATA_DIR on a persistent disk before paid launch)':''}`);
setInterval(()=>{if(booted)poll()},POLL_MS);
