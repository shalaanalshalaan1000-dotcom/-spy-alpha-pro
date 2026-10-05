import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';

const {analyzeLaura}=await import('../gold-laura-agent.js');
const {readFileSync}=await import('node:fs');

test('gold Laura is independent from ICT and uses all-timeframe classical confirmation',()=>{
  const source={
    price:101.3,
    multiTimeframe:{reads:{
      MN1:{side:'BUY'},W1:{side:'BUY'},D1:{side:'BUY'},H4:{side:'BUY'},H1:{side:'BUY'},M15:{side:'BUY'},M5:{side:'BUY'},M1:{side:'BUY'}
    }},
    lauraContext:{
      monthly:{closed:{open:90,high:110,low:85,close:105,t:1}},
      weekly:{closed:{open:95,high:106,low:93,close:104,t:2}},
      daily:{closed:{open:98,high:103,low:97,close:102,t:3}},
      h4:{closed:{open:99,high:102,low:98,close:101,t:4}},
      h1:{closed:{open:100,high:102,low:99,close:101,t:5}},
      m15:{closed:{open:99.7,high:101.4,low:99.5,close:101.1,t:6}},
      m5:{closed:{open:100.4,high:101.4,low:100.2,close:101.15,t:7}},
      m1:{closed:{open:101.05,high:101.4,low:101.0,close:101.3,t:8}},
      levels:{pdh:100,pdl:96,pwh:105,pwl:94,pmh:110,pml:85,h4SwingHigh:103,h4SwingLow:98,h1SwingHigh:102.5,h1SwingLow:99,m15SwingHigh:102,m15SwingLow:99.5,m5SwingHigh:101.8,m5SwingLow:100.2}
    },
    sessionLevels:{sessions:{}}
  };
  const a=analyzeLaura(source,Date.parse('2026-10-03T12:00:00Z'));
  assert.equal(a.name,'LAURA_AGENT');
  assert.equal(a.usesIctSignalLogic,false);
  assert.deepEqual(a.timeframes.macro,['MN1','W1','D1']);
  assert.deepEqual(a.timeframes.structure,['H4','H1']);
  assert.deepEqual(a.timeframes.break,['M15']);
  assert.deepEqual(a.timeframes.retest,['M5']);
  assert.deepEqual(a.timeframes.timing,['M1']);
  assert.equal(a.outlook.bias,'BUY');
  assert.equal(a.signal.action,'BUY');
  assert.equal(a.signal.state,'ENTRY');
  assert.ok(a.signal.target1?.level>a.signal.entry);
  assert.match(a.signal.reason,/all-timeframe classical bias/);
});

test('TradingView HTF subscriptions use canonical daily weekly monthly resolutions',()=>{
  const src=readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
  assert.match(src,/symbol_d1','1D',450/);
  assert.match(src,/symbol_w1','1W',200/);
  assert.match(src,/symbol_mn1','1M',96/);
  assert.doesNotMatch(src,/symbol_d1','D',450/);
  assert.doesNotMatch(src,/symbol_w1','W',200/);
  assert.doesNotMatch(src,/symbol_mn1','M',96/);
});
