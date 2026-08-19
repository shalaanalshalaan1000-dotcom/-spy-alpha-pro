import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalReadFileSync=fs.readFileSync.bind(fs);
fs.readFileSync=function(path,...args){
  const out=originalReadFileSync(path,...args);
  const name=String(path?.pathname||path||'');
  const encoding=typeof args[0]==='string'?args[0]:args[0]?.encoding;
  if(!name.endsWith('/server.js')&&!name.endsWith('server.js'))return out;
  if(encoding!=='utf8'&&encoding!=='utf-8')return out;
  let source=String(out);

  const setChainTail="  renderOptionChain();\n}\nasync function loadConfig(){";
  const setChainTracked="  renderOptionChain();\n  trackSavedContracts($('#chainSymbol').textContent,allContracts);\n  renderTrackedHistory();\n}\nasync function loadConfig(){";
  if(!source.includes(setChainTail))throw new Error('Tracking option-chain anchor missing');
  source=source.replace(setChainTail,setChainTracked);

  const loadConfigAnchor='async function loadConfig(){';
  const trackingFunctions=`function trackingPct(v){return Number.isFinite(Number(v))?((Number(v)>0?'+':'')+Number(v).toFixed(1)+'%'):'—'}
function trackingStatusLabel(v){return({OPEN:'مفتوح',TARGET:'وصل الهدف',STOP:'ضرب الوقف',EXPIRED:'منتهي'}[v]||'مفتوح')}
function trackingStatusClass(v){return v==='TARGET'?'positive':v==='STOP'?'negative':v==='OPEN'?'WATCH':'muted'}
function trackSavedContracts(underlying,items){
  if(typeof readContractHistory!=='function'||typeof writeContractHistory!=='function')return;
  const rows=readContractHistory(),contracts=Array.isArray(items)?items:[],today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());let changed=false;
  for(const row of rows){
    if(row.underlying!==underlying)continue;
    if(!['TARGET','STOP','EXPIRED'].includes(row.status)&&row.expiry&&row.expiry<today){row.status='EXPIRED';row.closedAt=row.closedAt||new Date().toISOString();changed=true;continue}
    const live=contracts.find(c=>c.symbol===row.contractSymbol),mid=Number(live?.mid),entry=Number(row.entry);
    if(!Number.isFinite(mid)||mid<=0||!Number.isFinite(entry)||entry<=0)continue;
    const p=(mid-entry)/entry*100,now=new Date().toISOString();
    row.currentPrice=Number(mid.toFixed(3));row.currentPct=Number(p.toFixed(2));row.lastTrackedAt=now;
    row.maxProfitPct=Number.isFinite(Number(row.maxProfitPct))?Math.max(Number(row.maxProfitPct),p):p;
    row.maxLossPct=Number.isFinite(Number(row.maxLossPct))?Math.min(Number(row.maxLossPct),p):p;
    if(!['TARGET','STOP','EXPIRED'].includes(row.status)){
      if(Number.isFinite(Number(row.target))&&mid>=Number(row.target)){row.status='TARGET';row.closedAt=now;row.resultPct=Number(p.toFixed(2))}
      else if(Number.isFinite(Number(row.stop))&&mid<=Number(row.stop)){row.status='STOP';row.closedAt=now;row.resultPct=Number(p.toFixed(2))}
      else row.status='OPEN';
    }
    changed=true;
  }
  if(changed)writeContractHistory(rows);
}
function renderTrackedHistory(){
  if(typeof readContractHistory!=='function')return;
  const card=$('#contractHistoryCard'),body=$('#contractHistoryBody');if(!card||!body)return;
  const head=card.querySelector('thead');if(head)head.innerHTML='<tr><th>الوقت</th><th>الرمز</th><th>الاتجاه</th><th>العقد</th><th class="num">الدخول</th><th class="num">الحالي</th><th class="num">الآن %</th><th class="num">أعلى ربح</th><th class="num">أسوأ تراجع</th><th>الحالة</th><th class="num">الثقة</th></tr>';
  const rows=readContractHistory();
  if(!rows.length){body.innerHTML='<tr><td colspan="11" class="loadingRow">لا توجد عقود مسجلة بعد</td></tr>';return}
  body.innerHTML=rows.map(x=>'<tr><td>'+contractHistoryTime(x.firstSeenAt)+'</td><td><b>'+x.underlying+'</b></td><td class="'+(x.direction==='CALL'?'CALL':'PUT')+'"><b>'+x.direction+'</b></td><td class="contractCode">'+x.contractSymbol+'</td><td class="num">'+money(x.entry)+'</td><td class="num">'+money(x.currentPrice)+'</td><td class="num '+((x.currentPct||0)>=0?'positive':'negative')+'">'+trackingPct(x.currentPct)+'</td><td class="num positive">'+trackingPct(x.maxProfitPct)+'</td><td class="num negative">'+trackingPct(x.maxLossPct)+'</td><td class="'+trackingStatusClass(x.status)+'"><b>'+trackingStatusLabel(x.status)+'</b></td><td class="num">'+x.confidence+'%</td></tr>').join('');
}
`;
  if(!source.includes(loadConfigAnchor))throw new Error('Tracking loadConfig anchor missing');
  source=source.replace(loadConfigAnchor,trackingFunctions+loadConfigAnchor);

  const analyzeStart="async function analyze(){\n  const s=$('#symbol').value,seq=++analysisSeq;";
  const analyzeTracked="async function analyze(){\n  const s=$('#symbol').value,seq=++analysisSeq;\n  renderTrackedHistory();";
  if(!source.includes(analyzeStart))throw new Error('Tracking analyze anchor missing');
  source=source.replace(analyzeStart,analyzeTracked);
  return source;
};
syncBuiltinESMExports();
await import('./start.js');
