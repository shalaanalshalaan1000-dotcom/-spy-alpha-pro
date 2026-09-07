import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchGoldEntryRange(source){
  // Legacy forecast card: show an actual entry zone instead of a single locked number.
  source=source.replace(
    "$('#goldEntry').textContent=money(plan.entry);",
    "$('#goldEntry').textContent=(plan.entryLow!=null&&plan.entryHigh!=null)?(money(plan.entryLow)+' — '+money(plan.entryHigh)):(plan.entry!=null?(money(Number(plan.entry)-0.50)+' — '+money(Number(plan.entry)+0.50)):'—');"
  );
  source=source.replace(
    "document.querySelector('#goldEntry').textContent=money(plan.entry);",
    "document.querySelector('#goldEntry').textContent=(plan.entryLow!=null&&plan.entryHigh!=null)?(money(plan.entryLow)+' — '+money(plan.entryHigh)):(plan.entry!=null?(money(Number(plan.entry)-0.50)+' — '+money(Number(plan.entry)+0.50)):'—');"
  );

  // Make the visible card label explicit.
  source=source.replaceAll('<span>الدخول</span><strong id="goldEntry">','<span>نطاق الدخول</span><strong id="goldEntry">');
  source=source.replaceAll('<span>الدخول من الرقم</span><strong id="goldEntry">','<span>نطاق الدخول</span><strong id="goldEntry">');

  // When a plan is locked from a single spot price, attach a narrow execution zone.
  source=source.replace(
    "return{...plan,entry:p,locked:true",
    "return{...plan,entry:p,entryLow:Number((p-0.50).toFixed(2)),entryHigh:Number((p+0.50).toFixed(2)),locked:true"
  );

  // Do not count targets on a setup that never entered its range.
  source=source.replace(
    "const hit1=plan.state==='UP'?price>=Number(plan.target1):price<=Number(plan.target1),hit2=plan.state==='UP'?price>=Number(plan.target2):price<=Number(plan.target2);",
    "const inEntryRange=plan.entryLow!=null&&plan.entryHigh!=null&&price>=Number(plan.entryLow)&&price<=Number(plan.entryHigh);if(!plan.entryTouched&&inEntryRange){plan.entryTouched=true;try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(plan))}catch{}}const hit1=!!plan.entryTouched&&(plan.state==='UP'?price>=Number(plan.target1):price<=Number(plan.target1)),hit2=!!plan.entryTouched&&(plan.state==='UP'?price>=Number(plan.target2):price<=Number(plan.target2));"
  );

  // Fallback UI sync: even if a later patch overwrites the normal renderer,
  // always force #goldEntry to show a range from the active lock.
  const client=`
function syncGoldEntryRangeUi(){
  const node=document.querySelector('#goldEntry');if(!node)return;
  let lock=null;try{lock=typeof readGoldTradeLock==='function'?readGoldTradeLock():null}catch{}
  if(!lock)return;
  const center=Number(lock.entry),lo=Number.isFinite(Number(lock.entryLow))?Number(lock.entryLow):(Number.isFinite(center)?center-.50:NaN),hi=Number.isFinite(Number(lock.entryHigh))?Number(lock.entryHigh):(Number.isFinite(center)?center+.50:NaN);
  if(Number.isFinite(lo)&&Number.isFinite(hi))node.textContent='$'+lo.toFixed(2)+' — $'+hi.toFixed(2);
  const label=node.parentElement?.querySelector('span');if(label)label.textContent='نطاق الدخول';
}
setTimeout(syncGoldEntryRangeUi,400);setInterval(syncGoldEntryRangeUi,1000);
`;
  if(!source.includes('function syncGoldEntryRangeUi')&&source.includes('(async()=>{'))source=source.replace('(async()=>{',client+'\n(async()=>{');

  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data);
  const patched=patchGoldEntryRange(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-entry-guard-start.js');
