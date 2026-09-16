import fs from 'node:fs';

const sourceUrl = new URL('./telegram-xau-bot-v2.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-telegram-xau-bot-v3.mjs', import.meta.url);

let source = fs.readFileSync(sourceUrl, 'utf8');

const replacements = [
  [
    "const FIVE_MIN_MS=300_000;\nconst BOOT_MS=Date.now();",
    "const FIVE_MIN_MS=300_000;\nconst MIN_CONFIDENCE=Math.max(0,Number(process.env.GOLD_TELEGRAM_MIN_CONFIDENCE||process.env.TELEGRAM_MIN_CONFIDENCE||75));\nconst BOOT_MS=Date.now();"
  ],
  [
    "if(!isConfirmedActive(s)||!valid(p)||!valid(entry)||!stopValid(side,entry,sl))return false;",
    "if(!isConfirmedActive(s)||confidenceOf(s)<MIN_CONFIDENCE||!valid(p)||!valid(entry)||!stopValid(side,entry,sl))return false;"
  ],
  [
    "if(side==='BUY'?p<=sl:p>=sl)return false;",
    "if(CONFIRM_ON_5M_CLOSE&&!fiveMinuteCloseConfirmed(s,now))return false;\n  const entryLow=num(s?.entryLow)??entry,entryHigh=num(s?.entryHigh)??entry;\n  if(!valid(entryLow)||!valid(entryHigh)||p<Math.min(entryLow,entryHigh)||p>Math.max(entryLow,entryHigh))return false;\n  if(tp1AlreadyGone(s,side,p,t[0]))return false;\n  if(side==='BUY'?p<=sl:p>=sl)return false;"
  ],
  [
    "console.log(`[telegram-xau-confirmed] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} one-active-trade lock; site-mirror=on; confidence-filter=off; TP/SL lifecycle alerts=on`);",
    "console.log(`[telegram-xau-confirmed] ${BOT_TOKEN&&CHAT_ID?'enabled':'disabled'} one-active-trade lock; site-mirror=on; confidence>=${MIN_CONFIDENCE}%; 5m-close=${CONFIRM_ON_5M_CLOSE?'required':'off'}; live-entry-range guard=on; TP1-chase guard=on; TP/SL lifecycle alerts=on`);"
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`telegram-xau-bot-v3: expected signature not found: ${from.slice(0, 80)}`);
  source = source.replace(from, to);
}

fs.writeFileSync(runtimeUrl, source, 'utf8');
await import(`${runtimeUrl.href}?v=${Date.now()}`);
