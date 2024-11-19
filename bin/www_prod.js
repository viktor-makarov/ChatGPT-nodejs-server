require('dotenv').config(); //Загружаем переменные из .env и добавляем к переменным окружения. .env должен быть в коревом каталоге приложения.
const yaml = require('js-yaml');
const path = require('path');
const fs = require('fs');

//load config to global var
const yamlFileContent = fs.readFileSync(path.join(__dirname,'..',"config","main_config.yml"), 'utf8');
global.appsettings = yaml.load(yamlFileContent);

//Подключаем и настраивам телеграм-бот

async function startServer(){
const mongoClient = require("../components/mongoClient")
global.mongoConnection = await mongoClient.connectToMongo()

const TelegramBot = require('node-telegram-bot-api');
const telegramRouter = require("../routerTelegram")
const options = {
    webHook: {
        port: process.env.WEBHOOK_PORT
    }
};

global.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, options);

global.bot.setWebHook(`${process.env.URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`,{ip_address:process.env.IP_ADDRESS})

telegramRouter.setBotParameters(global.bot) //задаем параметры бота
telegramRouter.UpdateGlobalVariables() //обновляем глобальные переменные
telegramRouter.GetModelsFromAPI() //получаем список моделей
telegramRouter.router(global.bot) //включаем роутер
}

startServer()

 




