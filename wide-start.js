import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function replaceIfPresent(source,from,to){
  return source.includes(from)?source.replace(from,to):source;
}

function applyWideOptionsPatch(source){
  // Keep two separate universes:
  // 1) liquid swing names suitable for roughly 1–2 week ideas,
  // 2) speculative movers discovered automatically in their own table.
  source=replaceIfPresent(source,
    "const STOCK_WATCHLIST = ['SPY','IWM'];",
    "const STOCK_WATCHLIST = ['SPY','QQQ','IWM','NVDA','AAPL','MSFT','AMZN','META','GOOGL','TSLA','AMD','AVGO','PLTR'];"
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
    '<p>XAUUSD FOCUS • 1–2 WEEK SWING • SPECULATIVE RADAR</p>'
  );
  source=replaceIfPresent(source,
    '<section class="toolbar"><span class="stockLabel">SPY + IWM فقط</span>',
    '<section class="toolbar"><span class="stockLabel">Swing أسبوع–أسبوعين + المضاربات منفصلة</span>'
  );
  source=replaceIfPresent(source,
    '<p id="instrumentPolicy" class="instrumentPolicy">الموقع مخصص لعقود SPY و IWM. مدة العقد ليست شرطًا؛ تتم المفاضلة حسب جودة الفرصة والسيولة وDelta وSpread وRR.</p>',
    '<p id="instrumentPolicy" class="instrumentPolicy">القائمة الأساسية مخصصة لفرص Swing لمدة تقريبية من أسبوع إلى أسبوعين على الأسهم والسيولة الأقوى. الأسهم المضاربية لا تدخل هذا الجدول ولها رادار مستقل أسفل الصفحة.</p>'
  );
  source=replaceIfPresent(source,
    '<h2>الإشارات الأساسية + SPX المستقل</h2>',
    '<h2>فرص Swing — أسبوع إلى أسبوعين</h2>'
  );
  source=replaceIfPresent(source,
    '<h2>رادار أسهم العقود المضاربية — تلقائي</h2>',
    '<h2>المضاربات السريعة — أسهم عليها عقود</h2>'
  );
  source=replaceIfPresent(source,
    'الاختيار آلي من أقوى الأسهم صعودًا وهبوطًا، بشرط الحركة والسيولة والتحقق من وجود عقود نشطة. البيانات حسب تأخير باقة Massive وليست توصية شراء.',
    'يعرض حتى 20 سهمًا مضاربيًا متحركًا بعد التحقق من وجود عقود Options نشطة. هذا القسم منفصل تمامًا عن جدول Swing الأسبوع–أسبوعين.'
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

  // Focus patch restricted contract selection to SPY/IWM; reopen it for both universes.
  source=replaceIfPresent(source,
    "if(!['SPY','IWM'].includes(symbol)||!chain?.length||!['CALL','PUT'].includes(direction))return null;",
    "if(!chain?.length||!['CALL','PUT'].includes(direction))return null;"
  );

  // Clarify the non-SPX policy text after symbol selection.
  source=replaceIfPresent(source,
    "if(symbol!=='SPX'){node.className='instrumentPolicy';node.textContent='مسار ارتداد Swing: أولوية لمناطق الانعكاس والدعم/المقاومة، وعقود 14–30 DTE بسعر قريب من $1 مع سيولة مقبولة. SPX وحده يبقى 0DTE مستقل.';return}",
    "if(symbol!=='SPX'){node.className='instrumentPolicy';node.textContent=(speculativeSymbols.has(symbol)?'مضاربة سريعة: سهم متحرك تم التحقق من وجود عقود عليه.':'Swing أسبوع–أسبوعين: سهم من القائمة الأساسية السائلة، مع أولوية لمناطق الارتداد والدعم/المقاومة.');return}"
  );

  return source;
}

fs.writeFileSync=function(path,data,...args){
  if(String(path).includes('.runtime-server.mjs')&&typeof data==='string')data=applyWideOptionsPatch(data);
  return originalWriteFileSync(path,data,...args);
};

syncBuiltinESMExports();
await import('./focus-start.js');
