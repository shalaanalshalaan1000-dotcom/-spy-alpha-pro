import test from 'node:test';
import assert from 'node:assert/strict';
import { clockParts } from '../runtime-memory-policy.js';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

test('cached clocks preserve timezone and DST output', () => {
  for (const timeZone of ['Asia/Riyadh','Asia/Tokyo','Europe/London','America/New_York']) {
    const expected=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false});
    for(const date of ['2026-03-08T07:00:00Z','2026-10-03T18:00:00Z','2026-11-01T06:00:00Z']) {
      assert.deepEqual(clockParts(Date.parse(date),timeZone),expected.formatToParts(new Date(date)));
    }
  }
});

test('production engine generator applies cached clock and emits valid module without starting services', () => {
  const url=new URL('../gold-site-signal-engine-v9.js',import.meta.url);
  let generated='';
  const generator=fs.readFileSync(url,'utf8')
    .replace("import fs from 'node:fs';",'')
    .replaceAll('import.meta.url',JSON.stringify(url.href))
    .replace(/await import\(`\$\{runtimeUrl.href\}\?v=\$\{Date.now\(\)\}`\);/,'');
  vm.runInNewContext(generator,{URL,fs:{readFileSync:fs.readFileSync,writeFileSync:(_url,value)=>{generated=value;}}});
  assert.match(generated,/const parts=clockParts\(ms,timeZone\)/);
  const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:generated,encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
});
