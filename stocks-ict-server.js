import http from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.MASSIVE_API_KEY || '';
const MIN_CONFIDENCE = Number(process.env.STOCKS_ICT_MIN_CONFIDENCE || 65);
const UNIVERSE = (process.env.STOCK_UNIVERSE || 'IONQ,SOFI,MARA,RKLB,ASTS,RIVN,GME,SNAP,ACHR,JOBY,LCID,RIOT,OPEN,GRAB').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
const ETF = new Set(['SPY','QQQ','IWM']);
const PAGE = readFileSync(new URL('./stocks-ict-page.html', import.meta.url), 'utf8');
const cache = new Map();

const round=(n,d=2)=>Number.isFinite(Number(n))?Number(Number(n).toFixed(d)):null;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const iso=d=>new Date(d).toISOString().slice(0,10);
const daysAgo=n=>Date.now()-n*86400000;
const dayDiff=(a,b)=>Math.max(0,Math.ceil((new Date(a+'T20:00:00Z')-new Date(b+'T20:00:00Z'))/86400000));

function et(ts){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}).formatToParts(new Date(ts)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {date:parts.year+'-'+parts.month+'-'+parts.day,min:Number(parts.hour)*60+Number(parts.minute),weekday:parts.weekday};
}
function marketPhase(){
  const x=et(Date.now());
  if(['Sat','Sun'].includes(x.weekday)) return 'CLOSED';
  if(x.min>=570&&x.min<960)return 'REGULAR';
  if(x.min>=240&&x.min<570)return 'PREMARKET';
  if(x.min>=960&&x.min<1200)return 'AFTER_HOURS';
  return 'CLOSED';
}
async function massive(path,params={}){
  if(!API_KEY) throw Object.assign(new Error('MASSIVE_API_KEY غير موجود في خدمة الموقع الجديد'),{statusCode:503});
  const url=new URL('https://api.massive.com'+path);
  for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null&&v!=='') url.searchParams.set(k,String(v));
  url.searchParams.set('apiKey',API_KEY);
  const r=await fetch(url,{headers:{accept:'application/json'}});
  const txt=await r.text();
  let data={}; try{data=JSON.parse(txt)}catch{}
  if(!r.ok || data.status==='ERROR') throw Object.assign(new Error(data.error||data.message||('Massive HTTP '+r.status)),{statusCode:r.status||502});
  return data;
}
function mapBars(rows=[]){return rows.map(x=>({open:Number(x.o),high:Number(x.h),low:Number(x.l),close:Number(x.c),volume:Number(x.v||0),vwap:Number(x.vw||x.c),timestamp:Number(x.t)})).filter(x=>Number.isFinite(x.close)&&Number.isFinite(x.timestamp))}
function ema(vals,p){if(!vals.length)return null;const k=2/(p+1);let e=vals[0];for(let i=1;i<vals.length;i++)e=vals[i]*k+e*(1-k);return e}
function atr(bars,p=14){if(bars.length<2)return null;const tr=[];for(let i=1;i<bars.length;i++)tr.push(Math.max(bars[i].high-bars[i].low,Math.abs(bars[i].high-bars[i-1].close),Math.abs(bars[i].low-bars[i-1].close)));const a=tr.slice(-p);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function agg5(bars){const m=new Map();for(const b of bars){const k=Math.floor(b.timestamp/300000)*300000;if(!m.has(k))m.set(k,{open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,timestamp:k});else{const x=m.get(k);x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=b.volume}}return [...m.values()].sort((a,b)=>a.timestamp-b.timestamp)}
function weightedVwap(bars){let pv=0,v=0;for(const b of bars){pv+=(Number.isFinite(b.vwap)?b.vwap:b.close)*b.volume;v+=b.volume}return v?pv/v:(bars.at(-1)?.close||null)}
function hi(a){return a.length?Math.max(...a.map(x=>x.high)):null}
function lo(a){return a.length?Math.min(...a.map(x=>x.low)):null}

async function stockData(symbol){
  const key='stock:'+symbol, hit=cache.get(key);
  if(hit&&Date.now()-hit.t<20000)return hit.v;
  const to=iso(Date.now()), from1=iso(daysAgo(5)), fromD=iso(daysAgo(70));
  const [m1,d1]=await Promise.all([
    massive('/v2/aggs/ticker/'+encodeURIComponent(symbol)+'/range/1/minute/'+from1+'/'+to,{adjusted:'true',sort:'asc',limit:50000}),
    massive('/v2/aggs/ticker/'+encodeURIComponent(symbol)+'/range/1/day/'+fromD+'/'+to,{adjusted:'true',sort:'asc',limit:5000})
  ]);
  const v={intraday:mapBars(m1.results||[]),daily:mapBars(d1.results||[])};
  cache.set(key,{t:Date.now(),v}); return v;
}
function ictAnalyze(symbol,data){
  const intraday=data.intraday||[], daily=data.daily||[];
  if(intraday.length<30||daily.length<20)return {symbol,state:'NO DATA',confidence:0,error:'بيانات غير كافية'};
  const nowET=et(Date.now()), today=nowET.date, barsToday=intraday.filter(b=>et(b.timestamp).date===today);
  const regular=barsToday.filter(b=>{const t=et(b.timestamp).min;return t>=570&&t<960});
  const pre=barsToday.filter(b=>{const t=et(b.timestamp).min;return t>=240&&t<570});
  const opening=barsToday.filter(b=>{const t=et(b.timestamp).min;return t>=570&&t<600});
  const active=(regular.length?regular:(barsToday.length?barsToday:intraday.slice(-390)));
  const m5=agg5(active), recent=m5.slice(-10), last=m5.at(-1)||active.at(-1), spot=Number(last.close);
  const a5=atr(m5,14)||spot*0.003;
  const prev=daily.length>=2?daily[daily.length-2]:daily.at(-1);
  const pdh=prev?.high,pdl=prev?.low,pmh=hi(pre),pml=lo(pre),orh=hi(opening),orl=lo(opening);
  const vw=weightedVwap(active);
  const closes=daily.map(x=>x.close), e9=ema(closes.slice(-45),9), e20=ema(closes.slice(-60),20);
  const htf=e9>e20?'CALL':e9<e20?'PUT':'NEUTRAL';
  const last6=recent.slice(-6), prev3=recent.slice(-5,-2), l5=recent.at(-1), p5=recent.at(-2), p2=recent.at(-3);
  const refLows=[pml,pdl].filter(Number.isFinite), refHighs=[pmh,pdh].filter(Number.isFinite);
  const sweptLow=refLows.find(level=>last6.some(x=>x.low<level)&&spot>level);
  const sweptHigh=refHighs.find(level=>last6.some(x=>x.high>level)&&spot<level);
  const priorHigh=hi(prev3), priorLow=lo(prev3);
  const mssBull=Number.isFinite(priorHigh)&&spot>priorHigh&&(l5?.close||0)>(l5?.open||0);
  const mssBear=Number.isFinite(priorLow)&&spot<priorLow&&(l5?.close||0)<(l5?.open||0);
  const fvgBull=Boolean(p2&&l5&&l5.low>p2.high);
  const fvgBear=Boolean(p2&&l5&&l5.high<p2.low);
  const body=l5?Math.abs(l5.close-l5.open):0;
  const dispBull=Boolean(l5&&l5.close>l5.open&&body>=a5*0.8);
  const dispBear=Boolean(l5&&l5.close<l5.open&&body>=a5*0.8);
  const rngHigh=hi(active),rngLow=lo(active),eq=(rngHigh+rngLow)/2,premium=spot>eq,discount=spot<eq;
  const callParts={
    sweep:sweptLow?22:0,mss:mssBull?22:0,fvg:fvgBull?14:0,vwap:spot>vw?14:0,htf:htf==='CALL'?10:0,
    displacement:dispBull?10:0,pd:discount?5:0,session:marketPhase()==='REGULAR'?3:0
  };
  const putParts={
    sweep:sweptHigh?22:0,mss:mssBear?22:0,fvg:fvgBear?14:0,vwap:spot<vw?14:0,htf:htf==='PUT'?10:0,
    displacement:dispBear?10:0,pd:premium?5:0,session:marketPhase()==='REGULAR'?3:0
  };
  const callScore=Object.values(callParts).reduce((a,b)=>a+b,0),putScore=Object.values(putParts).reduce((a,b)=>a+b,0);
  const direction=callScore>=putScore?'CALL':'PUT', parts=direction==='CALL'?callParts:putParts, raw=Math.max(callScore,putScore);
  const gate=direction==='CALL'?((mssBull&&(sweptLow||fvgBull||dispBull))||(sweptLow&&spot>vw&&dispBull)):((mssBear&&(sweptHigh||fvgBear||dispBear))||(sweptHigh&&spot<vw&&dispBear));
  let confidence=clamp(Math.round(raw),0,95); if(!gate&&confidence>64)confidence=64;
  const state=gate&&confidence>=MIN_CONFIDENCE?direction:(confidence>=50?'WATCH':'NO TRADE');
  let structuralStop;
  if(direction==='CALL'){
    const lows=[lo(recent.slice(-5)),sweptLow].filter(Number.isFinite); structuralStop=Math.max(Math.min(...lows),spot-a5*1.35);
    if(!(structuralStop<spot))structuralStop=spot-a5;
  }else{
    const highs=[hi(recent.slice(-5)),sweptHigh].filter(Number.isFinite); structuralStop=Math.min(Math.max(...highs),spot+a5*1.35);
    if(!(structuralStop>spot))structuralStop=spot+a5;
  }
  const risk=Math.max(Math.abs(spot-structuralStop),a5*0.55);
  const t1=direction==='CALL'?spot+risk:spot-risk,t2=direction==='CALL'?spot+risk*1.5:spot-risk*1.5,t3=direction==='CALL'?spot+risk*2:spot-risk*2;
  const entryLow=spot-a5*.15,entryHigh=spot+a5*.15;
  const todayDollarVol=active.reduce((s,b)=>s+b.volume*b.close,0);
  const reasons=[];
  if(parts.sweep)reasons.push(direction==='CALL'?'Liquidity sweep أسفل مستوى واضح':'Liquidity sweep أعلى مستوى واضح');
  if(parts.mss)reasons.push('MSS/BOS على 5m');
  if(parts.fvg)reasons.push(direction==='CALL'?'Bullish FVG':'Bearish FVG');
  if(parts.vwap)reasons.push(direction==='CALL'?'السعر فوق VWAP':'السعر تحت VWAP');
  if(parts.htf)reasons.push('Daily EMA bias متوافق');
  if(parts.displacement)reasons.push('Displacement candle');
  if(!gate)reasons.push('بانتظار تأكيد ICT إضافي');
  return {
    symbol,spot:round(spot),state,direction,confidence,score:raw,phase:marketPhase(),htfBias:htf,vwap:round(vw),
    levels:{pdh:round(pdh),pdl:round(pdl),pmh:round(pmh),pml:round(pml),orh:round(orh),orl:round(orl)},
    structure:{sweepLow:round(sweptLow),sweepHigh:round(sweptHigh),mssBull,mssBear,fvgBull,fvgBear,dispBull,dispBear,callScore,putScore,parts},
    setup:{entryLow:round(entryLow),entryHigh:round(entryHigh),stop:round(structuralStop),target1:round(t1),target2:round(t2),target3:round(t3),risk:round(risk),reasons},
    liquidity:{todayDollarVolume:Math.round(todayDollarVol),atr5:round(a5),atrPct:round(a5/spot*100,3)}
  };
}
function optionMid(x){
  const q=x.last_quote||{},t=x.last_trade||{},d=x.day||{};
  const bid=Number(q.bid||q.bid_price||0),ask=Number(q.ask||q.ask_price||0);
  if(bid>0&&ask>0)return (bid+ask)/2;
  return Number(t.price||d.close||0);
}
function optionSpread(x){
  const q=x.last_quote||{},bid=Number(q.bid||q.bid_price||0),ask=Number(q.ask||q.ask_price||0),mid=(bid>0&&ask>0)?(bid+ask)/2:0;
  return mid>0?(ask-bid)/mid*100:null;
}
async function bestOption(analysis){
  if(!['CALL','PUT'].includes(analysis.direction))return null;
  const symbol=analysis.symbol,dir=analysis.direction.toLowerCase(),now=iso(Date.now()),max=iso(Date.now()+(ETF.has(symbol)?4:8)*86400000);
  const data=await massive('/v3/snapshot/options/'+encodeURIComponent(symbol),{
    contract_type:dir, 'expiration_date.gte':now,'expiration_date.lte':max,limit:250,sort:'expiration_date',order:'asc'
  });
  const rows=data.results||[],spot=analysis.spot;
  const candidates=rows.map(x=>{
    const d=x.details||{},g=x.greeks||{},mid=optionMid(x),spread=optionSpread(x),strike=Number(d.strike_price),delta=Math.abs(Number(g.delta||0));
    const expiry=d.expiration_date||'',dte=expiry?dayDiff(expiry,now):99,oi=Number(x.open_interest||0),vol=Number(x.day?.volume||0);
    if(!mid||!strike||dte<0||dte>7||Math.abs(strike-spot)/spot>0.05)return null;
    if(mid<.12||mid>3.50)return null;
    if(delta&& (delta<.20||delta>.72))return null;
    if(spread!=null&&spread>16)return null;
    let score=0;
    if(spread!=null){if(spread<=5)score+=28;else if(spread<=9)score+=20;else if(spread<=13)score+=10;else score-=8}
    if(oi>=5000)score+=20;else if(oi>=1500)score+=16;else if(oi>=500)score+=10;else if(oi>=100)score+=5;
    if(vol>=3000)score+=18;else if(vol>=1000)score+=14;else if(vol>=250)score+=9;else if(vol>=50)score+=4;
    if(delta>=.35&&delta<=.60)score+=22;else if(delta>=.25&&delta<=.65)score+=14;else score+=5;
    if(mid>=.25&&mid<=1.50)score+=24;else if(mid>=.15&&mid<=2.25)score+=14;else score+=3;
    const iv=Number(x.implied_volatility||0);
    if(iv>=.55&&iv<=1.60)score+=10;else if(iv>.30)score+=5;
    if(dte<=2)score+=12;else if(dte<=5)score+=9;else score+=5;
    if(Math.abs(strike-spot)/spot<=.015)score+=10;else if(Math.abs(strike-spot)/spot<=.03)score+=6;
    return {raw:x,score,mid,spread,strike,delta,dte,oi,vol,expiry,type:String(d.contract_type||dir).toUpperCase(),ticker:d.ticker||x.ticker||''};
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  const c=candidates[0]; if(!c)return null;
  const move1=Math.abs(analysis.setup.target1-spot),move2=Math.abs(analysis.setup.target2-spot),move3=Math.abs(analysis.setup.target3-spot),stopMove=Math.abs(analysis.setup.stop-spot);
  const gamma=Math.abs(Number(c.raw.greeks?.gamma||0)), sign=analysis.direction==='CALL'?1:-1;
  const est=(move,up=true)=>Math.max(.01,c.mid + (up?1:-1)*(c.delta*move + .5*gamma*move*move));
  return {
    symbol:c.ticker,type:c.type,strike:c.strike,expiry:c.expiry,dte:c.dte,mid:round(c.mid),bid:round(Number(c.raw.last_quote?.bid||c.raw.last_quote?.bid_price||0))||null,
    ask:round(Number(c.raw.last_quote?.ask||c.raw.last_quote?.ask_price||0))||null,spreadPct:round(c.spread,1),delta:round(c.delta,2),gamma:round(gamma,3),
    theta:round(Number(c.raw.greeks?.theta||0),3),iv:round(Number(c.raw.implied_volatility||0)*100,1),volume:c.vol,openInterest:c.oi,quality:c.score,
    premiumTargets:[round(est(move1,true)),round(est(move2,true)),round(est(move3,true))],premiumStop:round(est(stopMove,false)),
    note:'أهداف Premium تقديرية من Delta/Gamma وليست تسعيرًا مضمونًا.'
  };
}
async function analyzeOne(symbol,withOption=false){
  const a=ictAnalyze(symbol,await stockData(symbol));
  if(withOption&&['CALL','PUT'].includes(a.direction))try{a.option=await bestOption(a)}catch(e){a.optionError=e.message}
  return a;
}
async function scan(){
  const key='scan',hit=cache.get(key);if(hit&&Date.now()-hit.t<25000)return hit.v;
  const out=[];
  for(let i=0;i<UNIVERSE.length;i+=4){
    const batch=UNIVERSE.slice(i,i+4);
    const rows=await Promise.all(batch.map(async s=>{try{return await analyzeOne(s,false)}catch(e){return {symbol:s,state:'ERROR',confidence:0,error:e.message}}}));
    out.push(...rows); if(i+4<UNIVERSE.length)await sleep(120);
  }
  out.sort((a,b)=>(['CALL','PUT'].includes(b.state)?1:0)-(['CALL','PUT'].includes(a.state)?1:0)||Number(b.confidence||0)-Number(a.confidence||0)||Number(b.liquidity?.atrPct||0)-Number(a.liquidity?.atrPct||0));
  const top=out.filter(x=>['CALL','PUT'].includes(x.state)).slice(0,6);
  await Promise.all(top.map(async a=>{try{a.option=await bestOption(a)}catch(e){a.optionError=e.message}}));
  for(const a of out){if(a.option){a.tradeScore=Number(a.confidence||0)+Math.min(25,Number(a.option.quality||0)/5)+Math.min(10,Number(a.liquidity?.atrPct||0)*12)}else a.tradeScore=Number(a.confidence||0)-20}
  out.sort((a,b)=>(b.option?1:0)-(a.option?1:0)||Number(b.tradeScore||0)-Number(a.tradeScore||0));
  const best=out.find(x=>['CALL','PUT'].includes(x.state)&&x.option)||out.find(x=>['CALL','PUT'].includes(x.state))||out[0]||null;
  const v={updatedAt:new Date().toISOString(),phase:marketPhase(),minConfidence:MIN_CONFIDENCE,universe:UNIVERSE,rows:out,best};
  cache.set(key,{t:Date.now(),v});return v;
}
function json(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj))}
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/api/health')return json(res,200,{ok:true,service:'stocks-ict-scalper',hasMarketKey:Boolean(API_KEY),phase:marketPhase(),time:new Date().toISOString()});
    if(u.pathname==='/api/config')return json(res,200,{service:'Stocks & Options ICT Scalper',universe:UNIVERSE,minConfidence:MIN_CONFIDENCE,phase:marketPhase(),provider:'Massive',hasMarketKey:Boolean(API_KEY)});
    if(u.pathname==='/api/scan')return json(res,200,await scan());
    if(u.pathname==='/api/symbol'){
      const s=String(u.searchParams.get('symbol')||'').toUpperCase();
      if(!UNIVERSE.includes(s))return json(res,400,{error:'Symbol خارج قائمة المتابعة'});
      return json(res,200,await analyzeOne(s,true));
    }
    if(u.pathname==='/'||u.pathname==='/index.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(PAGE)}
    json(res,404,{error:'Not found'});
  }catch(e){console.error(e);json(res,e.statusCode||500,{error:e.message||'Server error'})}
});
server.listen(PORT,'0.0.0.0',()=>console.log('Stocks ICT Scalper listening on',PORT));
