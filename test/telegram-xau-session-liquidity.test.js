import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.TELEGRAM_FRIDAY_PRIMARY_MAX_DISTANCE_USD='25';

const {sessionLiquidityTargets,sessionReversalSetupMessage}=await import('../telegram-xau-bot-v2.js');

const friday=Date.parse('2026-10-02T18:00:00Z');
const thursday=Date.parse('2026-10-01T18:00:00Z');

test('nearest closed-session external liquidity becomes Secondary and next becomes strategic Primary',()=>{
  const rows=[
    {id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4192.280,low:4133.715},
    {id:'LONDON',label:'LONDON',status:'CLOSED',high:4152.000,low:4138.000},
    {id:'NEW_YORK',label:'NEW YORK',status:'CLOSED',high:4166.000,low:4140.000}
  ];
  const t=sessionLiquidityTargets(rows,'LOW',4143.225,friday);
  assert.equal(t.secondary?.level,4152);
  assert.equal(t.primary?.level,4166);
  assert.equal(t.primaryFiltered,false);

  const msg=sessionReversalSetupMessage(
    rows[0],
    'LOW',
    {open:4142.8,high:4144,low:4141.8,close:4143.225},
    {level:4133.715,reversalTrigger:4142.915,sweepExtreme:4133.427},
    rows,
    friday
  );
  assert.match(msg,/Secondary BSL: 4152\.000/);
  assert.match(msg,/Primary BSL: 4166\.000/);
  assert.doesNotMatch(msg,/Primary BSL: 4192\.280/);
  assert.match(msg,/BUY يستهدف BSL وSELL يستهدف SSL/);
});

test('Friday does not present a far-only external level as Primary',()=>{
  const rows=[{id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4192.280,low:4133.715}];
  const t=sessionLiquidityTargets(rows,'LOW',4143.225,friday);
  assert.equal(t.primary,null);
  assert.equal(t.secondary?.level,4192.280);
  assert.equal(t.primaryFiltered,true);
});

test('non-Friday single external objective remains Primary without duplicate Secondary',()=>{
  const rows=[{id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4192.280,low:4133.715}];
  const t=sessionLiquidityTargets(rows,'LOW',4143.225,thursday);
  assert.equal(t.primary?.level,4192.280);
  assert.equal(t.secondary,null);
  assert.equal(t.friday,false);
});
