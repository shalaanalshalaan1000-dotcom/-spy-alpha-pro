const round = (value, digits = 2) => Number.isFinite(Number(value))
  ? Number(Number(value).toFixed(digits))
  : null;

function barsFromSamples(samples = [], timeframeMinutes = 1) {
  const span = timeframeMinutes * 60_000;
  const buckets = new Map();
  for (const sample of samples) {
    const time = Number(sample?.t);
    const close = Number(sample?.close ?? sample?.p ?? sample?.price);
    if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) continue;
    const open = Number.isFinite(Number(sample?.open)) ? Number(sample.open) : close;
    const high = Number.isFinite(Number(sample?.high)) ? Number(sample.high) : close;
    const low = Number.isFinite(Number(sample?.low)) ? Number(sample.low) : close;
    const key = Math.floor(time / span) * span;
    const bar = buckets.get(key);
    if (!bar) buckets.set(key, {t:key, open, high, low, close});
    else {
      bar.high = Math.max(bar.high, high);
      bar.low = Math.min(bar.low, low);
      bar.close = close;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}
export function bars1m(samples = []) { return barsFromSamples(samples, 1); }
export function bars5m(samples = []) { return barsFromSamples(samples, 5); }
export function bars15m(samples = []) { return barsFromSamples(samples, 15); }

function closedBars(bars, timeframeMinutes, now) {
  const span = timeframeMinutes * 60_000;
  return bars.filter(bar => bar.t + span <= now);
}

function averageRange(bars, fallback) {
  const ranges = bars.map(bar => bar.high - bar.low).filter(value => value > 0);
  return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : fallback;
}

function slope(values = []) {
  if (values.length < 2) return 0;
  return (values.at(-1) - values[0]) / Math.max(1, values.length - 1);
}

function rsi(values = [], period = 14) {
  if (values.length < 2) return 50;
  const recent = values.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const d = recent[i] - recent[i - 1];
    if (d > 0) gains += d;
    if (d < 0) losses -= d;
  }
  const count = Math.max(1, recent.length - 1);
  const avgGain = gains / count;
  const avgLoss = losses / count;
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function candlePressure(bars = []) {
  let bull = 0, bear = 0;
  for (const bar of bars) {
    const range = Math.max(.000001, bar.high - bar.low);
    const body = bar.close - bar.open;
    const upper = bar.high - Math.max(bar.open, bar.close);
    const lower = Math.min(bar.open, bar.close) - bar.low;
    if (body > 0) bull += Math.min(2, Math.abs(body) / range * 1.4);
    if (body < 0) bear += Math.min(2, Math.abs(body) / range * 1.4);
    if (lower > upper * 1.35) bull += .45;
    if (upper > lower * 1.35) bear += .45;
  }
  return {bull, bear, net:bull - bear};
}

function structureScore(bars = []) {
  const recent = bars.slice(-8);
  if (recent.length < 4) return 0;
  let score = 0;
  for (let i = 1; i < recent.length; i += 1) {
    if (recent[i].high >= recent[i - 1].high && recent[i].low >= recent[i - 1].low) score += 1;
    if (recent[i].high <= recent[i - 1].high && recent[i].low <= recent[i - 1].low) score -= 1;
  }
  return score;
}

function rangePosition(bars = [], price) {
  if (!bars.length) return .5;
  const high = Math.max(...bars.map(b => b.high));
  const low = Math.min(...bars.map(b => b.low));
  return high > low ? Math.max(0, Math.min(1, (price - low) / (high - low))) : .5;
}

function context15m(closed15, price) {
  const recent = closed15.slice(-10);
  if (recent.length < 2) return {bias:'NEUTRAL', strength:0, high:null, low:null};
  const closes = recent.map(bar => bar.close);
  const high = Math.max(...recent.map(bar => bar.high));
  const low = Math.min(...recent.map(bar => bar.low));
  const delta = closes.at(-1) - closes[0];
  const atr15 = Math.max(.01, averageRange(recent, Math.max(.75, price * .00025)));
  const position = high > low ? (price - low) / (high - low) : .5;
  const struct = structureScore(recent);
  const up = delta > atr15 * .08 || struct >= 2 || (delta >= -atr15 * .12 && position >= .55);
  const down = delta < -atr15 * .08 || struct <= -2 || (delta <= atr15 * .12 && position <= .45);
  if (up && !down) return {bias:'BUY', strength:Math.min(14, 4 + Math.round(Math.abs(delta) / atr15 * 6) + Math.max(0, struct)), high, low, atr15};
  if (down && !up) return {bias:'SELL', strength:Math.min(14, 4 + Math.round(Math.abs(delta) / atr15 * 6) + Math.max(0, -struct)), high, low, atr15};
  return {bias:'NEUTRAL', strength:0, high, low, atr15};
}

function oneMinuteConfirmation(closed1, side, price) {
  const recent = closed1.slice(-5);
  if (recent.length < 2) return {aligned:false, score:0};
  const closes = recent.map(b => b.close);
  const move = price - closes[0];
  const fast = closes.at(-1) - closes.at(-3 < -closes.length ? 0 : -3);
  const pressure = candlePressure(recent);
  const aligned = side === 'BUY'
    ? (move >= 0 && fast >= 0 && pressure.net >= -.5)
    : (move <= 0 && fast <= 0 && pressure.net <= .5);
  return {aligned, score:aligned ? 5 : 0, pressure:round(pressure.net,2)};
}

function predictiveRead({closed1, usable5, closed15, price, atr5, contextBias}) {
  const m1 = closed1.slice(-30);
  const m5 = usable5.slice(-18);
  const m15 = closed15.slice(-12);
  const closes1 = m1.map(b => b.close), closes5 = m5.map(b => b.close), closes15 = m15.map(b => b.close);
  const s1 = slope(closes1.slice(-12));
  const s5 = slope(closes5.slice(-8));
  const s15 = slope(closes15.slice(-6));
  const recent1 = slope(closes1.slice(-5));
  const prior1 = closes1.length >= 10 ? slope(closes1.slice(-10,-5)) : 0;
  const acceleration = recent1 - prior1;
  const p1 = candlePressure(m1.slice(-8));
  const p5 = candlePressure(m5.slice(-6));
  const struct1 = structureScore(m1.slice(-10));
  const struct5 = structureScore(m5.slice(-8));
  const pos5 = rangePosition(m5.slice(-8), price);
  const recentRanges = m1.slice(-10).map(b => b.high - b.low).filter(v => v > 0);
  const olderRanges = m1.slice(-20,-10).map(b => b.high - b.low).filter(v => v > 0);
  const avgRecentRange = recentRanges.length ? recentRanges.reduce((a,b)=>a+b,0)/recentRanges.length : 0;
  const avgOlderRange = olderRanges.length ? olderRanges.reduce((a,b)=>a+b,0)/olderRanges.length : avgRecentRange;
  const expansion = avgOlderRange > 0 ? avgRecentRange / avgOlderRange : 1;

  let buy = 0, sell = 0;
  const norm = Math.max(.05, atr5 / 5);
  if (s1 > 0) buy += Math.min(14, Math.abs(s1) / norm * 5); else sell += Math.min(14, Math.abs(s1) / norm * 5);
  if (s5 > 0) buy += Math.min(18, Math.abs(s5) / norm * 4); else sell += Math.min(18, Math.abs(s5) / norm * 4);
  if (s15 > 0) buy += Math.min(10, Math.abs(s15) / norm * 2); else sell += Math.min(10, Math.abs(s15) / norm * 2);
  if (acceleration > 0) buy += Math.min(10, Math.abs(acceleration) / norm * 4); else sell += Math.min(10, Math.abs(acceleration) / norm * 4);
  if (p1.net > 0) buy += Math.min(9,p1.net*1.5); else sell += Math.min(9,-p1.net*1.5);
  if (p5.net > 0) buy += Math.min(9,p5.net*1.4); else sell += Math.min(9,-p5.net*1.4);
  if (struct1 > 0) buy += Math.min(8,struct1*1.2); else sell += Math.min(8,-struct1*1.2);
  if (struct5 > 0) buy += Math.min(8,struct5*1.4); else sell += Math.min(8,-struct5*1.4);
  if (pos5 >= .62) buy += 5; else if (pos5 <= .38) sell += 5;
  if (contextBias === 'BUY') buy += 8;
  if (contextBias === 'SELL') sell += 8;
  if (expansion >= 1.18) {
    if (recent1 > 0) buy += 4;
    if (recent1 < 0) sell += 4;
  }

  const diff = buy - sell;
  const side = diff >= 7 ? 'BUY' : diff <= -7 ? 'SELL' : null;
  const confidence = side ? Math.min(86, Math.round(54 + Math.abs(diff) * .72)) : Math.min(59, Math.round(40 + Math.abs(diff)));
  return {
    side, confidence, buyScore:round(buy,1), sellScore:round(sell,1), scoreGap:round(diff,1),
    acceleration:round(acceleration,4), expansion:round(expansion,2), rangePosition5m:round(pos5,2),
    structure1m:struct1, structure5m:struct5, pressure1m:round(p1.net,2), pressure5m:round(p5.net,2)
  };
}

function trueRangeAverageWilliams(bars = [], period = 14, fallback = 1) {
  const recent = bars.slice(-(period + 1));
  if (!recent.length) return fallback;
  const ranges = recent.map((bar, i) => {
    const prevClose = i > 0 ? recent[i - 1].close : bar.open;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  }).slice(-period);
  return Math.max(.01, ranges.length ? ranges.reduce((a,b)=>a+b,0)/ranges.length : fallback);
}

function williamsRValue(bars = [], period = 14) {
  const recent = bars.slice(-period);
  if (recent.length < 2) return -50;
  const highest = Math.max(...recent.map(b=>b.high));
  const lowest = Math.min(...recent.map(b=>b.low));
  if (!(highest > lowest)) return -50;
  return ((highest - recent.at(-1).close) / (highest - lowest)) * -100;
}

function sessionProfileWilliams(now = Date.now()) {
  const hour = new Date(now).getUTCHours();
  if (hour >= 12 && hour < 17) return {name:'NEW_YORK',boost:3};
  if (hour >= 7 && hour < 12) return {name:'LONDON',boost:2};
  if (hour >= 0 && hour < 7) return {name:'ASIA',boost:0};
  return {name:'AFTER_HOURS',boost:0};
}

function trendContextWilliams(closed15 = [], price) {
  const recent = closed15.slice(-12);
  const atr15 = trueRangeAverageWilliams(recent,10,Math.max(1,price*.0003));
  if (recent.length < 4) return {bias:'NEUTRAL',strength:0,atr15,structure:0,normalizedSlope:0};
  const closes = recent.map(b=>b.close);
  const s = slope(closes.slice(-8));
  const normalizedSlope = s / Math.max(.01,atr15);
  const structure = structureScore(recent);
  const high = Math.max(...recent.map(b=>b.high));
  const low = Math.min(...recent.map(b=>b.low));
  const position = high>low ? (price-low)/(high-low) : .5;
  let bull=0,bear=0;
  if(normalizedSlope>.035)bull+=4;
  if(normalizedSlope<-.035)bear+=4;
  if(structure>=2)bull+=Math.min(5,structure);
  if(structure<=-2)bear+=Math.min(5,-structure);
  if(position>=.58)bull+=3;
  if(position<=.42)bear+=3;
  if(closes.at(-1)>closes.at(-4))bull+=2;
  if(closes.at(-1)<closes.at(-4))bear+=2;
  const diff=bull-bear;
  return {bias:diff>=3?'BUY':diff<=-3?'SELL':'NEUTRAL',strength:Math.min(14,Math.abs(diff)),atr15,structure,normalizedSlope:round(normalizedSlope,3),rangeHigh:round(high),rangeLow:round(low),rangePosition:round(position,2)};
}

function oneMinuteImpulseWilliams(closed1 = [], side) {
  const recent=closed1.slice(-5);
  if(recent.length<3)return{aligned:false,move:0};
  const move=recent.at(-1).close-recent[0].open;
  const up=recent.filter(b=>b.close>b.open).length,down=recent.filter(b=>b.close<b.open).length;
  return{aligned:side==='BUY'?move>0&&up>=3:move<0&&down>=3,move:round(move,3)};
}

function directionalLevelsWilliams(side,entry,closed5=[],closed15=[],tolerance=.35){
  const raw=[];
  for(const b of [...closed5.slice(-36),...closed15.slice(-20)])raw.push(side==='BUY'?b.high:b.low);
  const vals=raw.filter(v=>Number.isFinite(v)&&(side==='BUY'?v>entry:v<entry)).sort((a,b)=>side==='BUY'?a-b:b-a);
  const out=[];
  for(const v of vals)if(!out.length||Math.abs(v-out.at(-1))>=tolerance)out.push(v);
  return out;
}

function buildTargetsWilliams(side,entry,stop,atr5,atr15,closed5,closed15,expansionRatio){
  const risk=Math.max(.01,Math.abs(entry-stop)),dir=side==='BUY'?1:-1,expansion=Math.max(.75,Math.min(1.75,Number(expansionRatio)||1));
  const floors=[
    Math.max(1.25,risk*.95,atr5*(.72+expansion*.08)),
    Math.max(2.25,risk*1.55,atr5*(1.30+expansion*.12)),
    Math.max(3.75,risk*2.25,atr5*(2.00+expansion*.15)),
    Math.max(5.50,risk*3.15,atr5*(2.90+expansion*.20))
  ];
  for(let i=1;i<floors.length;i++)floors[i]=Math.max(floors[i],floors[i-1]+Math.max(.75,atr5*.35));
  const levels=directionalLevelsWilliams(side,entry,closed5,closed15,Math.max(.25,atr5*.12)),rewards=[],labels=[];
  let previous=0;
  floors.forEach((floor,index)=>{
    const minReward=Math.max(floor,previous+Math.max(.50,atr5*.20)),maxExtra=index<2?atr15*.65:atr15*1.15;
    const structural=levels.find(level=>{const reward=Math.abs(level-entry);return reward>=minReward&&reward<=minReward+maxExtra;});
    const reward=structural?Math.abs(structural-entry):minReward;
    rewards.push(reward);labels.push(structural?'مستوى سعري + تمدد تقلب':'تمدد تقلب محسوب');previous=reward;
  });
  return{targets:rewards.map(r=>round(entry+dir*r,3)),labels,finalR:round(rewards.at(-1)/risk,2)};
}

function normalizeSampleClock(samples = [], now = Date.now()) {
  const valid = samples.filter(s => Number.isFinite(Number(s?.t)) && Number.isFinite(Number(s?.p ?? s?.price)));
  if (!valid.length) return samples;
  const latestT = Math.max(...valid.map(s => Number(s.t)));
  const skew = latestT - now;
  if (Math.abs(skew) <= 60_000) return samples;
  return samples.map(s => {
    const t = Number(s?.t);
    return Number.isFinite(t) ? {...s, t:t-skew} : s;
  });
}

export function analyzeGoldSignal(samples, rawPrice, now = Date.now()) {
  const price=Number(rawPrice),alignedSamples=normalizeSampleClock(samples,now);
  const all1=bars1m(alignedSamples),all5=bars5m(alignedSamples),all15=bars15m(alignedSamples);
  const closed1=closedBars(all1,1,now),closed5=closedBars(all5,5,now),closed15=closedBars(all15,15,now);
  const current5Key=Math.floor(now/300_000)*300_000,current5=all5.find(b=>b.t===current5Key)||{t:current5Key,open:price,high:price,low:price,close:price};
  const ready=closed1.length>=8&&closed5.length>=8&&closed15.length>=4,completeness=Math.min(100,Math.round(Math.min(closed1.length/8,closed5.length/8,closed15.length/4)*100));
  const base={status:ready?'WAIT':'COLLECTING',action:'WAIT',candidateAction:'WAIT',side:null,strategy:'LARRY_WILLIAMS_FRAMEWORK',confidence:0,readingCompleteness:completeness,barCount:closed1.length,barCount5m:closed5.length,barCount15m:closed15.length,historyWindow:{m1:Math.min(30,closed1.length),m5:Math.min(36,closed5.length),m15:Math.min(20,closed15.length)},modelTimeframes:{context:'15m trend',execution:'5m volatility breakout',confirmation:'1m timing + Williams %R'},sampleCount:alignedSamples.length,price:round(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,targetLabels:[],riskReward:null,contextBias:'NEUTRAL',prediction:null,momentum:null,reason:ready?'Williams framework scanning trend + volatility expansion + timing':`جمع بيانات Williams: 1m ${closed1.length}/8 • 5m ${closed5.length}/8 • 15m ${closed15.length}/4`,updatedAt:new Date(now).toISOString()};
  if(!Number.isFinite(price)||price<=0||!ready)return base;
  const ctx=trendContextWilliams(closed15,price),recent5=closed5.slice(-20),recent1=closed1.slice(-30),atr5=trueRangeAverageWilliams(recent5,14,Math.max(.8,price*.0002)),atr15=ctx.atr15;
  const lastRange=Math.max(.01,recent5.at(-1).high-recent5.at(-1).low),baselineRange=Math.max(.01,averageRange(recent5.slice(-8),atr5)),liveMove=price-current5.open,expansionRatio=Math.abs(liveMove)/baselineRange;
  const ref=recent5.slice(-5),breakoutHigh=Math.max(...ref.map(b=>b.high)),breakoutLow=Math.min(...ref.map(b=>b.low)),triggerDistance=Math.max(atr5*.42,lastRange*.38),upTrigger=current5.open+triggerDistance,downTrigger=current5.open-triggerDistance;
  const wr5=williamsRValue(recent5,14),wr5Prev=williamsRValue(recent5.slice(0,-1),14),struct5=structureScore(recent5),session=sessionProfileWilliams(now);
  const breakoutUp=price>=Math.max(breakoutHigh+atr5*.03,upTrigger)&&ctx.bias!=='SELL',breakoutDown=price<=Math.min(breakoutLow-atr5*.03,downTrigger)&&ctx.bias!=='BUY';
  const wrBull=wr5>-55&&wr5>=wr5Prev,wrBear=wr5<-45&&wr5<=wr5Prev,wrCrossBull=wr5Prev<=-50&&wr5>-50,wrCrossBear=wr5Prev>=-50&&wr5<-50;
  const trendResumeBuy=ctx.bias==='BUY'&&struct5>=1&&wrCrossBull&&price>=current5.open,trendResumeSell=ctx.bias==='SELL'&&struct5<=-1&&wrCrossBear&&price<=current5.open;
  let side=null,strategy=null,entryBase=null;
  if(breakoutUp&&wrBull){side='BUY';strategy='WILLIAMS_VOLATILITY_BREAKOUT';entryBase=Math.max(breakoutHigh,upTrigger);}
  else if(breakoutDown&&wrBear){side='SELL';strategy='WILLIAMS_VOLATILITY_BREAKOUT';entryBase=Math.min(breakoutLow,downTrigger);}
  else if(trendResumeBuy){side='BUY';strategy='WILLIAMS_TREND_RESUMPTION';entryBase=Math.max(current5.open,recent5.at(-1).close);}
  else if(trendResumeSell){side='SELL';strategy='WILLIAMS_TREND_RESUMPTION';entryBase=Math.min(current5.open,recent5.at(-1).close);}
  const directionalEdge=round((ctx.bias==='BUY'?ctx.strength:ctx.bias==='SELL'?-ctx.strength:0)+struct5+(wr5+50)/10+Math.sign(liveMove)*Math.min(8,expansionRatio*4),1);
  const prediction={side,directionalEdge,williamsR5:round(wr5,1),williamsRPrev5:round(wr5Prev,1),volatilityExpansion:round(expansionRatio,2),atr5:round(atr5,3),atr15:round(atr15,3),structure5m:struct5,session:session.name};
  if(!side)return{...base,contextBias:ctx.bias,prediction,momentum:prediction,confidence:Math.min(78,55+ctx.strength+Math.min(8,Math.round(expansionRatio*4))),reason:`Williams WAIT — 15m ${ctx.bias}; %R ${round(wr5,1)}; expansion ${round(expansionRatio,2)}×; no confirmed volatility breakout/resumption`};
  const oneM=oneMinuteImpulseWilliams(recent1,side);let score=52;score+=Math.min(14,5+ctx.strength);score+=strategy==='WILLIAMS_VOLATILITY_BREAKOUT'?Math.min(14,5+Math.round(expansionRatio*6)):6;score+=side==='BUY'?(wrBull?8:0):(wrBear?8:0);if(side==='BUY'?wrCrossBull:wrCrossBear)score+=4;score+=Math.min(6,Math.abs(struct5));if(oneM.aligned)score+=4;score+=session.boost;const confidence=Math.min(94,Math.round(score));
  const chaseDistance=Math.abs(price-entryBase),maxChase=Math.max(1.25,atr5*.62);
  if(chaseDistance>maxChase)return{...base,status:'WAIT',candidateAction:'WAIT',side:null,strategy,confidence,contextBias:ctx.bias,prediction,momentum:prediction,reason:`NO CHASE — Williams entry passed by ${round(chaseDistance,2)}; max ${round(maxChase,2)}. Waiting for a new setup.`};
  const buffer=Math.max(.30,atr5*.12),swingWindow=recent5.slice(-4);let stop=side==='BUY'?Math.min(...swingWindow.map(b=>b.low))-buffer:Math.max(...swingWindow.map(b=>b.high))+buffer;const minimumStop=Math.max(.55,atr5*.38);if(side==='BUY'&&entryBase-stop<minimumStop)stop=entryBase-minimumStop;if(side==='SELL'&&stop-entryBase<minimumStop)stop=entryBase+minimumStop;const risk=Math.abs(entryBase-stop);
  if(!(risk>.44))return{...base,status:'WAIT',candidateAction:side,confidence,strategy,contextBias:ctx.bias,prediction,momentum:prediction,reason:'Williams setup rejected: structural stop too tight'};
  const targetPlan=buildTargetsWilliams(side,entryBase,stop,atr5,atr15,closed5,closed15,expansionRatio),half=Math.max(.20,Math.min(1.00,atr5*.18,risk*.35)),[t1,t2,t3,t4]=targetPlan.targets,setupId=[side,strategy,round(entryBase),round(stop),round(breakoutHigh),round(breakoutLow),round(wr5,1)].join('|'),momentum={...prediction,oneMinuteAligned:oneM.aligned,liveMove:round(liveMove,3),current5Open:round(current5.open,3),breakoutHigh:round(breakoutHigh,3),breakoutLow:round(breakoutLow,3)};
  return{...base,status:'CANDIDATE',candidateAction:side,side,strategy,confidence,contextBias:ctx.bias,oneMinuteConfirmed:oneM.aligned,setupId,prediction,momentum,entry:round(entryBase,3),entryLow:round(entryBase-half,3),entryHigh:round(entryBase+half,3),stopLoss:round(stop,3),target1:t1,target2:t2,target3:t3,target4:t4,targetLabels:targetPlan.labels,riskReward:targetPlan.finalR,reason:`Larry Williams ${strategy==='WILLIAMS_VOLATILITY_BREAKOUT'?'volatility breakout':'trend resumption'} — 15m ${ctx.bias}; %R ${round(wr5,1)}; expansion ${round(expansionRatio,2)}×; setup score ${confidence}`};
}
