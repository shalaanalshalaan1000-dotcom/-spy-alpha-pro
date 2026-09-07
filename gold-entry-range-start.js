import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchGoldEntryRange(source){
  // Legacy forecast card: show an actual entry zone instead of a single locked number.
  source=source.replace(
    "$('#goldEntry').textContent=money(plan.entry);",
    "$('#goldEntry').textContent=(plan.entryLow!=null&&plan.entryHigh!=null)?(money(plan.entryLow)+' — '+money(plan.entryHigh)):money(plan.entry);"
  );

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
