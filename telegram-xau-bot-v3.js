import fs from 'node:fs';

const sourceUrl = new URL('./telegram-xau-bot-v2.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-telegram-xau-bot-v3.mjs', import.meta.url);

let source = fs.readFileSync(sourceUrl, 'utf8');

const replacements = [
  [
    "const CONFIRM_ON_5M_CLOSE=String(process.env.TELEGRAM_CONFIRM_ON_5M_CLOSE||'true').toLowerCase()!=='false';",
    "const CONFIRM_ON_5M_CLOSE=false;"
  ],
  [
    "const FIVE_MIN_MS=300_000;",
    "const FIVE_MIN_MS=300_000;\nconst MIN_CONFIDENCE=Math.max(0,Number(process.env.GOLD_TELEGRAM_MIN_CONFIDENCE||process.env.TELEGRAM_MIN_CONFIDENCE||75));\nconst MIN_LIVE_RR=Math.max(1.20,Number(process.env.GOLD_TELEGRAM_MIN_RR||1.30));"
  ],
  [
    "if(!isConfirmedActive(s)||!valid(p)||!valid(entry)||!stopValid(side,entry,sl))return false;",
    "if(!isConfirmedActive(s)||confidenceOf(s)<MIN_CONFIDENCE||!valid(p)||!valid(entry)||!stopValid(side,entry,sl))return false;"
  ],
  [
    "if(side==='BUY'?p<=sl:p>=sl)return false;",
    "if(CONFIRM_ON_5M_CLOSE&&!fiveMinuteCloseConfirmed(s,now))return false;\n  if(tp1AlreadyGone(s,side,p,t[0]))return false;\n  const liveRisk=side==='BUY'?p-sl:sl-p,liveReward=side==='BUY'?t[0]-p:p-t[0];\n  if(!(liveRisk>0)||!(liveReward>0)||liveReward/liveRisk<MIN_LIVE_RR)return false;\n  if(side==='BUY'?p<=sl:p>=sl)return false;"
  ],
  [
    "console.log(`[telegram-xau-confirmed] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} one-active-trade lock; site-mirror=on; confidence-filter=off; TP/SL lifecycle alerts=on`);",
    "console.log(`[telegram-xau-confirmed] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} one-active-trade lock; site-mirror=on; confidence>=${MIN_CONFIDENCE}%; 5m-close=engine-confirmed; live-entry-range guard=engine-owned; min-live-RR=${MIN_LIVE_RR}; TP1-chase guard=on; TP/SL lifecycle alerts=on`);"
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`telegram-xau-bot-v3: expected signature not found: ${from.slice(0, 80)}`);
  source = source.replace(from, to);
}


{
  const oldReturn="return t.every((v,i)=>valid(v)&&(side==='BUY'?v>(i?t[i-1]:entry):v<(i?t[i-1]:entry)));";
  const newReturn="const present=t.filter(valid);if(!present.length)return false;return present.every((v,i)=>side==='BUY'?v>(i?present[i-1]:entry):v<(i?present[i-1]:entry));";
  if(!source.includes(oldReturn))throw new Error('telegram v3 ICT target validation anchor missing');
  source=source.replace(oldReturn,newReturn);

  const oldTarget="return \`\${icon} XAUUSD — \${side}\\n✅ CONFIRMED\\n📊 الثقة: \${confidence}%\\n💵 الدخول: \${money(entry)}\\n🛑 SL: \${n(sl)}\\n🎯 TP1: \${n(t[0])}\\n🎯 TP2: \${n(t[1])}\\n🎯 TP3: \${n(t[2])}\\n🎯 TP4: \${n(t[3])}\${sizing.length?'\\n\\n'+sizing.join('\\n'):''}\`;";
  const newTarget="const labels=Array.isArray(s?.targetLabels)?s.targetLabels:[],targetLines=t.map((v,i)=>valid(v)?\`🎯 TP\${i+1}: \${n(v)}\${labels[i]?' • '+labels[i]:''}\`:null).filter(Boolean);const ict=s?.ict||{},lot=s?.lotSizing||null,ictLines=[\`🧭 ICT: \${String(s?.strategy||'SETUP')}\`,\`📍 HTF: \${String(s?.contextBias||'—')} • \${String(ict.session||'—')}\`,\`💧 Draw: \${String(ict.drawOnLiquidity||labels[0]||'opposing liquidity')}\`,lot&&Number(lot.recommendedLot)>0?\`📐 اللوت المحسوب: \${Number(lot.recommendedLot).toFixed(2)} lot • Risk ≈ $\${Number(lot.actualRiskUsd||0).toFixed(2)}\`:null].filter(Boolean);return \`\${icon} XAUUSD — \${side}\\n✅ ICT CONFIRMED\\n📊 الثقة: \${confidence}%\\n💵 الدخول: \${money(entry)}\\n🛑 SL: \${n(sl)}\\n\${targetLines.join('\\n')}\\n\\n\${ictLines.join('\\n')}\${sizing.length?'\\n\\n'+sizing.join('\\n'):''}\`;";
  if(!source.includes(oldTarget))throw new Error('telegram v3 target message anchor missing');
  source=source.replace(oldTarget,newTarget);

  const oldTerminal="if(outcome==='TP4')return \`🏁 XAUUSD — ALL TARGETS COMPLETED / تم تحقيق جميع الأهداف\\n🎯 TP4: \${n(t?.target4)}\`;";
  const newTerminal="if(/^TP[1-4]$/.test(outcome)){const i=Number(outcome.slice(2));return \`🏁 XAUUSD — LIQUIDITY TARGET COMPLETED / تم تحقيق هدف السيولة\\n🎯 TP\${i}: \${n(t?.['target'+i])}\`;}";
  if(!source.includes(oldTerminal))throw new Error('telegram v3 terminal target anchor missing');
  source=source.replace(oldTerminal,newTerminal);
}

fs.writeFileSync(runtimeUrl, source, 'utf8');
await import(`${runtimeUrl.href}?v=${Date.now()}`);
