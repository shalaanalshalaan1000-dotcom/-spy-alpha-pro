import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTomorrowOutlook} from '../gold-tomorrow-outlook.js';

test('tomorrow outlook is bullish only when HTF context aligns',()=>{
  const out=buildTomorrowOutlook({
    price:4163,
    multiTimeframe:{reads:{W1:{side:'BUY'},D1:{side:'BUY'},H4:{side:'BUY'},H1:{side:'SELL'}}},
    ict:{primaryLiquidity:{label:'PDH',price:4180},levels:{pdh:4180,pdl:4120}}
  },Date.UTC(2026,9,6,20));
  assert.equal(out.bias,'BUY');
  assert.equal(out.mode,'ADVISORY_ONLY');
  assert.equal(out.liquidityTarget.price,4180);
  assert.equal(out.noEntryWithoutM5,true);
});

test('W1/D1 conflict forces conditional balanced outlook',()=>{
  const out=buildTomorrowOutlook({
    price:4163,
    multiTimeframe:{reads:{W1:{side:'SELL'},D1:{side:'BUY'},H4:{side:'BUY'},H1:{side:'BUY'}}},
    ict:{levels:{pdh:4180,pdl:4120}}
  },Date.UTC(2026,9,6,20));
  assert.equal(out.bias,'BALANCED');
  assert.equal(out.htfConflict,true);
  assert.ok(out.contextScore<=62);
});

test('Friday rolls to Monday New York trading date',()=>{
  const out=buildTomorrowOutlook({},Date.UTC(2026,9,9,20));
  assert.equal(out.sessionDate,'2026-10-12');
});
