import './server.js';

const token=process.env.TELEGRAM_BOT_TOKEN;
const chatId=process.env.TELEGRAM_CHAT_ID;
const now=Date.now();
const testWindowStart=Date.parse('2026-08-19T00:40:00Z');
const testWindowEnd=Date.parse('2026-08-19T01:30:00Z');

if(token&&chatId&&now>=testWindowStart&&now<=testWindowEnd){
  setTimeout(async()=>{
    try{
      const response=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          chat_id:chatId,
          text:'✅ Alpha Pro V4 مرتبط الآن مع Telegram\nسيتم إرسال الإشارات المؤهلة تلقائيًا أثناء السوق.',
          disable_web_page_preview:true
        }),
        signal:AbortSignal.timeout(15000)
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(String(data.description||response.status));
      console.log('Telegram connection test sent successfully');
    }catch(error){
      console.error('Telegram connection test failed:',error.message||error);
    }
  },3500);
}
