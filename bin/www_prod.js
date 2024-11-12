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
global.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

telegramRouter.setBotParameters(global.bot) //задаем параметры бота
telegramRouter.UpdateGlobalVariables() //обновляем глобальные переменные
telegramRouter.GetModelsFromAPI() //получаем список моделей
telegramRouter.router(global.bot) //включаем роутер
}

startServer()

 




