import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function replaceIfPresent(source,from,to){
  return source.includes(from)?source.replace(from,to):source;
}

function applyWideOptionsPatch(source){
  // Restore a broad options universe while keeping speculative movers isolated.
  source=replaceIfPresent(source,
    "const STOCK_WATCHLIST = ['SPY','IWM'];",
    "const STOCK_WATCHLIST = ['SPY','QQQ','IWM','NVDA','AAPL','MSFT','AMZN','META','GOOGL','TSLA','AMD','AVGO','PLTR','SOFI','MARA','RIVN'];"
  );
  source=replaceIfPresent(source,
    "const WATCHLIST = [...STOCK_WATCHLIST];",
    "const WATCHLIST = [...STOCK_WATCHLIST];"
  );
  source=replaceIfPresent(source,
    "const INDEX_ETFS = new Set(['SPY','IWM']);",
    "const INDEX_ETFS = new Set(['SPY','QQQ','IWM']);"
  );
  source=replaceIfPresent(source,
    "const SPECULATIVE_LIMIT = 6;",
    "const SPECULATIVE_LIMIT = 20;"
  );
  source=replaceIfPresent(source,
    "const SPECULATIVE_VERIFY_LIMIT = 12;",
    "const SPECULATIVE_VERIFY_LIMIT = 40;"
  );

  source=replaceIfPresent(source,
    '<p>XAUUSD FOCUS • SPY + IWM OPTIONS RADAR</p>',
    '<p>XAUUSD FOCUS • OPTIONS STOCKS • SPECULATIVE RADAR</p>'
  );
  source=replaceIfPresent(source,
    '<section class="toolbar"><span class="stockLabel">SPY + IWM فقط</span>',
    '<section class="toolbar"><span class="stockLabel">أسهم العقود الأساسية + اختيارات الرادار</span>'
  );
  source=replaceIfPresent(source,
    '<p id="instrumentPolicy" class="instrumentPolicy">الموقع مخصص لعقود SPY و IWM. مدة العقد ليست شرطًا؛ تتم المفاضلة حسب جودة الفرصة والسيولة وDelta وSpread وRR.</p>',
    '<p id="instrumentPolicy" class="instrumentPolicy">جدول العقود الأساسية مستقل عن جدول الأسهم المضاربية. مدة العقد ليست شرطًا؛ تتم المفاضلة حسب جودة الفرصة والسيولة وDelta وSpread وRR.</p>'
  );
  source=replaceIfPresent(source,
    '<h2>الإشارات الأساسية + SPX المستقل</h2>',
    '<h2>أسهم العقود الأساسية — قائمة موسعة</h2>'
  );
  source=replaceIfPresent(source,
    '<h2>رادار أسهم العقود المضاربية — تلقائي</h2>',
    '<h2>الأسهم المضاربية التي عليها عقود — جدول مستقل</h2>'
  );
  source=replaceIfPresent(source,
    'الاختيار آلي من أقوى الأسهم صعودًا وهبوطًا، بشرط الحركة والسيولة والتحقق من وجود عقود نشطة. البيانات حسب تأخير باقة Massive وليست توصية شراء.',
    'يعرض حتى 20 سهمًا مضاربيًا متحركًا بعد التحقق من وجود عقود Options نشطة. هذا الجدول مستقل عن الأسهم الأساسية.'
  );

  // Let lower-priced speculative names through, then verify that options exist.
  source=replaceIfPresent(source,
    'if(price==null||price<3||price>500||volume==null||volume<1_000_000||dollarVolume<20_000_000||changePct==null||Math.abs(changePct)<2)return null;',
    'if(price==null||price<1||price>500||volume==null||volume<500_000||dollarVolume<5_000_000||changePct==null||Math.abs(changePct)<1.5)return null;'
  );
  source=replaceIfPresent(source,
    'filters:{minPrice:3,maxPrice:500,minVolume:1_000_000,minDollarVolume:20_000_000,minAbsoluteChangePct:2}',
    'filters:{minPrice:1,maxPrice:500,minVolume:500_000,minDollarVolume:5_000_000,minAbsoluteChangePct:1.5}'
  );

  // Focus patch restricted contract selection to SPY/IWM; reopen it for the expanded list.
  source=replaceIfPresent(source,
    "if(!['SPY','IWM'].includes(symbol)||!chain?.length||!['CALL','PUT'].includes(direction))return null;",
    "if(!chain?.length||!['CALL','PUT'].includes(direction))return null;"
  );

  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string')data=applyWideOptionsPatch(data);
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./focus-start.js');
