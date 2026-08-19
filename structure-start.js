import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalReadFileSync=fs.readFileSync.bind(fs);
fs.readFileSync=function(path,...args){
  const out=originalReadFileSync(path,...args);
  const name=String(path?.pathname||path||'');
  const encoding=typeof args[0]==='string'?args[0]:args[0]?.encoding;
  if(!name.endsWith('/server.js')&&!name.endsWith('server.js'))return out;
  if(encoding!=='utf8'&&encoding!=='utf-8')return out;
  let source=String(out);

  const coreAnchor='function analyzeCore(snapshot,settings={}){';
  if(!source.includes(coreAnchor))throw new Error('Structure engine analyzeCore anchor missing');
  source=source.replace(coreAnchor,'function analyzeCoreBase(snapshot,settings={}){');

  const spxAnchor='function spxTradePolicy(date=new Date()){';
  if(!source.includes(spxAnchor))throw new Error('Structure engine SPX anchor missing');

  const engine=`function structureNyParts(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return{dayKey:parts.year+'-'+parts.month+'-'+parts.day,minutes:Number(parts.hour)*60+Number(parts.minute)};
}
function structureSessionLevels(intraday){
  const now=structureNyParts(new Date()),same=[];
  for(const bar of intraday||[]){const p=structureNyParts(bar.timestamp);if(p.dayKey===now.dayKey)same.push({...bar,_m:p.minutes})}
  const pre=same.filter(x=>x._m>=240&&x._m<570),opening=same.filter(x=>x._m>=570&&x._m<600),regular=same.filter(x=>x._m>=570&&x._m<960),recent=same.slice(-4);
  const high=a=>a.length?Math.max(...a.map(x=>Number(x.high)).filter(Number.isFinite)):null,low=a=>a.length?Math.min(...a.map(x=>Number(x.low)).filter(Number.isFinite)):null;
  const closes=recent.map(x=>Number(x.close)).filter(Number.isFinite),up=closes.length>=3&&closes.at(-1)>closes.at(-2)&&closes.at(-2)>=closes.at(-3),down=closes.length>=3&&closes.at(-1)<closes.at(-2)&&closes.at(-2)<=closes.at(-3);
  const phase=now.minutes>=570&&now.minutes<960?'REGULAR':now.minutes>=240&&now.minutes<570?'PREMARKET':now.minutes>=960&&now.minutes<1200?'AFTER_HOURS':'OVERNIGHT';
  return{phase,pmh:high(pre),pml:low(pre),orh:high(opening),orl:low(opening),regularHigh:high(regular),regularLow:low(regular),momentumUp:up,momentumDown:down};
}
function structureHtfBias(daily){
  const closes=(daily||[]).map(x=>Number(x.close)).filter(Number.isFinite);if(closes.length<20)return'NEUTRAL';
  const fast=ema(closes.slice(-40),9),slow=ema(closes.slice(-60),20);return fast>slow?'CALL':fast<slow?'PUT':'NEUTRAL';
}
function structureSessionConfirm(direction,spot,levels){
  if(direction==='CALL'){
    if(levels.phase==='REGULAR'&&((Number.isFinite(levels.pmh)&&spot>levels.pmh)||(Number.isFinite(levels.orh)&&spot>levels.orh)||levels.momentumUp))return true;
    if(levels.phase==='PREMARKET'&&levels.momentumUp&&(!Number.isFinite(levels.pmh)||spot>=levels.pmh*.999))return true;
  }
  if(direction==='PUT'){
    if(levels.phase==='REGULAR'&&((Number.isFinite(levels.pml)&&spot<levels.pml)||(Number.isFinite(levels.orl)&&spot<levels.orl)||levels.momentumDown))return true;
    if(levels.phase==='PREMARKET'&&levels.momentumDown&&(!Number.isFinite(levels.pml)||spot<=levels.pml*1.001))return true;
  }
  return false;
}
function structureScoreFor(direction,{spot,vw,smc,fvg,htf,levels}){
  const parts={session:0,sweep:0,mss:0,fvg:0,vwap:0,htf:0};
  if(structureSessionConfirm(direction,spot,levels))parts.session=15;
  if(direction==='CALL'&&smc.sweepLow)parts.sweep=25;if(direction==='PUT'&&smc.sweepHigh)parts.sweep=25;
  if(direction==='CALL'&&(smc.mssBull||smc.bosBull))parts.mss=20;if(direction==='PUT'&&(smc.mssBear||smc.bosBear))parts.mss=20;
  if(direction==='CALL'&&fvg.bull)parts.fvg=15;if(direction==='PUT'&&fvg.bear)parts.fvg=15;
  if(direction==='CALL'&&spot>vw)parts.vwap=15;if(direction==='PUT'&&spot<vw)parts.vwap=15;
  if(htf===direction)parts.htf=10;
  return{parts,total:Object.values(parts).reduce((a,b)=>a+b,0),gate:parts.sweep===25&&parts.mss===20};
}
function analyzeCore(snapshot,settings={}){
  const base=analyzeCoreBase(snapshot,settings),intraday=snapshot.intraday||[],daily=snapshot.daily||[],spot=Number(base.spot),vw=Number(base.indicators?.vwap),smc=detectStructure(intraday),fvg=detectFVG(intraday),htf=structureHtfBias(daily),levels=structureSessionLevels(intraday);
  const call=structureScoreFor('CALL',{spot,vw,smc,fvg,htf,levels}),put=structureScoreFor('PUT',{spot,vw,smc,fvg,htf,levels}),direction=['CALL','PUT'].includes(base.direction)?base.direction:(call.total>put.total?'CALL':put.total>call.total?'PUT':'NO TRADE'),chosen=direction==='CALL'?call:direction==='PUT'?put:{parts:{session:0,sweep:0,mss:0,fvg:0,vwap:0,htf:0},total:0,gate:false};
  let penalty=0;const reasons=[];
  if(base.indicators?.atrConsumedPct>=100){penalty+=16;reasons.push('ATR اليومي مستهلك بالكامل تقريبًا')}else if(base.indicators?.atrConsumedPct>=85){penalty+=10;reasons.push('معظم ATR اليومي مستهلك')}else if(base.indicators?.atrConsumedPct>=70){penalty+=5;reasons.push('ATR مستهلك جزئيًا')}
  if(base.indicators?.pivotDistanceAtr>.45){penalty+=6;reasons.push('السعر بعيد عن منطقة ارتكاز واضحة')}
  if(base.contract){if(base.contract.spreadPct==null){penalty+=4;reasons.push('Bid/Ask غير متوفر؛ سعر العقد مرجعي')}else if(base.contract.spreadPct>10){penalty+=10;reasons.push('Spread العقد واسع')}if((base.contract.openInterest||0)<200){penalty+=5;reasons.push('Open Interest منخفض')}if(Number(base.contract.rr)<2){penalty+=8;reasons.push('RR للعقد أقل من 1:2')}}
  let confidence=Math.max(0,Math.min(95,Math.round(chosen.total-penalty)));
  if(!chosen.gate&&confidence>69)confidence=69;
  const minConfidence=Math.max(70,Number(settings.minConfidence??70));
  let state='NO TRADE',band='LOW';
  if(chosen.gate&&confidence>=80){state=direction;band='HIGH CONVICTION'}else if(chosen.gate&&confidence>=minConfidence){state=direction;band='VALID'}else if(confidence>=60){state='WATCH';band='WATCH'};
  const structureReasons=[];
  if(chosen.parts.sweep)structureReasons.push(direction==='CALL'?'Liquidity Sweep للقاع +25':'Liquidity Sweep للقمة +25');
  if(chosen.parts.mss)structureReasons.push(direction==='CALL'?'MSS/BOS صاعد +20':'MSS/BOS هابط +20');
  if(chosen.parts.fvg)structureReasons.push(direction==='CALL'?'Bullish FVG +15':'Bearish FVG +15');
  if(chosen.parts.vwap)structureReasons.push(direction==='CALL'?'فوق VWAP +15':'تحت VWAP +15');
  if(chosen.parts.htf)structureReasons.push('HTF Bias متوافق +10');
  if(chosen.parts.session)structureReasons.push('Session confirmation +15');
  if(!chosen.gate)structureReasons.push('لا توجد بعد توليفة Sweep + MSS؛ لا تتحول لإشارة مؤكدة');
  const candidateContract=base.contract||null;
  base.direction=direction;base.confidence=confidence;base.state=state;base.convictionBand=band;
  base.structure={score:chosen.total,penalty,gate:chosen.gate,components:chosen.parts,callScore:call.total,putScore:put.total,htfBias:htf,session:levels.phase,levels:{pmh:round(levels.pmh),pml:round(levels.pml),orh:round(levels.orh),orl:round(levels.orl)}};
  base.pivots={...base.pivots,pmh:round(levels.pmh),pml:round(levels.pml),orh:round(levels.orh),orl:round(levels.orl)};
  base.setup={...base.setup,reasons:[...new Set([...structureReasons,...reasons,...(base.setup?.reasons||[])])].slice(0,16)};
  if(!['CALL','PUT'].includes(state)){base.candidateContract=candidateContract;base.contract=null}
  return base;
}
`;
  source=source.replace(spxAnchor,engine+spxAnchor);
  return source;
};

syncBuiltinESMExports();
await import('./tracking-start.js');
