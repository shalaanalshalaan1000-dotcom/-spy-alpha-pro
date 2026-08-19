import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./start.js',import.meta.url);
const runtimePath=new URL('./.runtime-start-options.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

const writeAnchor="writeFileSync(runtimePath,source,'utf8');";
if(!source.includes(writeAnchor))throw new Error('start.js runtime write anchor missing');

const optionPatch=String.raw`
// Swing options quality patch: price is not a selection constraint. SPX 0DTE remains unchanged.
const scoreOld="function optionScore(o,symbol,spot){const sp=spreadPct(o),mid=optionPrice(o)||0,absDelta=Math.abs(o.delta||0),dte=o.daysToExpiry??99;let s=0;if(sp!=null){if(sp<=4)s+=22;else if(sp<=7)s+=15;else if(sp<=10)s+=7;else s-=18}else if(mid>0)s+=2;if((o.openInterest||0)>=2000)s+=16;else if((o.openInterest||0)>=750)s+=10;else if((o.openInterest||0)>=200)s+=4;else s-=6;if((o.volume||0)>=1000)s+=14;else if((o.volume||0)>=250)s+=9;else if((o.volume||0)>=50)s+=3;if(symbol==='SPX'){if(absDelta>=.20&&absDelta<=.55)s+=12;if(dte<=1.2)s+=14;else s-=18;if(mid>0&&mid<=1.5)s+=12}else{if(absDelta>=.18&&absDelta<=.45)s+=16;else if(absDelta>=.12&&absDelta<=.55)s+=8;if(dte>=14&&dte<=30)s+=26;else if(dte>=10&&dte<=45)s+=8;else s-=20;if(mid>=.70&&mid<=1.30)s+=28;else if(mid>=.50&&mid<=1.60)s+=18;else if(mid>=.40&&mid<=2.00)s+=7;else s-=12;s+=Math.max(-10,10-Math.abs(mid-1)*10)}const distancePct=Math.abs(o.strike-spot)/spot*100;if(distancePct<=1.2)s+=12;else if(distancePct<=2.5)s+=7;else if(distancePct>6)s-=16;return s}";
const scoreNew="function optionScore(o,symbol,spot){const sp=spreadPct(o),mid=optionPrice(o)||0,absDelta=Math.abs(o.delta||0),dte=o.daysToExpiry??99;let s=0;if(sp!=null){if(sp<=3)s+=30;else if(sp<=5)s+=24;else if(sp<=8)s+=15;else if(sp<=12)s+=5;else s-=30}else if(mid>0)s+=3;if((o.openInterest||0)>=5000)s+=24;else if((o.openInterest||0)>=2000)s+=20;else if((o.openInterest||0)>=750)s+=14;else if((o.openInterest||0)>=200)s+=7;else if((o.volume||0)<50)s-=10;if((o.volume||0)>=2500)s+=20;else if((o.volume||0)>=1000)s+=16;else if((o.volume||0)>=250)s+=10;else if((o.volume||0)>=50)s+=5;if(symbol==='SPX'){if(absDelta>=.20&&absDelta<=.55)s+=12;if(dte<=1.2)s+=14;else s-=18;if(mid>0&&mid<=1.5)s+=12}else{if(absDelta>=.30&&absDelta<=.55)s+=26;else if(absDelta>=.20&&absDelta<=.65)s+=14;else s-=8;if(dte>=14&&dte<=30)s+=30;else if(dte>=31&&dte<=45)s+=22;else if(dte>=7&&dte<14)s+=14;else s-=28;if(mid<.25)s-=12}const distancePct=Math.abs(o.strike-spot)/spot*100;if(distancePct<=1.5)s+=16;else if(distancePct<=3)s+=10;else if(distancePct<=5)s+=3;else s-=18;return s}";
if(!source.includes(scoreOld))throw new Error('Option score anchor missing');
source=source.replace(scoreOld,scoreNew);

const chooseOld="function chooseContract(chain,direction,spot,symbol){\n  if(!chain?.length||!['CALL','PUT'].includes(direction))return null;\n  const type=direction==='CALL'?'call':'put';\n  let candidates=chain.filter(o=>o.type===type&&optionPrice(o)>0&&(spreadPct(o)==null||spreadPct(o)<=15));\n  if(symbol==='SPX'){\n    candidates=candidates.filter(o=>(o.daysToExpiry??99)<=1.2&&optionPrice(o)<=1.5&&(type==='call'?o.strike>spot:o.strike<spot));\n  }else{\n    candidates=candidates.filter(o=>(o.daysToExpiry??0)>=14&&(o.daysToExpiry??99)<=30);\n    const dollarZone=candidates.filter(o=>optionPrice(o)>=.70&&optionPrice(o)<=1.30);\n    const nearDollar=candidates.filter(o=>optionPrice(o)>=.50&&optionPrice(o)<=1.60);\n    candidates=dollarZone.length?dollarZone:(nearDollar.length?nearDollar:candidates.filter(o=>optionPrice(o)>=.40&&optionPrice(o)<=2.00));\n  }\n  if(!candidates.length)return null;\n  let pool=candidates.filter(o=>type==='call'?o.strike>=spot&&o.strike<=spot*1.06:o.strike<=spot&&o.strike>=spot*.94);\n  if(!pool.length)pool=candidates;\n  return pool.sort((a,b)=>optionScore(b,symbol,spot)-optionScore(a,symbol,spot))[0];\n}";
const chooseNew="function chooseContract(chain,direction,spot,symbol){\n  if(!chain?.length||!['CALL','PUT'].includes(direction))return null;\n  const type=direction==='CALL'?'call':'put';\n  let candidates=chain.filter(o=>o.type===type&&optionPrice(o)>0&&(spreadPct(o)==null||spreadPct(o)<=12));\n  if(symbol==='SPX'){\n    candidates=candidates.filter(o=>(o.daysToExpiry??99)<=1.2&&optionPrice(o)<=1.5&&(type==='call'?o.strike>spot:o.strike<spot));\n  }else{\n    candidates=candidates.filter(o=>(o.daysToExpiry??0)>=7&&(o.daysToExpiry??99)<=45);\n  }\n  if(!candidates.length)return null;\n  let pool=candidates.filter(o=>type==='call'?o.strike>=spot*.99&&o.strike<=spot*1.05:o.strike<=spot*1.01&&o.strike>=spot*.95);\n  if(!pool.length)pool=candidates;\n  return pool.sort((a,b)=>optionScore(b,symbol,spot)-optionScore(a,symbol,spot))[0];\n}";
if(!source.includes(chooseOld))throw new Error('Option selector anchor missing');
source=source.replace(chooseOld,chooseNew);

const finalObjectAnchor='function finalContractObject(raw,symbol,spot,target,stop){';
if(!source.includes(finalObjectAnchor))throw new Error('Final contract helper anchor missing');
const setupSelector="function chooseContractForSetup(chain,direction,spot,symbol,target,stop){if(symbol==='SPX')return chooseContract(chain,direction,spot,symbol);if(!chain?.length||!['CALL','PUT'].includes(direction))return null;const type=direction==='CALL'?'call':'put',candidates=chain.filter(o=>o.type===type&&optionPrice(o)>0&&(o.daysToExpiry??0)>=7&&(o.daysToExpiry??99)<=45&&(spreadPct(o)==null||spreadPct(o)<=12));if(!candidates.length)return null;const ranked=candidates.map(o=>{const now=optionPrice(o),atTarget=estimateContract(o,spot,target,.75),atStop=estimateContract(o,spot,stop,.35),reward=Math.max((atTarget||0)-now,0),risk=Math.max(now-(atStop||0),.01),rr=reward/risk;let quality=optionScore(o,symbol,spot);if(rr>=3)quality+=28;else if(rr>=2)quality+=22;else if(rr>=1.5)quality+=5;else quality-=30;if((o.openInterest||0)>=750||(o.volume||0)>=250)quality+=8;return{o,quality,rr}}).sort((a,b)=>b.quality-a.quality||b.rr-a.rr);return ranked[0]?.o||null}\n";
source=source.replace(finalObjectAnchor,setupSelector+finalObjectAnchor);

const rawOld='const raw=chooseContract(snapshot.options||[],dir,spot,snapshot.symbol);';
const rawNew='const raw=chooseContractForSetup(snapshot.options||[],dir,spot,snapshot.symbol,target,stop);';
if(!source.includes(rawOld))throw new Error('Final contract selection anchor missing');
source=source.replace(rawOld,rawNew);

source=source.replace('SPX يعرض عقود 0DTE لليوم فقط؛ بقية الرموز تستخدم مسار ارتداد 14–30 يومًا، مع جلب حتى 45 يومًا للمفاضلة. العقد المقترح مميز بالأخضر.','SPX يعرض عقود 0DTE لليوم فقط؛ بقية الرموز تفاضل عقود Swing من 7–45 يومًا حسب السيولة وDelta وSpread وRR، بدون اشتراط أن يكون العقد رخيصًا. العقد المقترح مميز بالأخضر.');
source=source.replace('مسار ارتداد Swing: أولوية لمناطق الانعكاس والدعم/المقاومة، وعقود 14–30 DTE بسعر قريب من $1 مع سيولة مقبولة. SPX وحده يبقى 0DTE مستقل.','مسار Swing: أولوية لجودة الفرصة والسيولة وDelta وSpread وRR. العقود من 7–45 DTE ولا يوجد سقف لسعر الـPremium. SPX وحده يبقى 0DTE مستقل.');
`;

source=source.replace(writeAnchor,optionPatch+'\n'+writeAnchor);
writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
