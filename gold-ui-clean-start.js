import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync = fs.writeFileSync.bind(fs);

fs.writeFileSync = function patchedWriteFileSync(path, data, ...args) {
  const p = String(path);
  let out = data;
  if (p.endsWith('/.runtime-server.mjs') || p.endsWith('\\.runtime-server.mjs')) {
    const isBuffer = Buffer.isBuffer(data);
    let source = isBuffer ? data.toString('utf8') : String(data);

    // Hide all legacy stock/options remnants from the gold-only interface.
    source = source.replace(
      '.toolbar,.hero,.grid,.chartCard,.scanner,.specScanner,.chain,.instrumentPolicy{display:none!important}',
      '.toolbar,.hero,.grid,.chartCard,.scanner,.specScanner,.chain,.instrumentPolicy,.contract,main>article:last-of-type,main>p.risk,#reasons{display:none!important}'
    );

    // Make the gold workflow visually primary and consistent.
    source = source.replace(
      '.goldPlan{border-color:#625329;background:linear-gradient(145deg,#17170f,#0c121c);border-radius:18px;padding:16px}',
      '.goldPlan{border-color:#625329;background:linear-gradient(145deg,#17170f,#0c121c);border-radius:18px;padding:16px;order:2}.goldMetrics{order:1}.ictLevelsPanel{order:3}.goldChartWrap{order:4}.goldNote{order:5}.goldPanel{display:flex;flex-direction:column;gap:12px}'
    );

    // Fix the chart note so it matches the actual embedded 15m TradingView interval.
    source = source.replace(
      'الشارت 5 دقائق من OANDA عبر TradingView وقد يظهر فرق بسيط بين المصدرين.',
      'الشارت 15 دقيقة من OANDA عبر TradingView، بينما قراءة الدخول الداخلية تُحدّث لحظيًا وقد يظهر فرق بسيط بين المصدرين.'
    );

    // Add a compact, factual setup strip. Do not claim MSS/FVG confirmation before the engine actually detects it.
    const planAnchor = '<section class="goldPlan"><div class="goldPlanHead">';
    if (source.includes(planAnchor)) {
      const strip = '<section class="ictConfluence"><div><span>SETUP STATUS</span><strong id="ictSetupState">NO SETUP</strong></div><div><span>Liquidity</span><strong id="ictLiquidityState">DATA PENDING</strong></div><div><span>ICT Confirmation</span><strong id="ictConfirmationState">NOT CONFIRMED</strong></div><div><span>Execution</span><strong id="ictExecutionState">WAITING</strong></div></section>';
      source = source.replace(planAnchor, strip + planAnchor);
    }

    source = source.replace(
      '.ictLabel{font:700 10px Inter,system-ui,sans-serif}.ictPrice{font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.ictLabel{font:700 10px Inter,system-ui,sans-serif}.ictPrice{font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace}.ictConfluence{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;padding:12px;border:1px solid #4f4528;border-radius:16px;background:#0d131d}.ictConfluence div{padding:10px;border:1px solid #303745;border-radius:11px;background:#0b111a}.ictConfluence span{display:block;color:#8f987f;font-size:10px}.ictConfluence strong{display:block;margin-top:5px;color:#e9d89f;font-size:12px;direction:ltr;text-align:right}@media(max-width:760px){header{padding:10px 12px}header h1{font-size:20px}header p{font-size:10px}.badge{padding:6px 9px;font-size:11px}.ictConfluence{grid-template-columns:repeat(2,1fr)}main{padding:12px}.goldHead{padding:14px}.goldMetrics{gap:8px}.goldMetric{padding:10px}.goldMetric.price strong{font-size:24px}}'
    );

    // Reflect the live model state in the setup label. This is model status, not ICT confirmation.
    source = source.replace(
      "$('#goldPlanStatus').textContent=labels[plan.state]||'انتظار';",
      "const ictSetupState=$('#ictSetupState'),ictExecutionState=$('#ictExecutionState');if(ictSetupState)ictSetupState.textContent=plan.state==='UP'?'BUY SETUP':plan.state==='DOWN'?'SELL SETUP':plan.state==='WAIT'?'WATCH':'NO SETUP';if(ictExecutionState)ictExecutionState.textContent=plan.locked?'ENTRY LOCKED':'WAITING';$('#goldPlanStatus').textContent=labels[plan.state]||'انتظار';"
    );

    // Sync liquidity availability with the actual native ICT map state.
    source = source.replace(
      "if(status)status.textContent='ICT LEVELS • LIVE'",
      "if(status)status.textContent='ICT LEVELS • LIVE';const ls=document.querySelector('#ictLiquidityState');if(ls)ls.textContent='PDH / PDL / ASIA READY'"
    );
    source = source.replace(
      "if(status)status.textContent='جمع البيانات';host.innerHTML='<div class=\"ictLevelsEmpty\">نحتاج تاريخ سعر كافٍ لحساب PDH / PDL و Asia range.</div>';return",
      "if(status)status.textContent='جمع البيانات';const ls=document.querySelector('#ictLiquidityState');if(ls)ls.textContent='DATA PENDING';host.innerHTML='<div class=\"ictLevelsEmpty\">نحتاج تاريخ سعر كافٍ لحساب PDH / PDL و Asia range.</div>';return"
    );

    out = isBuffer ? Buffer.from(source, 'utf8') : source;
  }
  return originalWriteFileSync(path, out, ...args);
};

syncBuiltinESMExports();
await import('./gold-ict-history-start.js');
