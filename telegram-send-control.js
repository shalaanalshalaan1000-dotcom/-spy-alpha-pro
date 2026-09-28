import fs from 'node:fs';

const CONTROL_PATH=String(process.env.TELEGRAM_SEND_CONTROL_PATH||'/tmp/gold-alpha-telegram-send-control.json').trim();
const DEFAULT_ENABLED=String(process.env.TELEGRAM_SEND_DEFAULT_ENABLED||'true').toLowerCase()!=='false';

function readState(){
  try{
    const d=JSON.parse(fs.readFileSync(CONTROL_PATH,'utf8'));
    if(typeof d?.enabled==='boolean')return d;
  }catch{}
  return {enabled:DEFAULT_ENABLED,updatedAt:null,source:'default'};
}
function writeState(enabled,source='telegram'){
  const state={enabled:Boolean(enabled),updatedAt:new Date().toISOString(),source:String(source||'telegram')};
  try{
    const tmp=CONTROL_PATH+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(state),'utf8');
    fs.renameSync(tmp,CONTROL_PATH);
  }catch(e){
    console.error('[telegram-send-control]',e?.message||e);
  }
  return state;
}
export function telegramSendState(){return readState();}
export function telegramSendingEnabled(){return readState().enabled===true;}
export function setTelegramSendingEnabled(enabled,source='telegram'){return writeState(enabled,source);}
