import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source,before,after,label){
  if(!source.includes(before)) throw new Error('Platform hardening target not found: '+label);
  return source.replace(before,()=>after);
}

function harden(source){
  // 1) BTC execution must use a genuinely fresh quote, not the timestamp of the current 1m candle bucket.
  source=replaceRequired(
    source,
    "const value={...analyzeBtcICT({one,five,fifteen,hour,four}),change24h:round(change24h,2),provider:'COINBASE',symbol:'BTC-USD'};btcCache.value=value;btcCache.expiresAt=Date.now()+20_000;return value;",
    "const analyzed=analyzeBtcICT({one,five,fifteen,hour,four}),liveUpdatedAt=new Date().toISOString();const value={...analyzed,price:round(last,2),minuteHigh:round(one.at(-1)?.high,2),minuteLow:round(one.at(-1)?.low,2),updatedAt:liveUpdatedAt,change24h:round(change24h,2),provider:'COINBASE',symbol:'BTC-USD'};btcCache.value=value;btcCache.expiresAt=Date.now()+10_000;return value;",
    'fresh BTC quote'
  );

  // 2) Keep server-side signal history and irreversible target-hit state.
  source=replaceRequired(
    source,
    "const btcAutoTradeState={signal:null,cooldownUntil:0};",
    "const btcAutoTradeState={signal:null,cooldownUntil:0,history:[]};\nfunction btcExecTouch(signal,raw,price,now){if(!signal)return;const hi=Math.max(Number(price)||-Infinity,Number(raw?.minuteHigh)||-Infinity),lo=Math.min(Number(price)||Infinity,Number(raw?.minuteLow)||Infinity),hit=t=>signal.side==='BUY'?hi>=Number(t):lo<=Number(t),stopped=signal.side==='BUY'?lo<=Number(signal.stopLoss):hi>=Number(signal.stopLoss);signal.targetHits=signal.targetHits||[false,false,false,false];[signal.target1,signal.target2,signal.target3,signal.target4].forEach((t,i)=>{if(Number.isFinite(Number(t))&&hit(t))signal.targetHits[i]=true});if(stopped&&!signal.targetHits[3])signal.result='STOP';if(signal.targetHits[3])signal.result='T4';signal.lastPrice=autoRound(price);signal.lastUpdate=new Date(now).toISOString();const row=btcAutoTradeState.history.find(x=>x.signalId===signal.signalId);if(row)Object.assign(row,{targetHits:[...signal.targetHits],result:signal.result||'OPEN',lastPrice:signal.lastPrice,lastUpdate:signal.lastUpdate});}"
    ,'BTC history state'
  );

  source=replaceRequired(
    source,
    "provider:String(raw.provider||'COINBASE'),reason:candidate==='WAIT'?",
    "provider:String(raw.provider||'COINBASE'),minuteHigh:autoRound(raw.minuteHigh),minuteLow:autoRound(raw.minuteLow),reason:candidate==='WAIT'?",
    'BTC minute extremes'
  );

  source=replaceRequired(
    source,
    ";btcAutoTradeState.signal=active;\n  }\n  if(active){",
    ";active.targetHits=[false,false,false,false];active.result='OPEN';btcAutoTradeState.signal=active;btcAutoTradeState.history.unshift({...active,targetHits:[false,false,false,false],result:'OPEN',lastPrice:base.price,lastUpdate:new Date(now).toISOString()});btcAutoTradeState.history=btcAutoTradeState.history.slice(0,100);\n  }\n  if(active){btcExecTouch(active,raw,price,now);",
    'record BTC signal'
  );

  const route="if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){try{const execute=url.searchParams.get('observe')!=='1',asset=String(url.searchParams.get('asset')||'XAUUSD').toUpperCase(),result=asset.startsWith('BTC')?await getBtcAutoTradeSignal(execute):await getAutoTradeSignal(execute);return sendJSON(res,200,result)}catch(error){return sendJSON(res,503,{error:'Auto-trade signal unavailable'})}}";
  source=replaceRequired(source,route,route+"\n    if(req.method==='GET'&&url.pathname==='/api/auto-trade/history'){const asset=String(url.searchParams.get('asset')||'BTCUSD').toUpperCase();return sendJSON(res,200,{asset,rows:asset.startsWith('BTC')?btcAutoTradeState.history:[]})}",'BTC history route');

  // 3) Target badges use candle extremes and stay marked once touched.
  const oldProgress="function renderBtcTargetProgress(signal){const targets=[signal.target1,signal.target2,signal.target3,signal.target4],durations=[signal.duration1,signal.duration2,signal.duration3,signal.duration4],hits=targets.map(t=>btcTargetReached(signal.state,signal.price,t)),next=hits.findIndex(x=>!x);for(let i=0;i<4;i++){const node=$('#btcEta'+(i+1));if(!node)continue;if(!signal.locked||targets[i]==null||!Number.isFinite(Number(targets[i]))){node.textContent='—';node.className='';continue}if(hits[i]){node.textContent='✓ تحقق';node.className='targetHit';continue}if(i===next){node.textContent=(durations[i]?'المدة: '+durations[i]+' • ':'')+'الهدف الحالي';node.className='targetCurrent'}else{node.textContent=i===3?'الامتداد الأخير للإشارة':'امتداد بعد الهدف '+i;node.className=''}}}";
  const newProgress="function renderBtcTargetProgress(signal){const targets=[signal.target1,signal.target2,signal.target3,signal.target4],durations=[signal.duration1,signal.duration2,signal.duration3,signal.duration4],key='btc-hit-'+String(signal.createdAt||signal.entry||'current'),stored=JSON.parse(localStorage.getItem(key)||'[false,false,false,false]'),hi=Math.max(Number(signal.price)||-Infinity,Number(signal.minuteHigh)||-Infinity),lo=Math.min(Number(signal.price)||Infinity,Number(signal.minuteLow)||Infinity),hits=targets.map((t,i)=>Boolean(stored[i])||(signal.state==='UP'?hi>=Number(t):signal.state==='DOWN'?lo<=Number(t):false));localStorage.setItem(key,JSON.stringify(hits));const next=hits.findIndex(x=>!x);for(let i=0;i<4;i++){const node=$('#btcEta'+(i+1));if(!node)continue;if(!signal.locked||targets[i]==null||!Number.isFinite(Number(targets[i]))){node.textContent='—';node.className='';continue}if(hits[i]){node.textContent='✓ تحقق';node.className='targetHit';continue}if(i===next){node.textContent=(durations[i]?'المدة: '+durations[i]+' • ':'')+'الهدف الحالي';node.className='targetCurrent'}else{node.textContent=i===3?'الامتداد الأخير للإشارة':'امتداد بعد الهدف '+i;node.className=''}}}";
  source=replaceRequired(source,oldProgress,newProgress,'persistent target progress');

  // 4) Visible automatic-trade table, refreshed from server every 10 seconds.
  const css=`\n.btcHistoryPanel{margin:14px 0;border:1px solid #594423;border-radius:18px;background:#0d121b;padding:14px}.btcHistoryPanel h2{margin:0 0 10px;color:#f3bf66;font-size:18px}.btcHistoryWrap{overflow:auto}.btcHistoryTable{width:100%;border-collapse:collapse;min-width:760px;font-size:11px}.btcHistoryTable th,.btcHistoryTable td{padding:9px 7px;border-bottom:1px solid #2b3340;text-align:center;white-space:nowrap}.btcHistoryTable th{color:#a99473}.btcHistoryTable td{color:#e8edf7}.btcHit{color:#52e5a5;font-weight:900}.btcMiss{color:#68717e}.btcSell{color:#ff718c}.btcBuy{color:#52e5a5}.btcHistoryNote{margin:9px 0 0;color:#96866f;font-size:10px}\n`;
  source=replaceRequired(source,'</style></head>',css+'</style></head>','history css');
  const historyHtml=`<article class="btcHistoryPanel"><h2>جدول صفقات BTC الآلية</h2><div class="btcHistoryWrap"><table class="btcHistoryTable"><thead><tr><th>الوقت</th><th>الاتجاه</th><th>الدخول</th><th>السعر</th><th>T1</th><th>T2</th><th>T3</th><th>T4</th><th>الحالة</th></tr></thead><tbody id="btcHistoryBody"><tr><td colspan="9">لا توجد صفقات مسجلة بعد</td></tr></tbody></table></div><p class="btcHistoryNote">السجل يتابع الإشارة الصادرة للتنفيذ والأهداف التي لمسها السعر. سعر تعبئة MT5 الفعلي قد يختلف قليلًا بسبب السبريد والانزلاق.</p></article>`;
  source=replaceRequired(source,'<article class="autoTradePanel">',historyHtml+'<article class="autoTradePanel">','history panel');

  const historyClient=`let btcHistoryLoading=false;\nasync function loadBtcTradeHistory(){if(btcHistoryLoading)return;btcHistoryLoading=true;try{const r=await fetch('/api/auto-trade/history?asset=BTCUSD',{cache:'no-store'}),d=await r.json(),rows=Array.isArray(d.rows)?d.rows:[],body=$('#btcHistoryBody');if(!body)return;if(!rows.length){body.innerHTML='<tr><td colspan="9">لا توجد صفقات مسجلة بعد</td></tr>';return}body.innerHTML=rows.slice(0,20).map(x=>{const hits=Array.isArray(x.targetHits)?x.targetHits:[false,false,false,false],side=x.side==='BUY'?'شراء':'بيع',cls=x.side==='BUY'?'btcBuy':'btcSell',tm=new Date(x.issuedAt||Date.now()).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}),money=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';return '<tr><td>'+tm+'</td><td class="'+cls+'">'+side+'</td><td>'+money(x.entry)+'</td><td>'+money(x.lastPrice)+'</td>'+hits.map(h=>'<td class="'+(h?'btcHit':'btcMiss')+'">'+(h?'✓':'—')+'</td>').join('')+'<td>'+(x.result||'OPEN')+'</td></tr>'}).join('')}catch(e){}finally{btcHistoryLoading=false}}\n`;
  source=replaceRequired(source,'let btcAutoTradeLoading=false;',historyClient+'let btcAutoTradeLoading=false;','history client');
  source=replaceRequired(source,'setInterval(loadBtcAutoTrade,5000);','setInterval(loadBtcAutoTrade,5000);\n  loadBtcTradeHistory();\n  setInterval(loadBtcTradeHistory,10000);','history refresh');

  for(const marker of ['minuteHigh:round(one.at(-1)?.high,2)','/api/auto-trade/history','جدول صفقات BTC الآلية','btcExecTouch'])if(!source.includes(marker))throw new Error('Platform hardening verification failed: '+marker);
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),source=harden(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args);
};

syncBuiltinESMExports();
await import('./btc-auto-ui-start.js');
