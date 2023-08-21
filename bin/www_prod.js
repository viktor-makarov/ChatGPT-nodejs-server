require('dotenv').config(); //Загружаем переменные из .env и добавляем к переменным окружения. .env должен быть в коревом каталоге приложения.
const yaml = require('js-yaml');
const path = require('path');
const fs = require('fs');

//load config to global var
const yamlFileContent = fs.readFileSync(path.join(__dirname,'..',"config","main_config.yml"), 'utf8');
global.appsettings = yaml.load(yamlFileContent);

global.allSettingsDict = {}; //В этой переменной будут храниться текущие настройки пользователей.
global.registeredArray = []; //В этой переменной будут храниться все зарегистрированные пользователи.
global.readArray = []; //В этой переменной будут храниться все пользователи, ознакомившиеся с инструкцией.
global.adminArray = []; //В этой переменной будут храниться все пользователи, у которых есть права администратора.
//Подключаем и настраивам телеграм-бот
const TelegramBot = require('node-telegram-bot-api');
const telegramRouter = require("../routerTelegram")

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, {polling: true});


telegramRouter.setBotParameters(bot) //задаем параметры бота
telegramRouter.UpdateGlobalVariables(bot) //обновляем глобальные переменные
telegramRouter.GetModelsFromAPI() //получаем список моделей
telegramRouter.router(bot) //включаем роутер
 




