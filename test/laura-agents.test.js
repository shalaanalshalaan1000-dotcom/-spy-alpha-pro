import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';

const {analyzeLaura}=await import('../gold-laura-agent.js');
const {analyzeBtcLaura}=await import('../btc-laura-engine.js');
const {lauraWeeklyReady,lauraWeeklyMessage}=await import('../telegram-xau-bot-v2.js');
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

function bars(start,count,step,base=90000){
  return Array.from({length:count},(_,i)=>{
    const close=base+i*step;
    return{t:start+i*60000,open:close-step*.5,high:close+step*.8,low:close-step*.8,close,volume:10+i};
  });
}

test('BTC Laura engine produces Laura-only signal without SMC/ICT dependencies',()=>{
  const start=Date.parse('2026-01-01T00:00:00Z');
  const MN1=bars(start,8,1000,92000);
  MN1[MN1.length-2]={...MN1[MN1.length-2],high:102000,low:94000,open:95000,close:101000};
  const W1=bars(start,10,500,96000);
  W1[W1.length-2]={...W1[W1.length-2],high:101000,low:97000,open:98000,close:100500};
  const D1=bars(start,12,250,97000);
  D1[D1.length-2]={...D1[D1.length-2],high:100000,low:98500,open:99000,close:99750};
  const H4=bars(start,12,120,98500);
  const H1=bars(start,12,80,99000);
  const M15=bars(start,12,30,99700);
  M15[M15.length-1]={t:start+12*60000,open:99950,high:100090,low:99920,close:100050,volume:20};
  const M5=bars(start,12,20,99850);
  M5[M5.length-1]={t:start+13*60000,open:100030,high:100080,low:100010,close:100060,volume:20};
  const M1=bars(start,12,10,99920);
  M1[M1.length-1]={t:start+14*60000,open:100040,high:100090,low:100030,close:100070,volume:20};
  const s=analyzeBtcLaura({MN1,W1,D1,H4,H1,M15,M5,M1,ticker:{price:'100070'}});
  assert.equal(s.strategy,'LAURA_CLASSICAL_PRICE_ACTION');
  assert.equal(s.tradeStyle,'LAURA_ONLY');
  assert.equal(s.smc,null);
  assert.equal(s.ict,null);
  assert.equal(s.laura.mode,'LAURA_ONLY');
  assert.equal(s.laura.reads.MN1.side,'BUY');
  assert.equal(s.laura.reads.W1.side,'BUY');
  assert.equal(s.laura.reads.D1.side,'BUY');
  assert.equal(s.action,'BUY');
  assert.equal(s.status,'ACTIVE');
  assert.match(s.reason,/LAURA BUY/);
  assert.deepEqual(s.priceAction.triggers,['DECISIVE_M15_CLOSE','M5_RETEST_HOLD','M1_TIMING']);
});


test('Laura weekly report refuses incomplete HTF data and renders complete top-down context',()=>{
  const incomplete={outlook:{reads:{W1:'NEUTRAL',D1:'NEUTRAL',H4:'NEUTRAL',H1:'NEUTRAL'},lastWeek:null,lastDaily:null,lastH4:null,levels:[]}};
  assert.equal(lauraWeeklyReady(incomplete),false);

  const complete={outlook:{
    bias:'BUY',strength:'HIGH',confidence:84,
    reads:{MN1:'BUY',W1:'BUY',D1:'BUY',H4:'BUY',H1:'BUY'},
    lastMonth:{open:4000,high:4300,low:3950,close:4250,pattern:'BULLISH_CLOSE'},
    lastWeek:{open:4100,high:4230,low:4070,close:4205,pattern:'BULLISH_CLOSE'},
    lastDaily:{open:4170,high:4220,low:4150,close:4205,pattern:'BULLISH_CLOSE'},
    lastH4:{open:4190,high:4210,low:4180,close:4205,pattern:'BULLISH_CLOSE'},
    nearestSupport:{label:'PWL',level:4070},
    nearestResistance:{label:'PMH',level:4300},
    invalidation:{label:'PWL',level:4070},
    nextWeekPath:'BULLISH toward PMH 4300 while support holds',
    levels:[{label:'PWL',level:4070}]
  }};
  assert.equal(lauraWeeklyReady(complete),true);
  const msg=lauraWeeklyMessage(complete);
  assert.match(msg,/MN1 BUY/);
  assert.match(msg,/W1 BUY/);
  assert.match(msg,/H4 BUY/);
  assert.match(msg,/Open: 4100\.000/);
  assert.match(msg,/أقرب مقاومة: PMH 4300\.000/);
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
