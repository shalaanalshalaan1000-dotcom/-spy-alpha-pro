// Gold Alpha Pro resilient launcher: preserve the original Gold Alpha UI/runtime,
// but add fallback quote providers when gold-api.com is temporarily unavailable.
const nativeFetch = globalThis.fetch.bind(globalThis);

async function fallbackGoldQuote() {
  const massiveKey = process.env.MASSIVE_API_KEY;
  if (massiveKey) {
    try {
      const u = new URL('https://api.massive.com/v1/last_quote/currencies/XAU/USD');
      u.searchParams.set('apiKey', massiveKey);
      const r = await nativeFetch(u, {
        headers: {accept:'application/json','user-agent':'GoldAlphaPro/9.1'},
        signal: AbortSignal.timeout(7000)
      });
      const d = await r.json().catch(()=>({}));
      const q = d.last || d.results?.last || d.results || {};
      const bid = Number(q.bid ?? q.b), ask = Number(q.ask ?? q.a);
      const price = Number.isFinite(bid) && Number.isFinite(ask) ? (bid+ask)/2 : (Number.isFinite(bid) ? bid : ask);
      if (r.ok && Number.isFinite(price) && price > 0) return {price, updatedAt:new Date().toISOString(), provider:'MASSIVE'};
    } catch {}
  }

  try {
    const r = await nativeFetch('https://data-asg.goldprice.org/dbXRates/USD', {
      cache:'no-store',
      headers:{accept:'application/json, text/plain, */*','user-agent':'Mozilla/5.0 GoldAlphaPro/9.1',origin:'https://goldprice.org',referer:'https://goldprice.org/'},
      signal:AbortSignal.timeout(7000)
    });
    const d = await r.json().catch(()=>({}));
    const x = Array.isArray(d.items) ? d.items[0] : null;
    const price = Number(x?.xauPrice);
    if (r.ok && Number.isFinite(price) && price > 0) return {price, updatedAt:new Date().toISOString(), provider:'GOLDPRICE_ORG'};
  } catch {}

  return null;
}

globalThis.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  if (!url.includes('api.gold-api.com/price/XAU')) return nativeFetch(input, init);

  try {
    const r = await nativeFetch(input, init);
    if (r.ok) return r;
  } catch {}

  const q = await fallbackGoldQuote();
  if (!q) return new Response(JSON.stringify({error:'all gold quote providers unavailable'}), {status:503, headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify(q), {status:200, headers:{'content-type':'application/json'}});
};

await import('./gold-app.js');
