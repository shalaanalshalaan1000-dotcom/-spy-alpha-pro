import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error('JustMarkets patch target was not found: ' + label);
  // A callback keeps JavaScript sequences such as "$'" literal instead of
  // letting String.replace interpret them as replacement tokens.
  return source.replace(before, () => after);
}

function applyJustMarketsBridge(source) {
  const backendAnchor = 'const server=http.createServer(async(req,res)=>{';
  const backend = `const AUTO_TRADE_MIN_CONFIDENCE=75,AUTO_TRADE_ENTRY_TTL_MS=60_000,AUTO_TRADE_LOCK_MS=4*60*60_000;
const autoTradeState={samples:[],signal:null,cooldownUntil:0};
const autoRound=(value,digits=2)=>Number.isFinite(Number(value))?Number(Number(value).toFixed(digits)):null;
function recordAutoTradeQuote(quote){const price=Number(quote?.price),providerTime=new Date(quote?.updatedAt).getTime(),now=Date.now(),t=quote?.live===true?now:providerTime;if(!Number.isFinite(price)||price<=0||!Number.isFinite(t))throw new Error('Invalid execution quote');const last=autoTradeState.samples.at(-1);if(!last||t>last.t)autoTradeState.samples.push({price,t});else if(t===last.t)last.price=price;autoTradeState.samples=autoTradeState.samples.filter(x=>x.t>=now-2*60*60_000&&x.t<=now+60_000).slice(-1440);return{price,t,now}}
function autoTradeModel(price,now,quoteUpdatedAt){const sourceAge=Math.max(0,(now-new Date(quoteUpdatedAt).getTime())/1000),windowed=autoTradeState.samples.filter(x=>x.t>=now-60*60_000&&x.t<=now+60_000);let continuousFrom=0;for(let i=1;i<windowed.length;i++)if(windowed[i].t-windowed[i-1].t>3*60_000)continuousFrom=i;const recent=windowed.slice(continuousFrom),n=recent.length,span=n>1?(recent.at(-1).t-recent[0].t)/60_000:0,base={action:'WAIT',candidateAction:'WAIT',status:'COLLECTING',confidence:0,price:autoRound(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,sampleCount:n,spanMinutes:autoRound(span,1),riskReward:2,updatedAt:new Date(now).toISOString()};if(sourceAge>120)return{...base,status:'STALE',reason:'سعر الذهب أقدم من دقيقتين'};if(n<3||span<1)return{...base,reason:'جمع بيانات الخادم: '+autoRound(span,1)+' من دقيقة واحدة'};const firstT=recent[0].t,times=recent.map(x=>(x.t-firstT)/60_000),meanT=times.reduce((a,b)=>a+b,0)/n,meanP=recent.reduce((a,b)=>a+b.price,0)/n,varianceT=times.reduce((sum,t)=>sum+(t-meanT)*(t-meanT),0);if(varianceT<=0)return{...base,status:'WAIT',reason:'العينات لا تكفي لحساب الاتجاه'};const slope=recent.reduce((sum,x,i)=>sum+(times[i]-meanT)*(x.price-meanP),0)/varianceT,intercept=meanP-slope*meanT,predicted=intercept+slope*times.at(-1),residuals=recent.map((x,i)=>x.price-(intercept+slope*times[i])),rmse=Math.sqrt(residuals.reduce((sum,x)=>sum+x*x,0)/n);let logSquares=0,elapsed=0;for(let i=1;i<n;i++){const dt=(recent[i].t-recent[i-1].t)/60_000;if(dt<=0)continue;const r=Math.log(recent[i].price/recent[i-1].price);logSquares+=r*r;elapsed+=dt}const expected5=elapsed>0?price*Math.sqrt(logSquares/elapsed)*Math.sqrt(5):0,prices=recent.map(x=>x.price),range=Math.max(...prices)-Math.min(...prices),totalMove=slope*span,noise=Math.max(rmse,expected5*.55,price*.00005),snr=Math.abs(totalMove)/noise,aligned=Math.abs(price-predicted)<=Math.max(rmse,price*.00005)||(slope>0?price>predicted:price<predicted);let confidence=Math.round(45+Math.min(23,snr*7)+Math.min(12,span*2.4)+Math.min(8,n/3));if(!aligned)confidence-=8;if(Math.abs(totalMove)<price*.00025)confidence-=10;confidence=Math.max(0,Math.min(92,confidence));if(confidence<AUTO_TRADE_MIN_CONFIDENCE)return{...base,status:'WAIT',confidence,reason:'التأكيد '+confidence+'% أقل من 75%'};const direction=slope>0?1:-1,side=direction>0?'BUY':'SELL',move=Math.min(price*.006,Math.max(5,expected5,rmse*1.35,range*.24)),stopDistance=Math.max(2.5,move/2),entryHalf=Math.min(.75,Math.max(.2,move*.08));return{...base,status:'CANDIDATE',confidence,candidateAction:side,entry:autoRound(price),entryLow:autoRound(price-entryHalf),entryHigh:autoRound(price+entryHalf),stopLoss:autoRound(price-direction*stopDistance),target1:autoRound(price+direction*move),target2:autoRound(price+direction*move*1.6),target3:autoRound(price+direction*move*2.2),target4:autoRound(price+direction*move*3),slopePerMinute:autoRound(slope,3),expectedMove:autoRound(move),reason:'إشارة خادمية مؤكدة • هدف أول لا يقل عن 5$ • R:R 1:2'}}
function autoTradeTargetReached(signal,price,target){return signal.side==='BUY'?price>=target:price<=target}
async function getAutoTradeSignal(execute=false){const quote=await getGoldLiveQuote(),sample=recordAutoTradeQuote(quote),model=autoTradeModel(sample.price,sample.now,quote.updatedAt);let active=autoTradeState.signal;if(active){const stopped=active.side==='BUY'?sample.price<=active.stopLoss:sample.price>=active.stopLoss,completed=autoTradeTargetReached(active,sample.price,active.target4),opposite=['BUY','SELL'].includes(model.candidateAction)&&model.candidateAction!==active.side&&model.confidence>=AUTO_TRADE_MIN_CONFIDENCE,expired=sample.now-active.issuedAtMs>AUTO_TRADE_LOCK_MS;if(stopped||completed||opposite||expired){autoTradeState.signal=null;autoTradeState.cooldownUntil=sample.now+5*60_000;active=null}}if(!active&&execute&&sample.now>=autoTradeState.cooldownUntil&&['BUY','SELL'].includes(model.candidateAction)){active={signalId:'XAU-'+sample.now+'-'+model.candidateAction,side:model.candidateAction,confidence:model.confidence,entry:model.entry,entryLow:model.entryLow,entryHigh:model.entryHigh,stopLoss:model.stopLoss,target1:model.target1,target2:model.target2,target3:model.target3,target4:model.target4,riskReward:model.riskReward,issuedAtMs:sample.now,issuedAt:new Date(sample.now).toISOString(),expiresAtMs:sample.now+AUTO_TRADE_ENTRY_TTL_MS,expiresAt:new Date(sample.now+AUTO_TRADE_ENTRY_TTL_MS).toISOString()};autoTradeState.signal=active}if(active){const entryOpen=sample.now<=active.expiresAtMs,inRange=sample.price>=active.entryLow&&sample.price<=active.entryHigh;return{...active,action:execute&&entryOpen&&inRange?active.side:'WAIT',candidateAction:active.side,status:entryOpen?'ACTIVE':'MANAGING',price:autoRound(sample.price),sampleCount:autoTradeState.samples.length,updatedAt:new Date(sample.now).toISOString(),provider:quote.provider,reason:entryOpen?(inRange?'إشارة جاهزة للتنفيذ على MT5 Demo':'انتظر عودة السعر إلى نطاق الدخول'):'انتهت نافذة الدخول؛ إدارة الصفقة القائمة فقط'}}return{...model,executionMode:'MT5_DEMO_ONLY',provider:quote.provider,updatedAt:new Date(sample.now).toISOString(),reason:sample.now<autoTradeState.cooldownUntil?'فترة تهدئة بعد انتهاء الإشارة':model.reason}}
`;
  source = replaceRequired(source, backendAnchor, backend + backendAnchor, 'server anchor');

  const routeAnchor = "if(req.method==='GET'&&url.pathname==='/api/gold-live'){try{return sendJSON(res,200,await getGoldLiveQuote())}catch(error){return sendJSON(res,502,{error:'Gold feed unavailable'})}}";
  const executionRoute = "if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){try{return sendJSON(res,200,await getAutoTradeSignal(url.searchParams.get('observe')!=='1'))}catch(error){return sendJSON(res,503,{error:'Auto-trade signal unavailable'})}}\n    ";
  source = replaceRequired(source, routeAnchor, executionRoute + routeAnchor, 'execution route');

  const authGate = "if(authEnabled()&&!session)return url.pathname.startsWith('/api/')?sendJSON(res,401,{error:'Authentication required'}):redirect(res,'/login');";
  const authGateWithSignal = "if(authEnabled()&&!session&&url.pathname!=='/api/auto-trade/signal')return url.pathname.startsWith('/api/')?sendJSON(res,401,{error:'Authentication required'}):redirect(res,'/login');";
  source = replaceRequired(source, authGate, authGateWithSignal, 'MT5 signal auth exemption');

  const css = `
.autoTradePanel{margin:0 0 14px;border:1px solid #2f5d52;border-radius:18px;background:linear-gradient(145deg,#0f1d1a,#0b111b);padding:16px}.autoTradeHead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.autoTradeHead h2{margin:0;color:#77e1bd;font-size:18px}.autoTradeHead p{margin:5px 0 0;color:#8fa9a0;font-size:11px}.autoTradeBadge{padding:6px 9px;border:1px solid #387b67;border-radius:999px;color:#77e1bd;background:#10271f;font-size:11px;font-weight:900}.autoTradeGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.autoTradeCard{padding:11px;border:1px solid #29473f;border-radius:11px;background:#0d1421}.autoTradeCard span,.autoTradeCard small{display:block;color:#8fa9a0;font-size:11px}.autoTradeCard strong{display:block;margin:6px 0;font-size:18px;direction:ltr;text-align:right}.autoTradeNote{margin:10px 0 0;color:#8fa9a0;font-size:11px;line-height:1.7}@media(max-width:760px){.autoTradeGrid{grid-template-columns:repeat(2,1fr)}.autoTradeHead{flex-direction:column}}
`;
  source = replaceRequired(source, '</style></head>', css + '</style></head>', 'execution CSS');

  const panel = `<article class="autoTradePanel"><div class="autoTradeHead"><div><h2>JustMarkets MT5 — التنفيذ الآلي</h2><p>الجسر الخادمي جاهز • التنفيذ محصور افتراضيًا بحساب Demo داخل ملف EA</p></div><span id="autoTradeBadge" class="autoTradeBadge">MT5 DEMO</span></div><section class="autoTradeGrid"><div class="autoTradeCard"><span>إشارة الخادم</span><strong id="autoTradeAction">انتظار</strong><small id="autoTradeConfidence">جمع البيانات</small></div><div class="autoTradeCard"><span>نطاق الدخول</span><strong id="autoTradeRange">—</strong><small>نافذة تنفيذ 60 ثانية</small></div><div class="autoTradeCard"><span>وقف الخسارة</span><strong id="autoTradeStop">—</strong><small>R:R أدنى 1:2</small></div><div class="autoTradeCard"><span>الهدف الأول</span><strong id="autoTradeTarget">—</strong><small>لا يقل عن 5$ عند صدور الإشارة</small></div></section><p id="autoTradeNote" class="autoTradeNote">الموقع يصدر إشارة خادمية؛ Expert Advisor داخل MT5 هو الذي ينفذ ويدير الصفقة. لا تُخزّن بيانات حساب JustMarkets في الموقع.</p></article>`;
  source = replaceRequired(source, '<section class="toolbar">', panel + '<section class="toolbar">', 'execution panel');

  const clientAnchor = "$('#btcRefresh').onclick=()=>loadBtc(true);";
  const client = `let autoTradeLoading=false;
async function loadAutoTrade(){if(autoTradeLoading)return;autoTradeLoading=true;try{const r=await fetch('/api/auto-trade/signal?observe=1',{cache:'no-store'}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Signal request failed');const candidate=d.action!=='WAIT'?d.action:d.candidateAction,active=['BUY','SELL'].includes(candidate),label=candidate==='BUY'?'شراء':candidate==='SELL'?'بيع':'انتظار',money=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';$('#autoTradeAction').textContent=label;$('#autoTradeAction').className=candidate==='BUY'?'positive':candidate==='SELL'?'negative':'WATCH';$('#autoTradeConfidence').textContent='الثقة '+Number(d.confidence||0)+'% • '+Number(d.sampleCount||0)+' عينة';$('#autoTradeRange').textContent=active?money(d.entryLow)+' — '+money(d.entryHigh):'—';$('#autoTradeStop').textContent=active?money(d.stopLoss):'—';$('#autoTradeTarget').textContent=active?money(d.target1):'—';$('#autoTradeBadge').textContent=d.status==='ACTIVE'?'إشارة فعالة':'MT5 DEMO';$('#autoTradeNote').textContent=d.reason||'بانتظار إشارة خادمية مكتملة';}catch(error){$('#autoTradeBadge').textContent='غير متاح';$('#autoTradeNote').textContent=error.message}finally{autoTradeLoading=false}}
`;
  source = replaceRequired(source, clientAnchor, client + clientAnchor, 'execution client');

  const startup = "await Promise.all([loadGold(),loadBtc()]);\n  setInterval(loadGold,5000);\n  setInterval(()=>loadBtc(),20000);";
  const startupWithExecution = "await Promise.all([loadGold(),loadBtc(),loadAutoTrade()]);\n  setInterval(loadGold,5000);\n  setInterval(loadAutoTrade,5000);\n  setInterval(()=>loadBtc(),20000);";
  source = replaceRequired(source, startup, startupWithExecution, 'execution startup');

  for (const marker of ["url.pathname==='/api/auto-trade/signal'", "url.pathname!=='/api/auto-trade/signal'", 'function getAutoTradeSignal', 'id="autoTradeAction"', 'setInterval(loadAutoTrade,5000)']) {
    if (!source.includes(marker)) throw new Error('JustMarkets patch failed: ' + marker);
  }
  return source;
}

fs.writeFileSync = function patchedWriteFileSync(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return originalWriteFileSync(path, data, ...args);
  }
  const isBuffer = Buffer.isBuffer(data);
  const source = applyJustMarketsBridge(isBuffer ? data.toString('utf8') : String(data));
  return originalWriteFileSync(path, isBuffer ? Buffer.from(source, 'utf8') : source, ...args);
};

syncBuiltinESMExports();
await import('./gold-live-start.js');
