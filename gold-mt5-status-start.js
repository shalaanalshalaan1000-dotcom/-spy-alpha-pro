import {readFileSync,writeFileSync} from 'node:fs';

let ui=readFileSync(new URL('./gold-app.js',import.meta.url),'utf8');
ui=ui.replace('<div class="card"><span>MT5</span><strong id="mt5">غير متصل</strong></div>','<div class="card"><span>الرصد الآلي / MT5</span><strong id="mt5">بانتظار الاتصال</strong></div>');
ui=ui.replace("const act=s.candidateAction||'WAIT'; $('#action').textContent=act;","const act=s.action||'WAIT', candidate=s.candidateAction||'WAIT'; $('#action').textContent=act;");
ui=ui.replace("const connected=!!st.mt5?.connected; $('#mt5').textContent=connected?(st.mt5.tradingEnabled?'متصل • التداول مفعل':'متصل • مراقبة'):'غير متصل';","const connected=!!st.mt5?.connected; $('#mt5').textContent=connected?'شغال • V9 Continuous':'غير متصل';");
ui=ui.replace("$('#autoNote').textContent=(s.status||'WAIT')+' • '+(s.strategy||'READING')+' • '+(s.reason||'');","$('#autoNote').textContent=(connected?'الرصد الآلي شغال • V9 Continuous • ':'الرصد الآلي غير متصل • ')+(act==='WAIT'&&['BUY','SELL'].includes(candidate)?('مرشح '+candidate+' لكن غير صالح للتنفيذ الآن • '):'')+(s.status||'WAIT')+' • '+(s.strategy||'READING')+' • '+(s.reason||'');");
writeFileSync(new URL('./gold-app-status-ui.js',import.meta.url),ui,'utf8');

let runtime=readFileSync(new URL('./gold-mt5-runtime.js',import.meta.url),'utf8');
runtime=runtime.replace("const child=spawn(process.execPath,['gold-app.js']","const child=spawn(process.execPath,['gold-app-status-ui.js']");
runtime=runtime.replace("if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal')return send(res,200,await signal(url.searchParams.get('observe')!=='1'));","if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){const execute=url.searchParams.get('observe')!=='1';if(execute){state.mt5.lastSeen=Date.now();state.mt5.tradingEnabled=true;state.mt5.symbol='XAUUSD';state.mt5.version='V9 CONTINUOUS';state.mt5.connectionSource='signal-poll';}return send(res,200,await signal(execute));}");
writeFileSync(new URL('./gold-mt5-runtime-status.js',import.meta.url),runtime,'utf8');
await import('./gold-mt5-runtime-status.js');
