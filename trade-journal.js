export function renderTradeJournalPage() {
  return String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trade Journal — Gold Alpha</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#080b12;color:#eef2ff;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at top,#132036,#080b12 45%);min-height:100vh}
header{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px max(14px,4vw);background:#0b111ddd;border-bottom:1px solid #25334b;backdrop-filter:blur(12px)}
h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:#8ea0c0;font-size:12px}
a{color:inherit}.back{padding:9px 12px;border:1px solid #334155;border-radius:10px;text-decoration:none;font-weight:800;font-size:12px;background:#101827}
main{max-width:1180px;margin:auto;padding:18px}
.notice{padding:12px 14px;margin-bottom:12px;border:1px solid #5f502b;border-radius:13px;background:#17160f;color:#d9c98d;font-size:12px;line-height:1.7}
.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:12px}
.card,section{background:#0e1524;border:1px solid #243149;border-radius:16px;padding:14px}
.card span{display:block;color:#8ea0c0;font-size:11px}.card strong{display:block;margin-top:6px;font-size:22px;direction:ltr;text-align:right}
.good{color:#52e5a5!important}.bad{color:#ff718c!important}.warn{color:#ffd166!important}.muted{color:#8ea0c0!important}
.grid{display:grid;grid-template-columns:1.25fr .75fr;gap:10px;margin-bottom:12px}
h2{font-size:15px;margin:0 0 12px;color:#dbe7ff}.row{display:flex;gap:8px;align-items:end;flex-wrap:wrap}
label{display:grid;gap:5px;color:#8ea0c0;font-size:11px;flex:1;min-width:145px}
input,button{background:#111827;color:#fff;border:1px solid #334155;border-radius:10px;padding:10px 12px;font-weight:800}
button{cursor:pointer}.primary{background:#183427;border-color:#35664d}.secondary{background:#171d2a}
.small{font-size:11px;color:#8ea0c0;line-height:1.6;margin:9px 0 0}
.withdrawList{display:grid;gap:7px;max-height:190px;overflow:auto;margin-top:10px}
.withdrawItem{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;background:#111827;border-radius:9px;font-size:12px}
.tableWrap{overflow:auto;border:1px solid #243149;border-radius:12px}
table{width:100%;border-collapse:collapse;min-width:980px}
th,td{padding:10px 11px;border-bottom:1px solid #243149;text-align:right;white-space:nowrap;font-size:12px}
th{position:sticky;top:0;background:#101827;color:#8ea0c0;font-size:11px;z-index:1}
tbody tr:last-child td{border-bottom:0}.num{direction:ltr;text-align:left}.tag{display:inline-flex;padding:5px 8px;border-radius:999px;background:#131d31;font-weight:900}
.editBtn{padding:6px 8px;font-size:10px}.empty{text-align:center!important;color:#8ea0c0!important;padding:26px!important}
.footerMeta{margin-top:10px;color:#8ea0c0;font-size:11px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
@media(max-width:980px){.cards{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}}
@media(max-width:620px){.cards{grid-template-columns:repeat(2,1fr)}main{padding:12px}header{padding:12px}h1{font-size:18px}.card strong{font-size:19px}}
</style>
</head>
<body>
<header>
  <div><h1>Trade Journal — XAUUSD</h1><p>رأس المال المرجعي $100 • الربح فوقه قابل للسحب يوميًا</p></div>
  <a class="back" href="/">← الذهب</a>
</header>
<main>
  <div class="notice">هذا Journal يقيس صفقات إشارات الموقع. الربح النقدي يُقدّر حسب اللوت الموصى به (أو 0.01 إذا لم يكن محفوظًا)، لذلك قد يختلف عن كشف الوسيط بسبب السبريد والانزلاق أو اختلاف حجم اللوت. يمكن تعديل P/L لأي صفقة بالقيمة الفعلية من Exness.</div>

  <div class="cards">
    <div class="card"><span>Base Capital</span><strong>$100.00</strong></div>
    <div class="card"><span>Journal Balance</span><strong id="balance">$100.00</strong></div>
    <div class="card"><span>Today's P/L</span><strong id="todayPnl">$0.00</strong></div>
    <div class="card"><span>Withdrawable Now</span><strong id="withdrawable">$0.00</strong></div>
    <div class="card"><span>Total Withdrawn</span><strong id="totalWithdrawn">$0.00</strong></div>
    <div class="card"><span>Win Rate / PF</span><strong id="quality">—</strong></div>
  </div>

  <div class="grid">
    <section>
      <h2>Daily Profit Withdrawal</h2>
      <div class="row">
        <label>المبلغ بالدولار<input id="withdrawAmount" inputmode="decimal" type="number" min="0" step="0.01" placeholder="10.00"></label>
        <label>التاريخ<input id="withdrawDate" type="date"></label>
        <button id="recordWithdrawal" class="primary">تسجيل السحب</button>
        <button id="withdrawAll" class="secondary">سحب كل الربح</button>
      </div>
      <p id="withdrawMessage" class="small">لن يسمح الـJournal باعتبار رأس المال الأساسي $100 ضمن الأرباح القابلة للسحب.</p>
    </section>
    <section>
      <h2>Withdrawals</h2>
      <div id="withdrawList" class="withdrawList"><div class="muted small">لا توجد سحوبات مسجلة.</div></div>
    </section>
  </div>

  <section>
    <h2>Closed Trades</h2>
    <div class="tableWrap">
      <table>
        <thead><tr><th>الإغلاق</th><th>Side</th><th>Strategy</th><th>Entry</th><th>Exit</th><th>Lot</th><th>Outcome</th><th>Result</th><th>P/L USD</th><th>Actual P/L</th></tr></thead>
        <tbody id="tradeBody"><tr><td colspan="10" class="empty">جارٍ مزامنة الصفقات…</td></tr></tbody>
      </table>
    </div>
    <div class="footerMeta"><span id="syncMeta">لم تتم المزامنة بعد</span><span id="tradeCount">0 closed trades</span></div>
  </section>
</main>

<script>
(function(){
  'use strict';
  var BASE_CAPITAL=100;
  var CONTRACT_SIZE=100;
  var TRADE_KEY='goldTradeJournalClosedV1';
  var WITHDRAW_KEY='goldTradeJournalWithdrawalsV1';
  var OVERRIDE_KEY='goldTradeJournalOverridesV1';
  var lastWithdrawable=0;

  function read(key,fallback){try{var x=JSON.parse(localStorage.getItem(key)||'null');return x==null?fallback:x}catch(e){return fallback}}
  function write(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch(e){}}
  function num(v){var x=Number(v);return Number.isFinite(x)?x:null}
  function money(v){var x=num(v);return x==null?'—':'$'+x.toFixed(2)}
  function signedMoney(v){var x=num(v)||0;return (x>0?'+':'')+'$'+x.toFixed(2)}
  function px(v){var x=num(v);return x==null?'—':x.toFixed(2)}
  function when(v){if(!v)return'—';try{return new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch(e){return String(v)}}
  function dayKey(v){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}catch(e){return new Date(v).toISOString().slice(0,10)}}
  function todayKey(){return dayKey(new Date())}
  function tradeId(t){return String(t.setupId||'')+'|'+String(t.issuedAt||t.issuedAtMs||'')+'|'+String(t.side||'')+'|'+String(t.triggerPrice||t.entry||'')+'|'+String(t.closedAt||t.closedAtMs||'')}
  function tradeLot(t){var lot=num(t&&t.lotSizing&&t.lotSizing.recommendedLot);return lot!=null&&lot>0?lot:0.01}
  function estimatedPnl(t){var move=num(t.realizedUsd);if(move==null)return 0;return move*CONTRACT_SIZE*tradeLot(t)}
  function pnlFor(t,overrides){var id=tradeId(t),override=num(overrides[id]);return override==null?estimatedPnl(t):override}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function cssPnl(v){return Number(v)>0?'good':Number(v)<0?'bad':'muted'}
  function getTrades(){var rows=read(TRADE_KEY,[]);return Array.isArray(rows)?rows:[]}
  function getWithdrawals(){var rows=read(WITHDRAW_KEY,[]);return Array.isArray(rows)?rows:[]}
  function getOverrides(){var x=read(OVERRIDE_KEY,{});return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}

  function mergeTrades(incoming){
    var map=new Map();
    getTrades().forEach(function(t){map.set(tradeId(t),t)});
    incoming.forEach(function(t){if(t&&t.status==='CLOSED')map.set(tradeId(t),Object.assign({},map.get(tradeId(t))||{},t))});
    var rows=Array.from(map.values()).sort(function(a,b){return Number(b.closedAtMs||new Date(b.closedAt||0).getTime())-Number(a.closedAtMs||new Date(a.closedAt||0).getTime())}).slice(0,1000);
    write(TRADE_KEY,rows);
    return rows;
  }

  function render(){
    var trades=getTrades(),withdrawals=getWithdrawals(),overrides=getOverrides();
    var totalPnl=trades.reduce(function(s,t){return s+pnlFor(t,overrides)},0);
    var totalWithdrawn=withdrawals.reduce(function(s,w){return s+(num(w.amount)||0)},0);
    var balance=BASE_CAPITAL+totalPnl-totalWithdrawn;
    lastWithdrawable=Math.max(0,balance-BASE_CAPITAL);
    var today=todayKey(),todayPnl=trades.filter(function(t){return dayKey(t.closedAt||t.closedAtMs)===today}).reduce(function(s,t){return s+pnlFor(t,overrides)},0);
    var wins=trades.filter(function(t){return t.result==='WIN'}).length;
    var grossWin=trades.reduce(function(s,t){var p=pnlFor(t,overrides);return s+(p>0?p:0)},0);
    var grossLoss=Math.abs(trades.reduce(function(s,t){var p=pnlFor(t,overrides);return s+(p<0?p:0)},0));
    var winRate=trades.length?wins/trades.length*100:null;
    var pf=grossLoss>0?grossWin/grossLoss:(grossWin>0?Infinity:null);

    var balanceEl=document.getElementById('balance');balanceEl.textContent=money(balance);balanceEl.className=cssPnl(balance-BASE_CAPITAL);
    var todayEl=document.getElementById('todayPnl');todayEl.textContent=signedMoney(todayPnl);todayEl.className=cssPnl(todayPnl);
    var wdEl=document.getElementById('withdrawable');wdEl.textContent=money(lastWithdrawable);wdEl.className=lastWithdrawable>0?'good':'muted';
    document.getElementById('totalWithdrawn').textContent=money(totalWithdrawn);
    document.getElementById('quality').textContent=winRate==null?'—':winRate.toFixed(0)+'% / '+(pf===Infinity?'∞':pf==null?'—':pf.toFixed(2));
    document.getElementById('tradeCount').textContent=trades.length+' closed trades';

    var body=document.getElementById('tradeBody');
    if(!trades.length){body.innerHTML='<tr><td colspan="10" class="empty">لا توجد صفقة مغلقة بعد. ستظهر تلقائيًا عندما يغلق محرك الذهب صفقة.</td></tr>'}
    else body.innerHTML=trades.map(function(t){
      var p=pnlFor(t,overrides),id=tradeId(t),hasOverride=num(overrides[id])!=null;
      var strategy=t.tradeStyle||t.strategy||'CONFLUENCE';
      return '<tr>'+
        '<td>'+esc(when(t.closedAt||t.closedAtMs))+'</td>'+
        '<td class="'+(t.side==='BUY'?'good':'bad')+'"><b>'+esc(t.side||'—')+'</b></td>'+
        '<td>'+esc(strategy)+'</td>'+
        '<td class="num">'+esc(px(t.triggerPrice!=null?t.triggerPrice:t.entry))+'</td>'+
        '<td class="num">'+esc(px(t.exitPrice))+'</td>'+
        '<td class="num">'+esc(tradeLot(t).toFixed(2))+'</td>'+
        '<td><span class="tag">'+esc(t.outcome||'—')+'</span></td>'+
        '<td class="'+(t.result==='WIN'?'good':t.result==='LOSS'?'bad':'warn')+'"><b>'+esc(t.result||'—')+'</b></td>'+
        '<td class="num '+cssPnl(p)+'"><b>'+esc(signedMoney(p))+'</b>'+(hasOverride?' *':'')+'</td>'+
        '<td><button class="editBtn secondary" data-id="'+encodeURIComponent(id)+'">'+(hasOverride?'تعديل':'إدخال')+'</button></td>'+
      '</tr>';
    }).join('');

    var list=document.getElementById('withdrawList');
    var sorted=withdrawals.slice().sort(function(a,b){return String(b.date).localeCompare(String(a.date))});
    list.innerHTML=sorted.length?sorted.slice(0,20).map(function(w){return '<div class="withdrawItem"><span>'+esc(w.date)+'</span><b class="good">'+esc(money(w.amount))+'</b></div>'}).join(''):'<div class="muted small">لا توجد سحوبات مسجلة.</div>';

    document.querySelectorAll('.editBtn').forEach(function(btn){btn.onclick=function(){
      var id=decodeURIComponent(btn.getAttribute('data-id')),current=getOverrides(),existing=num(current[id]);
      var value=prompt('أدخل P/L الفعلي من الوسيط بالدولار. اتركه فارغًا للعودة للتقدير.',existing==null?'':String(existing));
      if(value===null)return;
      if(String(value).trim()===''){delete current[id];write(OVERRIDE_KEY,current);render();return}
      var n=num(value);if(n==null){alert('قيمة غير صحيحة');return}
      current[id]=Number(n.toFixed(2));write(OVERRIDE_KEY,current);render();
    }});
  }

  async function sync(){
    try{
      var r=await fetch('/api/performance/journal',{cache:'no-store'}),d=await r.json();
      if(!r.ok||!d||!Array.isArray(d.trades))throw new Error(d&&d.error?d.error:'journal unavailable');
      mergeTrades(d.trades);
      document.getElementById('syncMeta').textContent='آخر مزامنة: '+new Date().toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',second:'2-digit'});
      render();
    }catch(e){
      document.getElementById('syncMeta').textContent='تعذر مزامنة المحرك الآن — أعرض السجل المحلي';
      render();
    }
  }

  function addWithdrawal(amount,date){
    var value=num(amount);
    if(value==null||value<=0){document.getElementById('withdrawMessage').textContent='أدخل مبلغ سحب صحيح.';return}
    if(value>lastWithdrawable+0.005){document.getElementById('withdrawMessage').textContent='المبلغ يتجاوز الربح القابل للسحب حاليًا ('+money(lastWithdrawable)+').';return}
    var rows=getWithdrawals();
    rows.push({id:String(Date.now()),amount:Number(value.toFixed(2)),date:date||todayKey(),createdAt:new Date().toISOString()});
    write(WITHDRAW_KEY,rows);
    document.getElementById('withdrawAmount').value='';
    document.getElementById('withdrawMessage').textContent='تم تسجيل السحب. رأس المال المرجعي يبقى $100.';
    render();
  }

  document.getElementById('withdrawDate').value=todayKey();
  document.getElementById('recordWithdrawal').onclick=function(){addWithdrawal(document.getElementById('withdrawAmount').value,document.getElementById('withdrawDate').value)};
  document.getElementById('withdrawAll').onclick=function(){if(lastWithdrawable<=0){document.getElementById('withdrawMessage').textContent='لا يوجد ربح فوق $100 قابل للسحب الآن.';return}addWithdrawal(lastWithdrawable,document.getElementById('withdrawDate').value)};
  render();
  sync();
  setInterval(sync,10000);
})();
</script>
</body>
</html>`;
}
