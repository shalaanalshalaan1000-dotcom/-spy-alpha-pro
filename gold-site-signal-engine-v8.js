import fs from 'node:fs';

const sourceUrl = new URL('./gold-site-signal-engine-v7.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-gold-site-signal-engine-v8.mjs', import.meta.url);

let source = fs.readFileSync(sourceUrl, 'utf8');

const oldTp1Guard = "const BASE_MIN_TP1_R=Math.max(.9,Number(process.env.GOLD_MIN_LIVE_TP1_R||1.20));";
const newTp1Guard = "const BASE_MIN_TP1_R=Math.max(.45,Math.min(.65,Number(process.env.GOLD_MIN_LIVE_TP1_R||.55)));";

if (!source.includes(oldTp1Guard)) {
  throw new Error('gold-site-signal-engine-v8: expected TP1 guard signature not found');
}

source = source
  .replace(oldTp1Guard, newTp1Guard)
  .replace(
    "const BUILD='site-signal-noai-v19-trade-management';",
    "const BUILD='site-signal-noai-v20-fast-tp1-aligned';"
  );

fs.writeFileSync(runtimeUrl, source, 'utf8');
await import(`${runtimeUrl.href}?v=${Date.now()}`);
