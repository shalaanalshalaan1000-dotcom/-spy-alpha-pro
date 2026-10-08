import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyGoldTimeframeAlignment, withGoldTimeframeAlignment } from '../gold-timeframe-alignment.js';

test('H4 trend classification uses the trade side and remains advisory', () => {
  const buy = classifyGoldTimeframeAlignment({side:'BUY',ict:{dir4:1,dir1:1}});
  assert.equal(buy.classification,'WITH_TREND');
  assert.equal(buy.h1Aligned,true);
  assert.equal(buy.entryGate,false);
  assert.equal(buy.advisoryOnly,true);
  const sell = classifyGoldTimeframeAlignment({side:'SELL',ict:{dir4:1,dir1:-1}});
  assert.equal(sell.classification,'COUNTER_TREND');
  assert.equal(sell.h1Aligned,true);
  assert.equal(classifyGoldTimeframeAlignment({side:'SELL',ict:{dir4:-1,dir1:1}}).h1Aligned,false);
});

test('missing and neutral H4 data are never represented as a trend', () => {
  assert.equal(classifyGoldTimeframeAlignment({side:'BUY'}).classification,'UNKNOWN');
  assert.equal(classifyGoldTimeframeAlignment({side:'BUY',ict:{dir4:0}}).classification,'NEUTRAL_HTF');
  assert.equal(classifyGoldTimeframeAlignment({ict:{dir4:1}}).classification,'NO_SETUP');
  assert.equal(classifyGoldTimeframeAlignment({side:'SELL',multiTimeframe:{reads:{H4:{side:'SELL'},H1:{side:'BUY'}}}}).classification,'WITH_TREND');
});

test('active trade side wins over changing candidate, annotation never changes entry fields', () => {
  const source={status:'ACTIVE',side:'SELL',candidateAction:'SELL',tradeState:{active:true,side:'BUY'},ict:{dir4:1},entry:4200,stopLoss:4195,target1:4210,executable:true,signalId:'sample'};
  const original=structuredClone(source);
  const tagged=withGoldTimeframeAlignment(source);
  assert.equal(tagged.timeframeAlignment.classification,'WITH_TREND');
  assert.equal(tagged.timeframeAlignment.side,'BUY');
  const {timeframeAlignment,...rest}=tagged;
  assert.deepEqual(rest,source);
  assert.deepEqual(source,original);
});

test('site and Telegram include alignment without making it a gate', () => {
  const site=fs.readFileSync(new URL('../site-indicator-start.js',import.meta.url),'utf8');
  const bot=fs.readFileSync(new URL('../telegram-xau-bot-v3.js',import.meta.url),'utf8');
  assert.match(site,/withGoldTimeframeAlignment\(upstream\.data\)/);
  assert.match(site,/siteTrendAlignment/);
  assert.match(bot,/timeframeAlignment/);
});
