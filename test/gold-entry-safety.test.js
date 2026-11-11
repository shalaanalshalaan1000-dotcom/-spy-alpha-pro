import test from 'node:test';
import assert from 'node:assert/strict';
import {goldEntryWindow} from '../gold-session-entry-policy.js';
import {m1AnalysisFresh,newsEntryBlocked} from '../gold-entry-safety.js';

test('new XAU entries are read-only in Asia and outside London/New York, using NY weekend clock',()=>{
  for(const t of ['2026-11-11T00:30:00Z','2026-11-11T23:30:00Z','2026-11-06T17:30:00Z'])
    assert.equal(goldEntryWindow(Date.parse(t)).allowed,false,t);
  assert.equal(goldEntryWindow(Date.parse('2026-11-06T17:30:00Z')).session,'OFF_KILLZONE');
  assert.equal(goldEntryWindow(Date.parse('2026-11-11T08:30:00Z')).allowed,true);
});

test('news outage and high impact blackout fail closed',()=>{
  assert.equal(newsEntryBlocked({available:false,blockEntries:false,level:'NORMAL'}),true);
  assert.equal(newsEntryBlocked({available:true,blockEntries:false,level:'EXTREME'}),true);
  assert.equal(newsEntryBlocked({available:true,blockEntries:false,activeEvent:{impact:'HIGH'}}),true);
  assert.equal(newsEntryBlocked({available:true,blockEntries:false,level:'NORMAL'}),false);
});

test('M1 read must track the last completed candle and bar count',()=>{
  const now=Date.parse('2026-11-11T10:03:30Z');
  const samples=[0,1,2,3].map(i=>({t:now-(4-i)*60_000-30_000,close:4100+i}));
  const model={multiTimeframe:{reads:{M1:{ready:true,bars:4,currentClose:4103}}}};
  assert.equal(m1AnalysisFresh(model,samples,now),true);
  assert.equal(m1AnalysisFresh({multiTimeframe:{reads:{M1:{ready:true,bars:1,currentClose:4100}}}},samples,now),false);
  assert.equal(m1AnalysisFresh({multiTimeframe:{reads:{M1:{ready:true,bars:4,currentClose:4090}}}},samples,now),false);
});
