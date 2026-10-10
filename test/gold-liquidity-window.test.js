import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {goldEntryWindow,nextGoldHighLiquidityWindow} from '../gold-session-entry-policy.js';
import {assessGoldLiquidity} from '../gold-liquidity-window.js';
const at=x=>Date.parse(x);
test('late NY and late London are read-only even if a full ICT MSS exists',()=>{
 assert.equal(goldEntryWindow(at('2026-10-08T17:00:00Z')).allowed,false);
 assert.equal(goldEntryWindow(at('2026-10-08T17:00:00Z')).reason,'LATE_SESSION_NO_NEW_XAU_ENTRIES');
 assert.equal(goldEntryWindow(at('2026-10-08T07:10:00Z')).allowed,true);
 assert.equal(goldEntryWindow(at('2026-10-08T13:00:00Z')).allowed,true);
 assert.equal(goldEntryWindow(at('2026-10-08T16:00:00Z')).allowed,false);
});
test('Gold next-session availability is DST aware and rendered in Riyadh timezone',()=>{
 const next=nextGoldHighLiquidityWindow(at('2026-10-10T12:00:00Z'));
 assert.ok(next);
 assert.equal(next.session,'LONDON');
 assert.match(next.riyadhTime,/Mon/);
 assert.equal(next.timezone,'Asia/Riyadh');
 assert.equal(goldEntryWindow(next.atMs).allowed,true);
});
function observed(now,counts=[30,30,30,30,30,30,30]){
 const out=[];
 for(let offset=7;offset>=1;offset--){
  const start=Math.floor(now/300000)*300000-offset*300000;
  const count=counts[7-offset];
  for(let i=0;i<count;i++){
   const time=start+Math.floor(i*300000/Math.max(1,count));
   const p=4200+Math.sin(i/3)*1.2+(i/Math.max(count,1))*.3;
   out.push({t:time,p});
  }
 }
 return out;
}
test('active quote-density and price motion allow the gate while missing/flat data fail closed',()=>{
 const now=at('2026-10-08T08:07:00Z');
 const okay=assessGoldLiquidity({samples:observed(now),now,quote:{provider:'TRADINGVIEW_OANDA_BAR'}});
 assert.equal(okay.sessionEntryAllowed,true);
 assert.equal(okay.allowNewEntry,true);
 assert.equal(okay.actualTradedVolumeAvailable,false);
 const noData=assessGoldLiquidity({samples:[],now});
 assert.equal(noData.allowNewEntry,false);
 assert.equal(noData.reason,'INSUFFICIENT_COMPLETED_M5_ACTIVITY_HISTORY');
 const sparse=assessGoldLiquidity({samples:observed(now,[30,30,30,30,30,30,2]),now});
 assert.equal(sparse.allowNewEntry,false);
 assert.equal(sparse.reason,'THIN_OBSERVED_QUOTE_ACTIVITY');
 const weekend=assessGoldLiquidity({samples:observed(at('2026-10-10T12:00:00Z')),now:at('2026-10-10T12:00:00Z')});
 assert.equal(weekend.allowNewEntry,false);
});
test('Gold worker gates new entry (not existing manage) and API exposes measured proxy separately from real volume',()=>{
 const worker=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 const ui=fs.readFileSync(new URL('../site-indicator-start.js',import.meta.url),'utf8');
 assert.match(worker,/if\(!activityGate\.allowNewEntry\)/);
 assert.match(worker,/goldLiquidity:assessGoldLiquidity/);
 assert.match(ui,/goldNextLiquidityTime/);
 assert.match(ui,/goldLiquidityGate/);
 assert.match(ui,/source\.goldLiquidity \|\| assessGoldLiquidity/);
});
