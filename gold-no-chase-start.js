import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchNoChase(source){
  const oldModel="const direction=setup.direction,side=setup.side,closes=bars.slice(-6).map(x=>x.close),aligned=direction>0?closes.at(-1)>closes[0]:closes.at(-1)<closes[0],displacement=Math.abs(price-setup.sweep.close)>=atr*.7,confidence=Math.min(92,75+(aligned?7:0)+(displacement?5:0)),buffer=Math.max(.35,atr*.35),stop=direction>0?setup.sweep.low-buffer:setup.sweep.high+buffer,risk=Math.abs(price-stop);if(risk<.8||risk>GOLD_AUTO_MAX_STOP_USD)return{...base,status:'WAIT',confidence,reason:risk<.8?'Structural stop too close':'NO TRADE: structural stop wider than 3 USD'};const r1=Math.max(5,risk*2),half=Math.min(1,Math.max(.25,atr*.2));return{...base,status:'CANDIDATE',confidence,candidateAction:side,entry:goldAutoRound(price),entryLow:goldAutoRound(price-half),entryHigh:goldAutoRound(price+half),stopLoss:goldAutoRound(stop),target1:goldAutoRound(price+direction*r1),target2:goldAutoRound(price+direction*Math.max(risk*2.7,r1*1.35)),target3:goldAutoRound(price+direction*Math.max(risk*3.3,r1*1.65)),target4:goldAutoRound(price+direction*Math.max(risk*4,r1*2)),riskReward:goldAutoRound(r1/risk,2),reason:'XAU confirmed: Sweep + Reclaim + MSS'}";
  const newModel="const direction=setup.direction,side=setup.side,closes=bars.slice(-6).map(x=>x.close),aligned=direction>0?closes.at(-1)>closes[0]:closes.at(-1)<closes[0],displacement=Math.abs(price-setup.sweep.close)>=atr*.7,confidence=Math.min(92,75+(aligned?7:0)+(displacement?5:0)),buffer=Math.max(.35,atr*.35),stop=direction>0?setup.sweep.low-buffer:setup.sweep.high+buffer,half=Math.min(1,Math.max(.25,atr*.2)),entryBase=setup.mssLevel,chaseDistance=Math.abs(price-entryBase),maxChase=Math.max(1.25,atr*.75),risk=Math.abs(entryBase-stop);if(chaseDistance>maxChase)return{...base,status:'WAIT',confidence,reason:'NO CHASE: price already moved too far beyond the MSS entry; waiting for a fresh setup'};if(risk<.8||risk>GOLD_AUTO_MAX_STOP_USD)return{...base,status:'WAIT',confidence,reason:risk<.8?'Structural stop too close':'NO TRADE: structural stop wider than 3 USD'};const r1=Math.max(5,risk*2);return{...base,status:'CANDIDATE',confidence,candidateAction:side,entry:goldAutoRound(entryBase),entryLow:goldAutoRound(entryBase-half),entryHigh:goldAutoRound(entryBase+half),stopLoss:goldAutoRound(stop),target1:goldAutoRound(entryBase+direction*r1),target2:goldAutoRound(entryBase+direction*Math.max(risk*2.7,r1*1.35)),target3:goldAutoRound(entryBase+direction*Math.max(risk*3.3,r1*1.65)),target4:goldAutoRound(entryBase+direction*Math.max(risk*4,r1*2)),riskReward:goldAutoRound(r1/risk,2),reason:'XAU confirmed: fresh MSS retest entry — no chase'}";
  if(!source.includes(oldModel)) throw new Error('No-chase model anchor missing');
  source=source.replace(oldModel,newModel);

  source=source.replace(
    "q('#goldAutoEntryState').textContent=status==='ACTIVE'?'النطاق جاهز للدخول':status==='MANAGING'?'تم تفعيل الدخول':status==='CANDIDATE'?'مرشح للدخول':status==='COLLECTING'?'يجمع شموع M1':'لا توجد إشارة فعالة';",
    "q('#goldAutoEntryState').textContent=status==='ACTIVE'&&!entered?'بانتظار لمس نطاق دخول جديد':status==='MANAGING'?'تم تفعيل الدخول':status==='CANDIDATE'?'مرشح جديد — غير منفذ':status==='COLLECTING'?'يجمع شموع M1':'لا توجد إشارة فعالة';"
  );

  const tgAnchor="const goldAutoState={samples:[],signal:null,cooldownUntil:0,lastStopped:null};";
  if(!source.includes(tgAnchor)) throw new Error('Telegram state anchor missing');
  source=source.replace(tgAnchor,tgAnchor+`
const telegramBotToken=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const telegramChatId=String(process.env.TELEGRAM_CHAT_ID||'').trim();
async function goldTelegram(text){
  if(!telegramBotToken||!telegramChatId)return false;
  try{
    const r=await fetch('https://api.telegram.org/bot'+telegramBotToken+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:telegramChatId,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)});
    return r.ok;
  }catch{return false}
}
function goldTelegramPrice(v){return Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—'}
`);

  const lifecycleAnchor="let active=goldAutoState.signal;if(active){const stopped=";
  if(!source.includes(lifecycleAnchor)) throw new Error('Telegram lifecycle anchor missing');
  source=source.replace(lifecycleAnchor,`let active=goldAutoState.signal;if(active){
    if(active.entered){
      active.telegramTargets=active.telegramTargets||{};
      const checks=[[1,active.target1],[2,active.target2],[3,active.target3],[4,active.target4]];
      for(const [n,t] of checks){
        if(!active.telegramTargets[n]&&goldAutoTargetHit(active,sample.price,t)){
          active.telegramTargets[n]=true;
          void goldTelegram('🎯 XAUUSD تحقق الهدف '+n+'\n'+(active.side==='BUY'?'شراء':'بيع')+' | السعر '+goldTelegramPrice(sample.price)+'\nالهدف: '+goldTelegramPrice(t)+'\nالثقة: '+active.confidence+'%');
        }
      }
    }
    const stopped=`);

  const stopAnchor="if(stopped){goldAutoState.lastStopped={side:active.side,entry:active.entry,stopLoss:active.stopLoss,stoppedAt:sample.now};";
  if(!source.includes(stopAnchor)) throw new Error('Telegram stop anchor missing');
  source=source.replace(stopAnchor,"if(stopped){void goldTelegram('🛑 XAUUSD ضرب وقف الخسارة\n'+(active.side==='BUY'?'شراء':'بيع')+' | السعر '+goldTelegramPrice(sample.price)+'\nالوقف: '+goldTelegramPrice(active.stopLoss));goldAutoState.lastStopped={side:active.side,entry:active.entry,stopLoss:active.stopLoss,stoppedAt:sample.now};");

  const entryAnchor="if(!active.entered&&entryOpen&&inRange){active.entered=true;active.enteredAtMs=sample.now;goldAutoState.signal=active}const executable=";
  if(!source.includes(entryAnchor)) throw new Error('Telegram entry anchor missing');
  source=source.replace(entryAnchor,`if(!active.entered&&entryOpen&&inRange){active.entered=true;active.enteredAtMs=sample.now;goldAutoState.signal=active}
    if(active.entered&&!active.telegramEntryNotified){
      active.telegramEntryNotified=true;
      goldAutoState.signal=active;
      void goldTelegram('🚨 XAUUSD دخول '+(active.side==='BUY'?'شراء':'بيع')+'\nالدخول: '+goldTelegramPrice(active.entryLow)+' — '+goldTelegramPrice(active.entryHigh)+'\nوقف الخسارة: '+goldTelegramPrice(active.stopLoss)+'\nTP1: '+goldTelegramPrice(active.target1)+' | TP2: '+goldTelegramPrice(active.target2)+'\nTP3: '+goldTelegramPrice(active.target3)+' | TP4: '+goldTelegramPrice(active.target4)+'\nالثقة: '+active.confidence+'%');
    }
    const executable=`);

  const configAnchor="if(req.method==='GET'&&url.pathname==='/api/config')return sendJSON(res,200,{watchlist:WATCHLIST,minConfidence:Number(process.env.MIN_CONFIDENCE||70),user:session?.email||null,...currentMode()});";
  if(!source.includes(configAnchor)) throw new Error('Telegram test route anchor missing');
  source=source.replace(configAnchor,`if(req.method==='GET'&&url.pathname==='/api/telegram-test'){const tokenConfigured=Boolean(telegramBotToken),chatConfigured=Boolean(telegramChatId),ok=tokenConfigured&&chatConfigured?await goldTelegram('✅ اختبار Gold Alpha Pro\nتم ربط تيليجرام بنجاح.\nتنبيهات الدخول والأهداف TP1–TP4 ووقف الخسارة مفعلة.'):false;return sendJSON(res,200,{ok,tokenConfigured,chatConfigured,telegramConfigured:tokenConfigured&&chatConfigured,status:ok?'SENT':(!tokenConfigured?'MISSING_BOT_TOKEN':!chatConfigured?'MISSING_CHAT_ID':'TELEGRAM_SEND_FAILED')})}\n    `+configAnchor);

  source=source.replace(
    "if(authEnabled()&&!session&&url.pathname!=='/api/auto-trade/signal')return url.pathname.startsWith('/api/')?sendJSON(res,401,{error:'Authentication required'}):redirect(res,'/login');",
    "if(authEnabled()&&!session&&url.pathname!=='/api/auto-trade/signal'&&url.pathname!=='/api/telegram-test')return url.pathname.startsWith('/api/')?sendJSON(res,401,{error:'Authentication required'}):redirect(res,'/login');"
  );

  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data);
  const patched=patchNoChase(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-entry-guard-start.js');
