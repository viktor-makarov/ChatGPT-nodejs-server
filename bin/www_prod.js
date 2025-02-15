require('dotenv').config(); //Загружаем переменные из .env и добавляем к переменным окружения. .env должен быть в коревом каталоге приложения.
const yaml = require('js-yaml');
const path = require('path');
const fs = require('fs');
const aws = require('../components/aws_func.js');

//load config to global var
const yamlFileContent = fs.readFileSync(path.join(__dirname,'..',"config","main_config.yml"), 'utf8');
global.appsettings = yaml.load(yamlFileContent);

//Подключаем и настраивам телеграм-бот

async function startServer(){
const mongoClient = require("../components/mongoClient")
global.mongoConnection = await mongoClient.connectToMongo()

const TelegramBot = require('node-telegram-bot-api');
const telegramRouter = require("../routerTelegram")


let options = {
    polling:true
};

if(process.env.WEBHOOK_ENABLED){
    options["webHook"] = {
        port: process.env.WEBHOOK_PORT
    }
    options["polling"] = false
}

global.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, options);

if(process.env.WEBHOOK_ENABLED){
global.bot.setWebHook(`${process.env.URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`)
}


console.log("TelegramBot options",options)


telegramRouter.setBotParameters(global.bot) //задаем параметры бота
telegramRouter.UpdateGlobalVariables() //обновляем глобальные переменные
telegramRouter.GetModelsFromAPI() //получаем список моделей
telegramRouter.router(global.bot) //включаем роутер
}

startServer()

 




