import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./server.js',import.meta.url);
const runtimePath=new URL('./.runtime-server.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

// Gold-only UI without strict patch anchors: every replacement is optional.
source=source.replace('<title>SPY Alpha Pro V4</title>','<title>Gold Alpha Pro — XAUUSD</title>');
source=source.replace('<h1>SPY Alpha Pro V4</h1><p>XAUUSD FOCUS • LEADERS • SPX 0DTE • AUTO OPTIONS RADAR</p>','<h1>Gold Alpha Pro</h1><p>XAUUSD ONLY • GOLD INTELLIGENCE TERMINAL</p>');
source=source.replace('<span class="goldTag">SPOT • NO OPTIONS</span>','<span class="goldTag">XAUUSD • GOLD ONLY</span>');

const css=`
/* Stable gold-only shell */
.toolbar,.hero,.grid,.chartCard,.scanner,.specScanner,.chain,.instrumentPolicy{display:none!important}
main{max-width:1280px;padding:18px}.goldPanel{border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important}
.goldHead{padding:18px 20px;border:1px solid #544725;border-radius:18px;background:linear-gradient(145deg,#17160f,#0c121c)}
.goldPlan{border-color:#625329;background:linear-gradient(145deg,#17170f,#0c121c);border-radius:18px;padding:16px}
.goldChartWrap{height:520px;border:1px solid #282d38;border-radius:18px}
@media(max-width:900px){.goldMetrics{grid-template-columns:repeat(2,1fr)}.goldPlanGrid{grid-template-columns:repeat(2,1fr)}.goldChartWrap{height:430px}}
`;
source=source.replace('</style></head>',css+'</style></head>');

// Stop stock/options polling in the browser when the known startup block is present.
const stockStartup="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);\n  setInterval(()=>{if($('#auto').checked)analyze()},30000);\n  setInterval(()=>{if($('#auto').checked)loadScan()},60000);\n  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);\n  setInterval(()=>{if($('#auto').checked)loadGold()},30000);";
const goldStartup="await loadGold();\n  setInterval(loadGold,30000);";
source=source.replace(stockStartup,goldStartup);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
