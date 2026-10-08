import fs from 'node:fs';

const sourceUrl = new URL('./telegram-xau-bot-v2.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-telegram-xau-bot-v3.mjs', import.meta.url);

let source = "import {validTrendContinuation} from './ict-trend-continuation.js';\n" + fs.readFileSync(sourceUrl, 'utf8');

const replacements = [
  [
    "const CONFIRM_ON_5M_CLOSE=String(process.env.TELEGRAM_CONFIRM_ON_5M_CLOSE||'true').toLowerCase()!=='false';",
    "const CONFIRM_ON_5M_CLOSE=false;"
  ],
  [
    "const FIVE_MIN_MS=300_000;",
    "const FIVE_MIN_MS=300_000;\nconst MIN_CONFIDENCE=Math.max(75,Number(process.env.GOLD_TELEGRAM_MIN_CONFIDENCE||process.env.TELEGRAM_MIN_CONFIDENCE||75));\nconst MIN_LIVE_RR=Math.max(.50,Math.min(.75,Number(process.env.GOLD_TELEGRAM_MIN_RR||.60)));"
  ],
  [
    "if(side==='BUY'?p<=sl:p>=sl)return false;",
    "if(CONFIRM_ON_5M_CLOSE&&!fiveMinuteCloseConfirmed(s,now))return false;\n  if(tp1AlreadyGone(s,side,p,t[0]))return false;\n  const liveRisk=side==='BUY'?p-sl:sl-p,liveReward=side==='BUY'?t[0]-p:p-t[0];\n  if(!(liveRisk>0)||!(liveReward>0)||liveReward/liveRisk<MIN_LIVE_RR)return false;\n  if(side==='BUY'?p<=sl:p>=sl)return false;"
  ],
  [
    "console.log(`[telegram-xau-confirmed] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} session-level-alerts=${SESSION_LEVEL_ALERTS_ENABLED?'on':'off'}; trade-signals=${TRADE_SIGNALS_ENABLED?'on':'off'}; gold-snr=advisory-only; one-active-trade lock; TP/SL + STOP/CONTINUE management alerts=on`);",
    "console.log(`[telegram-xau-confirmed] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} session-level-alerts=${SESSION_LEVEL_ALERTS_ENABLED?'on':'off'}; trade-signals=${TRADE_SIGNALS_ENABLED?'on':'off'}; gold-snr=advisory-only; confidence>=${MIN_CONFIDENCE}%; 5m-close=engine-confirmed; min-live-RR=${MIN_LIVE_RR}; TP/SL + STOP/CONTINUE management alerts=on`);"
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`telegram-xau-bot-v3: expected signature not found: ${from.slice(0, 80)}`);
  source = source.replace(from, to);
}

// Commands are handled by the HTTPS webhook on the public site. Long polling via getUpdates
// causes 409 conflicts during Render zero-downtime deploy overlap, so it is disabled here.
const commandLoop="  (async function commands(){await botCommandLoop();})();";
if(!source.includes(commandLoop))throw new Error('telegram v3 command-loop anchor missing');
source=source.replace(commandLoop,"  console.log('[telegram-xau-commands] webhook mode; getUpdates disabled');");


{
  const oldReturn="return t.every((v,i)=>valid(v)&&(side==='BUY'?v>(i?t[i-1]:entry):v<(i?t[i-1]:entry)));";
  const newReturn="const authoritative=Boolean(s?.tradeState?.active===true&&String(s?.tradeState?.signalId||'')===String(s?.signalId||'')&&s?.tradeState?.side===s?.side&&s?.entered===true&&s?.triggered===true);if(!authoritative||!valid(t[0]))return false;/* The site has already enforced the ICT execution gate; Telegram must not rerun mutable advisory model/context gates after confirmation. */const present=t.filter(valid);if(!present.length)return false;return present.every((v,i)=>side==='BUY'?v>(i?present[i-1]:entry):v<(i?present[i-1]:entry));";
  if(!source.includes(oldReturn))throw new Error('telegram v3 confluence target validation anchor missing');
  source=source.replace(oldReturn,newReturn);

  const oldTarget="return \`\${icon} XAUUSD — \${side}\\n✅ CONFIRMED\\n📊 الثقة: \${confidence}%\\n💵 الدخول: \${money(entry)}\\n🛑 SL: \${n(sl)}\\n🎯 TP1: \${n(t[0])}\\n🎯 TP2: \${n(t[1])}\\n🎯 TP3: \${n(t[2])}\\n🎯 TP4: \${n(t[3])}\${sizing.length?'\\n\\n'+sizing.join('\\n'):''}\`;";
  const newTarget="const labels=Array.isArray(s?.targetLabels)?s.targetLabels:[];const targetLines=t.map((v,i)=>valid(v)?('🎯 TP'+(i+1)+': '+n(v)+(labels[i]?' • '+labels[i]:'')):null).filter(Boolean);const ict=s?.ict||{},sweep=ict?.legSweep||ict?.sweep||{},mtf=s?.multiTimeframe||{},reads=mtf.reads||{};const sweepName=String(sweep?.name||'EXTERNAL LIQUIDITY').toUpperCase(),sweepPrice=n(sweep?.level);const sweepLine='🧹 Swept: '+sweepName+(valid(sweepPrice)?' @ '+n(sweepPrice):'');const htfLine='🧭 HTF: W1 '+(reads.W1?.side||'—')+' • D1 '+(reads.D1?.side||'—')+' • H4 '+(reads.H4?.side||'—');return icon+' XAUUSD — '+side+'\\n✅ ICT EXTERNAL SETUP CONFIRMED\\n🆔 '+s.signalId+'\\n📊 الثقة: '+confidence+'%\\n💵 الدخول: '+money(entry)+'\\n🛑 SL: '+n(sl)+'\\n'+targetLines.join('\\n')+'\\n\\n🧠 ICT ONLY — EXTERNAL LIQUIDITY\\n'+sweepLine+'\\n'+htfLine+'\\n🔁 '+(ict?.contextSequence||'EXTERNAL LIQUIDITY → MSS/DISPLACEMENT → FVG/OB')+(sizing.length?'\\n\\n'+sizing.join('\\n'):'');";
  if(!source.includes(oldTarget))throw new Error('telegram v3 target message anchor missing');
  source=source.replace(oldTarget,newTarget);

  const oldTerminal="if(outcome==='TP4')return \`🏁 XAUUSD — ALL TARGETS COMPLETED / تم تحقيق جميع الأهداف\\n🎯 TP4: \${n(t?.target4)}\`;";
  const newTerminal="if(/^TP[1-4]$/.test(outcome)){const i=Number(outcome.slice(2));return \`🏁 XAUUSD — TARGET COMPLETED / تم تحقيق الهدف\\n🎯 TP\${i}: \${n(t?.['target'+i])}\`;}";
  if(!source.includes(oldTerminal))throw new Error('telegram v3 terminal target anchor missing');
  source=source.replace(oldTerminal,newTerminal);
}

fs.writeFileSync(runtimeUrl, source, 'utf8');
const runtimeModule=await import(`${runtimeUrl.href}?v=${Date.now()}`);
export const canSendSignal=runtimeModule.canSendSignal;
export const targetMessage=runtimeModule.targetMessage;
