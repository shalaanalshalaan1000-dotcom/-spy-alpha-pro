import fs from 'node:fs';

const sourceUrl = new URL('./gold-site-signal-engine-v7.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-gold-site-signal-engine-v9.mjs', import.meta.url);

let source = fs.readFileSync(sourceUrl, 'utf8');

const replacements = [
  [
    "const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||72);",
    "const MIN_CONFIDENCE=Math.max(68,Math.min(75,Number(process.env.MIN_CONFIDENCE||70)));"
  ],
  [
    "const BASE_MIN_TP1_R=Math.max(.9,Number(process.env.GOLD_MIN_LIVE_TP1_R||1.20));",
    "const BASE_MIN_TP1_R=Math.max(.45,Math.min(.65,Number(process.env.GOLD_MIN_LIVE_TP1_R||.50)));"
  ],
  [
    "const BUILD='site-signal-noai-v19-trade-management';",
    "const BUILD='site-signal-noai-v22-trade-safety';"
  ],
  [
    "maxRisk:round(clamp(atr1*2.80,2.00,5.00),3),",
    "maxRisk:round(clamp(atr1*3.40,2.50,5.25),3),"
  ],
  [
    "if(REQUIRE_1M_CONFIRM&&!m.oneMinuteConfirmed){state.lastEntryGuard={atMs:now,reason:'WAITING_1M_CONFIRMATION',side};return;}",
    "if(REQUIRE_1M_CONFIRM&&!m.oneMinuteConfirmed&&Number(m.confidence)<82){state.lastEntryGuard={atMs:now,reason:'WAITING_1M_CONFIRMATION',side};return;}"
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`gold-site-signal-engine-v9: expected signature not found: ${from.slice(0, 60)}`);
  source = source.replace(from, to);
}

fs.writeFileSync(runtimeUrl, source, 'utf8');
await import(`${runtimeUrl.href}?v=${Date.now()}`);
