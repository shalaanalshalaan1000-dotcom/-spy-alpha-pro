import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBtcIctSequence, analyzeBtcIct } from '../btc-ict-engine.js';
const MS=60000, now=Date.UTC(2026,9,14,12);
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
test('Only complete external sweep + chronological displaced M1 MSS + later M1 retest gives an ICT setup',()=>{
 const bars=candles();
 const externalSweep={label:'PDL',side:'BUY',tf:'M15',level:990,t:bars[8].t};
 const seq=detectBtcIctSequence({M1:bars,externalLevels:[pool],externalSweep,atr1:6,now});
 assert.deepEqual(detectBtcIctSequence({M1:bars,externalLevels:[pool],atr1:6,now}),[],'No confirmed M15/M30 external sweep: no BTC entry');
 assert.equal(seq.length,1);
 assert.equal(seq[0].side,'BUY');
 assert.equal(seq[0].pool.label,'PDL');
 assert.ok(seq[0].sweepAt<seq[0].mssAt&&seq[0].mssAt<seq[0].retestAt);
 assert.equal(seq[0].mss.confirmed,true);
 assert.equal(seq[0].retest.confirmed,true);
 assert.deepEqual(detectBtcIctSequence({M1:bars,externalLevels:[{...pool,targetEligible:false}],externalSweep,now,atr1:6}),[]);
 assert.deepEqual(detectBtcIctSequence({M1:bars,externalLevels:[pool],externalSweep:{...externalSweep,label:'INTERNAL'},atr1:6,now}),[]);
});
test('MSS and retest cannot predate sweep or occur inside the same closed candle',()=>{
 const bars=candles(),externalSweep={label:'PDL',side:'BUY',tf:'M15',level:990,t:bars[8].t};
 const missingRetest=bars.map((x,i)=>i>=14?{...x,low:1045,close:1048,high:1055}:x);
 assert.deepEqual(detectBtcIctSequence({M1:missingRetest,externalLevels:[pool],externalSweep,atr1:6,now}),[]);
 const noDisplacement=bars.map((x,i)=>i===13?{...x,open:1037,close:1038}:x);
 assert.deepEqual(detectBtcIctSequence({M1:noDisplacement,externalLevels:[pool],externalSweep,atr1:6,now}),[]);
});
test('No named external levels or missing fresh quote always means WAIT',()=>{
 const bars=candles();
 const m5=Array.from({length:18},(_,i)=>({t:now-18*300000+i*300000,open:1000,high:1008,low:995,close:1001}));
 const empty=analyzeBtcIct({M1:bars,M5:m5,ticker:{price:1036,time:new Date(now-1000).toISOString()},now});
 assert.equal(empty.status,'WAIT');
 const stale=analyzeBtcIct({M1:bars,M5:m5,ticker:{price:1036,time:new Date(now-120000).toISOString()},now});
 assert.equal(stale.status,'WAIT');
});
test('BTC runtime has NO SNR strategy dependency, API is ICT, targets cannot be internal pivot levels',()=>{
 const engine=readFileSync(new URL('../btc-ict-engine.js',import.meta.url),'utf8');
 const render=readFileSync(new URL('../render-start.js',import.meta.url),'utf8');
 const bot=readFileSync(new URL('../btc-telegram-bot.js',import.meta.url),'utf8');
 assert.doesNotMatch(engine,/SNR|Laura|btc-snr-engine/i);
 assert.doesNotMatch(render,/SNR|Laura|btc-snr-engine/i);
 assert.doesNotMatch(bot,/SNR|Laura|btc-snr-engine/i);
 assert.match(engine,/strategy:'ICT_EXTERNAL_ONLY_M15_M30_M1_RETEST'/);
 assert.match(engine,/internalLiquidityScalps:false/);
 assert.match(engine,/CLOSED_M15_OR_M30_EXTERNAL_SWEEP -> CLOSED_M1_MSS_OR_CHOCH_AND_DISPLACEMENT/);
 assert.match(render,/btc-ict-engine\.js/);
 assert.match(bot,/ICT_LIQUIDITY_HUNT_M1_MSS_RETEST/);
});
