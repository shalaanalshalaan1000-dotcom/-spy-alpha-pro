import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBtcLaura } from '../btc-ict-fast.js';

function trend(base,step,n=10){
  return Array.from({length:n},(_,i)=>{
    const open=base+i*step,close=open+step*.6;
    return{t:(i+1)*3600000,open,high:Math.max(open,close)+2,low:Math.min(open,close)-2,close,volume:100+i};
  });
}
function precisionM5(){
  return [
    {t:1,open:122,high:124,low:121,close:123,volume:10},
    {t:2,open:123,high:125,low:122,close:124,volume:10},
    {t:3,open:124,high:126,low:123,close:125,volume:10},
    {t:4,open:125,high:126,low:123.5,close:124,volume:10},
    {t:5,open:124,high:125,low:120,close:124.8,volume:20},
    {t:6,open:124.8,high:128,low:126.5,close:127.5,volume:30},
    {t:7,open:127.4,high:129,low:127,close:128,volume:20},
    {t:8,open:127,high:127.2,low:126.1,close:126.3,volume:18}
  ];
}

test('BTC Sunday trial uses Laura HTF bias with M5 precision entry model',()=>{
  process.env.BTC_LAURA_MIN_CONFIDENCE='60';
  const MN1=trend(80,3),W1=trend(90,2.5),D1=trend(95,2),H4=trend(100,1.5),H1=trend(105,1.2);
  H1[2]={...H1[2],low:116,high:118,open:116.5,close:117.5};
  H1[0]={...H1[0],high:110};
  const M15=trend(112,1,10);
  const M5=precisionM5();
  const M1=trend(120,.4,12);
  const ETHH1=trend(2000,8,10);
  const s=analyzeBtcLaura({MN1,W1,D1,H4,H1,M15,M5,M1,ETHH1,ticker:{price:'126.3'}});
  assert.equal(s.strategy,'LAURA_PRECISION_HYBRID');
  assert.equal(s.tradeStyle,'LAURA_PLUS_PRECISION');
  assert.equal(s.laura.mode,'LAURA_PLUS_PRECISION');
  assert.deepEqual(s.precision.requiredGates,[
    'LAURA_HTF_BIAS',
    'D1_H1_POI',
    'M5_SWEEP_CISD_OR_MSS_DISPLACEMENT_FVG_RETRACE'
  ]);
  assert.equal(s.precision.confluence.poi.valid,true);
  assert.equal(s.precision.m5.complete,true);
  assert.equal(s.status,'ACTIVE');
  assert.equal(s.action,'BUY');
  assert.ok(s.entry>s.stopLoss);
  assert.deepEqual(s.priceAction.triggers.slice(0,3),['M5_LIQUIDITY_SWEEP','CISD_OR_MSS','DISPLACEMENT']);
  assert.doesNotMatch(s.reason,/M15 decisive|M1 timing/i);
});
