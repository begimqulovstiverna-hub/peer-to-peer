import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';

const token=process.env.BOT_TOKEN;
const webAppUrl=process.env.WEB_APP_URL;
if(!token || !webAppUrl) {
  console.error('BOT_TOKEN va WEB_APP_URL .env faylida bo‘lishi kerak');
  process.exit(1);
}
const bot=new TelegramBot(token,{polling:true});
bot.setMyCommands([
  {command:'start',description:'English Peers Mini Appni ochish'},
  {command:'app',description:'Mini Appni ochish'}
]);
bot.setChatMenuButton({menu_button:{type:'web_app',text:'English Peers',web_app:{url:webAppUrl}}});
const openApp=async(msg)=>{
  await bot.sendMessage(msg.chat.id,'English Peers platformasini ochish uchun quyidagi tugmani bosing:',{
    reply_markup:{inline_keyboard:[[{text:'English Peersni ochish',web_app:{url:webAppUrl}}]]}
  });
};
bot.onText(/^\/start(?:@\w+)?$/,openApp);
bot.onText(/^\/app(?:@\w+)?$/,openApp);
console.log('English Peers Telegram bot is running.');
