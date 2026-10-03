import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLaura } from '../gold-laura-agent.js';

test('gold Laura is all-timeframe and enters without ICT/SMC conditions',()=>{
  process.env.LAURA_MIN_CONFIDENCE='60';
  process.env.LAURA_DECISIVE_CLOSE_USD='0.25';
  process.env.LAURA_RETEST_TOLERANCE_USD='0.60';
  const source={
    price:130,
    multiTimeframe:{reads:{
      MN1:{side:'BUY'},W1:{side:'BUY'},D1:{side:'BUY'},H4:{side:'BUY'},
      H1:{side:'BUY'},M15:{side:'BUY'},M5:{side:'BUY'},M1:{side:'BUY'}
    }},
    lauraContext:{
      monthly:{closed:{open:80,high:140,low:70,close:130}},
      weekly:{closed:{open:90,high:135,low:85,close:130}},
      daily:{closed:{open:100,high:132,low:98,close:130}},
      h4:{closed:{open:110,high:131,low:108,close:130}},
      h1:{closed:{open:118,high:131,low:117,close:130}},
      m15:{closed:{t:1000,open:99.8,high:131,low:99,close:130}},
      m5:{closed:{t:2000,open:100.2,high:131,low:99.9,close:129}},
      m1:{closed:{t:3000,open:128,high:131,low:127.5,close:130}},
      levels:{pdl:90,pdh:100,pwl:80,pwh:150,pmh:170,pml:70,h4SwingHigh:145,h4SwingLow:95,h1SwingHigh:140,h1SwingLow:98}
    },
    sessionLevels:{sessions:{}}
  };
  const a=analyzeLaura(source,Date.UTC(2026,9,3,12));
  assert.equal(a.mode,'INDEPENDENT_CLASSICAL_PRICE_ACTION');
  assert.equal(a.usesIctSignalLogic,false);
  assert.deepEqual(a.timeframes.macro,['MN1','W1','D1']);
  assert.deepEqual(a.timeframes.timing,['M1']);
  assert.equal(a.outlook.bias,'BUY');
  assert.equal(a.signal.state,'ENTRY');
  assert.equal(a.signal.action,'BUY');
  assert.equal(a.signal.brokenLevel.label,'PDH');
  assert.equal(a.signal.target1.label,'H1_SWING_HIGH');
  assert.match(a.signal.reason,/M1 timing/);
});
