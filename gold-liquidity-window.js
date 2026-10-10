import { goldEntryWindow, nextGoldHighLiquidityWindow } from './gold-session-entry-policy.js';
// Spot XAUUSD has no consolidated exchange trade volume from the present feed.
// This is an observation-density + price-activity proxy, NOT actual traded volume.
// A setup without sufficiently granular live observations must not generate a late/illiquid entry.
const n=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=2)=>v==null?null:Number(v.toFixed(d));
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
export function assessGoldLiquidity({samples=[],now=Date.now(),quote=null}={}){
 const entryWindow=goldEntryWindow(now);
 const nextWindow=nextGoldHighLiquidityWindow(now);
 const base={
  model:'XAU_SESSION_ACTIVITY_PROXY_V1',symbol:'XAUUSD',
  actualTradedVolumeAvailable:false,volumeSource:'NONE',
  activitySource:'TIMESTAMPED_MARKET_OBSERVATIONS_PROXY_NOT_TRADED_VOLUME',
  quoteProvider:quote?.provider??null,session:entryWindow.session,
  sessionEntryAllowed:entryWindow.allowed,sessionReason:entryWindow.reason,
  recommendedWindow:nextWindow,activityRatio:null,latestCompletedM5Range:null,
  baselineM5Range:null,recentM5Observations:0,minimumObservations:12,
  marketActivity:'UNAVAILABLE',allowNewEntry:false,
  reason:entryWindow.allowed?'AWAITING_LIVE_ACTIVITY_DATA':entryWindow.reason,
  caveat:'Observed updates and candle movement are proxies, not proof of executable volume, market depth, or fills.'
 };
 if(!entryWindow.allowed)return base;
 const rows=Array.isArray(samples)?samples:[];
 const buckets=new Map(),current=Math.floor(now/300000)*300000;
 for(const sample of rows){
  const t=n(sample?.t),p=n(sample?.p??sample?.price??sample?.close);
  if(t==null||p==null||p<=0||t>=current||t<current-9*300000)continue;
  const key=Math.floor(t/300000)*300000,b=buckets.get(key);
  if(!b)buckets.set(key,{t:key,high:p,low:p,count:1});
  else{b.high=Math.max(b.high,p);b.low=Math.min(b.low,p);b.count++;}
 }
 const latest=buckets.get(current-300000),prior=[];
 for(let i=2;i<=7;i++){
  const b=buckets.get(current-i*300000);
  if(b&&b.count>0)prior.push({count:b.count,range:b.high-b.low});
 }
 if(!latest||prior.length<3)return {...base,reason:'INSUFFICIENT_COMPLETED_M5_ACTIVITY_HISTORY'};
 const normalCount=median(prior.map(x=>x.count));
 const normalRange=median(prior.map(x=>x.range).filter(x=>x>0));
 const range=latest.high-latest.low;
 const relative=normalCount?latest.count/normalCount:null;
 const enough=latest.count>=12&&normalCount>=12&&relative>=0.65;
 const moving=normalRange!=null&&range>=Math.max(0.15,normalRange*0.45);
 const allowNewEntry=Boolean(enough&&moving);
 const reason=!enough?'THIN_OBSERVED_QUOTE_ACTIVITY':!moving?'FLAT_OR_LOW_M5_PRICE_ACTIVITY':'ACTIVITY_PROXY_PASS';
 return {...base,recentM5Observations:latest.count,
  baselineM5Observations:normalCount,activityRatio:round(relative,2),
  latestCompletedM5Range:round(range,3),baselineM5Range:round(normalRange,3),
  marketActivity:allowNewEntry?'ACTIVE_PROXY':'THIN_PROXY',
  allowNewEntry,reason};
}
