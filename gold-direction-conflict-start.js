import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function patchDirectionConflict(source) {
  const client = `
function goldTextNodeByLabel(label){
  const all=[...document.querySelectorAll('span,div,p,small')];
  const lab=all.find(n=>String(n.textContent||'').trim()===label);
  if(!lab)return null;
  const card=lab.closest('.card,.goldPlanCard,[class*=card],[class*=Card]')||lab.parentElement;
  if(!card)return null;
  return card.querySelector('strong,b,[class*=value],[class*=Value]');
}
function syncGoldDirectionConflictGuard(){
  let lock=null;try{lock=typeof readGoldTradeLock==='function'?readGoldTradeLock():null}catch{}
  if(!lock)return;
  const entered=Boolean(lock.entryTouched||lock.actualEntry||lock.entryTouchedAt);
  if(entered)return;
  const shortNode=goldTextNodeByLabel('اتجاه القراءة القصيرة');
  const shortText=String(shortNode?.textContent||'').trim();
  const shortSide=shortText.includes('هابط')?'DOWN':shortText.includes('صاعد')?'UP':null;
  const lockSide=String(lock.state||'').toUpperCase();
  if(!shortSide||!['UP','DOWN'].includes(lockSide)||shortSide===lockSide)return;

  const status=document.querySelector('#goldPlanStatus');
  const scenario=document.querySelector('#goldScenario');
  const conf=document.querySelector('#goldConfidence');
  const note=document.querySelector('#goldPlanNote');
  const actualState=document.querySelector('#goldActualEntryState');
  const entryState=document.querySelector('#goldEntryRangeState');
  if(status){status.textContent='انتظار — تعارض الاتجاه';status.className='goldPlanStatus muted'}
  if(scenario)scenario.textContent='انتظار';
  if(conf)conf.textContent='القراءة القصيرة عكس السيناريو المقفول — الدخول معلّق';
  if(note)note.textContent='لا تدخل الآن: اتجاه القراءة القصيرة يعاكس سيناريو 5 دقائق. يبقى السيناريو تحت المراقبة حتى يعود التوافق أو يصل حد الإلغاء.';
  if(actualState)actualState.textContent='الدخول معلّق بسبب تعارض الاتجاه';
  if(entryState)entryState.textContent='WAIT — لا تنفيذ مع تعارض الاتجاه';

  const candidates=[...document.querySelectorAll('.goldPlanCard,.card,[class*=card],[class*=Card]')];
  for(const card of candidates){
    const t=String(card.textContent||'');
    if(t.includes('الدخول المقبول')||t.includes('نطاق الدخول')||t.includes('الدخول المفعّل')){
      const small=card.querySelector('small');
      if(small)small.textContent='WAIT • تعارض 1m مع 5m';
    }
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(syncGoldDirectionConflictGuard,900);setInterval(syncGoldDirectionConflictGuard,1000)});else{setTimeout(syncGoldDirectionConflictGuard,900);setInterval(syncGoldDirectionConflictGuard,1000)}
`;
  if(!source.includes('function syncGoldDirectionConflictGuard')&&source.includes('(async()=>{')){
    source=source.replace('(async()=>{',client+'\n(async()=>{');
  }
  return source;
}

fs.writeFileSync = function(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return previousWriteFileSync(path, data, ...args);
  }
  const isBuffer = Buffer.isBuffer(data);
  const patched = patchDirectionConflict(isBuffer ? data.toString('utf8') : String(data));
  return previousWriteFileSync(path, isBuffer ? Buffer.from(patched, 'utf8') : patched, ...args);
};

syncBuiltinESMExports();
await import('./gold-preentry-invalidation-start.js');
