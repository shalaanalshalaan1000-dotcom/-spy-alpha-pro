import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateGoldAgents, applyAgentExecutionGate, resetGoldAgentMemory } from '../gold-agent-orchestrator.js';

const base = {
  action:'BUY',
  candidateAction:'BUY',
  side:'BUY',
  status:'CONFIRMED',
  executable:false,
  entered:true,
  triggered:true,
  brokerConfirmed:false,
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
    month6Support:{
      source:'ICT_MONTH_6_SWING_TRADING',mode:'SUPPORT_ONLY',advisoryOnly:true,blocksExecution:false,
      sequence:'MN1 > W1 > D1 > H4',side:'BUY',aligned:3,opposed:1,
      reads:{MN1:'BUY',W1:'SELL',D1:'BUY',H4:'BUY'},pdLocation:'DISCOUNT',pdPreferred:true,
      poiType:'FVG_OB_CONFLUENCE',drawOnLiquidity:{label:'PWH',price:4350},htfConflict:false
    },
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
  assert.equal(stack.architecture,'GOLD_AGENT_STACK_V3_TRADING_HUB');
  assert.equal(stack.decision.ready,true);
  assert.equal(stack.decision.executable,false);
  assert.equal(stack.agents.trading.advisoryReady,true);
  assert.equal(stack.agents.trading.manualAction,'BUY');
  assert.equal(stack.agents.trading.executable,false);
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
  const live=applyAgentExecutionGate(base);
  assert.equal(live.action,'BUY');
  assert.equal(live.executable,true);
  assert.equal(live.executionMode,'AGENT_TRADING_HUB');
  assert.equal(live.agentStack.agents.trading.action,'BUY');
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


test('all specialist agents feed the trading agent and Telegram brief', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  resetGoldAgentMemory();
  const stack=orchestrateGoldAgents(base);
  const trading=stack.agents.trading;
  assert.equal(trading.name,'TRADING_AGENT');
  assert.equal(trading.feed.brain,'LONG');
  assert.equal(trading.feed.market,'READY');
  assert.equal(trading.feed.setup,'CONFIRMED');
  assert.equal(trading.feed.risk,'PASS');
  assert.equal(stack.agents.drawOnLiquidity.name,'DRAW_ON_LIQUIDITY_AGENT');
  assert.equal(stack.agents.drawOnLiquidity.canCreateSignal,false);
  assert.equal(stack.agents.drawOnLiquidity.canOverrideIctGate,false);
  assert.equal(trading.feed.drawOnLiquidity,'MAPPED');
  assert.equal(trading.feed.research,'CLEAR');
  assert.equal(trading.feed.finalCheck,'PASS');
  assert.equal(stack.agents.market.context.month6Support?.mode,'SUPPORT_ONLY');
  assert.equal(stack.agents.market.context.month6Support?.blocksExecution,false);
  assert.equal(stack.agents.market.context.month6Support?.pdLocation,'DISCOUNT');
  assert.equal(stack.telegramBrief.title,'XAUUSD AGENT DESK');
  assert.equal(stack.telegramBrief.advisoryReady,true);
});


test('draw-on-liquidity maps nearest Secondary and strategic Primary without authorizing execution', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  resetGoldAgentMemory();
  const source={
    ...base,
    signalId:'dol-test',
    target1:null,target2:null,target3:null,target4:null,
    targetLabels:[],
    ict:{
      levels:{
        pwh:4350,
        pdh:4330,
        asiaHigh:4310,
        londonHigh:4320
      },
      legSweep:{name:'asiaLow',level:4290,liquidityClass:'EXTERNAL'},
      hasSweep:true,
      hasShift:true,
      hasDisplacement:true,
      retest:true
    }
  };
  const stack=orchestrateGoldAgents(source);
  const dol=stack.agents.drawOnLiquidity;
  assert.equal(dol.secondaryLiquidity?.label,'ASIA_HIGH');
  assert.equal(dol.secondaryLiquidity?.level,4310);
  assert.equal(dol.primaryLiquidity?.label,'PWH');
  assert.equal(dol.primaryLiquidity?.level,4350);
  assert.equal(dol.canCreateSignal,false);
  assert.equal(dol.canOverrideIctGate,false);
  assert.equal(stack.telegramBrief.liquidityObjectives.secondary?.level,4310);
  assert.equal(stack.telegramBrief.liquidityObjectives.primary?.level,4350);
  assert.equal(stack.decision.executable,false);
});


