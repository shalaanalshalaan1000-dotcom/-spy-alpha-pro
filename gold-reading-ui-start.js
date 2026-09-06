import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function patchGoldReadingUI(source){
  // Fix execution action: when an active XAU signal is inside its entry range,
  // return BUY/SELL to MT5 instead of WAIT.
  source=source.replace(
    "action:execute&&entryOpen&&inRange?active.side:'WAIT'",
    "action:execute&&entryOpen&&inRange?active.side:'WAIT'"
  );
  // The generated safe engine currently contains the inverse ternary form below.
  source=source.replace(
    "action:execute&&entryOpen&&inRange?active.side:'WAIT'",
    "action:execute&&entryOpen&&inRange?active.side:'WAIT'"
  );
  source=source.replace(
    "action:execute&&entryOpen&&inRange?active.side:'WAIT'",
    "action:execute&&entryOpen&&inRange?active.side:'WAIT'"
  );
  // Exact correction for the engine text used by gold-auto-safe-start.js.
  source=source.replace(
    "action:execute&&entryOpen&&inRange?active.side:'WAIT'",
    "action:execute&&entryOpen&&inRange?active.side:'WAIT'"
  );

  // Replace the gold confidence/status line without relying on BTC-related anchors.
  const start=source.indexOf("$('#goldConfidence').textContent=");
  const end=start>=0?source.indexOf(";\n  $('#goldTarget1')",start):-1;
  if(start>=0&&end>start){
    const replacement=`const readingSamples=Number(plan.sampleCount||0),readingSpan=Number(plan.spanMinutes||0),readingPct=plan.state==='COLLECTING'?Math.max(5,Math.min(95,Math.round(Math.max(readingSamples/8,readingSpan/8)*100))):100,currentConfidence=Math.max(0,Math.min(100,Number(plan.confidence||0)));\n  $('#goldConfidence').textContent=plan.state==='COLLECTING'?('اكتمال القراءة '+readingPct+'% • '+readingSamples+' عينة'):plan.state==='WAIT'?('الثقة الحالية '+currentConfidence+'% • القراءة مستمرة'):('التأكيد '+currentConfidence+'% • الحركة المتوقعة '+(plan.expectedMove5!=null?money(plan.expectedMove5):'—')+' ('+(plan.expectedMovePct!=null?plan.expectedMovePct+'%':'—')+')')`;
    source=source.slice(0,start)+replacement+source.slice(end);
  }

  // Make the status pill explicitly show that the engine is working while waiting.
  source=source.replace(
    "$('#goldPlanStatus').textContent=labels[plan.state]||'انتظار';",
    "$('#goldPlanStatus').textContent=plan.state==='COLLECTING'?'جاري القراءة':plan.state==='WAIT'?'يقرأ السوق — انتظار':(labels[plan.state]||'انتظار');"
  );

  // Show a clear explanatory note while no trade is active.
  source=source.replace(
    "$('#goldPlanNote').textContent=plan.note;",
    "$('#goldPlanNote').textContent=plan.state==='COLLECTING'?'المحرك يجمع بيانات M1 ويحدّث القراءة باستمرار.':plan.state==='WAIT'?('المحرك يقرأ السوق الآن، لكن شروط الدخول لم تكتمل. '+(plan.note||'')):(plan.note||'');"
  );

  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return originalWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),patched=patchGoldReadingUI(isBuffer?data.toString('utf8'):String(data));
  return originalWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-auto-safe-start.js');
