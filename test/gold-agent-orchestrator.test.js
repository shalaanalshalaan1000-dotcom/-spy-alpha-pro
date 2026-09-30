import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateGoldAgents, applyAgentExecutionGate, resetGoldAgentMemory } from '../gold-agent-orchestrator.js';

const base = {
  action:'BUY',
  candidateAction:'BUY',
  side:'BUY',
  status:'CONFIRMED',
  executable:true,
  signalId:'agent-test',
  price:4300,
  bid:4299.95,
  ask:4300.05,
  liveFeedFresh:true,
  degraded:false,
  signalConfidence:82,
  entry:4300,
  entryLow:4299.80,
  entryHigh:4300.20,
  stopLoss:4299,
  target1:4301,
  target2:4302,
  target3:4303,
  target4:4304,
  reason:'London liquidity sweep MSS displacement retest FVG',
  multiTimeframe:{
    side:'BUY',
    macroAligned:4,
    intradayAligned:3,
    reads:{
      D1:{side:'BUY'},
      H4:{side:'BUY'},
      H1:{side:'BUY'},
      M15:{side:'BUY'},
      M5:{side:'BUY'},
      M1:{side:'BUY'}
    }
  },
  newsRisk:{available:true,blockEntries:false}
};

function configure() {
  process.env.XAU_ACCOUNT_BALANCE_USD='70';
  process.env.XAU_SAFE_RISK_USD='5';
  process.env.XAU_MAX_RISK_USD='10';
  process.env.XAU_MAX_DAILY_LOSS_USD='10';
  process.env.XAU_MAX_DRAWDOWN_PCT='15';
  process.env.XAU_MAX_SPREAD_USD='1.50';
  process.env.XAU_CONTRACT_SIZE='100';
  process.env.XAU_LOT_STEP='0.01';
  process.env.AGENT_MIN_CONFIDENCE='75';
  process.env.AGENT_MIN_RR='0.60';
}

test('brain/reflex stack is fail-closed while execution permission is off', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  resetGoldAgentMemory();
  const stack=orchestrateGoldAgents(base);
  assert.equal(stack.architecture,'GOLD_AGENT_STACK_V2_BRAIN_REFLEX');
  assert.equal(stack.decision.ready,true);
  assert.equal(stack.decision.executable,false);
  assert.ok(stack.decision.reason.includes('EXECUTION_PERMISSION_OFF'));
  const gated=applyAgentExecutionGate(base);
  assert.equal(gated.action,'WAIT');
  assert.equal(gated.executable,false);
});

test('reflex authorizes only a confirmed fresh setup inside deterministic risk limits', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='true';
  resetGoldAgentMemory();
  const stack=orchestrateGoldAgents(base);
  assert.equal(stack.decision.executable,true);
  assert.equal(stack.decisionSchema.action,'LONG');
  assert.equal(stack.decisionSchema.riskState,'SAFE');
  assert.equal(applyAgentExecutionGate(base).action,'BUY');
});

test('stale data and wide spread are hard vetoes', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='true';
  resetGoldAgentMemory();
  const stale=orchestrateGoldAgents({...base,liveFeedFresh:false,quoteAgeMs:60000});
  assert.equal(stale.decision.executable,false);
  assert.ok(stale.agents.reflex.vetoes.includes('STALE_QUOTE'));

  const wide=orchestrateGoldAgents({...base,bid:4299,ask:4301});
  assert.equal(wide.decision.executable,false);
  assert.ok(wide.agents.risk.vetoes.includes('SPREAD_TOO_WIDE'));
});
