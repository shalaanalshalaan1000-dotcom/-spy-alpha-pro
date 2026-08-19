import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./start.js',import.meta.url);
const runtimePath=new URL('./.runtime-start-safe.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

const launchAnchor="writeFileSync(runtimePath,source,'utf8');";
if(!source.includes(launchAnchor))throw new Error('start.js launch anchor missing');

const safetyPatch=String.raw`
// HARD ENTRY GATE + SAFER CONTRACT SELECTION (injected after all existing start.js patches).
const finalAnalyzeOld="function analyze(snapshot,settings={}){return alignFinalContract(snapshot,analyzeBase(snapshot,settings))}";
if(!source.includes(finalAnalyzeOld))throw new Error('Safe-entry final analyze anchor missing');

const alignChooseOld="const raw=chooseContract(snapshot.options||[],dir,spot,snapshot.symbol);";
const alignChooseNew="const raw=safeChooseContract(snapshot.options||[],dir,spot,snapshot.symbol);";
if(!source.includes(alignChooseOld))throw new Error('Safe contract chooser anchor missing');
source=source.replace(alignChooseOld,alignChooseNew);

const safeEngine=\`function safeChooseContract(chain,direction,spot,symbol){
  if(!chain?.length||!['CALL','PUT'].includes(direction))return null;
  if(symbol==='SPX')return chooseContract(chain,direction,spot,symbol);
  const type=direction==='CALL'?'call':'put';
  const candidates=chain.filter(o=>{
    if(o.type!==type||!(optionPrice(o)>0))return false;
    const sp=spreadPct(o),dte=Number(o.daysToExpiry??99),distance=Math.abs(Number(o.strike)-spot)/spot;
    if(sp!=null&&sp>10)return false;
    if(dte<5||dte>45)return false;
    if(distance>0.03)return false;
    if(direction==='CALL'&&Number(o.strike)<spot*.995)return false;
    if(direction==='PUT'&&Number(o.strike)>spot*1.005)return false;
    const d=Math.abs(Number(o.delta));
    if(Number.isFinite(d)&&d>0&&(d<.25||d>.60))return false;
    if(Number(o.openInterest||0)<100)return false;
    return true;
  });
  if(!candidates.length)return null;
  const quality=o=>{
    const distance=Math.abs(Number(o.strike)-spot)/spot*100,sp=spreadPct(o),dte=Number(o.daysToExpiry??99),d=Math.abs(Number(o.delta)),oi=Number(o.openInterest||0),vol=Number(o.volume||0);
    let s=0;
    s+=Math.max(0,42-distance*14);
    if(Number.isFinite(d)&&d>0)s+=Math.max(0,24-Math.abs(d-.40)*80);else s+=4;
    if(sp!=null)s+=Math.max(0,18-sp*1.8);else s+=2;
    if(dte>=14&&dte<=30)s+=18;else s+=8;
    if(oi>=2000)s+=12;else if(oi>=750)s+=9;else if(oi>=200)s+=5;
    if(vol>=1000)s+=8;else if(vol>=250)s+=6;else if(vol>=50)s+=3;
    return s;
  };
  return candidates.sort((a,b)=>quality(b)-quality(a))[0];
}
function entryGate(snapshot,result){
  if(!result||!['CALL','PUT'].includes(result.direction))return{gate:false,label:'لا يوجد اتجاه قابل للتنفيذ'};
  const dir=result.direction,spot=Number(result.spot),atr=Number(result.indicators?.atr14)||spot*.02,vw=Number(result.indicators?.vwap),p=result.pivots||{},bars=(snapshot.intraday||[]).slice(-4),last=bars.at(-1);
  if(!Number.isFinite(spot)||!last)return{gate:false,label:'بيانات الدخول غير مكتملة'};
  const band=Math.max(spot*.0015,atr*.10),levels=x=>x.filter(Number.isFinite),near=arr=>levels(arr).some(x=>Math.abs(spot-x)<=band),smc=detectStructure(snapshot.intraday||[]);
  const bullishReject=bars.some(b=>Number(b.close)>Number(b.open)&&Number(b.close)-Number(b.low)>=(Number(b.high)-Number(b.low))*.55);
  const bearishReject=bars.some(b=>Number(b.close)<Number(b.open)&&Number(b.high)-Number(b.close)>=(Number(b.high)-Number(b.low))*.55);
  const support=[p.pdl,p.swingLow,p.pml,p.orl,Number.isFinite(Number(p.whole))&&Number(p.whole)<=spot?Number(p.whole):null];
  const resistance=[p.pdh,p.swingHigh,p.pmh,p.orh,Number.isFinite(Number(p.whole))&&Number(p.whole)>=spot?Number(p.whole):null];
  const nearSupport=near(support),nearResistance=near(resistance),nearVwap=Number.isFinite(vw)&&Math.abs(spot-vw)<=band;
  const bullRetest=levels([p.pdh,p.pmh,p.orh,p.whole]).some(level=>spot>=level&&bars.some(b=>Number(b.low)<=level+band*.45&&Number(b.close)>=level));
  const bearRetest=levels([p.pdl,p.pml,p.orl,p.whole]).some(level=>spot<=level&&bars.some(b=>Number(b.high)>=level-band*.45&&Number(b.close)<=level));
  const bullStructure=Boolean(smc.sweepLow||smc.mssBull||smc.bosBull),bearStructure=Boolean(smc.sweepHigh||smc.mssBear||smc.bosBear);
  const supportReaction=nearSupport&&(bullStructure||bullishReject),resistanceReaction=nearResistance&&(bearStructure||bearishReject);
  const vwapBull=nearVwap&&spot>=vw&&bullishReject&&bullStructure,vwapBear=nearVwap&&spot<=vw&&bearishReject&&bearStructure;
  const gate=dir==='CALL'?(supportReaction||bullRetest||vwapBull):(resistanceReaction||bearRetest||vwapBear);
  let label='السعر في منتصف الحركة — لا توجد نقطة ارتكاز/ارتداد مؤكدة';
  if(gate&&dir==='CALL')label=supportReaction?'ارتداد مؤكد من دعم/ارتكاز':bullRetest?'اختراق وإعادة اختبار صاعد':'ارتداد صاعد مؤكد من VWAP';
  if(gate&&dir==='PUT')label=resistanceReaction?'رفض مؤكد من مقاومة/ارتكاز':bearRetest?'كسر وإعادة اختبار هابط':'رفض هابط مؤكد من VWAP';
  return{gate,label,nearSupport,nearResistance,nearVwap,bullRetest,bearRetest,band:round(band)};
}
function analyze(snapshot,settings={}){
  const result=alignFinalContract(snapshot,analyzeBase(snapshot,settings)),entry=entryGate(snapshot,result);
  result.entryGate=entry;
  result.setup={...result.setup,reasons:[...new Set([entry.label,...(result.setup?.reasons||[])])].slice(0,16)};
  if(!entry.gate){
    if(result.contract)result.candidateContract=result.contract;
    result.contract=null;
    result.contractStatus='BLOCKED_NO_ENTRY';
    if(['CALL','PUT'].includes(result.direction))result.state='WATCH';
    result.confidence=Math.min(Number(result.confidence)||0,69);
    return result;
  }
  if(!result.contract||result.contractStatus!=='CONFIRMED'){
    if(result.contract)result.candidateContract=result.contract;
    result.contract=null;
    result.contractStatus='BLOCKED_CONTRACT_QUALITY';
    if(['CALL','PUT'].includes(result.direction))result.state='WATCH';
    result.setup.reasons=[...new Set(['نقطة الدخول موجودة لكن لا يوجد عقد قريب/سائل اجتاز فلتر الجودة',...(result.setup?.reasons||[])])].slice(0,16);
  }
  return result;
}
\`;
source=source.replace(finalAnalyzeOld,safeEngine);
`;

source=source.replace(launchAnchor,safetyPatch+'\n'+launchAnchor);
writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
