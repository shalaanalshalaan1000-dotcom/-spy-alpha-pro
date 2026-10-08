// XAUUSD entry policy: Asian/Tokyo market is observation-only.
// All clocks use native market time zones so daylight saving is handled automatically.
const WINDOWS=[
  {id:'LONDON',timeZone:'Europe/London',start:8*60,end:16*60+30},
  {id:'NEW_YORK',timeZone:'America/New_York',start:8*60+15,end:13*60+30}
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
      return {allowed:true,session:w.id,reason:'LONDON_NEW_YORK_EXECUTION_WINDOW'};
    }
  }
  const tokyo=localClock(ms,'Asia/Tokyo');
  const asia=tokyo.weekday!=='Sat'&&tokyo.weekday!=='Sun'&&tokyo.minute>=9*60&&tokyo.minute<18*60;
  return {allowed:false,session:asia?'ASIA_READ_ONLY':'OFF_SESSION_READ_ONLY',reason:asia?'ASIA_READ_ONLY_NO_NEW_XAU_TRADES':'OUTSIDE_LONDON_NEW_YORK_NO_NEW_XAU_TRADES'};
}
export const isGoldEntryAllowed=at=>goldEntryWindow(at).allowed;
