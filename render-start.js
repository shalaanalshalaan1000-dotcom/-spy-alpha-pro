import {spawn} from 'node:child_process';

const PORT=Number(process.env.PORT||10000);
let stopping=false;
let child=null;

function start(){
  child=spawn(process.execPath,['site-indicator-start.js'],{
    env:{...process.env,PORT:String(PORT)},
    stdio:['ignore','inherit','inherit']
  });
  child.on('exit',code=>{
    console.error('[render-start] site indicator exited',code);
    if(stopping)return;
    setTimeout(start,1000).unref();
  });
}

function shutdown(signal){
  stopping=true;
  if(child&&!child.killed)child.kill(signal);
  setTimeout(()=>process.exit(0),500).unref();
}

process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
start();
console.log('[render-start] Gold Alpha site indicator + news-risk stack started');
