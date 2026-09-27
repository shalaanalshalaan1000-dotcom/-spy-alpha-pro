const num=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=3)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,v)=>s+v,0)/a.length:null;};

function cleanRows(rows=[]){
  return rows.map((r,index)=>({
    index,
    t:num(r?.t),
    open:num(r?.open),
    high:num(r?.high),
    low:num(r?.low),
    close:num(r?.close),
    volume:num(r?.volume)
  })).filter(r=>r.t!=null&&r.open!=null&&r.high!=null&&r.low!=null&&r.close!=null&&r.high>=r.low&&r.open>0&&r.close>0);
}

function metrics(c){
  const range=Math.max(.0000001,c.high-c.low);
  const body=Math.abs(c.close-c.open);
  const upper=Math.max(0,c.high-Math.max(c.open,c.close));
  const lower=Math.max(0,Math.min(c.open,c.close)-c.low);
  return{range,body,bodyPct:body/range,upper,lower,upperPct:upper/range,lowerPct:lower/range};
}

function trendMove(rows,i,count=5){
  const start=Math.max(0,i-count),x=rows.slice(start,i);
  if(x.length<2)return 0;
  return x.at(-1).close-x[0].close;
}

function confirmation(rows,index,side,candle){
  const future=rows.slice(index+1,Math.min(rows.length,index+4));
  if(!future.length)return'CANDIDATE';
  const confirmed=side==='BUY'
    ? future.some(x=>x.close>candle.high)
    : future.some(x=>x.close<candle.low);
  return confirmed?'CONFIRMED':'CANDIDATE';
}

function eventFor(rows,index,side,patterns,score,reasons,timeframe,extra={}){
  const c=rows[index],m=metrics(c);
  const futureStatus=confirmation(rows,index,side,c);
  const ageBars=rows.length-1-index;
  const grade=score>=88?'A+':score>=82?'A':score>=74?'B+':score>=66?'B':'C';
  return{
    side,
    pattern:patterns[0]||'IMPORTANT_CANDLE',
    patterns:[...new Set(patterns)],
    score:Math.round(clamp(score,0,99)),
    grade,
    status:futureStatus,
    timeframe,
    t:c.t,
    ageBars,
    open:round(c.open),high:round(c.high),low:round(c.low),close:round(c.close),
    referenceLevel:round(side==='BUY'?c.low:c.high),
    bodyPct:round(m.bodyPct,3),
    upperWickPct:round(m.upperPct,3),
    lowerWickPct:round(m.lowerPct,3),
    reason:[...new Set(reasons)].join(' + '),
    ...extra
  };
}

function addOrMerge(events,event){
  if(!event)return;
  const existing=events.find(x=>x.t===event.t&&x.side===event.side);
  if(!existing){events.push(event);return;}
  existing.patterns=[...new Set([...existing.patterns,...event.patterns])];
  existing.pattern=existing.score>=event.score?existing.pattern:event.pattern;
  existing.score=Math.max(existing.score,event.score);
  existing.grade=existing.score>=88?'A+':existing.score>=82?'A':existing.score>=74?'B+':existing.score>=66?'B':'C';
  existing.reason=[...new Set((existing.reason+' + '+event.reason).split(' + '))].join(' + ');
  existing.status=existing.status==='CONFIRMED'||event.status==='CONFIRMED'?'CONFIRMED':'CANDIDATE';
  existing.rangeRatio=Math.max(existing.rangeRatio||0,event.rangeRatio||0)||null;
  existing.volumeRatio=Math.max(existing.volumeRatio||0,event.volumeRatio||0)||null;
}

