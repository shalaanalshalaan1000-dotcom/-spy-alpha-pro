import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchTelegramDiagnostic(source){
  const oldRoute="if(req.method==='GET'&&url.pathname==='/api/telegram-test'){const ok=await goldTelegram('✅ اختبار Gold Alpha Pro\\nتم ربط تيليجرام بنجاح.\\nتنبيهات الدخول والأهداف TP1–TP4 ووقف الخسارة مفعلة.');return sendJSON(res,ok?200:503,{ok,telegramConfigured:Boolean(telegramBotToken&&telegramChatId)})}";
  const newRoute="if(req.method==='GET'&&url.pathname==='/api/telegram-test'){const tokenConfigured=Boolean(telegramBotToken),chatConfigured=Boolean(telegramChatId),ok=tokenConfigured&&chatConfigured?await goldTelegram('✅ اختبار Gold Alpha Pro\\nتم ربط تيليجرام بنجاح.\\nتنبيهات الدخول والأهداف TP1–TP4 ووقف الخسارة مفعلة.'):false;return sendJSON(res,200,{ok,tokenConfigured,chatConfigured,telegramConfigured:tokenConfigured&&chatConfigured,status:ok?'SENT':(!tokenConfigured?'MISSING_BOT_TOKEN':!chatConfigured?'MISSING_CHAT_ID':'TELEGRAM_SEND_FAILED')})}";
  if(source.includes(oldRoute)) source=source.replace(oldRoute,newRoute);
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs')) return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data);
  const patched=patchTelegramDiagnostic(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-no-chase-start.js');
