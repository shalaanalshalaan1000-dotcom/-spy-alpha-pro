import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function replaceRequired(source,from,to,label){
  if(!source.includes(from))throw new Error('Gold-only patch anchor missing: '+label);
  return source.replace(from,to);
}

function applyGoldOnlyPatch(source){
  source=replaceRequired(source,
    "const STOCK_WATCHLIST = ['SPY','QQQ','IWM','NVDA','AAPL','MSFT','AMZN','META','GOOGL','TSLA','AMD','AVGO'];",
    "const STOCK_WATCHLIST = [];",
    'stock watchlist'
  );
  source=replaceRequired(source,
    "const WATCHLIST = [...STOCK_WATCHLIST,'SPX'];",
    "const WATCHLIST = [];",
    'watchlist'
  );

  source=source.replace('<title>SPY Alpha Pro V4</title>','<title>Gold Alpha Pro — XAUUSD</title>');
  source=source.replace('<h1>SPY Alpha Pro V4</h1><p>XAUUSD FOCUS • LEADERS • SPX 0DTE • AUTO OPTIONS RADAR</p>','<h1>Gold Alpha Pro</h1><p>XAUUSD ONLY • SPOT GOLD • LIVE FOCUS</p>');
  source=source.replace('SPOT • NO OPTIONS','XAUUSD • GOLD ONLY');

  const goldStart=source.indexOf('<article class="goldPanel">');
  if(goldStart<0)throw new Error('Gold-only patch anchor missing: gold panel');
  const goldEnd=source.indexOf('</article>',goldStart);
  if(goldEnd<0)throw new Error('Gold-only patch anchor missing: gold panel end');
  const mainEnd=source.indexOf('</main>',goldEnd);
  if(mainEnd<0)throw new Error('Gold-only patch anchor missing: main end');
  source=source.slice(0,goldEnd+10)+source.slice(mainEnd);

  source=replaceRequired(source,
    "async function loadConfig(){cfg=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json()); $('#mode').textContent=cfg.mode+' / '+cfg.provider; $('#symbol').innerHTML=cfg.watchlist.map(s=>'<option value=\"'+s+'\">'+(s==='SPX'?'SPX • 0DTE مستقل':s)+'</option>').join(''); $('#logout').hidden=!cfg.user;}",
    "async function loadConfig(){cfg=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json()); $('#mode').textContent=cfg.mode+' / '+cfg.provider;}",
    'load config'
  );

  source=replaceRequired(source,
    "$('#refresh').onclick=()=>{analyze();loadScan(true)};\n$('#scanRefresh').onclick=()=>loadScan(true);\n$('#specRefresh').onclick=()=>loadSpeculative(true);\n$('#goldRefresh').onclick=loadGold;\n$('#symbol').onchange=analyze;\n$('#scanBody').onclick=e=>{const row=e.target.closest('tr[data-symbol]');if(row)selectSymbol(row.dataset.symbol)};\n$('#specBody').onclick=e=>{const row=e.target.closest('tr[data-symbol]');if(row)selectSymbol(row.dataset.symbol)};\n$('#chainType').onchange=renderOptionChain;\n$('#chainExpiry').onchange=renderOptionChain;\n(async()=>{\n  goldSamples=restoreGoldSamples();\n  await loadConfig();\n  renderGoldChart();\n  await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);\n  setInterval(()=>{if($('#auto').checked)analyze()},30000);\n  setInterval(()=>{if($('#auto').checked)loadScan()},60000);\n  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);\n  setInterval(()=>{if($('#auto').checked)loadGold()},30000);\n})();",
    "$('#goldRefresh').onclick=loadGold;\n(async()=>{\n  goldSamples=restoreGoldSamples();\n  await loadConfig();\n  renderGoldChart();\n  await loadGold();\n  setInterval(loadGold,30000);\n})();",
    'gold-only startup'
  );

  source=replaceRequired(source,
    "async function analysisSymbolAllowed(symbol){\n  if(WATCHLIST.includes(symbol))return true;\n  if(!process.env.MASSIVE_API_KEY)return false;\n  const scan=await fetchSpeculativeScan();\n  return(scan.items||[]).some(x=>x.symbol===symbol&&x.optionsVerified===true);\n}",
    "async function analysisSymbolAllowed(){return false;}",
    'disable stock analysis'
  );

  source=replaceRequired(source,
    "if(req.method==='GET'&&url.pathname==='/api/config')return sendJSON(res,200,{watchlist:WATCHLIST,minConfidence:Number(process.env.MIN_CONFIDENCE||70),user:session?.email||null,...currentMode()});",
    "if(req.method==='GET'&&url.pathname==='/api/config')return sendJSON(res,200,{watchlist:[],asset:'XAUUSD',goldOnly:true,user:session?.email||null,...currentMode()});",
    'gold-only config'
  );

  source=replaceRequired(source,
    "    if(req.method==='GET'&&url.pathname==='/api/scan'){\n      const result=await fetchMarketScan(url.searchParams.get('force')==='1');\n      return sendJSON(res,200,result);\n    }\n    if(req.method==='GET'&&url.pathname==='/api/speculative'){\n      const result=await fetchSpeculativeScan(url.searchParams.get('force')==='1');\n      return sendJSON(res,200,result);\n    }",
    "    if(req.method==='GET'&&(url.pathname==='/api/scan'||url.pathname==='/api/speculative'))return sendJSON(res,410,{error:'Stock scanners disabled — XAUUSD only'});",
    'disable stock scanner routes'
  );

  source=replaceRequired(source,
    "server.listen(PORT,'0.0.0.0',()=>{console.log('SPY Alpha Pro V4 listening on '+PORT+' — '+currentMode().provider);startTelegramWorker()});",
    "server.listen(PORT,'0.0.0.0',()=>{console.log('Gold Alpha Pro listening on '+PORT+' — XAUUSD only')});",
    'disable stock telegram worker'
  );

  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string')data=applyGoldOnlyPatch(data);
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./gold-start.js');
