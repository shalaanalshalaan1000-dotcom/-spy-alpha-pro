// Deterministic XAUUSD signal guardrails. Price distances are USD per ounce,
// not cash risk for an account/lot. Existing ACTIVE trades remain managed.
export const MAX_GOLD_STOP_DISTANCE_USD = 10;

const finite = value => value !== null && value !== undefined && value !== '' &&
  typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : null;
const rounded = (value, digits=3) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

export function goldStopDistanceCheck(entry, stop, maxDistance=MAX_GOLD_STOP_DISTANCE_USD) {
  const e=finite(entry), s=finite(stop), max=finite(maxDistance);
  const distance=e!=null&&s!=null?Math.abs(e-s):null;
  const allowed=Boolean(e>0&&s>0&&distance>0&&max>0&&distance<=max+1e-9);
  return {allowed,distance:rounded(distance),maxDistance:max,
    reason:distance==null||!(distance>0)||!(max>0)?'INVALID_STOP_DISTANCE':
      distance>max+1e-9?'STOP_DISTANCE_EXCEEDS_10_USD':'OK'};
}

export function tp1HalfwayPrice(entry, target1) {
  const e=finite(entry),t=finite(target1);
  return e>0&&t>0&&t!==e ? rounded(e+(t-e)*0.5) : null;
}

export function halfwayTp1Reached(side, entry, target1, executableExitPrice) {
  const e=finite(entry),t=finite(target1),p=finite(executableExitPrice);
  if(!e||!t||!p||!['BUY','SELL'].includes(side))return false;
  if(side==='BUY'&&t<=e||side==='SELL'&&t>=e)return false;
  const halfway=e+(t-e)*0.5;
  return side==='BUY'?p>=halfway:p<=halfway;
}

export function entryZoneAudit(entry, low, high, stopLoss) {
  const e=finite(entry),lo=finite(low),hi=finite(high),stop=finite(stopLoss);
  if(e==null||lo==null||hi==null||lo>hi)return {status:'UNKNOWN',inside:null,distance:null,distanceR:null};
  const distance=e<lo?lo-e:e>hi?e-hi:0;
  const risk=stop!=null?Math.abs(e-stop):null;
  return {status:distance<=1e-9?'INSIDE_PLANNED_POI':'EXECUTED_OUTSIDE_PLANNED_POI',
    inside:distance<=1e-9,distance:rounded(distance),distanceR:risk>0?rounded(distance/risk,3):null,
    plannedLow:lo,plannedHigh:hi,actualEntry:e,executionPolicy:'M1_MSS_RETEST_HOLD_NOT_ORIGINAL_POI_RETOUCH'};
}

// Audit score is descriptive, not a calibrated win probability or an entry gate.
export function goldSetupAuditScore({ict={},entry,stopLoss,target1,entryLow,entryHigh,sessionAllowed=false}={}) {
  const sweep=ict?.legSweep||ict?.sweep||{};
  const mss=ict?.sequence1?.firstMss||{};
  const retest=Boolean(ict?.m1MssRetest?.confirmed||ict?.coreIctEntryReady);
  const stop=goldStopDistanceCheck(entry,stopLoss);
  const zone=entryZoneAudit(entry,entryLow,entryHigh,stopLoss);
  const reward=Math.abs(Number(target1)-Number(entry));
  const rr=stop.distance>0&&Number.isFinite(reward)?reward/stop.distance:null;
  const points={
    externalSweep:sweep.liquidityClass==='EXTERNAL'?25:0,
    closedM1Mss:mss.mss&&mss.closeT?20:0,
    m1Displacement:ict?.hasDisplacement===true?10:0,
    m1Retest:retest?15:0,
    session:sessionAllowed?10:0,
    stopDistance:stop.allowed?10:0,
    entryZone:zone.inside===true?5:zone.distanceR!=null&&zone.distanceR<=0.25?3:0,
    tp1Practicality:rr!=null&&rr>=0.6&&rr<=3?5:rr!=null&&rr>3&&rr<=6?3:rr!=null&&rr>6?1:0
  };
  const score=Math.max(0,Math.min(100,Object.values(points).reduce((a,b)=>a+b,0)));
  return {score,points,version:'XAU_SETUP_AUDIT_V1',calibratedWinProbability:false,
    entryGate:false,zone,stop,rrToTp1:rounded(rr,2)};
}
