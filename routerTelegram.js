const telegramCmdHandler = require("./components/telegramCmdHandler.js");
const telegramFunctionHandler = require("./components/telegramFunctionHandler.js");
const openAIApiHandler = require("./components/openAI_API_Handler.js");
const modelSettings = require("./config/telegramModelsSettings");
const telegramErrorHandler = require("./components/telegramErrorHandler.js");
const mongo = require("./components/mongo");
const msqTemplates = require("./config/telegramMsgTemplates.js");
const otherFunctions = require("./components/other_func");

async function UpdateGlobalVariables(botInstance) {
  try {
    const updateResult =
      await mongo.UpdateProfilesRegistrationCodeUpToDatePromise(
        process.env.REGISTRATION_KEY
      );
    console.log(new Date(), "register code stats", updateResult);

    await mongo.setDefaultVauesForNonExiting(); //Должно быть перед get_all_registeredPromise

    global.registeredArray = await mongo.get_all_registeredPromise();
    console.log(new Date(), "registeredArray", global.registeredArray);

    global.readArray = await mongo.get_all_readPromise(); //И проверяем всех ознакомившихся
    console.log(new Date(), "readArray", global.readArray);

    global.allSettingsDict = await mongo.get_all_settingsPromise();
    console.log(new Date(), "allSettingsDict", global.allSettingsDict);

    global.adminArray = await mongo.get_all_adminPromise(); //Если секция permissions успешно добавилась, то обновляем adminArray.
    console.log(new Date(), "adminArray", global.adminArray);
  } catch (err) {
    err.consolelog = true;
    err.place_in_code = err.place_in_code || arguments.callee.name;
    console.log("UpdateGlobalVariables", err);
    // telegramErrorHandler.main(null,null,err,err.place_in_code,null)
  }
}
async function GetModelsFromAPI() {
  try {
    const models_array = await openAIApiHandler.getModels(); //обновляем список моделей в базе
    const write_result = await mongo.update_models_listPromise(
      models_array.data.data
    );
    console.log(new Date(), "Models updated", write_result);
  } catch (err) {
    err.consolelog = true;
    console.log("GetModelsFromAPI", err);
    // telegramErrorHandler.main(null,null,err,arguments.callee.name,err.user_message)
  }
}
async function setBotParameters(botInstance) {
  try {
    await botInstance.setMyCommands(appsettings.telegram_options.commands);
  } catch (err) {
    err.consolelog = true;
    console.log("setBotParameters", err);
    //telegramErrorHandler.main(null,null,err,arguments.callee.name,null)
  }
}
function router(botInstance) {
  var useDebounceMs = false;
  var jointMsg = "";

  botInstance.on("message", async (msg) => {
    //Слушаем сообщения пользователей

    try {
      if (process.env.PROD_RUN != "true") {
        console.log(
          "Пользователь: ",
          "chatId",
          msg.chat.id,
          "fromId",
          msg.from.id,
          "msg.id",
          msg.message_id,
          "timestemp",
          new Date(),
          "msg.lenght",
          (msg.text || "").length,
          "msg"
          //,msg.text
        );
      }
  
      if (/^\/start/i.test(msg.text)) {
        //обрабатываем команду /start
        const response = await telegramCmdHandler.startHandler(
          botInstance,
          msg
        );
        await botInstance.sendMessage(
          msg.chat.id,
          response.text,
          response.buttons
        );
        return;
      }

      //Должно стоять после /register и перед всеми другими
      if (!registeredArray.includes(msg.from.id)) {
        await mongo.insert_reg_eventPromise(
          msg.from.id,
          msg.chat.id,
          msg.from.is_bot,
          msg.from.first_name,
          msg.from.last_name,
          msg.from.username,
          msg.from.language_code,
          "unauthorized request",
          "request"
        );
        //Провевяем, зарегистрирован ли пользователь уже
        await botInstance.sendMessage(msg.chat.id, msqTemplates.register);
        return;
      }

      if (!readArray.includes(msg.from.id)) {
        //Провевяем, видел ти пользователь информационное сообщение

        const response = telegramCmdHandler.infoHandler(botInstance, msg);
        await botInstance.sendMessage(msg.chat.id, response.text, {
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: "Понятно", callback_data: "info_accepted" }],
            ],
          }),
        });
        return;
      }

      if (/^\/admin/i.test(msg.text)) {
        const response = await telegramCmdHandler.adminHandler(
          botInstance,
          msg
        );
          console.log(response)
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/register/i.test(msg.text)) {
        const response = await telegramCmdHandler.registerHandler(
          botInstance,
          msg
        );
        botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/delete_not_uptodate_users/i.test(msg.text)) {
        //обрабатываем команду /sendtome
        const response = await telegramCmdHandler.unregisterAllNotUpToDate(
          botInstance,
          msg
        );
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/unregister/i.test(msg.text)) {
        const response = await telegramCmdHandler.unregisterHandler(
          botInstance,
          msg
        );
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/sendtome/i.test(msg.text)) {
        //обрабатываем команду /sendtome

        const response = telegramCmdHandler.sendtomeHandler(botInstance, msg);
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/sendtoall/i.test(msg.text)) {
        //обрабатываем команду /sendtome
        const response = await telegramCmdHandler.sendtoallHandler(
          botInstance,
          msg
        );
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/help/i.test(msg.text)) {
        //обрабатываем команду /help
        const response = await telegramCmdHandler.helpHandler(botInstance, msg);
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/faq/i.test(msg.text)) {
        //обрабатываем команду /faq
        const response = await telegramCmdHandler.faqHandler(botInstance, msg);
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/settings/i.test(msg.text)) {
        //обрабатываем команду /faq
        const response = await telegramCmdHandler.settingsOptionsHandler(
          botInstance,
          "settings",
          msg
        );
        
        
        await botInstance.sendMessage(
          msg.chat.id,
          response.text,
          response.buttons
        );
        return;
      }

      if (/^\/reports/i.test(msg.text)) {
        //обрабатываем команду /help
        const response = await telegramCmdHandler.reportsOptionsHandler(
          botInstance,
          "reports",
          msg
        );
        await botInstance.sendMessage(
          msg.chat.id,
          response.text,
          response.buttons
        );
        return;
      }

      if (/^\/info/i.test(msg.text)) {
        //обрабатываем команду /info

        const response = await telegramCmdHandler.infoHandler(botInstance, msg);
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (
        /^\/assistant/i.test(msg.text) ||
        /^\/texteditor/i.test(msg.text) ||
        /^\/codereviewer/i.test(msg.text) ||
        /^\/translator/i.test(msg.text) ||
        /^\/voicetotext/i.test(msg.text) ||
        /^\/texttospeech/i.test(msg.text) 
      ) {
        //обрабатываем команды смены режима

        const regime = msg.text.split(" ")[0].substring(1);
        const response = await telegramCmdHandler.changeRegimeHandlerPromise(
          msg,
          regime
        );
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (/^\/resetdialogue/i.test(msg.text)) {
        //обрабатываем команду /resetdialog

        const response = await telegramCmdHandler.resetdialogHandler(
          botInstance,
          msg
        );
        await botInstance.sendMessage(msg.chat.id, response.text);
        return;
      }

      if (!(msg.text || msg.audio || msg.voice || msg.video_note)) {
        //Обрабатываем сообщение без текста/аудио/видео
        const response = telegramCmdHandler.noMessageText();

        await botInstance.sendMessage(msg.chat.id, response);
        // botInstance.sendMessage("111", response)
        return;
      }

      //обрабатываем остальные сообщения, то есть сообщения с текстом.
      
      var innerMsg = new Object(); //создаем новый инстанс сообщения
      innerMsg = msg;

      if (msg.audio || msg.voice || msg.video_note) {
        //Если пришло голосовое или аудио сообщение - извлекаем текст и добавляем его к объекту с сообщением

        const progressMsg = await botInstance.sendMessage(
          innerMsg.chat.id,
          msqTemplates.audio_dowload_progess
        );
        const transcript = await openAIApiHandler.VoiceToText(
          botInstance,
          innerMsg
        );
        innerMsg.text = transcript;
        let transcriptArray = transcript.match(
          new RegExp(
            ".{1," +
              appsettings.telegram_options.big_outgoing_message_threshold +
              "}",
            "g"
          )
        ); //Делим длинное сообщение на несколько частей, чтобы уместилось в сообщение Телеграм

        count = 1;
        if (!transcriptArray) {
          transcriptArray = [""];
        }

        let index = 0;

        async function sendMessagePartsSequentially() {
          if (index < transcriptArray.length) {
            var ender = "...";
            if (index === transcriptArray.length - 1) {
              ender = "";
            }

            if (index === 0) {
              await botInstance.editMessageText(
                "> " + transcriptArray[index] + ender,
                {
                  chat_id: msg.chat.id,
                  message_id: progressMsg.message_id,
                }
              );
            } else {
              await botInstance.sendMessage(
                msg.chat.id,
                transcriptArray[index] + ender
              );
            }

            index++;
            setTimeout(
              sendMessagePartsSequentially,
              appsettings.telegram_options.debounceMs
            );
          }
        }

        await sendMessagePartsSequentially();

        if (
          global.allSettingsDict[msg.from.id].current_regime === "voicetotext" 
        ) {
          //Если включен режим voicetotеxt, то сообщение не пересылается в сервис
          return;
        }
      } else if (
        msg.text &&
        global.allSettingsDict[msg.from.id].current_regime === "voicetotext"
      ) {
        await botInstance.sendMessage(
          msg.chat.id,
          msqTemplates.error_voicetotext_doesnot_process_text
        );
        return;
      }

      if (
        innerMsg.text.length >
        appsettings.telegram_options.big_message_threshold
      ) {
        //Проверяем не приближается ли размер сообщения к ограничению в 4000 символов. Сообщения меньшего размера не нуждаются в задержке.
        useDebounceMs = true;
      }

      //Обрабатываем пересланные текстовые сообщения
      if (innerMsg.forward_from && innerMsg.text) {
        innerMsg.text =
          "\n" +
          (innerMsg.forward_from.first_name || "") +
          " " +
          (innerMsg.forward_from.username || "") +
          " : " +
          innerMsg.text; //ДОбавляем автора
        useDebounceMs = true;
      }

      jointMsg = jointMsg + innerMsg.text; //накапливаем сообщения
      innerMsg.text = jointMsg;


      const regime = global.allSettingsDict[innerMsg.from.id].current_regime
      const model = allSettingsDict[innerMsg.from.id][regime].model || modelSettings[regime].default_model
      const voice = allSettingsDict[innerMsg.from.id][regime].voice || modelSettings[regime].voice
      const temperature = allSettingsDict[innerMsg.from.id][regime].temperature || 1
      const functions = await telegramFunctionHandler.functionsList(innerMsg.from.id)
      
      if(regime === "texttospeech"){
        if(innerMsg.text.length>appsettings.telegram_options.big_message_threshold){
          const progressMsg = await botInstance.sendMessage(
            innerMsg.chat.id,
            msqTemplates.texttospeech_length_error.replace("[limit]",appsettings.telegram_options.big_message_threshold)
          );
        } else {

          const progressMsg = await botInstance.sendMessage(
            innerMsg.chat.id,
            msqTemplates.texttospeech_progress
          );      

          const transcript = await openAIApiHandler.TextToVoice(
            botInstance,
            innerMsg,
            regime,
            model,
            voice,
            process.env.OPENAI_API_KEY
          );
        
     //   console.log("progressMsg",progressMsg)
        await botInstance.deleteMessage(
          innerMsg.chat.id,
          progressMsg.message_id
        );
      }

        jointMsg = ""; //обнуляем накопленные сообщения
        return
      }

      if (regime != "assistant") {
        await mongo.deleteDialogByUserPromise(innerMsg.from.id, regime); //удаляем диалог, если это не ассистент, т.к. не требуется учитывать предыдущий диалог
      }

      if (modelSettings[regime].task) {
        //Добавялем задачу, если она есть
        await mongo.upsertSystemPromise(
          modelSettings[regime].task,
          innerMsg,
          regime
        );
        
        if(allSettingsDict[msg.from.id][regime].sysmsg){ 
          await botInstance.sendMessage(
            msg.chat.id,
            msqTemplates.system_msg_show.replace("[task]",modelSettings[regime].task)
          );
        }
      }

      await mongo.upsertPromptPromise(innerMsg, regime,functions); //записываем prompt в диалог

      if (useDebounceMs) {
        await deferredMsgHandler(
          botInstance,
          innerMsg.chat.id,
          innerMsg,
          process.env.OPENAI_API_KEY,
          model,
          temperature,
          functions,
          regime
        ); //запускаем отложенный обработчик
      } else {
        await MsgHandler(botInstance, innerMsg.chat.id, innerMsg, process.env.OPENAI_API_KEY,model,temperature,functions,regime); //запускаем обычный обработчик
      }
      jointMsg = ""; //обнуляем накопленные сообщения
      useDebounceMs = false; //обнуляем задержку
    } catch (err) {
      if (err.mongodblog === undefined) {
        err.mongodblog = true;
      }
      err.place_in_code = err.place_in_code || arguments.callee.name;
      telegramErrorHandler.main(
        botInstance,
        msg.chat.id,
        err,
        err.place_in_code,
        err.user_message
      );
    }
  });

  botInstance.on("callback_query", async (callback_msg) => {
    try {
      if (callback_msg.data === "info_accepted") {
        await botInstance.answerCallbackQuery(callback_msg.id);
        response = await telegramCmdHandler.infoacceptHandler(
          botInstance,
          callback_msg
        );
        await botInstance.sendMessage(
          callback_msg.message.chat.id,
          response.text
        );
      } else if (callback_msg.data.startsWith("regenerate")) {
        await botInstance.answerCallbackQuery(callback_msg.id);

        //Убираем кнопку, которая была нажата, т.к. она уже использована
        await botInstance.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: callback_msg.message.chat.id, message_id: callback_msg.message.message_id })
        //    console.log("callback_msg",callback_msg)
        const callback_regime = callback_msg.data.split("_")[1];

        if (
          callback_regime !=
          global.allSettingsDict[callback_msg.from.id].current_regime
        ) {
          await botInstance.sendMessage(
            callback_msg.message.chat.id,
            msqTemplates.wrong_regime.replace(
              "[regime]",
              modelSettings[callback_regime].name
            )
          );
          return;
        }

        const regime = global.allSettingsDict[callback_msg.from.id].current_regime
        const model = allSettingsDict[callback_msg.from.id][regime].model || modelSettings[regime].default_model
        const temperature = allSettingsDict[callback_msg.from.id][regime].temperature || 1
        const functions = null

       //>>>new block 
              //Так делаем, если regenerate
      await mongo.deleteMsgByIdPromise(callback_msg.from.id, callback_msg.message.message_id); //Удаляем предыдущий вариант комплишена из базы
      callback_msg.chat = callback_msg.message.chat; //Немного меняем струкуту сообщения, чтобы она была более универсальной

      //>>>new block 

        await MsgHandler(
          botInstance,
          callback_msg.message.chat.id,
          callback_msg,
          process.env.OPENAI_API_KEY,
          model,
          temperature,
          functions,
          regime
        );
      } else if (callback_msg.data.startsWith("readaloud")) {
        await botInstance.answerCallbackQuery(callback_msg.id);
        
        const regime = "texttospeech"
        const model = allSettingsDict[callback_msg.from.id][regime].model || modelSettings[regime].default_model
        const voice = allSettingsDict[callback_msg.from.id][regime].voice || modelSettings[regime].voice

        const progressMsg = await botInstance.sendMessage(
          callback_msg.message.chat.id,
          msqTemplates.texttospeech_progress
        );      

        const transcript = await openAIApiHandler.TextToVoice(
          botInstance,
          callback_msg.message,
          regime,
          model,
          voice,
          process.env.OPENAI_API_KEY
        );
      
   //   console.log("progressMsg",progressMsg)
      await botInstance.deleteMessage(
        callback_msg.message.chat.id,
        progressMsg.message_id
      );

      } else if (callback_msg.data.startsWith("settings")) {
        await botInstance.answerCallbackQuery(callback_msg.id);
        response = await telegramCmdHandler.settingsOptionsHandler(
          botInstance,
          callback_msg.data,
          callback_msg
        );
        if (!response.text) {
          //Если текста нет - сообщение не отправляем
          return;
        }

        await botInstance.editMessageText(response.text, {
          chat_id: callback_msg.message.chat.id,
          message_id: callback_msg.message.message_id,
          reply_markup: response.buttons.reply_markup,
        });
      } else if (callback_msg.data.startsWith("reports")) {
        await botInstance.answerCallbackQuery(callback_msg.id);

        const response = await telegramCmdHandler.reportsOptionsHandler(
          botInstance,
          callback_msg.data,
          callback_msg
        );
        if (!response.text) {
          //Если текста нет - сообщение не отправляем
          return;
        }
        await botInstance.editMessageText(response.text, {
          chat_id: callback_msg.message.chat.id,
          message_id: callback_msg.message.message_id,
          reply_markup: response.buttons.reply_markup,
        });
      } else if (callback_msg.data.startsWith("resend_to_admin")) {
        await botInstance.answerCallbackQuery(callback_msg.id);
        console.log("resceived request");
      }
    } catch (err) {
      if (err.mongodblog === undefined) {
        err.mongodblog = true;
      }
      err.place_in_code = err.place_in_code || arguments.callee.name;
      telegramErrorHandler.main(
        botInstance,
        callback_msg.message.chat.id,
        err,
        err.place_in_code,
        err.user_message
      );
    }
  });
}

const deferredMsgHandler = otherFunctions.debounceConstructorPromise(
  MsgHandler,
  appsettings.telegram_options.debounceMs
);

async function MsgHandler(botInstance, chat_id, msg, open_ai_api_key,model,temperature,functions,regime) {
  if (msg.text && process.env.PROD_RUN) {
    console.log("message lenght", msg.text.length, new Date());
  }
  //  console.log("Полученный текст",msg.text)

  await botInstance.sendChatAction(chat_id, "typing"); //Отправляем progress msg
  const result = await botInstance.sendMessage(chat_id, "..."); //Следом отправляем plaseholder
  await openAIApiHandler.chatCompletionStreamAxiosRequest(
    botInstance,
    result.message_id,
    msg,
    regime,
  //  global.allSettingsDict[msg.from.id].current_regime,
    open_ai_api_key,
    model,
    temperature,
    functions
  );
}

module.exports = {
  router,
  setBotParameters,
  GetModelsFromAPI,
  UpdateGlobalVariables,
  MsgHandler
};
