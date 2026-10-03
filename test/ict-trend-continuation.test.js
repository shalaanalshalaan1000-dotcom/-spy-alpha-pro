import test from 'node:test';
import assert from 'node:assert/strict';
import {findTrendContinuation,validTrendContinuation} from '../ict-trend-continuation.js';
process.env.NODE_ENV='test';
const {canSendSignal}=await import('../telegram-xau-bot-v3.js');
const step=300000,start=Date.UTC(2026,9,2,10);
const candles=[[100,101,99,100],[100,101,99,100],[100,101,99,100],[100,104,100,103.8],[103.8,105,103,104],[104,104.2,102.8,103.1]].map(([open,high,low,close],i)=>({t:start+i*step,open,high,low,close}));
// Last candle must reject upward, not simply touch the gap.
candles[5].open=102.9;
const now=start+6*step;
function scan(patch={}){return findTrendContinuation({bars:candles,side:'BUY',dir4:1,dir1:1,price:103.1,now,...patch});}
test('aligned HTF displacement and closed M5 FVG retest work without any sweep',()=>{
 const c=scan();assert.ok(c);assert.equal(c.side,'BUY');
 assert.equal(validTrendContinuation({setupType:'ICT_HTF_TREND_FVG_RETEST',trendContinuation:c},'BUY',now),true);
});
test('reject opposing HTF, unfinished retest, chase, stale zone and invalidation',()=>{
 for(const patch of [{dir4:-1},{dir1:0},{now:now-1},{price:105},{now:now+3*step},{bars:candles.map((b,i)=>i===5?{...b,close:100}:b)}])assert.equal(scan(patch),null,JSON.stringify(patch));
});
test('SELL route is symmetric and does not accept a BUY contract',()=>{
 const bars=candles.map(b=>({...b,open:200-b.open,close:200-b.close,high:200-b.low,low:200-b.high}));
 const c=scan({bars,side:'SELL',dir4:-1,dir1:-1,price:96.9});assert.ok(c);
 assert.equal(validTrendContinuation({setupType:'ICT_HTF_TREND_FVG_RETEST',trendContinuation:c},'BUY',now),false);
});
test('Telegram continuation requires full evidence and retains confidence and freshness gates',()=>{
 const trendContinuation=scan();
 const s={signalId:'trend-test',status:'ACTIVE',entered:true,triggered:true,side:'BUY',confidence:80,price:103.1,triggerPrice:103.1,entry:103.1,stopLoss:100,target1:106,target2:107,quoteAgeMs:100,liveFeedFresh:true,updatedAt:new Date(now).toISOString(),tradeStyle:'ICT_ONLY_TREND_CONTINUATION',ict:{setupType:'ICT_HTF_TREND_FVG_RETEST',trendContinuation},agentStack:{agents:{trading:{advisoryReady:true}}}};
 assert.equal(canSendSignal(s,now),true);
 for(const patch of [{confidence:74},{degraded:true},{ict:{setupType:s.ict.setupType}},{ict:{...s.ict,trendContinuation:{...trendContinuation,retested:false}}},{ict:{...s.ict,trendContinuation:{...trendContinuation,retestT:now+step}}}])assert.equal(canSendSignal({...s,...patch},now),false);
});
