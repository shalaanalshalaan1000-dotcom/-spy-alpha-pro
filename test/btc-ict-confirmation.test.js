import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBtcIctSequence, analyzeBtcIct } from '../btc-ict-engine.js';
const MS=300000, now=Date.UTC(2026,9,14,12);
function candles(){
 const t=now-18*MS;
 const rows=Array.from({length:18},(_,i)=>({t:t+i*MS,open:1000,high:1008,low:995,close:1001,volume:10}));
 rows[6]={...rows[6],high:1030,close:1010};
 rows[12]={...rows[12],open:995,high:1003,low:980,close:995};
 rows[13]={...rows[13],open:995,high:1041,low:994,close:1038};
 rows[14]={...rows[14],open:1038,high:1040,low:1028,close:1035};
 rows[15]={...rows[15],open:1034,high:1052,low:1033,close:1048};
 return rows;
}
const pool={timeframe:'D1',label:'PDL',level:990,liquiditySide:'SSL',targetEligible:true};
test('Only complete external sweep + chronological displaced M5 MSS + later M5 retest gives an ICT setup',()=>{
 const bars=candles(),seq=detectBtcIctSequence({M5:bars,externalLevels:[pool],atr5:6,now});
 assert.equal(seq.length,1);
 assert.equal(seq[0].side,'BUY');
 assert.equal(seq[0].pool.label,'PDL');
 assert.ok(seq[0].sweepAt<seq[0].mssAt&&seq[0].mssAt<seq[0].retestAt);
 assert.equal(seq[0].mss.confirmed,true);
 assert.equal(seq[0].retest.confirmed,true);
 assert.deepEqual(detectBtcIctSequence({M5:bars,externalLevels:[{...pool,targetEligible:false}],now,atr5:6}),[]);
});
test('MSS and retest cannot predate sweep or occur inside the same closed candle',()=>{
 const bars=candles();
 const missingRetest=bars.map((x,i)=>i===14?{...x,low:1039,close:1040}:x);
 assert.deepEqual(detectBtcIctSequence({M5:missingRetest,externalLevels:[pool],atr5:6,now}),[]);
 const noDisplacement=bars.map((x,i)=>i===13?{...x,open:1034,close:1038}:x);
 assert.deepEqual(detectBtcIctSequence({M5:noDisplacement,externalLevels:[pool],atr5:6,now}),[]);
});
test('No named external levels or missing fresh quote always means WAIT',()=>{
 const bars=candles();
 const empty=analyzeBtcIct({M5:bars,ticker:{price:1036,time:new Date(now-1000).toISOString()},now});
 assert.equal(empty.status,'WAIT');
 const stale=analyzeBtcIct({M5:bars,ticker:{price:1036,time:new Date(now-120000).toISOString()},now});
 assert.equal(stale.status,'WAIT');
});
test('BTC runtime has NO SNR strategy dependency, API is ICT, targets cannot be internal pivot levels',()=>{
 const engine=readFileSync(new URL('../btc-ict-engine.js',import.meta.url),'utf8');
 const render=readFileSync(new URL('../render-start.js',import.meta.url),'utf8');
 const bot=readFileSync(new URL('../btc-telegram-bot.js',import.meta.url),'utf8');
 assert.doesNotMatch(engine,/SNR|Laura|btc-snr-engine/i);
 assert.doesNotMatch(render,/SNR|Laura|btc-snr-engine/i);
 assert.doesNotMatch(bot,/SNR|Laura|btc-snr-engine/i);
 assert.match(engine,/ICT_ONLY_EXTERNAL_LIQUIDITY/);
 assert.match(render,/btc-ict-engine\.js/);
 assert.match(bot,/ICT_LIQUIDITY_HUNT_M5_MSS_RETEST/);
});
