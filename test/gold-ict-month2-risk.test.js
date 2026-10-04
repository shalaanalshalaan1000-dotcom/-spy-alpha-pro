import test from 'node:test';
import assert from 'node:assert/strict';
import {month2RiskFramework} from '../gold-ict-swing-model.js';

test('Month 2 advisory marks 3R partial as optional when primary liquidity is beyond 3R',()=>{
  const x=month2RiskFramework('BUY',100,98,{rr:2,primaryLiquidity:{price:108},secondaryLiquidity:{price:104}});
  assert.equal(x.advisoryOnly,true);
  assert.equal(x.entryGate,false);
  assert.equal(x.idealMinimumRewardRisk,3);
  assert.equal(x.riskDistance,2);
  assert.equal(x.threeRPrice,106);
  assert.equal(x.primaryLiquidityPrice,108);
  assert.equal(x.primaryBeyond3R,true);
  assert.equal(x.management.mode,'OPTIONAL_PARTIAL_AT_3R_THEN_RUNNER');
  assert.equal(x.management.partialFraction,.5);
  assert.equal(x.management.runnerTarget,'PRIMARY_EXTERNAL_LIQUIDITY');
});

test('Month 2 advisory never forces a 3R target when external liquidity comes first',()=>{
  const x=month2RiskFramework('SELL',100,102,{rr:2.5,primaryLiquidity:{price:95}});
  assert.equal(x.threeRPrice,94);
  assert.equal(x.primaryLiquidityPrice,95);
  assert.equal(x.primaryBeyond3R,false);
  assert.equal(x.management.mode,'LIQUIDITY_FIRST_NO_FORCED_3R');
  assert.equal(x.entryGate,false);
});

test('Month 2 advisory rejects invalid inputs without affecting the model',()=>{
  assert.equal(month2RiskFramework('WAIT',100,98,{}),null);
  assert.equal(month2RiskFramework('BUY',100,100,{}),null);
});
