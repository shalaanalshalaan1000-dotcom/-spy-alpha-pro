import {spawn} from 'node:child_process';

const PORT=Number(process.env.PORT||10000);
let stopping=false;
const children=[];

function run(name,file,extraEnv={}){
  const child=spawn(process.execPath,[file],{env:{...process.env,...extraEnv},stdio:['ignore','inherit','inherit']});
  children.push(child);
  child.on('exit',code=>{
    console.error(`[render-start] ${name} exited`,code);
    if(stopping)return;
    setTimeout(()=>run(name,file,extraEnv),1000).unref();
  });
  return child;
}

run('gold-service','gold-resilient-unified-start.js',{PORT:String(PORT)});
run('telegram-bot','telegram-xau-bot.js',{TELEGRAM_SIGNAL_URL:`http://127.0.0.1:${PORT}/api/auto-trade/signal?observe=1`});

function shutdown(signal){
  stopping=true;
  for(const child of children){if(child&&!child.killed)child.kill(signal);}
  setTimeout(()=>process.exit(0),500).unref();
}

process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
console.log('[render-start] Gold service + Telegram bot supervisor started');
