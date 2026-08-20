import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);
const replaceIfPresent=(s,a,b)=>s.includes(a)?s.replace(a,b):s;

function applyGoldPaperMode(source){
  const css=`\n/* Paper trading */\n.paperPanel{margin:12px 0;padding:16px;border:1px solid #3c4b63;border-radius:18px;background:linear-gradient(145deg,#101722,#0b1018)}.paperHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.paperHead h3{margin:0;color:#dbe7fb}.paperBadge{padding:6px 10px;border-radius:999px;border:1px solid #45618a;color:#9fc4ff;background:#10213a;font-size:11px;font-weight:900}.paperGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.paperCell{padding:11px;border:1px solid #29364a;border-radius:12px;background:#0c131d}.paperCell span{display:block;color:#8290a6;font-size:11px}.paperCell strong{display:block;margin-top:5px;font-size:14px}.paperTrade{margin-top:10px;padding:11px;border:1px solid #2d394c;border-radius:12px;color:#aab7ca;font-size:12px;line-height:1.7}.paperActions{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}.paperActions button{font-size:11px;padding:8px 10px}.paperHistory{margin-top:10px;display:grid;gap:6px}.paperRow{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid #253044;border-radius:10px;font-size:11px}.paperWin{color:#75e8b2}.paperLoss{color:#ff8798}@media(max-width:800px){.paperGrid{grid-template-columns:repeat(2,1fr)}}\n`;
  source=replaceIfPresent(source,'</style></head>',css+'</style></head>');

  const chartAnchor='<div id="goldChart" class="goldChartWrap"></div>';
  if(source.includes(chartAnchor)){
    const panel=`<section class="paperPanel"><div class="paperHead"><h3>المحفظة التجريبية — Paper Trading</h3><span class="paperBadge">SIMULATION ONLY</span></div><div class="paperGrid"><div class="paperCell"><span>الرصيد الافتراضي</span><strong id="paperBalance">$10,000.00</strong></div><div class="paperCell"><span>النتيجة</span><strong id="paperPnl">$0.00</strong></div><div class="paperCell"><span>الصفقات</span><strong id="paperTrades">0</strong></div><div class="paperCell"><span>Win Rate</span><strong id="paperWinRate">—</strong></div><div class="paperCell"><span>المخاطرة</span><strong>1% / صفقة</strong></div></div><div id="paperTrade" class="paperTrade">لا توجد صفقة افتراضية مفتوحة.</div><div class="paperActions"><button id="paperReset">إعادة المحفظة</button></div><div id="paperHistory" class="paperHistory"></div></section>`;
    source=source.replace(chartAnchor,panel+chartAnchor);
  }

  const frontendAnchor="$('#goldRefresh').onclick=loadGold;";
  if(source.includes(frontendAnchor)){
    const frontend=`const PAPER_KEY='gold_alpha_paper_v1';\nfunction paperDefault(){return{initialBalance:10000,balance:10000,open:null,history:[]}}\nfunction loadPaper(){try{const x=JSON.parse(localStorage.getItem(PAPER_KEY)||'null');return x&&Number.isFinite(Number(x.balance))?x:paperDefault()}catch{return paperDefault()}}\nfunction savePaper(){try{localStorage.setItem(PAPER_KEY,JSON.stringify(paperState))}catch{}}\nlet paperState=loadPaper();\nconst paperMoney=v=>'$'+Number(v||0).toFixed(2);\nfunction renderPaper(){const h=Array.isArray(paperState.history)?paperState.history:[],wins=h.filter(x=>x.pnl>0).length,pnl=Number(paperState.balance)-Number(paperState.initialBalance||10000);$('#paperBalance').textContent=paperMoney(paperState.balance);$('#paperPnl').textContent=(pnl>=0?'+':'')+paperMoney(pnl);$('#paperPnl').className=pnl>0?'positive':pnl<0?'negative':'';$('#paperTrades').textContent=String(h.length);$('#paperWinRate').textContent=h.length?Math.round(wins/h.length*100)+'%':'—';const o=paperState.open;if(o){$('#paperTrade').innerHTML='<b>'+(o.side==='BUY'?'BUY 🟢':'SELL 🔴')+'</b> • دخول '+paperMoney(o.entry)+' • TP '+paperMoney(o.target)+' • SL '+paperMoney(o.stop)+' • مخاطرة '+paperMoney(o.riskUsd)}else $('#paperTrade').textContent='لا توجد صفقة افتراضية مفتوحة.';$('#paperHistory').innerHTML=h.slice(-5).reverse().map(x=>'<div class="paperRow '+(x.pnl>=0?'paperWin':'paperLoss')+'"><span>'+x.side+' • '+x.result+'</span><strong>'+(x.pnl>=0?'+':'')+paperMoney(x.pnl)+'</strong></div>').join('')}\nfunction openPaperTrade(d){if(paperState.open||!d?.plan||!['UP','DOWN'].includes(d.plan.state)||d.plan.entryStatus!=='ENTER_NOW'||goldMacroRisk==='HIGH')return;const entry=Number(d.plan.entry),target=Number(d.plan.target1),stop=Number(d.plan.invalidation);if(![entry,target,stop].every(Number.isFinite))return;const stopDistance=Math.abs(entry-stop);if(stopDistance<=0)return;const riskUsd=Math.max(1,Number(paperState.balance)*.01),units=riskUsd/stopDistance;paperState.open={side:d.plan.state==='UP'?'BUY':'SELL',entry,target,stop,units,riskUsd,openedAt:new Date().toISOString()};savePaper();renderPaper()}\nfunction updatePaperTrade(d){const o=paperState.open,price=Number(d?.price);if(!o||!Number.isFinite(price))return;let result=null,exit=price;if(o.side==='BUY'){if(price>=o.target){result='TP1';exit=o.target}else if(price<=o.stop){result='SL';exit=o.stop}}else{if(price<=o.target){result='TP1';exit=o.target}else if(price>=o.stop){result='SL';exit=o.stop}}if(!result)return;const pnl=(o.side==='BUY'?exit-o.entry:o.entry-exit)*o.units;paperState.balance=Math.max(0,Number(paperState.balance)+pnl);paperState.history=[...(paperState.history||[]),{...o,result,exit,pnl,closedAt:new Date().toISOString()}].slice(-100);paperState.open=null;savePaper();renderPaper()}\nfunction evaluatePaperTrade(d){updatePaperTrade(d);openPaperTrade(d);renderPaper()}\n$('#paperReset').onclick=()=>{if(confirm('إعادة المحفظة الافتراضية إلى $10,000 وحذف سجل التجربة؟')){paperState=paperDefault();savePaper();renderPaper()}};\nrenderPaper();\n`;
    source=source.replace(frontendAnchor,frontend+frontendAnchor);
  }

  source=replaceIfPresent(source,'renderGoldPlan(d.plan);','renderGoldPlan(d.plan);evaluatePaperTrade(d);');
  source=replaceIfPresent(source,'<h1>Gold Alpha Pro</h1>','<h1>Gold Alpha Pro <span style="font-size:11px;color:#9fc4ff">PAPER</span></h1>');
  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string')data=applyGoldPaperMode(data);
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./gold-server-start.js');
