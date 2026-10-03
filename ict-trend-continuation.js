// Separate ICT continuation route: no synthetic sweep and no Laura/BTC dependencies.
const M5=300_000;
export function findTrendContinuation({bars=[],side,dir4,dir1,price,now}){
  const sign=side==='BUY'?1:side==='SELL'?-1:0;
  if(!sign||dir4!==sign||dir1!==sign||!Number.isFinite(price))return null;
  const x=bars.filter(b=>b.t+M5<=now).slice(-32);
  for(let i=x.length-2;i>=3;i--){
    const a=x[i-2],b=x[i-1],c=x[i];
    if(b.t-a.t!==M5||c.t-b.t!==M5||now-(c.t+M5)>75*60_000)continue;
    const ranges=x.slice(Math.max(0,i-15),i-1).map(z=>z.high-z.low);
    const avg=ranges.reduce((s,v)=>s+v,0)/ranges.length;
    const body=(b.close-b.open)*sign,range=b.high-b.low;
    if(!(body>=avg*1.2&&body>=range*.65))continue;
    const low=sign===1?a.high:c.high,high=sign===1?c.low:a.low;
    if(!(high>low))continue;
    const later=x.slice(i+1);
    if(later.some(z=>sign===1?z.close<low:z.close>high))continue;
    const retest=later.find(z=>z.low<=high&&z.high>=low&&(sign===1?z.close>=high&&z.close>z.open:z.close<=low&&z.close<z.open));
    if(!retest||now-(retest.t+M5)>2*M5)continue;
    const pad=Math.max(.05,Math.min(.25,avg*.15));
    if(price<low-pad||price>high+pad)continue;
    return{side,dir4,dir1,timeframe:'M5',displacementT:b.t+M5,fvg:{low,high,mid:(low+high)/2,t:c.t,type:sign===1?'BULL_FVG':'BEAR_FVG'},fvgCloseT:c.t+M5,retestT:retest.t+M5,retested:true,stopAnchor:sign===1?Math.min(b.low,c.low,retest.low):Math.max(b.high,c.high,retest.high)};
  }
  return null;
}
export function validTrendContinuation(ict,side,now=Date.now()){
  const c=ict?.trendContinuation,sign=side==='BUY'?1:side==='SELL'?-1:0;
  return Boolean(sign&&ict?.setupType==='ICT_HTF_TREND_FVG_RETEST'&&c?.side===side&&c.dir4===sign&&c.dir1===sign&&c.timeframe==='M5'&&c.retested===true&&Number.isFinite(c.fvg?.low)&&c.fvg.high>c.fvg.low&&Number.isFinite(c.displacementT)&&c.displacementT<c.fvgCloseT&&c.fvgCloseT<c.retestT&&c.retestT<=now&&now-c.retestT<=2*M5&&now-c.fvgCloseT<=75*60_000);
}