export function detectImportantCandles(inputRows=[],options={}){
  const rows=cleanRows(inputRows);
  const timeframe=String(options.timeframe||'5m');
  const lookback=Math.max(8,Math.min(80,Number(options.lookback||24)));
  if(rows.length<3)return{timeframe,closedOnly:true,primary:null,recent:[],counts:{BUY:0,SELL:0},scanned:rows.length};

  const events=[];
  const start=Math.max(2,rows.length-lookback);
  for(let i=start;i<rows.length;i++){
    const c=rows[i],prev=rows[i-1],prev2=rows[i-2],m=metrics(c),pm=metrics(prev);
    const prior=rows.slice(Math.max(0,i-10),i);
    const prior5=rows.slice(Math.max(0,i-6),i);
    const avgRange=mean(prior.map(x=>metrics(x).range))||m.range;
    const avgBody=mean(prior.map(x=>metrics(x).body))||m.body;
    const vols=prior.map(x=>x.volume).filter(v=>Number.isFinite(v)&&v>0);
    const avgVolume=mean(vols);
    const volumeRatio=avgVolume&&c.volume>0?c.volume/avgVolume:null;
    const rangeRatio=avgRange>0?m.range/avgRange:1;
    const priorHigh=prior5.length?Math.max(...prior5.map(x=>x.high)):null;
    const priorLow=prior5.length?Math.min(...prior5.map(x=>x.low)):null;
    const move=trendMove(rows,i,6);
    const extended=Math.abs(move)>=avgRange*1.6;

    if(priorLow!=null&&c.low<priorLow&&c.close>priorLow){
      let score=88+(m.lowerPct>=.35?4:0)+(volumeRatio>=1.4?3:0);
      addOrMerge(events,eventFor(rows,i,'BUY',['LIQUIDITY_SWEEP','FAILED_BREAKDOWN'],score,
        ['swept prior low','closed back above liquidity','potential bullish reversal'],timeframe,
        {sweptLevel:round(priorLow),rangeRatio:round(rangeRatio,2),volumeRatio:round(volumeRatio,2)}));
    }
    if(priorHigh!=null&&c.high>priorHigh&&c.close<priorHigh){
      let score=88+(m.upperPct>=.35?4:0)+(volumeRatio>=1.4?3:0);
      addOrMerge(events,eventFor(rows,i,'SELL',['LIQUIDITY_SWEEP','FAILED_BREAKOUT'],score,
        ['swept prior high','closed back below liquidity','potential bearish reversal'],timeframe,
        {sweptLevel:round(priorHigh),rangeRatio:round(rangeRatio,2),volumeRatio:round(volumeRatio,2)}));
    }

    const bullEngulf=c.close>c.open&&prev.close<prev.open&&c.open<=prev.close&&c.close>=prev.open;
    const bearEngulf=c.close<c.open&&prev.close>prev.open&&c.open>=prev.close&&c.close<=prev.open;
    if(bullEngulf)addOrMerge(events,eventFor(rows,i,'BUY',['BULLISH_ENGULFING'],74+(extended&&move<0?5:0),
      ['bullish body engulfed previous bearish body',extended&&move<0?'appeared after downside extension':'body control shifted bullish'],timeframe,{rangeRatio:round(rangeRatio,2)}));
    if(bearEngulf)addOrMerge(events,eventFor(rows,i,'SELL',['BEARISH_ENGULFING'],74+(extended&&move>0?5:0),
      ['bearish body engulfed previous bullish body',extended&&move>0?'appeared after upside extension':'body control shifted bearish'],timeframe,{rangeRatio:round(rangeRatio,2)}));

    const lowerReject=m.lower>=Math.max(m.body*1.8,m.range*.38)&&c.close>=c.low+m.range*.62;
    const upperReject=m.upper>=Math.max(m.body*1.8,m.range*.38)&&c.close<=c.low+m.range*.38;
    if(lowerReject){
      const hammer=move<0;
      addOrMerge(events,eventFor(rows,i,'BUY',[hammer?'HAMMER':'LOWER_REJECTION_PIN_BAR'],hammer?76:70,
        [hammer?'hammer after decline':'strong lower-wick rejection','buyers reclaimed most of candle range'],timeframe,{rangeRatio:round(rangeRatio,2)}));
    }
    if(upperReject){
      const shooting=move>0;
      addOrMerge(events,eventFor(rows,i,'SELL',[shooting?'SHOOTING_STAR':'UPPER_REJECTION_PIN_BAR'],shooting?76:70,
        [shooting?'shooting star after rise':'strong upper-wick rejection','sellers reclaimed most of candle range'],timeframe,{rangeRatio:round(rangeRatio,2)}));
    }

    if(i>=2){
      const a=rows[i-2],b=rows[i-1],am=metrics(a),bm=metrics(b);
      const morning=a.close<a.open&&am.bodyPct>=.45&&bm.bodyPct<=.42&&c.close>c.open&&c.close>=a.open-(am.body*.45);
      const evening=a.close>a.open&&am.bodyPct>=.45&&bm.bodyPct<=.42&&c.close<c.open&&c.close<=a.open+(am.body*.45);
      if(morning)addOrMerge(events,eventFor(rows,i,'BUY',['MORNING_STAR'],82,['three-candle bullish reversal','indecision followed by bullish recovery'],timeframe,{rangeRatio:round(rangeRatio,2)}));
      if(evening)addOrMerge(events,eventFor(rows,i,'SELL',['EVENING_STAR'],82,['three-candle bearish reversal','indecision followed by bearish rejection'],timeframe,{rangeRatio:round(rangeRatio,2)}));

      if(c.low>a.high){
        addOrMerge(events,eventFor(rows,i-1,'BUY',['BULLISH_FVG_ORIGIN','DISPLACEMENT_ORIGIN'],80,['middle candle created bullish fair-value gap','institutional-style displacement origin'],timeframe));
      }
      if(c.high<a.low){
        addOrMerge(events,eventFor(rows,i-1,'SELL',['BEARISH_FVG_ORIGIN','DISPLACEMENT_ORIGIN'],80,['middle candle created bearish fair-value gap','institutional-style displacement origin'],timeframe));
      }
    }

    const doji=m.bodyPct<=.12;
    if(doji&&extended){
      const side=move<0?'BUY':'SELL';
      addOrMerge(events,eventFor(rows,i,side,['DOJI_AFTER_EXTENSION'],62,['doji after extended directional move','momentum paused at an extreme'],timeframe,{rangeRatio:round(rangeRatio,2)}));
    }

    const outside=c.high>prev.high&&c.low<prev.low;
    if(outside&&m.bodyPct>=.35){
      const side=c.close>c.open?'BUY':'SELL';
      addOrMerge(events,eventFor(rows,i,side,['OUTSIDE_BAR'],70,['engulfed previous candle full range','closed with directional control'],timeframe,{rangeRatio:round(rangeRatio,2)}));
    }

    const displacement=m.bodyPct>=.62&&rangeRatio>=1.35&&m.body>=Math.max(avgBody*1.30,m.range*.55);
    if(displacement){
      const side=c.close>c.open?'BUY':'SELL';
      addOrMerge(events,eventFor(rows,i,side,['DISPLACEMENT_CANDLE'],77+(rangeRatio>=1.8?4:0),
        ['large real body','range expansion versus recent candles','possible order-flow shift'],timeframe,
        {rangeRatio:round(rangeRatio,2),volumeRatio:round(volumeRatio,2)}));
    }

    const climactic=rangeRatio>=1.75&&(volumeRatio==null||volumeRatio>=1.35);
    if(climactic&&extended){
      if(move>0&&m.upperPct>=.28){
        addOrMerge(events,eventFor(rows,i,'SELL',['CLIMACTIC_EXHAUSTION'],69,['range/volume expansion after rise','upper rejection suggests exhaustion'],timeframe,{rangeRatio:round(rangeRatio,2),volumeRatio:round(volumeRatio,2)}));
      }else if(move<0&&m.lowerPct>=.28){
        addOrMerge(events,eventFor(rows,i,'BUY',['CLIMACTIC_EXHAUSTION'],69,['range/volume expansion after decline','lower rejection suggests exhaustion'],timeframe,{rangeRatio:round(rangeRatio,2),volumeRatio:round(volumeRatio,2)}));
      }
    }
  }

  for(const e of events){
    const idx=rows.findIndex(x=>x.t===e.t);
    if(idx<0)continue;
    const prior=rows.slice(Math.max(0,idx-6),idx);
    if(!prior.length)continue;
    const c=rows[idx],hi=Math.max(...prior.map(x=>x.high)),lo=Math.min(...prior.map(x=>x.low));
    if(e.side==='BUY'&&c.low<=lo)e.score=Math.min(99,e.score+3);
    if(e.side==='SELL'&&c.high>=hi)e.score=Math.min(99,e.score+3);
    e.grade=e.score>=88?'A+':e.score>=82?'A':e.score>=74?'B+':e.score>=66?'B':'C';
  }

  events.sort((a,b)=>(b.status==='CONFIRMED'?1:0)-(a.status==='CONFIRMED'?1:0)||b.score-a.score||b.t-a.t);
  const recent=events.filter(e=>e.ageBars<=8).slice(0,8);
  const primary=recent[0]||events[0]||null;
  return{
    timeframe,
    closedOnly:true,
    primary,
    recent,
    counts:{BUY:events.filter(e=>e.side==='BUY').length,SELL:events.filter(e=>e.side==='SELL').length},
    scanned:Math.min(lookback,rows.length),
    note:'Patterns are context candidates, not standalone trade signals. Confirmation still requires structure/price-action context.'
  };
}

export function confirmImportantCandle(report,structureEvent=null){
  if(!report?.primary)return report;
  const p={...report.primary};
  if(structureEvent&&structureEvent.side===p.side&&Number(structureEvent.t)>=Number(p.t)){
    p.status='CONFIRMED';
    p.structureConfirmation=structureEvent.type||'STRUCTURE_BREAK';
    p.score=Math.min(99,p.score+5);
    p.grade=p.score>=88?'A+':p.score>=82?'A':p.score>=74?'B+':p.score>=66?'B':'C';
    p.reason=p.reason+' + '+p.structureConfirmation+' confirmed same-side structure';
  }
  return{...report,primary:p,recent:report.recent.map(x=>x.t===p.t&&x.side===p.side?p:x)};
}