test('liquidity decision agent maps H4 H1 M15 and reserves M5 for confirmation', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  resetGoldAgentMemory();
  const source={
    ...base,
    dailySignalCount:0,
    ict:{
      levels:{
        h4SwingHigh:4350,h4SwingLow:4250,
        h1SwingHigh:4330,h1SwingLow:4270,
        m15SwingHigh:4310,m15SwingLow:4290
      },
      legSweep:{name:'m15SwingLow',level:4290,liquidityClass:'EXTERNAL'},
      hasShift:true,
      hasDisplacement:true,
      retest:true,
      dm5:{mss:true,displacement:true}
    }
  };
  const stack=orchestrateGoldAgents(source);
  const l=stack.agents.liquidityDecision;
  assert.equal(l.name,'LIQUIDITY_DECISION_AGENT');
  assert.deepEqual(l.hierarchy,['H4','H1','M15']);
  assert.equal(l.executionTimeframe,'M5');
  assert.equal(l.drawSide,'BSL');
  assert.equal(l.secondaryLiquidity?.label,'M15_SWING_HIGH');
  assert.equal(l.secondaryLiquidity?.level,4310);
  assert.equal(l.primaryLiquidity?.label,'H4_SWING_HIGH');
  assert.equal(l.primaryLiquidity?.level,4350);
  assert.equal(l.m5Confirmation.confirmed,true);
  assert.equal(l.canCreateSignal,false);
  assert.equal(l.canExecute,false);
  assert.equal(stack.telegramBrief.liquidityObjectives.type,'BSL');
  assert.equal(stack.telegramBrief.liquidityObjectives.executionTimeframe,'M5');
});

test('daily opportunity agent prefers 1-3 qualified setups but has no hard cap', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  process.env.GOLD_DAILY_QUALIFIED_MIN='1';
  process.env.GOLD_DAILY_QUALIFIED_PREFERRED_HIGH='3';
  resetGoldAgentMemory();

  const zero=orchestrateGoldAgents({...base,dailySignalCount:0});
  assert.equal(zero.agents.dailyOpportunity.state,'SEARCHING_FOR_MINIMUM');
  assert.equal(zero.agents.dailyOpportunity.target.min,1);
  assert.equal(zero.agents.dailyOpportunity.target.preferredHigh,3);
  assert.equal(zero.agents.dailyOpportunity.target.hardMax,null);
  assert.equal(zero.agents.dailyOpportunity.hardCap,false);
  assert.equal(zero.agents.dailyOpportunity.forceTrade,false);
  assert.equal(zero.agents.dailyOpportunity.mayRelaxM5Confirmation,false);

  const two=orchestrateGoldAgents({...base,dailySignalCount:2});
  assert.equal(two.agents.dailyOpportunity.state,'OPEN_FOR_MORE_QUALIFIED_SETUPS');

  const three=orchestrateGoldAgents({...base,dailySignalCount:3});
  assert.equal(three.agents.dailyOpportunity.state,'OPEN_FOR_ADDITIONAL_QUALIFIED_SETUPS');

  const five=orchestrateGoldAgents({...base,dailySignalCount:5});
  assert.equal(five.agents.dailyOpportunity.state,'OPEN_FOR_ADDITIONAL_QUALIFIED_SETUPS');
  assert.equal(five.agents.dailyOpportunity.canExecute,false);
});
