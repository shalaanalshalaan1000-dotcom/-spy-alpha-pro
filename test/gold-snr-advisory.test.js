import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGoldSnr } from '../gold-snr-advisory.js';

test('gold SNR maps nearest support/resistance and is advisory only',()=>{
  const out=analyzeGoldSnr({
    price:4100,
    candidateAction:'BUY',
    sessionLevels:{sessions:{
      TOKYO:{high:4110,low:4098},
      LONDON:{high:4115,low:4090}
    }},
    ict:{primaryLiquidity:{label:'PDH',price:4120}}
  });
  assert.equal(out.mode,'SNR_ADVISORY');
  assert.equal(out.advisoryOnly,true);
  assert.equal(out.executionGate,false);
  assert.equal(out.confidenceBonus,0);
  assert.equal(out.canOpenTrade,false);
  assert.equal(out.canBlockTrade,false);
  assert.equal(out.nearestSupport.level,4098);
  assert.equal(out.nearestResistance.level,4110);
  assert.equal(out.alignment,'SUPPORTIVE');
});

test('gold SNR remains neutral without a trade side',()=>{
  const out=analyzeGoldSnr({price:4100,sessionLevels:{sessions:{TOKYO:{high:4110,low:4098}}}});
  assert.equal(out.side,null);
  assert.equal(out.alignment,'NEUTRAL');
});
