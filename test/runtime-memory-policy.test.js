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

// Execute the exact module-level formatter declaration; no workers or HTTP servers start.
test('hot path formatters preserve original locale, timezone, midnight and DST output',()=>{
 const modules=[['gold-agent-orchestrator.js','RIYADH_WEEKDAY_FORMATTER'],['gold-ict-swing-model.js','NY_CONTEXT_FORMATTER'],['gold-luxalgo-native.js','NY_SESSION_FORMATTER'],['server.js','EASTERN_CLOCK_FORMATTER']];
 for(const [file,name] of modules){
  const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const declaration=source.split('\n').find(line=>line.startsWith('const '+name+'='));
  assert.ok(declaration);
  const expression=declaration.slice(declaration.indexOf('=')+1,-1);
  const cached=vm.runInNewContext(expression,{Intl});
  for(const stamp of ['2026-03-08T06:59:00Z','2026-03-08T07:01:00Z','2026-11-01T05:59:00Z','2026-11-01T06:01:00Z','2026-10-04T04:00:00Z']){
   const fresh=vm.runInNewContext(expression,{Intl});
   assert.deepEqual(cached.formatToParts(new Date(stamp)),fresh.formatToParts(new Date(stamp)),file);
  }
  assert.equal(source.split(expression).length-1,1,file+' creates exactly one formatter');
 }
});
