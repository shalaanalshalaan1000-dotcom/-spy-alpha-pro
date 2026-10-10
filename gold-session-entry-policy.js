// XAUUSD entry policy: Asian/Tokyo market is observation-only.
// High-participation entry windows only: London 08:00–11:30 local and NY 08:15–11:30 local.
// These are conservative trade-entry cutoffs, not claims about official exchange closure.
// All clocks use native market time zones so daylight saving is handled automatically.
const WINDOWS=[
  {id:'LONDON',timeZone:'Europe/London',start:8*60,end:11*60+30},
  {id:'NEW_YORK',timeZone:'America/New_York',start:8*60+15,end:11*60+30}
];
function localClock(at,timeZone){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
  const get=k=>parts.find(x=>x.type===k)?.value||'';
  return {weekday:get('weekday'),minute:Number(get('hour'))*60+Number(get('minute'))};
}
export function goldEntryWindow(at=Date.now()){
  const ms=Number(at);
  if(!Number.isFinite(ms))return {allowed:false,session:'UNKNOWN',reason:'INVALID_ENTRY_TIME_READ_ONLY'};
  for(const w of WINDOWS){
    const clock=localClock(ms,w.timeZone);
    if(clock.weekday!=='Sat'&&clock.weekday!=='Sun'&&clock.minute>=w.start&&clock.minute<w.end){
      return {allowed:true,session:w.id,reason:'LONDON_NEW_YORK_HIGH_PARTICIPATION_ENTRY_WINDOW'};
    }
  }
  const late=WINDOWS.some(w=>{const c=localClock(ms,w.timeZone);return c.weekday!=='Sat'&&c.weekday!=='Sun'&&c.minute>=w.end&&c.minute<(w.id==='LONDON'?16*60+30:13*60+30);});
  if(late)return {allowed:false,session:'LATE_SESSION_READ_ONLY',reason:'LATE_SESSION_NO_NEW_XAU_ENTRIES'};
  const tokyo=localClock(ms,'Asia/Tokyo');
  const asia=tokyo.weekday!=='Sat'&&tokyo.weekday!=='Sun'&&tokyo.minute>=9*60&&tokyo.minute<18*60;
  return {allowed:false,session:asia?'ASIA_READ_ONLY':'OFF_SESSION_READ_ONLY',reason:asia?'ASIA_READ_ONLY_NO_NEW_XAU_TRADES':'OUTSIDE_LONDON_NEW_YORK_NO_NEW_XAU_TRADES'};
}
export const isGoldEntryAllowed=at=>goldEntryWindow(at).allowed;

const displayRiyadh = t => new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
const nextCache = new Map();
export function nextGoldHighLiquidityWindow(now=Date.now()){
  const ms=Number(now);if(!Number.isFinite(ms))return null;
  const bucket=Math.floor(ms/60000);
  if(nextCache.has(bucket))return nextCache.get(bucket);
  if(nextCache.size>8)nextCache.clear();
  // Entry windows use DST-aware local clocks. Search up to a week across weekends.
  let result=null;
  for(let i=0;i<=7*24*4;i++){
    const t=Math.ceil(ms/900000)*900000+i*900000;
    const w=goldEntryWindow(t);
    if(w.allowed){result={session:w.session,atMs:t,at:new Date(t).toISOString(),riyadhTime:displayRiyadh(t),timezone:'Asia/Riyadh',type:'EXPECTED_SESSION_ACTIVITY_WINDOW_NOT_GUARANTEED_LIQUIDITY'};break;}
  }
  nextCache.set(bucket,result);return result;
}
