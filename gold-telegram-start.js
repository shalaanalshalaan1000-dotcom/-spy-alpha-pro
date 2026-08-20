import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);
const replaceIfPresent=(s,a,b)=>s.includes(a)?s.replace(a,b):s;

function applyGoldTelegram(source){
  const backendAnchor='const server=http.createServer(async(req,res)=>{';
  if(source.includes(backendAnchor)){
    const backend=`const goldTelegramState={running:false,lastRunAt:null,lastSentAt:null,lastState:'WAIT',lastSignal:null,lastError:null,dayKey:null,sentToday:0};
function goldTelegramConfig(){const n=(k,f,min,max)=>{const v=Number(process.env[k]);return Number.isFinite(v)?Math.min(max,Math.max(min,v)):f};return{minConfidence:n('GOLD_TELEGRAM_MIN_CONFIDENCE',75,60,95),cooldownMinutes:n('GOLD_TELEGRAM_COOLDOWN_MINUTES',20,5,180),maxPerDay:Math.round(n('MAX_GOLD_TELEGRAM_SIGNALS_PER_DAY',12,1,40))}}
function resetGoldTelegramDay(){const key=new Date().toISOString().slice(0,10);if(goldTelegramState.dayKey!==key){goldTelegramState.dayKey=key;goldTelegramState.sentToday=0}return key}
function goldTelegramPublicStatus(){resetGoldTelegramDay();return{configured:telegramConfigured(),running:goldTelegramState.running,lastRunAt:goldTelegramState.lastRunAt,lastSentAt:goldTelegramState.lastSentAt,lastState:goldTelegramState.lastState,lastSignal:goldTelegramState.lastSignal,lastError:goldTelegramState.lastError,sentToday:goldTelegramState.sentToday}}
function computeGoldTelegramSignal(){const now=Date.now(),recent=goldServerState.samples.filter(x=>x.t>=now-20*60_000&&x.t<=now+60_000).slice(-80);if(recent.length<8)return{state:'COLLECTING',sampleCount:recent.length};const span=(recent.at(-1).t-recent[0].t)/60_000;if(span<5)return{state:'COLLECTING',sampleCount:recent.length,span};const first=recent[0].price,last=recent.at(-1).price,net=last-first,diffs=[];for(let i=1;i<recent.length;i++)diffs.push(recent[i].price-recent[i-1].price);const sumAbs=diffs.reduce((a,b)=>a+Math.abs(b),0),noise=diffs.length?sumAbs/diffs.length:0,efficiency=sumAbs>0?Math.min(1,Math.abs(net)/sumAbs):0,minMove=Math.max(.5,last*.00012),moveScore=Math.min(1,Math.abs(net)/Math.max(minMove,0.01)),confidence=Math.round(Math.min(95,50+efficiency*30+moveScore*15));if(Math.abs(net)<minMove||confidence<75)return{state:'WAIT',confidence,price:last,net,span,efficiency};const state=net>0?'BUY':'SELL',sign=state==='BUY'?1:-1,target1Dist=Math.max(Math.abs(net)*.6,noise*2.6,.8),target2Dist=Math.max(Math.abs(net),noise*4,1.3),stopDist=target1Dist/2,speed=Math.max(.03,Math.abs(net)/Math.max(span,1)),eta1=Math.max(5,Math.min(30,Math.round(target1Dist/speed))),eta2=Math.max(10,Math.min(60,Math.round(target2Dist/speed)));return{state,confidence,price:last,entry:last,target1:last+sign*target1Dist,target2:last+sign*target2Dist,stop:last-sign*stopDist,rr:2,eta1,eta2,net,span,efficiency}}
function goldTelegramMessage(s){const f=v=>Number(v).toFixed(2),side=s.state==='BUY'?'BUY 🟢':'SELL 🔴';return['🟡 XAUUSD — تنبيه الذهب','', 'الاتجاه: '+side,'الثقة: '+s.confidence+'%','الدخول: '+f(s.entry),'TP1: '+f(s.target1)+' • متوقع '+s.eta1+' د','TP2: '+f(s.target2)+' • متوقع '+s.eta2+' د','Stop Loss: '+f(s.stop),'R:R تقريبي: 1:2','','التنبيه يظهر فقط عند إشارة جديدة أو تغير الاتجاه.','قراءة تحليلية تجريبية وليست ضمانًا للربح.'].join('\n')}
async function runGoldTelegramScan(){if(goldTelegramState.running||!telegramConfigured())return null;goldTelegramState.running=true;goldTelegramState.lastRunAt=new Date().toISOString();try{resetGoldTelegramDay();await collectGoldServerSample();const config=goldTelegramConfig(),signal=computeGoldTelegramSignal();goldTelegramState.lastSignal=signal;if(!['BUY','SELL'].includes(signal.state)||Number(signal.confidence)<config.minConfidence){if(signal.state==='WAIT')goldTelegramState.lastState='WAIT';return signal}if(goldTelegramState.sentToday>=config.maxPerDay)return signal;const now=Date.now(),lastSent=goldTelegramState.lastSentAt?new Date(goldTelegramState.lastSentAt).getTime():0,sameSideRecently=goldTelegramState.lastState===signal.state&&lastSent&&now-lastSent<config.cooldownMinutes*60_000;if(sameSideRecently)return signal;if(goldTelegramState.lastState===signal.state)return signal;await sendTelegramMessage(goldTelegramMessage(signal));goldTelegramState.lastState=signal.state;goldTelegramState.lastSentAt=new Date().toISOString();goldTelegramState.sentToday++;goldTelegramState.lastError=null;return signal}catch(e){goldTelegramState.lastError=String(e.message||e).slice(0,240);return null}finally{goldTelegramState.running=false}}
void(()=>{const timer=setInterval(()=>void runGoldTelegramScan(),60_000);timer.unref()})();
`;
    source=source.replace(backendAnchor,backend+backendAnchor);
  }

  source=replaceIfPresent(source,'void runTelegramSignalScan();\n      return sendJSON(res,202,{ok:true,queued,telegram:telegramPublicStatus()});','void runTelegramSignalScan();\n      void runGoldTelegramScan();\n      return sendJSON(res,202,{ok:true,queued,telegram:telegramPublicStatus(),goldTelegram:goldTelegramPublicStatus()});');
  source=replaceIfPresent(source,"if(req.method==='GET'&&url.pathname==='/api/gold-series')return sendJSON(res,200,await goldServerSnapshot());","if(req.method==='GET'&&url.pathname==='/api/gold-telegram/status')return sendJSON(res,200,goldTelegramPublicStatus());\n    if(req.method==='GET'&&url.pathname==='/api/gold-series')return sendJSON(res,200,await goldServerSnapshot());");
  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string')data=applyGoldTelegram(data);
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./gold-server-start.js');
