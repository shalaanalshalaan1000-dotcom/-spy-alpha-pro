import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBtcDolMap,completedBtcSessionLevels,projectBtcDolSide} from '../btc-dol-map.js';
import {detectBtcIctSequence} from '../btc-ict-engine.js';

const FIVE=300000,now=Date.UTC(2026,9,14,12);
const asiaStart=Date.UTC(2026,9,14,0);
const fullAsia=Array.from({length:96},(_,i)=>({
 t:asiaStart+i*FIVE,open:1000,close:1000,
 high:i===20?1035:1005,low:i===45?965:995,volume:10
}));

test('fully observed CLOSED BTC UTC session becomes named external BSL/SSL, never a current forming session',()=>{
 const developingLondon=Array.from({length:48},(_,i)=>({
  t:Date.UTC(2026,9,14,8)+i*FIVE,open:1000,close:1000,high:1200,low:800
 }));
 const dol=buildBtcDolMap({M5:[...fullAsia,...developingLondon],now,price:1000});
 const pools=dol.byTimeframe.SESSION;
 assert.equal(pools.find(p=>p.label==='ASIA_HIGH')?.level,1035);
 assert.equal(pools.find(p=>p.label==='ASIA_LOW')?.level,965);
 assert.ok(pools.every(p=>p.targetEligible&&p.liquidityClass==='EXTERNAL_COMPLETED_SESSION'));
 assert.equal(pools.some(p=>p.label.startsWith('LONDON_')),false);
 assert.equal(pools.some(p=>p.label.startsWith('NEW_YORK_')),false);
 assert.equal(projectBtcDolSide(dol,'BUY',1000).targetPreview[0].label,'ASIA_HIGH');
 assert.equal(projectBtcDolSide(dol,'SELL',1000).targetPreview[0].label,'ASIA_LOW');
});

test('session evidence is fail-closed on missing or incomplete M5 candles',()=>{
 assert.deepEqual(completedBtcSessionLevels(fullAsia.filter((_,i)=>i!==17),now),[]);
 assert.deepEqual(completedBtcSessionLevels(fullAsia.slice(0,-1),now),[]);
 assert.deepEqual(completedBtcSessionLevels(fullAsia.slice(1),now),[]);
 assert.equal(completedBtcSessionLevels(fullAsia,Date.UTC(2026,9,14,7,55)).length,0);
 assert.equal(completedBtcSessionLevels(fullAsia,now).map(x=>x.id).join(','),'ASIA');
});

function ictCandles(){
 const t=now-18*FIVE;
 const bars=Array.from({length:18},(_,i)=>({t:t+i*FIVE,open:1000,high:1008,low:995,close:1001}));
 bars[6]={...bars[6],high:1030,close:1010};
 bars[12]={...bars[12],open:995,high:1003,low:980,close:995};
 bars[13]={...bars[13],open:995,high:1041,low:994,close:1038};
 bars[14]={...bars[14],open:1038,high:1040,low:1028,close:1035};
 bars[15]={...bars[15],open:1034,high:1052,low:1033,close:1048};
 return bars;
}

test('completed named BTC session can be swept, but M5 MSS and a LATER retest still required',()=>{
 const pool={timeframe:'SESSION',label:'ASIA_LOW',level:990,liquiditySide:'SSL',
   liquidityClass:'EXTERNAL_COMPLETED_SESSION',targetEligible:true};
 const bars=ictCandles();
 const full=detectBtcIctSequence({M5:bars,externalLevels:[pool],atr5:6,now});
 assert.equal(full.length,1);
 assert.equal(full[0].pool.label,'ASIA_LOW');
 assert.ok(full[0].sweepAt<full[0].mssAt&&full[0].mssAt<full[0].retestAt);
 const noRetest=bars.map((b,i)=>i>=14?{...b,high:1060,low:1050,close:1058}:b);
 assert.deepEqual(detectBtcIctSequence({M5:noRetest,externalLevels:[pool],atr5:6,now}),[]);
 assert.deepEqual(detectBtcIctSequence({M5:bars,externalLevels:[{...pool,targetEligible:false}],atr5:6,now}),[]);
 assert.deepEqual(detectBtcIctSequence({M5:bars,externalLevels:[{...pool,label:'H1_SWING_LOW'}],atr5:6,now}),[]);
});
