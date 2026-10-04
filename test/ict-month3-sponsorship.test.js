import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonth3Sponsorship} from '../ict-month3-sponsorship.js';

test('Month 3 sponsorship recognizes long setup evidence without becoming an entry gate',()=>{
  const out=buildMonth3Sponsorship({
    side:'BUY',
    price:4100,
    candidate:{
      target1:4112,
      ict:{
        legSweep:{name:'londonLow',level:4092,liquidityClass:'EXTERNAL'},
        trendContinuation:{htfFvg:{valid:true,side:'BUY',timeframe:'H1'}}
      }
    },
    topDown:{reads:{H4:{side:'BUY'},H1:{side:'BUY'}}},
    now:Date.UTC(2026,9,4,12,0,0)
  });
  assert.equal(out.confirmations,4);
  assert.equal(out.supported,true);
  assert.equal(out.advisoryOnly,true);
  assert.equal(out.canCreateSignal,false);
  assert.equal(out.canBlockSignal,false);
  assert.equal(out.canOverrideEntryGate,false);
  assert.equal(out.intermediateTermImbalance.evidence,'SELL_SIDE_LIQUIDITY_RUN');
  assert.equal(out.shortTermExitLiquidity.evidence,'BUY_SIDE_LIQUIDITY_ABOVE');
  assert.equal(out.timeOfDayInfluence.supported,true);
});

test('Month 3 sponsorship does not treat the wrong liquidity side as confirmation',()=>{
  const out=buildMonth3Sponsorship({
    side:'BUY',
    price:4100,
    candidate:{
      target1:4110,
      ict:{legSweep:{name:'pdh',level:4118,liquidityClass:'EXTERNAL'}}
    },
    topDown:{reads:{H4:{side:'SELL'},H1:{side:'SELL'}}},
    now:Date.UTC(2026,9,4,12,0,0)
  });
  assert.equal(out.intermediateTermImbalance.supported,false);
  assert.equal(out.timeOfDayInfluence.supported,false);
  assert.equal(out.higherTimeFramePriceDisplacement.supported,false);
  assert.equal(out.shortTermExitLiquidity.supported,true);
  assert.equal(out.confirmations,1);
  assert.equal(out.supported,false);
});

test('Month 3 sponsorship recognizes short-side liquidity and London/New York high influence',()=>{
  const out=buildMonth3Sponsorship({
    side:'SELL',
    price:4100,
    candidate:{
      target1:4088,
      ict:{legSweep:{name:'nyHigh',level:4110,liquidityClass:'EXTERNAL'}}
    },
    topDown:{reads:{H4:{side:'SELL'},H1:{side:'NEUTRAL'}}},
    now:Date.UTC(2026,9,4,12,0,0)
  });
  assert.equal(out.intermediateTermImbalance.evidence,'BUY_SIDE_LIQUIDITY_RUN');
  assert.equal(out.shortTermExitLiquidity.evidence,'SELL_SIDE_LIQUIDITY_BELOW');
  assert.equal(out.timeOfDayInfluence.evidence,'LONDON_OR_NEW_YORK_HIGH_FORMATION');
  assert.equal(out.confirmations,4);
});
