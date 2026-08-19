import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./server.js',import.meta.url);
const runtimePath=new URL('./.runtime-server.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

const snapshotFallback="async function fetchSnapshot(symbol){return process.env.MASSIVE_API_KEY?fetchMassiveSnapshot(symbol):demoSnapshot(symbol)}";
const snapshotLive="async function fetchSnapshot(symbol){if(!process.env.MASSIVE_API_KEY){const e=new Error('Market data unavailable');e.statusCode=503;throw e}return fetchMassiveSnapshot(symbol)}";
if(!source.includes(snapshotFallback))throw new Error('Snapshot fallback anchor missing');
source=source.replace(snapshotFallback,snapshotLive);

const scanFallback="  const value=process.env.MASSIVE_API_KEY?await fetchMassiveScan():demoScan();";
const scanLive="  if(!process.env.MASSIVE_API_KEY){const e=new Error('Market data unavailable');e.statusCode=503;throw e}\n  const value=await fetchMassiveScan();";
if(!source.includes(scanFallback))throw new Error('Scan fallback anchor missing');
source=source.replace(scanFallback,scanLive);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
