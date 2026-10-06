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

test('watching setup with no complete entry-stop plan is pending, not risk-blocked', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  resetGoldAgentMemory();
  const watching=orchestrateGoldAgents({...base,status:'WAIT',signalId:null,entered:false,triggered:false,signalConfidence:60,confidence:60,entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null});
  assert.equal(watching.agents.setup.stage,'WATCHING');
  assert.equal(watching.decisionSchema.riskState,'PENDING');
  assert.equal(watching.agents.risk.planComplete,false);
  assert.ok(!watching.agents.risk.vetoes.includes('INVALID_STOP_STRUCTURE'));
  assert.ok(!watching.agents.trading.blockers.includes('FINAL_CHECK_FAILED'));
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


test('trade manager requires ICT/M5 structure for CONTINUE and structure flip for early STOP', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  process.env.GOLD_TRADE_MANAGEMENT_MIN_CONFIDENCE='82';
  process.env.GOLD_TRADE_MANAGEMENT_CONFIRM_MS='5000';
  resetGoldAgentMemory();
  const t=Date.UTC(2026,9,6,13,0,0);
  const aligned={...base,status:'ACTIVE',liveModelStatus:'CANDIDATE',liveModelAction:'BUY',liveModelConfidence:88,liveModelReady:true};

  let stack=orchestrateGoldAgents(aligned,t);
  assert.equal(stack.agents.tradeManager.managementDecision.action,'HOLD_PLAN');
  assert.equal(stack.agents.tradeManager.managementDecision.candidateAction,'CONTINUE');
  assert.equal(stack.agents.tradeManager.managementDecision.structureState,'VALID');
  assert.equal(stack.agents.tradeManager.managementDecision.confidenceRole,'ADVISORY_ONLY');
  assert.equal(stack.agents.tradeManager.managementDecision.confirmed,false);

  stack=orchestrateGoldAgents(aligned,t+5001);
  assert.equal(stack.agents.tradeManager.managementDecision.action,'CONTINUE');
  assert.equal(stack.agents.tradeManager.managementDecision.manualAction,'KEEP_TRADE');
  assert.equal(stack.agents.tradeManager.managementDecision.confirmed,true);

  const missingStructure={
    ...aligned,
    signalId:'agent-test-missing-structure',
    reason:'live model only',
    ict:{},
    multiTimeframe:{...aligned.multiTimeframe,reads:{...aligned.multiTimeframe.reads,M5:{side:'BUY'}}}
  };
  resetGoldAgentMemory();
  stack=orchestrateGoldAgents(missingStructure,t+6000);
  assert.equal(stack.agents.tradeManager.managementDecision.action,'HOLD_PLAN');
  assert.equal(stack.agents.tradeManager.managementDecision.candidateAction,'HOLD_PLAN');
  assert.equal(stack.agents.tradeManager.managementDecision.structureState,'WEAKENING');

  const weakOpposite={...aligned,liveModelAction:'SELL',liveModelConfidence:79};
  resetGoldAgentMemory();
  stack=orchestrateGoldAgents(weakOpposite,t+7000);
  assert.equal(stack.agents.tradeManager.managementDecision.action,'HOLD_PLAN');
  assert.equal(stack.agents.tradeManager.managementDecision.candidateAction,'HOLD_PLAN');

  const oppositeWithoutM5Flip={...aligned,liveModelAction:'SELL',liveModelConfidence:91};
  resetGoldAgentMemory();
  stack=orchestrateGoldAgents(oppositeWithoutM5Flip,t+8000);
  assert.equal(stack.agents.tradeManager.managementDecision.action,'HOLD_PLAN');
  assert.equal(stack.agents.tradeManager.managementDecision.candidateAction,'HOLD_PLAN');

  const opposite={
    ...oppositeWithoutM5Flip,
    multiTimeframe:{...aligned.multiTimeframe,reads:{...aligned.multiTimeframe.reads,M5:{side:'SELL'}}}
  };
  resetGoldAgentMemory();
  stack=orchestrateGoldAgents(opposite,t+9000);
  assert.equal(stack.agents.tradeManager.managementDecision.action,'HOLD_PLAN');
  assert.equal(stack.agents.tradeManager.managementDecision.candidateAction,'STOP');
  assert.equal(stack.agents.tradeManager.managementDecision.structureState,'INVALIDATED');

  stack=orchestrateGoldAgents(opposite,t+14001);
  assert.equal(stack.agents.tradeManager.managementDecision.action,'STOP');
  assert.equal(stack.agents.tradeManager.managementDecision.manualAction,'EXIT_TRADE');
  assert.equal(stack.agents.tradeManager.managementDecision.confirmed,true);
});


test('terminal event from a previous signal cannot invalidate a new active setup', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  resetGoldAgentMemory();
  const freshSignal={
    ...base,
    status:'ACTIVE',
    signalId:'new-sell-signal',
    action:'SELL',
    candidateAction:'SELL',
    side:'SELL',
    price:4169,
    entry:4171.92,
    entryLow:4171.74,
    entryHigh:4172.10,
    stopLoss:4184.58,
    target1:4154.34,
    target2:4143.58,
    target3:4128.43,
    target4:4103.52,
    signalConfidence:98,
    terminalEvent:{signalId:'old-buy-signal',side:'BUY',closedAtMs:Date.now()-60_000},
    multiTimeframe:{...base.multiTimeframe,side:'SELL',reads:{...base.multiTimeframe.reads,M5:{side:'SELL'},M1:{side:'SELL'}}}
  };
  const stack=orchestrateGoldAgents(freshSignal);
  assert.notEqual(stack.agents.setup.stage,'INVALIDATED');
  assert.equal(stack.agents.setup.side,'SELL');
});

test('agent confidence floor remains 75 even if environment is configured lower', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  process.env.AGENT_MIN_CONFIDENCE='65';
  resetGoldAgentMemory();
  const stack=orchestrateGoldAgents({...base,signalId:'confidence-floor',signalConfidence:70,confidence:70});
  assert.equal(stack.agents.setup.minConfidence,75);
  assert.equal(stack.agents.setup.stage,'WATCHING');
});


test('wide structural stop remains allowed without a hard $10 per-trade cap', () => {
  configure();
  process.env.AGENT_EXECUTION_ENABLED='false';
  resetGoldAgentMemory();
  const wideStop={
    ...base,
    signalId:'wide-stop-no-cap',
    entry:4171.92,
    entryLow:4171.74,
    entryHigh:4172.10,
    stopLoss:4184.58,
    target1:4154.34,
    target2:4143.58,
    target3:4128.43,
    target4:4103.52,
    side:'SELL',
    action:'SELL',
    candidateAction:'SELL',
    signalConfidence:98,
    confidence:98,
    multiTimeframe:{...base.multiTimeframe,side:'SELL',reads:{...base.multiTimeframe.reads,M5:{side:'SELL'},M1:{side:'SELL'}}}
  };
  const stack=orchestrateGoldAgents(wideStop);
  assert.equal(stack.agents.risk.hardDollarRiskCap,false);
  assert.equal(stack.agents.risk.maxRiskUsd,null);
  assert.equal(stack.agents.risk.maxStopDistanceUsd,null);
  assert.equal(stack.agents.risk.allowed,true);
  assert.ok(stack.agents.risk.estimatedRiskUsd>10);
});
