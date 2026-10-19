// XAUUSD entry policy: allow confirmed ICT setups during Asia as well as London/New York.
// London and New York retain their preferred high-participation windows; weekends remain blocked.
// All clocks use native market time zones so daylight saving is handled automatically.
const WINDOWS=[
  {id:'LONDON',timeZone:'Europe/London',start:8*60,end:12*60},
  {id:'NEW_YORK',timeZone:'America/New_York',start:7*60,end:11*60+30}
];
function localClock(at,timeZone){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
  const get=k=>parts.find(x=>x.type===k)?.value||'';
  return {weekday:get('weekday'),minute:Number(get('hour'))*60+Number(get('minute'))};
}
export function goldEntryWindow(at=Date.now()){
  const ms=Number(at);
  if(!Number.isFinite(ms))return {allowed:false,session:'UNKNOWN',reason:'INVALID_ENTRY_TIME_READ_ONLY'};
  const tokyo=localClock(ms,'Asia/Tokyo');
  if(tokyo.weekday==='Sat'||tokyo.weekday==='Sun')return {allowed:false,session:'WEEKEND_READ_ONLY',reason:'WEEKEND_NO_NEW_XAU_ENTRIES'};
  for(const w of WINDOWS){
    const clock=localClock(ms,w.timeZone);
    if(clock.weekday!=='Sat'&&clock.weekday!=='Sun'&&clock.minute>=w.start&&clock.minute<w.end){
      return {allowed:true,session:w.id,reason:'LONDON_NEW_YORK_HIGH_PARTICIPATION_ENTRY_WINDOW'};
    }
  }
  const asia=tokyo.minute>=9*60&&tokyo.minute<18*60;
  return {allowed:true,session:asia?'ASIA_ICT_ENABLED':'OFF_SESSION_ICT_ENABLED',reason:asia?'ASIA_SESSION_ALLOWED_IF_ICT_SETUP_CONFIRMED':'OFF_SESSION_ALLOWED_IF_ICT_SETUP_CONFIRMED'};
}
export const isGoldEntryAllowed=at=>goldEntryWindow(at).allowed;

const displayRiyadh = t => new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
const nextCache = new Map();
export function nextGoldHighLiquidityWindow(now=Date.now()){
  const ms=Number(now);if(!Number.isFinite(ms))return null;
  const bucket=Math.floor(ms/60000);
  if(nextCache.has(bucket))return nextCache.get(bucket);
  if(nextCache.size>8)nextCache.clear();
  // Preferred London/NY windows; this is not a guarantee of a signal or liquidity.
  let result=null;
  for(let i=0;i<=7*24*4;i++){
    const t=Math.ceil(ms/900000)*900000+i*900000;
    const w=goldEntryWindow(t);
    if(w.allowed&&(w.session==='LONDON'||w.session==='NEW_YORK')){result={session:w.session,atMs:t,at:new Date(t).toISOString(),riyadhTime:displayRiyadh(t),timezone:'Asia/Riyadh',type:'EXPECTED_SESSION_ACTIVITY_WINDOW_NOT_GUARANTEED_LIQUIDITY'};break;}
  }
  nextCache.set(bucket,result);return result;
}
