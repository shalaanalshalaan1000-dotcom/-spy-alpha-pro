import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patch(source){
  // Make target tracking explicit in the BTC automatic-trade history.
  const oldTouch="function btcExecTouch(signal,raw,price,now){if(!signal)return;const hi=Math.max(Number(price)||-Infinity,Number(raw?.minuteHigh)||-Infinity),lo=Math.min(Number(price)||Infinity,Number(raw?.minuteLow)||Infinity),hit=t=>signal.side==='BUY'?hi>=Number(t):lo<=Number(t),stopped=signal.side==='BUY'?lo<=Number(signal.stopLoss):hi>=Number(signal.stopLoss);signal.targetHits=signal.targetHits||[false,false,false,false];[signal.target1,signal.target2,signal.target3,signal.target4].forEach((t,i)=>{if(Number.isFinite(Number(t))&&hit(t))signal.targetHits[i]=true});if(stopped&&!signal.targetHits[3])signal.result='STOP';if(signal.targetHits[3])signal.result='T4';signal.lastPrice=autoRound(price);signal.lastUpdate=new Date(now).toISOString();const row=btcAutoTradeState.history.find(x=>x.signalId===signal.signalId);if(row)Object.assign(row,{targetHits:[...signal.targetHits],result:signal.result||'OPEN',lastPrice:signal.lastPrice,lastUpdate:signal.lastUpdate});}";
  const newTouch="function btcExecTouch(signal,raw,price,now){if(!signal)return;const hi=Math.max(Number(price)||-Infinity,Number(raw?.minuteHigh)||-Infinity),lo=Math.min(Number(price)||Infinity,Number(raw?.minuteLow)||Infinity),hit=t=>signal.side==='BUY'?hi>=Number(t):lo<=Number(t),stopped=signal.side==='BUY'?lo<=Number(signal.stopLoss):hi>=Number(signal.stopLoss);signal.targetHits=signal.targetHits||[false,false,false,false];signal.targetHitAt=signal.targetHitAt||[null,null,null,null];[signal.target1,signal.target2,signal.target3,signal.target4].forEach((t,i)=>{if(Number.isFinite(Number(t))&&hit(t)&&!signal.targetHits[i]){signal.targetHits[i]=true;signal.targetHitAt[i]=new Date(now).toISOString()}});if(stopped&&!signal.targetHits[3]){signal.result='STOP';signal.stopHitAt=signal.stopHitAt||new Date(now).toISOString()}if(signal.targetHits[3])signal.result='T4';else if(signal.targetHits[2])signal.result='T3';else if(signal.targetHits[1])signal.result='T2';else if(signal.targetHits[0])signal.result='T1';signal.lastPrice=autoRound(price);signal.lastUpdate=new Date(now).toISOString();const row=btcAutoTradeState.history.find(x=>x.signalId===signal.signalId);if(row)Object.assign(row,{targetHits:[...signal.targetHits],targetHitAt:[...signal.targetHitAt],stopHitAt:signal.stopHitAt||null,result:signal.result||'OPEN',lastPrice:signal.lastPrice,lastUpdate:signal.lastUpdate});}";
  if(source.includes(oldTouch))source=source.replace(oldTouch,newTouch);

  source=source.replace(
    "active.targetHits=[false,false,false,false];active.result='OPEN';btcAutoTradeState.signal=active;btcAutoTradeState.history.unshift({...active,targetHits:[false,false,false,false],result:'OPEN',lastPrice:base.price,lastUpdate:new Date(now).toISOString()});",
    "active.targetHits=[false,false,false,false];active.targetHitAt=[null,null,null,null];active.result='OPEN';btcAutoTradeState.signal=active;btcAutoTradeState.history.unshift({...active,targetHits:[false,false,false,false],targetHitAt:[null,null,null,null],stopHitAt:null,result:'OPEN',lastPrice:base.price,lastUpdate:new Date(now).toISOString()});"
  );

  const oldHead='<tr><th>الوقت</th><th>الاتجاه</th><th>الدخول</th><th>السعر</th><th>T1</th><th>T2</th><th>T3</th><th>T4</th><th>الحالة</th></tr>';
  const newHead='<tr><th>الوقت</th><th>الاتجاه</th><th>الدخول</th><th>السعر</th><th>T1</th><th>T2</th><th>T3</th><th>T4</th><th>آخر نتيجة</th><th>الحالة</th></tr>';
  source=source.replace(oldHead,newHead).replaceAll('colspan="9">لا توجد صفقات مسجلة بعد','colspan="10">لا توجد صفقات مسجلة بعد');

  const oldMap="body.innerHTML=rows.slice(0,20).map(x=>{const hits=Array.isArray(x.targetHits)?x.targetHits:[false,false,false,false],side=x.side==='BUY'?'شراء':'بيع',cls=x.side==='BUY'?'btcBuy':'btcSell',tm=new Date(x.issuedAt||Date.now()).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}),money=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';return '<tr><td>'+tm+'</td><td class=\"'+cls+'\">'+side+'</td><td>'+money(x.entry)+'</td><td>'+money(x.lastPrice)+'</td>'+hits.map(h=>'<td class=\"'+(h?'btcHit':'btcMiss')+'\">'+(h?'✓':'—')+'</td>').join('')+'<td>'+(x.result||'OPEN')+'</td></tr>'}).join('')";
  const newMap="body.innerHTML=rows.slice(0,20).map(x=>{const hits=Array.isArray(x.targetHits)?x.targetHits:[false,false,false,false],hitAt=Array.isArray(x.targetHitAt)?x.targetHitAt:[null,null,null,null],side=x.side==='BUY'?'شراء':'بيع',cls=x.side==='BUY'?'btcBuy':'btcSell',tm=new Date(x.issuedAt||Date.now()).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}),money=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—',time=v=>v?new Date(v).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}):'',highest=hits[3]?'وصل T4':hits[2]?'وصل T3':hits[1]?'وصل T2':hits[0]?'وصل T1':(x.result==='STOP'?'ضرب الوقف':'لم يصل هدف بعد'),status=x.result==='STOP'?'وقف خسارة':hits[3]?'اكتملت الأهداف':'مفتوحة/تحت المتابعة';return '<tr><td>'+tm+'</td><td class=\"'+cls+'\">'+side+'</td><td>'+money(x.entry)+'</td><td>'+money(x.lastPrice)+'</td>'+hits.map((h,i)=>'<td class=\"'+(h?'btcHit':'btcMiss')+'\">'+(h?'✓ وصل'+(hitAt[i]?'<br><small>'+time(hitAt[i])+'</small>':''):'لم يصل')+'</td>').join('')+'<td class=\"'+(highest.startsWith('وصل')?'btcHit':highest==='ضرب الوقف'?'btcSell':'btcMiss')+'\">'+highest+'</td><td>'+status+'</td></tr>'}).join('')";
  if(source.includes(oldMap))source=source.replace(oldMap,newMap);

  source=source.replace('السجل يتابع الإشارة الصادرة للتنفيذ والأهداف التي لمسها السعر. سعر تعبئة MT5 الفعلي قد يختلف قليلًا بسبب السبريد والانزلاق.','السجل يوضح لكل صفقة آلية هل وصل T1 / T2 / T3 / T4 أم لا، ويعرض وقت لمس كل هدف. سعر تعبئة MT5 الفعلي قد يختلف قليلًا بسبب السبريد والانزلاق.');
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),source=patch(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args);
};

syncBuiltinESMExports();
await import('./btc-fast-m1-start.js');
