import 'dotenv/config';
import express from 'express';
import { analyze, WATCHLIST } from './src/engine.js';
import { demoSnapshot } from './src/demo.js';

const app=express(); app.use(express.json()); app.use(express.static('public'));
const PORT=process.env.PORT||3000;
const MASSIVE_BASE='https://api.massive.com';

const isoDate=d=>d.toISOString().slice(0,10);
const daysAgo=n=>{const d=new Date(); d.setUTCDate(d.getUTCDate()-n); return d;};
const daysAhead=n=>{const d=new Date(); d.setUTCDate(d.getUTCDate()+n); return d;};

async function massiveGet(path, params={}) {
  const apiKey=process.env.MASSIVE_API_KEY;
  if(!apiKey) throw new Error('MASSIVE_API_KEY is not configured');
  const url=new URL(path.startsWith('http')?path:`${MASSIVE_BASE}${path}`);
  for(const [k,v] of Object.entries(params)) if(v!==undefined && v!==null) url.searchParams.set(k,String(v));
  url.searchParams.set('apiKey',apiKey);
  const r=await fetch(url,{headers:{accept:'application/json'}});
  if(!r.ok){
    const body=await r.text().catch(()=> '');
    throw new Error(`Massive ${r.status}: ${body.slice(0,220)}`);
  }
  return await r.json();
}

function mapBars(rows=[]) {
  return rows.map(x=>({
    open:Number(x.o), high:Number(x.h), low:Number(x.l), close:Number(x.c),
    volume:Number(x.v||0), vwap:x.vw==null?null:Number(x.vw), timestamp:new Date(Number(x.t)).toISOString()
  })).filter(x=>Number.isFinite(x.close));
}

async function fetchAllOptions(symbol, spot) {
  const today=isoDate(new Date());
  const end=isoDate(daysAhead(Number(process.env.OPTIONS_MAX_DTE||14)));
  const pct=Number(process.env.OPTIONS_STRIKE_WINDOW_PCT||0.10);
  const lo=Math.max(0.01,spot*(1-pct));
  const hi=spot*(1+pct);
  const all=[];

  for(const type of ['call','put']){
    let next=`${MASSIVE_BASE}/v3/snapshot/options/${encodeURIComponent(symbol)}`;
    let page=0;
    while(next && page<3){
      const data=await massiveGet(next, page===0?{
        contract_type:type,
        'expiration_date.gte':today,
        'expiration_date.lte':end,
        'strike_price.gte':lo.toFixed(2),
        'strike_price.lte':hi.toFixed(2),
        limit:250,
        sort:'expiration_date',
        order:'asc'
      }:{});
      for(const x of data.results||[]){
        const expiry=x.details?.expiration_date;
        if(!expiry) continue;
        const dte=Math.max(0,(new Date(`${expiry}T20:00:00Z`).getTime()-Date.now())/86400000);
        all.push({
          symbol:x.details?.ticker,
          type:x.details?.contract_type,
          strike:Number(x.details?.strike_price),
          expiry,
          daysToExpiry:dte,
          bid:Number(x.last_quote?.bid||0),
          ask:Number(x.last_quote?.ask||0),
          iv:Number(x.implied_volatility||0),
          delta:Number(x.greeks?.delta||0),
          gamma:Number(x.greeks?.gamma||0),
          theta:Number(x.greeks?.theta||0),
          vega:Number(x.greeks?.vega||0),
          volume:Number(x.day?.volume||0),
          openInterest:Number(x.open_interest||0),
          quoteTimeframe:x.last_quote?.timeframe||null
        });
      }
      next=data.next_url||null;
      page++;
    }
  }
  return all;
}

async function fetchMassiveSnapshot(symbol){
  const dailyData=await massiveGet(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${isoDate(daysAgo(70))}/${isoDate(new Date())}`,{adjusted:true,sort:'asc',limit:120});
  const daily=mapBars(dailyData.results||[]);
  if(daily.length<20) throw new Error(`Not enough daily bars for ${symbol}`);

  const intradayData=await massiveGet(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/5/minute/${isoDate(daysAgo(7))}/${isoDate(new Date())}`,{adjusted:true,sort:'asc',limit:50000});
  let intraday=mapBars(intradayData.results||[]);
  if(!intraday.length) throw new Error(`No intraday bars for ${symbol}`);

  // Analyze the latest trading session only, so VWAP/day range do not mix multiple days.
  const latestDay=intraday.at(-1).timestamp.slice(0,10);
  intraday=intraday.filter(x=>x.timestamp.slice(0,10)===latestDay);
  const spot=intraday.at(-1).close;
  const options=await fetchAllOptions(symbol,spot);

  return {
    symbol,
    daily,
    intraday,
    options,
    timestamp:intraday.at(-1).timestamp,
    mode:'LIVE',
    provider:'MASSIVE'
  };
}

async function fetchSnapshot(symbol){
  if(process.env.MASSIVE_API_KEY) return fetchMassiveSnapshot(symbol);

  // Optional provider-neutral adapter fallback.
  if(process.env.MARKET_DATA_API_URL){
    const url=new URL(process.env.MARKET_DATA_API_URL);
    url.searchParams.set('symbol',symbol);
    const r=await fetch(url,{headers:{Authorization:`Bearer ${process.env.MARKET_DATA_API_KEY||''}`}});
    if(!r.ok) throw new Error(`Market data ${r.status}`);
    return await r.json();
  }
  return demoSnapshot(symbol);
}

function currentMode(){
  if(process.env.MASSIVE_API_KEY) return {mode:'LIVE',provider:'MASSIVE'};
  if(process.env.MARKET_DATA_API_URL) return {mode:'LIVE',provider:'CUSTOM'};
  return {mode:'DEMO',provider:'DEMO'};
}

app.get('/api/config',(req,res)=>res.json({
  watchlist:WATCHLIST,
  minConfidence:Number(process.env.MIN_CONFIDENCE||70),
  maxSignalsPerDay:Number(process.env.MAX_SIGNALS_PER_DAY||3),
  ...currentMode()
}));

app.get('/api/health',(req,res)=>res.json({ok:true,...currentMode(),telegram:Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID)}));

app.get('/api/analyze/:symbol',async(req,res)=>{
  try{
    const symbol=req.params.symbol.toUpperCase();
    if(!WATCHLIST.includes(symbol)) return res.status(400).json({error:'Unsupported symbol'});
    const snap=await fetchSnapshot(symbol);
    const result=analyze(snap,{minConfidence:process.env.MIN_CONFIDENCE||70});
    if(result.freshness.stale) result.state='NO TRADE';
    res.json({...result,mode:snap.mode||'LIVE',provider:snap.provider||currentMode().provider});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/telegram',async(req,res)=>{
  const token=process.env.TELEGRAM_BOT_TOKEN, chat=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chat) return res.status(400).json({error:'Telegram not configured'});
  const text=String(req.body.text||'').slice(0,4000);
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text})});
  const data=await r.json(); res.status(r.ok?200:500).json(data);
});

app.listen(PORT,()=>console.log(`SPY Alpha Pro on http://localhost:${PORT} — ${currentMode().provider}`));
