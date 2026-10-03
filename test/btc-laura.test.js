import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBtcLaura } from '../btc-ict-fast.js';

function trend(base,step,n=8){
  return Array.from({length:n},(_,i)=>{
    const open=base+i*step,close=open+step*.6;
    return{t:(i+1)*1000,open,high:close+5,low:open-5,close,volume:100+i};
  });
}

test('BTC legacy engine path is Laura-only with no SMC/ICT dependency',()=>{
  process.env.BTC_LAURA_MIN_CONFIDENCE='60';
  process.env.BTC_LAURA_DECISIVE_CLOSE_USD='25';
  const MN1=trend(100,10),W1=trend(150,10),D1=trend(50,5),H4=trend(80,5),H1=trend(85,4);
  const M15=trend(70,2);M15[M15.length-1]={t:9000,open:85,high:135,low:84,close:130,volume:200};
  const M5=trend(90,2);M5[M5.length-1]={t:9000,open:100,high:132,low:90,close:128,volume:200};
  const M1=trend(110,2);M1[M1.length-1]={t:9000,open:125,high:133,low:124,close:131,volume:200};
  const s=analyzeBtcLaura({MN1,W1,D1,H4,H1,M15,M5,M1,ticker:{price:'131'}});
  assert.equal(s.strategy,'LAURA_CLASSICAL_PRICE_ACTION');
  assert.equal(s.tradeStyle,'LAURA_ONLY');
  assert.equal(s.smc,null);
  assert.equal(s.ict,null);
  assert.equal(s.laura.mode,'LAURA_ONLY');
  assert.equal(s.laura.reads.W1.side,'BUY');
  assert.equal(s.laura.reads.D1.side,'BUY');
  assert.equal(s.laura.reads.H4.side,'BUY');
  assert.ok(['ACTIVE','WAIT'].includes(s.status));
  assert.doesNotMatch(s.reason,/SMC|FVG|ORDER.?BLOCK|LIQUIDITY.?SWEEP/i);
});
