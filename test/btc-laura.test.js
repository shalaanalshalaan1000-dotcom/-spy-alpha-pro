import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBtcLaura } from '../btc-ict-fast.js';

function trend(base,step,n=10){
  return Array.from({length:n},(_,i)=>{
    const open=base+i*step,close=open+step*.6;
    return{t:(i+1)*3600000,open,high:Math.max(open,close)+30,low:Math.min(open,close)-30,close,volume:100+i};
  });
}

test('BTC runtime is Laura-only and does not require Precision/SMC/ICT gates',()=>{
  process.env.BTC_LAURA_MIN_CONFIDENCE='70';
  const MN1=trend(82000,500);
  const W1=trend(89000,200);
  W1[8]={...W1[8],high:92000};
  const D1=trend(90000,100);
  const H4=trend(90000,100);
  const H1=trend(90000,100);
  const M15=trend(90400,40);
  M15[M15.length-1]={...M15.at(-1),open:90880,high:90980,low:90860,close:90940};
  const M5=trend(90600,30);
  M5[M5.length-1]={...M5.at(-1),open:90910,high:90980,low:90880,close:90950};
  const M1=trend(90700,20);
  M1[M1.length-1]={...M1.at(-1),open:90940,high:90980,low:90930,close:90960};

  const s=analyzeBtcLaura({MN1,W1,D1,H4,H1,M15,M5,M1,ticker:{price:'90960'}});
  assert.equal(s.strategy,'LAURA_CLASSICAL_PRICE_ACTION');
  assert.equal(s.tradeStyle,'LAURA_ONLY');
  assert.equal(s.laura.mode,'LAURA_ONLY');
  assert.equal(s.smc,null);
  assert.equal(s.ict,null);
  assert.equal('precision' in s,false);
  assert.equal(s.status,'ACTIVE');
  assert.equal(s.action,'BUY');
  assert.ok(s.entry>s.stopLoss);
  assert.deepEqual(s.priceAction.triggers,['DECISIVE_M15_CLOSE','M5_RETEST_HOLD','M1_TIMING']);
  assert.match(s.reason,/LAURA BUY/);
  assert.doesNotMatch(s.reason,/CISD|MSS|FVG|sweep|precision|PSP|POI/i);
});
