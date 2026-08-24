import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function patchedReadFileSync(path, ...args) {
  const data = originalReadFileSync(path, ...args);
  const p = String(path);
  if (!p.endsWith('/server.js') && !p.endsWith('\\server.js')) return data;

  const isBuffer = Buffer.isBuffer(data);
  let source = isBuffer ? data.toString('utf8') : String(data);

  const oldGoldClock = "const normalizedAt=updatedAt.toISOString(),sampleTime=updatedAt.getTime(),last=goldSamples.at(-1);";
  const newGoldClock = "const normalizedAt=updatedAt.toISOString(),sampleTime=now,last=goldSamples.at(-1);";

  if (!source.includes(oldGoldClock)) {
    throw new Error('Gold sampling patch target was not found in server.js');
  }

  source = source.replace(oldGoldClock, newGoldClock);
  source = source.replace("symbol:'OANDA:XAUUSD',interval:'15'", "symbol:'OANDA:XAUUSD',interval:'5'");

  return isBuffer ? Buffer.from(source, 'utf8') : source;
};

syncBuiltinESMExports();
await import('./gold-btc-ict-start.js');
