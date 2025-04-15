require('dotenv').config(); //Загружаем переменные из .env и добавляем к переменным окружения. .env должен быть в коревом каталоге приложения.
const yaml = require('js-yaml');
const path = require('path');
const fs = require('fs');

//load config to global var
const yamlFileContent = fs.readFileSync(path.join(__dirname,'..',"config","main_config.yml"), 'utf8');
global.appsettings = yaml.load(yamlFileContent);

//Подключаем и настраивам телеграм-бот

async function startServer(){
console.time('Server startup');
console.log(new Date(),"Telegram bot is launching...")
const mongoClient = require("../components/mongoClient")
global.mongoConnection = await mongoClient.connectToMongo()

const TelegramBot = require('node-telegram-bot-api');
const telegramRouter = require("../routerTelegram")

let options = {
    polling:true
};

if(process.env.WEBHOOK_ENABLED==="true"){
    options["webHook"] = {
        port: process.env.WEBHOOK_PORT
    }
    options["polling"] = false
}

global.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, options);

if(process.env.WEBHOOK_ENABLED==="true"){
const webHookUrl = `${process.env.URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`

global.bot.setWebHook(webHookUrl)
.then((result) => {
    console.log("setWebHook result:",result)

    global.bot.getWebHookInfo()
    .then((info) => console.log("getWebHookInfo:",info))
    .catch((err)=>console.log("getWebHook Error:",err))
    
    const hasOpenWebHook = global.bot.hasOpenWebHook()
    console.log("hasOpenWebHook",hasOpenWebHook)
    })

    global.bot.getMe()
    .then((result) => console.log("getMe result:",result))
    .catch((err)=>console.log("getMe Error:",err))

.catch((err) => console.log("setWebHook err:",err))
}

//telegramRouter.MdjAccountInfo()
await telegramRouter.setBotParameters(global.bot) //задаем параметры бота
await telegramRouter.UpdateGlobalVariables() //обновляем глобальные переменные
await telegramRouter.GetModelsFromAPI() //получаем список моделей
telegramRouter.router(global.bot) //включаем роутер
console.timeEnd('Server startup');
}

startServer()

 




