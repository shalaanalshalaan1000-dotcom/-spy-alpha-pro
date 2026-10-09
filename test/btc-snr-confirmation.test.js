import test from 'node:test';
import assert from 'node:assert/strict';
import {btcSnrConfirmation,btcStructuralStop,lifecycleSignal,resetBtcLifecycleForTests} from '../btc-snr-engine.js';
const zone={kind:'RESISTANCE',low:990,high:1000};
const prev15={t:0,close:998},m15={t:900000,close:1012};
const m5={t:1800000,open:1010,high:1015,low:999,close:1012};
const m1={t:2100000,open:1012,high:1014,low:1011,close:1013};
const args={zone,m5,m1,m15,prev15,side:'BUY',type:'SNR_BREAKOUT_RETEST',retestTol:2,breakBuf:5};
test('breakout needs a later M5 retest and subsequent directional M1',()=>{
  assert.equal(btcSnrConfirmation(args),true);
  assert.equal(btcSnrConfirmation({...args,m5:{...m5,t:1500000},m1:{...m1,t:1800000}}),false);
  assert.equal(btcSnrConfirmation({...args,m1:{...m1,t:2040000}}),false);
  assert.equal(btcSnrConfirmation({...args,m5:{...m5,low:1005}}),false);
  assert.equal(btcSnrConfirmation({...args,m1:{...m1,open:1014,close:1013}}),false);
});
test('SELL breakout uses the mirrored chronological support retest',()=>{
  const mirror=b=>({...b,open:2000-b.open,high:2000-b.low,low:2000-b.high,close:2000-b.close});
  const x={...args,side:'SELL',zone:{kind:'SUPPORT',low:1000,high:1010},prev15:{...prev15,close:1002},m15:{...m15,close:988},m5:mirror(m5),m1:mirror(m1)};
  assert.equal(btcSnrConfirmation(x),true);
  assert.equal(btcSnrConfirmation({...x,m5:{...x.m5,t:1500000}}),false);
});
test('rejection needs an actual rejection wick and reclaim beyond the whole zone',()=>{
  const support={kind:'SUPPORT',low:990,high:1000};
  const reaction={t:1800000,open:998,high:1005,low:980,close:1003};
  const x={zone:support,m5:reaction,m1:{...m1,open:1003,close:1004},side:'BUY',type:'SNR_REJECTION',retestTol:2};
  assert.equal(btcSnrConfirmation(x),true);
  assert.equal(btcSnrConfirmation({...x,m5:{...reaction,low:997}}),false);
  assert.equal(btcSnrConfirmation({...x,m5:{...reaction,close:997}}),false);
});
test('structural stop sits beyond rejection/retest extreme as well as the zone',()=>{
  assert.equal(btcStructuralStop({low:990,high:1000},{low:980,high:1005},'BUY',5),975);
  assert.equal(btcStructuralStop({low:990,high:1000},{low:980,high:1015},'SELL',5),1020);
});
test('a signal still tracks TP after its entry window ends and cannot issue an opposite signal',()=>{
  resetBtcLifecycleForTests();
  const at=Date.UTC(2026,9,9,12);
  const buy={status:'ACTIVE',action:'BUY',setupId:'buy',entry:100,stopLoss:90,target1:110,target2:120,price:100};
  lifecycleSignal(buy,at);
  const opposing={status:'ACTIVE',action:'SELL',setupId:'sell',entry:103,stopLoss:115,target1:90,price:103};
  const managing=lifecycleSignal(opposing,at+360000);
  assert.equal(managing.status,'MANAGING');assert.equal(managing.tradeSide,'BUY');
  assert.equal(managing.setupId,'buy');assert.equal(managing.action,'WAIT');
  const hit=lifecycleSignal({status:'WAIT',price:110},at+400000);
  assert.equal(hit.status,'TP1_HIT');assert.equal(hit.targetHits[0],true);
  const closed=lifecycleSignal({status:'WAIT',price:120},at+500000);
  assert.equal(closed.closedReason,'TP2');
});
