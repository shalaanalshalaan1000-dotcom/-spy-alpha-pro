import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function patchedReadFileSync(path, ...args) {
  const data = originalReadFileSync(path, ...args);
  const p = String(path);
  if (!p.endsWith('/server.js') && !p.endsWith('\\server.js')) return data;

  const isBuffer = Buffer.isBuffer(data);
  let source = isBuffer ? data.toString('utf8') : String(data);

  // Keep substantially more gold history available to the existing ICT level UI.
  // These replacements are intentionally exact and non-invasive: if an anchor is
  // absent in server.js, that line is simply left unchanged.
  source = source.replaceAll('24*60*60_000', '72*60*60_000');
  source = source.replaceAll('slice(-3000)', 'slice(-9000)');
  source = source.replace('samples:goldServerState.samples.slice(-720)', 'samples:goldServerState.samples.slice(-6000)');

  return isBuffer ? Buffer.from(source, 'utf8') : source;
};

syncBuiltinESMExports();
await import('./gold-ict-levels-start.js');
