import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ui=fs.readFileSync(new URL('../gold-site-ui-start.js',import.meta.url),'utf8');
const mapper=ui.split('const mapper = `')[1].split('`;')[0];
const context=vm.createContext({goldBrowserReading:()=>({}),Date});
vm.runInContext(mapper,context);
const now=Date.now();
const active={signalId:'SELL-1',status:'ACTIVE',side:'SELL',entered:true,triggered:true,entry:4189,stopLoss:4198.99,target1:4141.8,target2:4110.87,signalConfidence:98,quoteAgeMs:100,liveFeedFresh:true,updatedAt:new Date(now).toISOString(),tradeState:{signalId:'SELL-1',sweptName:'pdh',sweptLevel:4190,sweptAtMs:now-900000,mssTrigger:4188,mssAtMs:now-600000,m5RetestConfirmed:true,retestLevel:4188,retestAtMs:now-300000}};
test('active snapshot overrides a newly waiting context and unavailable confluence scores',()=>{
 const p=context.goldSignalReading({...active,ict:{executionStage:'WAIT_EXTERNAL_SWEEP'},confluence:{scores:{BUY:0,SELL:0},breakdown:{}}}).plan;
 assert.equal(p.locked,true);assert.equal(p.setupProgress,100);assert.equal(p.confidence,98);
 assert.match(p.missingCondition,/الصفقة مفعلة/);assert.doesNotMatch(p.missingCondition,/ننتظر/);
 assert.match(p.setupSteps,/pdh ✓ @ 4190.00/);assert.match(p.setupSteps,/M5 MSS ✓ @ 4188.00/);
 assert.match(p.setupSteps,new RegExp(new Date(now-300000).toISOString().replaceAll('.','\\.')));
 assert.doesNotMatch(p.setupSteps,/Structure 0/);
});
test('trade evidence from another signal is never presented as matching active evidence',()=>{
 const p=context.goldSignalReading({...active,tradeState:{...active.tradeState,signalId:'OTHER'}}).plan;
 assert.doesNotMatch(p.setupSteps,/pdh ✓/);
});
test('missing entries cannot be labelled active by the poller and stale quotes retain existing active levels',()=>{
 assert.equal(context.goldSignalReading({...active,entry:null}).plan.locked,false);
 const p=context.goldSignalReading({...active,degraded:true}).plan;
 assert.equal(p.locked,true);assert.equal(p.entry,4189);assert.match(p.missingCondition,/تحديث السعر متوقف/);
});
test('the mapper explicitly identifies a legacy swing target without claiming external classification',()=>{
 const p=context.goldSignalReading({...active,targetLabels:['H4_SWING_LOW']}).plan;
 assert.match(p.liquidityDescription,/غير مثبت/);
});
test('generated progress poller shares mapper state and preserves hit markers',async()=>{
 const source=ui.split('const liveProgressScript = `')[1].split('`;')[0].replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'');
 const nodes=new Map();const sandbox=vm.createContext({goldBrowserReading:()=>({}),Date,document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:''});return nodes.get(id);}},fetch:async()=>({ok:true,json:async()=>({...active,targetHits:[true,false],ict:{drawOnLiquidity:'PDL'}})}),setTimeout:()=>{}});
 vm.runInContext(mapper,sandbox);vm.runInContext(source,sandbox);
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(nodes.get('goldMissingCondition').textContent,/الصفقة مفعلة/);
 assert.equal(nodes.get('goldSetupProgress').textContent,'100%');
 assert.match(nodes.get('goldSetupSteps').textContent,/pdh ✓/);
 assert.match(nodes.get('goldTarget1').textContent,/✓ تحقق/);
 assert.match(nodes.get('goldCurrentBias').textContent,/SELL LIVE • 98\/100/);
});
const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
const externalCode=ictSource.slice(ictSource.indexOf('const EXTERNAL_LIQUIDITY_KEYS='),ictSource.indexOf('function localSweep('));
const targetCode=ictSource.slice(ictSource.indexOf('function targetPlan('),ictSource.indexOf('export function month2RiskFramework'));
const model=vm.createContext({process:{env:{}},round:v=>v, dedupePools:(pools,side,entry)=>pools.filter(p=>Number.isFinite(p.price)&&(side==='BUY'?p.price>entry:p.price<entry))});
vm.runInContext(externalCode+'\n'+targetCode,model);
test('internal swing pools cannot start external setups or supply external targets',()=>{
 const levels={h4SwingHigh:4200,h4SwingLow:4170,h1SwingLow:4160,m15SwingLow:4180,pdl:4140,pwl:4110};
 assert.deepEqual(Array.from(model.externalLiquidityEntries(levels),x=>x[0]),['pdl','pwl']);
 const plan=model.targetPlan('SELL',4189,4199,levels);
 assert.deepEqual(Array.from(plan.targets,x=>x.label),['PDL','PWL']);
 assert.equal(model.targetPlan('SELL',4189,4199,{h4SwingLow:4170}),null);
});
