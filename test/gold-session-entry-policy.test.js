import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {goldEntryWindow,isGoldEntryAllowed} from '../gold-session-entry-policy.js';

const at=(v)=>Date.parse(v);
test('Tokyo is read-only: no BUY/SELL even when a setup is complete',()=>{
  for(const v of ['2026-10-08T00:30:00Z','2026-10-08T02:30:00Z','2026-10-08T06:30:00Z']){
    assert.equal(isGoldEntryAllowed(at(v)),false,v);
  }
  assert.equal(goldEntryWindow(at('2026-10-08T02:30:00Z')).session,'ASIA_READ_ONLY');
});
test('London and New York unlock entries on local clocks, including DST',()=>{
  for(const v of ['2026-10-08T07:00:00Z','2026-10-08T12:30:00Z','2026-12-08T08:00:00Z','2026-12-08T14:00:00Z']){
    assert.equal(isGoldEntryAllowed(at(v)),true,v);
  }
  assert.equal(isGoldEntryAllowed(at('2026-10-08T06:59:00Z')),false);
  assert.equal(isGoldEntryAllowed(at('2026-12-08T07:59:00Z')),false);
});
test('After London/New York and weekends are read-only',()=>{
  for(const v of ['2026-10-08T20:30:00Z','2026-10-10T13:00:00Z','2026-10-11T13:00:00Z']){
    assert.equal(isGoldEntryAllowed(at(v)),false,v);
  }
  assert.equal(isGoldEntryAllowed(NaN),false);
});
test('Entry policy is enforced by engine, API agent gate, and Telegram new-entry mirror',()=>{
  const engine=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
  const agent=fs.readFileSync(new URL('../gold-agent-orchestrator.js',import.meta.url),'utf8');
  const telegram=fs.readFileSync(new URL('../telegram-xau-bot-v2.js',import.meta.url),'utf8');
  assert.match(engine,/if\(!entryWindow.allowed\).*return;/);
  assert.match(agent,/if\(!tradeState.active&&!entryWindow.allowed\)/);
  assert.match(telegram,/goldEntryWindow\(issuedAtOf\(s\)\?\?now\)\.allowed/);
});
