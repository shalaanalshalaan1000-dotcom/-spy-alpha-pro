import test from 'node:test';
import assert from 'node:assert/strict';
import {liquidityHuntSequence,liquidityHuntRetest,sessionHuntMss} from '../gold-liquidity-hunt.js';
import {analyzeGoldSignal as analyzeIct} from '../gold-ict-swing-model.js';
import {analyzeGoldSignal as analyzeWrapped} from '../gold-confluence-model.js';
const span=300000;
const bar=(i,o,h,l,c)=>({t:i*span,open:o,high:h,low:l,close:c});
// A confirmed HL at 100, then a sweep of external buy-side liquidity at 110.
const lead=[bar(0,103,105,102,104),bar(1,104,106,101,103),bar(2,103,105,100,104),
  bar(3,104,107,102,106),bar(4,106,109,103,108),bar(5,108,111,106,109)];
const breakBar=bar(6,106,106.2,98,98.5);
const retest=bar(7,99,100.2,98.8,99.5);
const sellSequence=rows=>liquidityHuntSequence(rows,'SELL',6*span,1,span);
test('sell hunt breaks the actual pre-sweep HL with displacement and retests that level',()=>{
  const seq=sellSequence([...lead,breakBar,retest]);
  assert.equal(seq.firstMss.level,100);
  assert.equal(seq.firstMss.protectedSwingT,2*span);
  assert.equal(seq.firstMss.classification,'MSS');
  const hold=liquidityHuntRetest([...lead,breakBar,retest],'SELL',seq.firstMss,1,111);
  assert.equal(hold.confirmed,true);assert.equal(hold.level,100);assert.equal(hold.t,7*span);
});
test('buy hunt is the mirrored sell sequence',()=>{
  const rows=[...lead,breakBar,retest].map(b=>({...b,open:210-b.open,high:210-b.low,low:210-b.high,close:210-b.close}));
  const seq=liquidityHuntSequence(rows,'BUY',6*span,1,span);
  assert.equal(seq.firstMss.level,110);
  assert.equal(liquidityHuntRetest(rows,'BUY',seq.firstMss,1,99).confirmed,true);
});
test('wick-only break and four-bar micro low break cannot replace protected HL',()=>{
  assert.equal(sellSequence([...lead,bar(6,103,104,98,102)]).firstMss,null);
  assert.equal(sellSequence([...lead,bar(6,108,108.2,101,101.5)]).firstMss,null);
});
test('weak CHoCH remains observation without displaced MSS',()=>{
  const seq=sellSequence([...lead,bar(6,100.1,100.3,99.6,99.9)]);
  assert.equal(seq.firstAny.classification,'CHOCH');assert.equal(seq.firstMss,null);
});
test('sweep bar cannot simultaneously authorize MSS',()=>{
  const rows=[...lead.slice(0,5),bar(5,108,111,98,98.5)];
  assert.equal(sellSequence(rows).firstMss,null);
});
test('future pivots do not replace the swing available when liquidity was swept',()=>{
  const seq=sellSequence([...lead,breakBar,retest,bar(8,101,102,97,98),bar(9,99,102,98,101),bar(10,101,103,99,102)]);
  assert.equal(seq.firstMss.level,100);
});
test('retest requires actual range overlap and no intervening invalidation',()=>{
  const seq=sellSequence([...lead,breakBar]);
  assert.equal(liquidityHuntRetest([bar(7,105,106,101,99)],'SELL',seq.firstMss,1,111).confirmed,false);
  const invalid=bar(7,99,102,98,101),later={...retest,t:8*span};
  assert.equal(liquidityHuntRetest([invalid,later],'SELL',seq.firstMss,1,111).invalidated,true);
  assert.equal(liquidityHuntRetest([bar(7,99,112,98,99.5)],'SELL',seq.firstMss,1,111).invalidated,true);
});
test('session MSS must match side, swept level, chronology, and structural evidence',()=>{
  const event=sellSequence([...lead,breakBar]).firstMss;
  const s={candidateAction:'SELL',ict:{legSweep:{level:110},m5MssEvent:event}};
  assert.equal(sessionHuntMss(s,'SELL',110,5*span,6*span),event);
  assert.equal(sessionHuntMss(s,'BUY',110,5*span,6*span),null);
  assert.equal(sessionHuntMss(s,'SELL',105,5*span,6*span),null);
  assert.equal(sessionHuntMss(s,'SELL',110,6*span,6*span),null);
  assert.equal(sessionHuntMss(s,'SELL',110,5*span,5*span),null);
  assert.equal(sessionHuntMss({...s,ict:{...s.ict,m5MssEvent:{...event,structureConfirmed:false}}},'SELL',110,5*span,6*span),null);
});
test('full ICT and confluence engines wait for retest, then produce the same external SELL hunt',()=>{
  const now=Date.parse('2026-10-09T14:00:00Z');
  const tail=[...lead,breakBar,retest];
  const rows=Array.from({length:296},(_,i)=>{
    if(i>=288)return tail[i-288];
    const c=104+Math.sin(i/4);return {open:c,high:c+.3,low:c-.3,close:c+.1};
  });
  const samples=rows.flatMap((b,i)=>Array.from({length:5},(_,j)=>({...b,t:now-(rows.length-i)*span+j*60000,p:b.close})));
  const ht={D1:[{t:now-172800000,open:100,high:110,low:90,close:104},{t:now-86400000,open:104,high:111,low:98,close:99.5}],
    W1:[{t:now-1209600000,open:100,high:120,low:80,close:105},{t:now-604800000,open:105,high:111,low:90,close:99}]};
  const pending=analyzeIct(samples.slice(0,-5),98.5,now-span,ht);
  assert.equal(pending.status,'WAIT');assert.equal(pending.ict.executionStage,'WAIT_RETEST_HOLD');
  for(const analyze of [analyzeIct,analyzeWrapped]){
    const x=analyze(samples,99.5,now,ht);
    assert.equal(x.status,'CANDIDATE');assert.equal(x.candidateAction,'SELL');
    assert.equal(x.ict.legSweep.name,'pdh');assert.equal(x.ict.m5MssEvent.level,100);
    assert.equal(x.ict.m5MssRetest.confirmed,true);assert.equal(x.ict.m5MssRetest.level,100);
    assert.equal(x.targetLabels[0],'PDL');assert.equal(x.targetLabels[1],'PWL');
  }
});
test('a retest invalidated on a subsequent bar cannot be replayed',()=>{
  const seq=sellSequence([...lead,breakBar]);
  const x=liquidityHuntRetest([retest,bar(8,99,102,98,101),{...retest,t:9*span}], 'SELL',seq.firstMss,1,111);
  assert.equal(x.confirmed,false);assert.equal(x.invalidated,true);
});
