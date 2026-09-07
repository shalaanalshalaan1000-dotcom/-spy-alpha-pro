import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync = fs.writeFileSync.bind(fs);

function patchPreEntryInvalidation(source) {
  // A scenario is invalid the instant price reaches its invalidation/stop level,
  // even if the entry range was never touched. This prevents stale BUY/SELL
  // instructions from surviving next to the stop level.
  source = source.replaceAll(
    'stopHit=entryTouched&&Number.isFinite(stop)&&',
    'stopHit=Number.isFinite(stop)&&'
  );

  // Distinguish an actual stop-loss after entry from a scenario that became
  // invalid before entry. Both cases clear the lock so a fresh model can form.
  source = source.replaceAll(
    "saveGoldHistorySnapshot(lock,'SL')",
    "saveGoldHistorySnapshot(lock,entryTouched?'SL':'CANCELLED')"
  );
  source = source.replaceAll(
    "reason:'STOP_HIT'",
    "reason:entryTouched?'STOP_HIT':'PREENTRY_INVALIDATED'"
  );
  source = source.replaceAll(
    "status.textContent='وقف الخسارة تحقق'",
    "status.textContent=entryTouched?'وقف الخسارة تحقق':'السيناريو ملغى'"
  );
  source = source.replaceAll(
    "note.textContent='انتهى السيناريو — STOP LOSS HIT. لن تبقى هذه الصفقة فعالة.'",
    "note.textContent=entryTouched?'انتهى السيناريو — STOP LOSS HIT. لن تبقى هذه الصفقة فعالة.':'الصفقة لم تُفعّل — وصل السعر إلى حد الإلغاء قبل الدخول. انتظر سيناريو جديد.'"
  );

  return source;
}

fs.writeFileSync = function(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return previousWriteFileSync(path, data, ...args);
  }
  const isBuffer = Buffer.isBuffer(data);
  const patched = patchPreEntryInvalidation(isBuffer ? data.toString('utf8') : String(data));
  return previousWriteFileSync(path, isBuffer ? Buffer.from(patched, 'utf8') : patched, ...args);
};

syncBuiltinESMExports();
await import('./gold-final-layout-start.js');
