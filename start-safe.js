import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./start.js',import.meta.url);
const runtimePath=new URL('./.runtime-start-safe.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

const launchAnchor="writeFileSync(runtimePath,source,'utf8');";
if(!source.includes(launchAnchor))throw new Error('start.js launch anchor missing');

const safetyPatch=String.raw`
// SAFER CONTRACT SELECTION ONLY — no hard entry gate.
const finalAnalyzeOld="function analyze(snapshot,settings={}){return alignFinalContract(snapshot,analyzeBase(snapshot,settings))}";
if(!source.includes(finalAnalyzeOld))throw new Error('Safe contract final analyze anchor missing');

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
function analyze(snapshot,settings={}){return alignFinalContract(snapshot,analyzeBase(snapshot,settings))}
\`;
source=source.replace(finalAnalyzeOld,safeEngine);
`;

source=source.replace(launchAnchor,safetyPatch+'\n'+launchAnchor);
writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
