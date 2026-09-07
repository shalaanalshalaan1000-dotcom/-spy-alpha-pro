import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function decodeXml(s=''){
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

function patchRuntime(source){
  const backend=`
const goldNewsCache={expiresAt:0,value:null};
function goldNewsDecode(s=''){return String(s).replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function goldNewsTag(title){const t=String(title||'').toLowerCase();if(/central bank|reserve|reserves|gold purchase|gold buying|gold sale|gold holdings|pboc|people's bank|world gold council/.test(t))return{category:'احتياطيات / بنوك مركزية',impact:3};if(/federal reserve|fed |fomc|rate hike|rate cut|interest rate|treasury yield|bond yield/.test(t))return{category:'فيدرالي / فائدة / عوائد',impact:3};if(/dollar|dxy|usd/.test(t))return{category:'الدولار',impact:2};if(/etf|inflow|outflow|fund flow|futures positioning|open interest/.test(t))return{category:'تدفقات الذهب',impact:2};return{category:'ذهب / ماكرو',impact:1}}
function goldNewsBias(title){const t=String(title||'').toLowerCase();if(/rate hike|higher yields|yields rise|dollar rises|dollar gains|outflow|selling|sales|strong jobs|hot inflation/.test(t))return'ضغط هابط';if(/rate cut|lower yields|yields fall|dollar falls|dollar weakens|inflow|buying|purchase|purchases|safe haven|risk-off/.test(t))return'دعم صاعد';return'محايد / يحتاج قراءة'}
function parseGoldNewsRss(xml){const items=[];for(const m of String(xml).matchAll(/<item>([\\s\\S]*?)<\\/item>/g)){const b=m[1],pick=(tag)=>goldNewsDecode((b.match(new RegExp('<'+tag+'>([\\s\\S]*?)<\\/'+tag+'>'))||[])[1]||'').trim(),title=pick('title'),link=pick('link'),pubDate=pick('pubDate'),sourceName=pick('source');if(!title||!pubDate)continue;const meta=goldNewsTag(title);items.push({title,link,pubDate,newstime:new Date(pubDate).toISOString(),source:sourceName||'Google News',category:meta.category,impact:meta.impact,bias:goldNewsBias(title)})}return items}
async function fetchGoldNews(){const now=Date.now();if(goldNewsCache.value&&now<goldNewsCache.expiresAt)return goldNewsCache.value;const queries=['gold central bank reserves purchases','gold Federal Reserve interest rates Treasury yields dollar','gold ETF inflows outflows World Gold Council'].map(q=>'https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=en-US&gl=US&ceid=US:en');const settled=await Promise.allSettled(queries.map(async u=>{const r=await fetch(u,{headers:{'user-agent':'Gold-Alpha-Pro/1.0'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('news '+r.status);return parseGoldNewsRss(await r.text())}));let all=settled.flatMap(x=>x.status==='fulfilled'?x.value:[]);const seen=new Set();all=all.filter(x=>{const k=x.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(seen.has(k))return false;seen.add(k);return true}).filter(x=>now-new Date(x.pubDate).getTime()<36*60*60_000).sort((a,b)=>b.impact-a.impact||new Date(b.pubDate)-new Date(a.pubDate)).slice(0,14);const value={updatedAt:new Date(now).toISOString(),items:all};goldNewsCache.value=value;goldNewsCache.expiresAt=now+5*60_000;return value}
`;
  const serverAnchor='const server=http.createServer(async(req,res)=>{';
  if(source.includes(serverAnchor)){
    source=source.replace(serverAnchor,backend+serverAnchor+"const __gnu=new URL(req.url||'/', 'http://localhost');if(req.method==='GET'&&__gnu.pathname==='/api/gold-news'){try{const d=await fetchGoldNews();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end(JSON.stringify(d))}catch(e){res.writeHead(503,{'content-type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Gold news unavailable'}))}};");
  }

  const css=`
.goldNewsPanel{margin:14px 0;border:1px solid #4b4125;border-radius:18px;background:linear-gradient(145deg,#17160f,#0b111b);padding:16px}.goldNewsHead{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px}.goldNewsHead h2{margin:0;font-size:18px;color:#f0c86d}.goldNewsHead small{color:#9e957b}.goldNewsList{display:grid;gap:9px}.goldNewsItem{display:grid;grid-template-columns:90px 1fr auto;gap:10px;align-items:start;padding:11px;border:1px solid #3d3828;border-radius:12px;background:#0d1420}.goldNewsTime{font-size:11px;color:#9ea7b5;direction:ltr}.goldNewsTitle{font-size:13px;font-weight:800;line-height:1.55}.goldNewsMeta{margin-top:4px;font-size:11px;color:#a79d82}.goldNewsImpact{font-size:11px;border:1px solid #65562c;border-radius:999px;padding:5px 8px;white-space:nowrap}.goldNewsImpact.i3{color:#ffcf66;border-color:#8a6727}.goldNewsImpact.i2{color:#a8d8ff;border-color:#355a72}.goldNewsBiasUp{color:#58dda5}.goldNewsBiasDown{color:#ff7e92}.goldNewsEmpty{padding:14px;color:#9e957b;text-align:center}@media(max-width:760px){.goldNewsItem{grid-template-columns:72px 1fr}.goldNewsImpact{grid-column:2;justify-self:start}.goldNewsHead{align-items:flex-start;flex-direction:column}}
`;
  source=source.replace('</style></head>',css+'</style></head>');

  const panel=`<article class="goldNewsPanel"><div class="goldNewsHead"><div><h2>التسلسل الإخباري المؤثر على الذهب</h2><small>بنوك مركزية • احتياطيات • فائدة وعوائد • دولار • تدفقات الذهب</small></div><small id="goldNewsUpdated">جارٍ التحديث…</small></div><div id="goldNewsList" class="goldNewsList"><div class="goldNewsEmpty">تحميل أهم الأخبار فقط…</div></div></article>`;
  source=source.replace('</main><script>',panel+'</main><script>');

  const client=`
let goldNewsLoading=false;
function goldNewsEsc(s){return String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function loadGoldNews(){if(goldNewsLoading)return;goldNewsLoading=true;try{const r=await fetch('/api/gold-news',{cache:'no-store'}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'news unavailable');const host=document.querySelector('#goldNewsList');if(!host)return;const items=Array.isArray(d.items)?d.items:[];host.innerHTML=items.length?items.map(x=>{const dt=new Date(x.pubDate),tm=dt.toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}),biasClass=x.bias==='دعم صاعد'?'goldNewsBiasUp':x.bias==='ضغط هابط'?'goldNewsBiasDown':'';return '<div class="goldNewsItem"><div class="goldNewsTime">'+goldNewsEsc(tm)+'</div><div><div class="goldNewsTitle">'+goldNewsEsc(x.title)+'</div><div class="goldNewsMeta">'+goldNewsEsc(x.category)+' • <span class="'+biasClass+'">'+goldNewsEsc(x.bias)+'</span> • '+goldNewsEsc(x.source)+'</div></div><div class="goldNewsImpact i'+Number(x.impact||1)+'">'+(Number(x.impact)>=3?'تأثير قوي':Number(x.impact)===2?'مهم':'متابعة')+'</div></div>'}).join(''):'<div class="goldNewsEmpty">لا توجد أخبار جوهرية حديثة ضمن الفلاتر الحالية.</div>';const u=document.querySelector('#goldNewsUpdated');if(u)u.textContent='آخر فحص '+new Date(d.updatedAt).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'})}catch(e){const host=document.querySelector('#goldNewsList');if(host)host.innerHTML='<div class="goldNewsEmpty">تعذر تحديث الأخبار الآن — سيعاد المحاولة تلقائيًا.</div>'}finally{goldNewsLoading=false}}
`;
  const startup='(async()=>{';
  if(source.includes(startup))source=source.replace(startup,client+'\n'+startup);
  source=source.replace('await loadGold();\n  setInterval(loadGold,30000);','await Promise.all([loadGold(),loadGoldNews()]);\n  setInterval(loadGold,30000);\n  setInterval(loadGoldNews,300000);');
  return source;
}

fs.writeFileSync=function(path,data,...args){const p=String(path);if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return originalWriteFileSync(path,data,...args);const isBuffer=Buffer.isBuffer(data),source=patchRuntime(isBuffer?data.toString('utf8'):String(data));return originalWriteFileSync(path,isBuffer?Buffer.from(source,'utf8'):source,...args)};
syncBuiltinESMExports();
await import('./gold-only-stable-start.js');
