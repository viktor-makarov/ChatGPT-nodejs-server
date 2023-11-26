const mongo = require("./mongo");
const msqTemplates = require("../config/telegramMsgTemplates");
const modelSettings = require("../config/telegramModelsSettings");
const reports = require("../config/telegramReportsConfig.js");
const otherFunctions = require("./other_func");
const modelConfig = require("../config/modelConfig");

function noMessageText() {
  return msqTemplates.no_text_msg;
}

async function infoacceptHandler(botInstance, callback_msg) {
    await mongo.insert_read_sectionPromise(callback_msg); // Вставляем новую секцию в базу данных
    global.readArray = await mongo.get_all_readPromise(); // Получаем все секции read из базы данных
    return { text: msqTemplates.welcome };
}

async function registerHandler(botInstance, msg) {
  return { text: msqTemplates.register_depricated };
}

function infoHandler(botInstance, msg) {
  return { text: msqTemplates.info };
}

async function adminHandler(botInstance, msg) {
  if (adminArray.includes(msg.from.id)) {
    //Провевяем, активированы ли уже админские права
    return { text: msqTemplates.already_admin };
  }
 
  const adminCode = process.env.ADMIN_KEY;
  let prompt = msg.text.substring("/admin".length).trim();

  console.log("prompt",prompt)
  if (prompt === "") {
    return { text: msqTemplates.blank_admin_code };
  }

  if (adminCode === prompt) {
    
      await mongo.insert_adminRolePromise(msg);
      await mongo.insert_reg_eventPromise(
        msg.from.id,
        msg.chat.id,
        msg.from.is_bot,
        msg.from.first_name,
        msg.from.last_name,
        msg.from.username,
        msg.from.language_code,
        "admin permissions granted",
        "user's command"
      );
      global.adminArray = await mongo.get_all_adminPromise(); //Если секция permissions успешно добавилась, то обновляем adminArray.

      return { text: msqTemplates.admin_welcome };
    }
}

function sendtomeHandler(botInstance, msg) {
    const pattern = /\[(.*?)\]/gm; // Regular expression pattern to match strings inside []
    const matches = msg.text.match(pattern); // Array of all matches found

    if (matches) {
      const substrings = matches.map((match) => match.slice(1, -1)); // Extracting substring between []
      return { text: substrings.join(" ") };
    } else {
      err = new Error(
        `No match for pattern ${pattern} found in function ${arguments.callee.name}.`
      );
      //Tested
      err.code = "RQS_ERR3";
      err.user_message = msqTemplates.sendtome_error;
      err.place_in_code = err.place_in_code || arguments.callee.name
      err.mongodblog = false;
      throw err;
    }
}

async function unregisterAllNotUpToDate(botInstance, msg) {
    if (adminArray.includes(msg.from.id)) {//Если у пользователя есть права админа

      const profilesWithOldRegistration = await mongo.get_all_profiles_with_old_registrationPromise()
      console.log("Profiles with not upToDate registration found:",profilesWithOldRegistration.length)

      let index = 0;
      async function sendMessageSequentially(){
        if(index < profilesWithOldRegistration.length) {
  
          const item = profilesWithOldRegistration[index]

          //Отправляем всем пользователям уведомление об отмене регистрации
        if (item.id_chat) {
          await mongo.insert_reg_eventPromise(
            item.id,
            item.id_chat,
            item.is_bot,
            item.first_name,
            item.last_name,
            item.username,
            item.language_code,
            "unregister",
            "register code change"
          );

          await botInstance.sendMessage(
            item.id_chat,
            msqTemplates.code_change_mesage
          );
          console.log("Sent message to unregistered user",item.id,item.first_name,
          item.last_name,
          item.username);
        }
          index++;
          setTimeout(sendMessageSequentially,appsettings.telegram_options.debounceMs)
        }
      }

      if(profilesWithOldRegistration.length>0){
        sendMessageSequentially()
      }

      const resultDeleted = await mongo.DeleteNotUpToDateProfilesPromise()
      console.log("Deleted profiles:",resultDeleted)
      global.registeredArray = await mongo.get_all_registeredPromise();     
      global.readArray = await mongo.get_all_readPromise(); //И проверяем всех ознакомившихся     
      global.allSettingsDict = await mongo.get_all_settingsPromise();
      global.adminArray = await mongo.get_all_adminPromise(); //Если секция permissions успешно добавилась, то обновляем adminArray.

      return { text: msqTemplates.unregisteredAllResultMsg.replace("[number]",resultDeleted.deletedCount.toString()) };
    } else {
      return {text: msqTemplates.no_admin_permissions}
      
    }
}

async function sendtoallHandler(botInstance, msg) {
  try {
    if (adminArray.includes(msg.from.id)) {
      const pattern = /\[(.*?)\]/gm; // Regular expression pattern to match strings inside []
      const matches = msg.text.match(pattern); // Array of all matches found

      if (matches) {
        const substrings = matches.map((match) => match.slice(1, -1)); // Extracting substring between []
        let text_to_send = substrings.join(" ");
        const profile_list = await mongo.get_all_profilesPromise();
        profile_list.forEach(async (item) => {
            if (item.id_chat) {
              await botInstance.sendMessage(
                item.id_chat,
                text_to_send + "\n\n Сообщение от Администратора."
              );
            }
        });
        return {
          text:
            msqTemplates.sendtoall_success +
            ` ${profile_list.length} пользователям.`,
        };
      } else {
        err = new Error(
          `No match for pattern ${pattern} found in function ${arguments.callee.name}.`
        );
        //Tested
        err.code = "RQS_ERR3";
        err.user_message = msqTemplates.sendtome_error;
        err.mongodblog = false;
        throw err
      }
    } else {
      return { text: msqTemplates.no_admin_permissions };
    }
  } catch (err) {
    //Tested
    err.place_in_code = err.place_in_code || arguments.callee.name
    throw err;
  }
}

async function changeRegimeHandlerPromise(msg, regime) {
      await mongo.UpdateCurrentRegimeSettingPromise(msg, regime);
      const dict = await mongo.get_all_settingsPromise(); //Обновляем глобальную переменную с настроками
      global.allSettingsDict = dict;

      if (regime == "assistant") {
        const dialogueList = await mongo.getDialogueByUserIdPromise(
          msg.from.id,
          regime
        ); //получаем текущий диалог
        if (dialogueList.length > 0) {
          var previous_dialogue_tokens = 0; //Подсчитаем токены
          for (const obj of dialogueList) {
            previous_dialogue_tokens += obj.tokens;
          }
          return {
            text: modelSettings[regime].incomplete_msg
              .replace(
                "[temperature]",
                allSettingsDict[msg.from.id][regime].temperature
              )
              .replace(
                "[model]",
                modelConfig[allSettingsDict[msg.from.id][regime].model].name
              )
              .replace("[previous_dialogue_tokens]", previous_dialogue_tokens)
              .replace(
                "[request_length_limit_in_tokens]",
                modelConfig[allSettingsDict[msg.from.id][regime].model].request_length_limit_in_tokens
              ),
          };
        } else {
          return {
            text: modelSettings[regime].welcome_msg
            .replace(
              "[temperature]",
              allSettingsDict[msg.from.id][regime].temperature
            ).replace(
              "[model]",
              modelConfig[allSettingsDict[msg.from.id][regime].model].name
            ),
          };
        }
      } else if (regime == "voicetotext") {
        return {
          text: modelSettings[regime].welcome_msg.replace(
            "[size]",
            modelSettings.voicetotext.filesize_limit_mb.toString()
          ),
        };
      } else {
        return {
          text: modelSettings[regime].welcome_msg
          .replace(
            "[temperature]",
            allSettingsDict[msg.from.id][regime].temperature
          ).replace(
            "[model]",
            modelConfig[allSettingsDict[msg.from.id][regime].model].name
          ),
        };
      }

  };

async function unregisterHandler(botInstance, msg) {
    await mongo.delete_profile_by_id_arrayPromise([msg.from.id]);
    await mongo.insert_reg_eventPromise(
      msg.from.id,
      msg.chat.id,
      msg.from.is_bot,
      msg.from.first_name,
      msg.from.last_name,
      msg.from.username,
      msg.from.language_code,
      "unregister",
      "user's command"
    );

    await mongo.deleteDialogByUserPromise([msg.from.id], null); //Удаляем диалог данного пользователя
    global.registeredArray = await mongo.get_all_registeredPromise();
    global.readArray = await mongo.get_all_readPromise();
    //И отправляем сообщение пользователю
    return { text: msqTemplates.unregistered };
}

async function resetdialogHandler(botInstance, msg) {

    await mongo.deleteDialogByUserPromise([msg.from.id], "assistant");
    return { text: msqTemplates.dialogresetsuccessfully };

}

async function settingsChangeHandler(botInstance, msg) {
    const callbackArray = msg.data.split("_");
    const pathArray = callbackArray.slice(0, callbackArray.length - 1);
    const pathString = pathArray.join(".");
    const value = callbackArray[callbackArray.length - 1];
    let templateResponseMsg = "";
    let objectToParce = {
      settings: {
        options_desc: msqTemplates.settings_intro,
        options: modelSettings,
      },
    };
    pathArray.forEach((part) => {
      //Получаем объект, который нужно превратить в кнопки
      templateResponseMsg = objectToParce[part].templateRespMsg;
      objectToParce = objectToParce[part].options;
    });
    const result = await mongo.UpdateSettingPromise(msg, pathString, value);
    //console.log("Обновление результатов",result)
    global.allSettingsDict = await mongo.get_all_settingsPromise();
    //console.log("Обновленные settings", global.allSettingsDict);
    await botInstance.sendMessage(
      msg.message.chat.id,
      
      templateResponseMsg.replace("[value]", value)
    );
}

async function reportsSendHandler(botInstance, msg) {
    const callbackArray = msg.data.split("_");
    let templateResponseMsg = "";
    let objectToParce = reports;
    callbackArray.forEach((part) => {
      //Получаем объект, который нужно превратить в кнопки
      templateResponseMsg = objectToParce[part].templateRespMsg;
      objectToParce = objectToParce[part].options;
    });

    //console.log("Обновление результатов",result)
    let report = "";
    if (callbackArray.join("_") === "reports_currentProfiles") {
      const docs = await mongo.get_all_profilesPromise();
      let count = 1;
      docs.forEach((doc) => {
        report =
          report +
          `\n${count}. ${doc.first_name || ""} ${doc.last_name || ""} ${
            doc.username || ""
          } ${new Intl.DateTimeFormat("ru", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
          }).format(new Date(Date.parse(doc.datetimeUTC)))}`;
        count += 1;
      });
    } else if (callbackArray.join("_") === "reports_oldusers") {
      const docs = await mongo.get_all_profiles_with_old_registrationPromise();
      
      let count = 1;
   
        for (let i = 0; i < docs.length; i++) {
        report =
          report +
          `\n${count}. ${docs[i].id} ${docs[i].first_name || ""} ${docs[i].last_name || ""} ${
            docs[i].username || ""
          } ${new Intl.DateTimeFormat("ru", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
          }).format(new Date(Date.parse(docs[i].datetimeUTC)))}`;
        count += 1;
      };

    } else if (callbackArray.join("_") === "reports_statistics_userActivity") {
      const docs = await mongo.get_tokenUsageByUsers();
      let count = 1;

        for (let i = 0; i < docs.length; i++) {
      
        report =
          report +
          `\n${count}. ${docs[i].userFirstName || ""} ${
            docs[i].userLastName || ""
          } ${docs[i].username || ""} ${docs[i].requests} req. ${
            docs[i].tokens
          } tok. ${new Intl.DateTimeFormat("ru", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(new Date(Date.parse(docs[i].last_request)))}`;
        count += 1;
      };
    } else if (callbackArray.join("_") === "reports_statistics_regimeUsage") {
      const docs = await mongo.get_tokenUsageByRegimes();
      let count = 1;
      docs.forEach((doc) => {
        report =
          report +
          `\n${count}. ${doc._id.regime} ${doc.requests} req. ${doc.tokens} tok.`;
        count += 1;
      });
    } else if (callbackArray.join("_") === "reports_statistics_errors") {
      const docs = await mongo.get_errorsByMessages();
      let count = 1;
      docs.forEach((doc) => {
        report = report + `\n${count}. ${doc._id} = (${doc.count}).`;
        count += 1;
      });
    } else if (callbackArray.join("_") === "reports_statistics_tokenUsage") {
      const docs = await mongo.get_tokenUsageByDates();
      let count = 1;
      docs.forEach((doc) => {
        report =
          report +
          `\n${doc._id} ${doc.requests} req. ${doc.tokens} tok. ${doc.uniqueUsers} users.`;
        count += 1;
      });
    }
    //console.log("Обновленные settings", global.allSettingsDict);
    await botInstance.sendMessage(
      msg.message.chat.id,
      templateResponseMsg.replace("[report]", report)
    );

}

async function reportsOptionsHandler(botInstance, callback_data, msg) {
    if (!adminArray.includes(msg.from.id)) {
      return {
        text: msqTemplates.reports_no_permission,
        buttons: { reply_markup: {} },
      };
    }
    let callbackArray = callback_data.split("_");
    // console.log("callbackArray",callbackArray)
    let settingsKeyboard = [];
    let objectToParce = reports;
    //  console.log("initialObject",objectToParce)
    let msgText = "";
    if (callbackArray[callbackArray.length - 1] === "back") {
      callbackArray = callbackArray.slice(0, callbackArray.length - 2); //убираем последний участок пути, чтобы переключиться на предыдущий уровень
      // console.log("back trigger",callbackArray)
    }

    callbackArray.forEach((part) => {
      //Получаем объект, который нужно превратить в кнопки
      msgText = objectToParce[part].options_desc;
      objectToParce = objectToParce[part].options;
    });
    //   console.log("final object",JSON.stringify(objectToParce))

    if (objectToParce) {
      //Если объект с опциями существует
      //Обновляем меню

      settingsKeyboard = otherFunctions.optionsToButtons(
        objectToParce,
        callbackArray.join("_")
      );
      //  console.log("Обновленная клавиатура",settingsKeyboard)
      return {
        text: msgText,
        buttons: {
          reply_markup: {
            inline_keyboard: settingsKeyboard,
            resize_keyboard: true,
          },
        },
      };
    } else {
      //выполняем изменение конфига
      //  console.log("Выполняем действие")
      await reportsSendHandler(botInstance, msg);
      return { text: null };
    }
}

async function settingsOptionsHandler(botInstance, callback_data, msg) {
    let callbackArray = callback_data.split("_");
    //console.log("callbackArray",callbackArray)
    if(callbackArray.includes("currentsettings")){
      await botInstance.sendMessage(
        msg.message.chat.id,
        msqTemplates.current_settings.replace("[settings]",otherFunctions.jsonToText(allSettingsDict[msg.from.id]))
      );
      return { text: null };
    }

    let settingsKeyboard = [];
    let objectToParce = {
      settings: {
        options_desc: msqTemplates.settings_intro,
        options: modelSettings,
      },
    };
    //console.log("initialObject",objectToParce)
    let msgText = "";

    if (callbackArray[callbackArray.length - 1] === "back") {
      callbackArray = callbackArray.slice(0, callbackArray.length - 2); //убираем последний участок пути, чтобы переключиться на предыдущий уровень
      //console.log("back trigger",callbackArray)
    }

    callbackArray.forEach((part) => {
      //Получаем объект, который нужно превратить в кнопки
      msgText = objectToParce[part].options_desc;
      objectToParce = objectToParce[part].options;
    });
    // console.log("final object",JSON.stringify(objectToParce))

    if (objectToParce) {
      //Если объект с опциями существует
      //Обновляем меню

      settingsKeyboard = otherFunctions.optionsToButtons(
        objectToParce,
        callbackArray.join("_")
      );
      //console.log("Обновленная клавиатура",settingsKeyboard)
      return {
        text: msgText,
        buttons: {
          reply_markup: {
            inline_keyboard: settingsKeyboard,
            resize_keyboard: true,
          },
        },
      };
    } else {
      //выполняем изменение конфига
      //console.log("Выполняем действие")
      await settingsChangeHandler(botInstance, msg);
      return { text: null };
    }
}

async function startHandler(botInstance, msg) {
    if (registeredArray.includes(msg.from.id)) {
      //Провевяем, зарегистрирован ли уже пользователь уже
      return { text: msqTemplates.already_registered };
    }

    const registerCode = process.env.REGISTRATION_KEY;
    const prompt = msg.text.substring("/start".length).trim();

    if (prompt === "") {
      await mongo.insert_reg_eventPromise(
        msg.from.id,
        msg.chat.id,
        msg.from.is_bot,
        msg.from.first_name,
        msg.from.last_name,
        msg.from.username,
        msg.from.language_code,
        "failed register attempt",
        "user's command"
      );
      return { text: msqTemplates.blank_registration };
    }

    if (registerCode === prompt) {
      await mongo.insert_profilePromise(msg); //Пробуем вставить профиль
      await mongo.insert_permissionsPromise(msg);
      await mongo.insert_reg_eventPromise(
        msg.from.id,
        msg.chat.id,
        msg.from.is_bot,
        msg.from.first_name,
        msg.from.last_name,
        msg.from.username,
        msg.from.language_code,
        "register",
        "user's command"
      );
      global.registeredArray = await mongo.get_all_registeredPromise(); //Если секция permissions успешно добавилась, то обновляем registeredArray.
      global.allSettingsDict = await mongo.get_all_settingsPromise(); //Обновляем глобальную переменную с настроками

      return {
        text: infoHandler(botInstance, msg).text,
        buttons: {
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: "Понятно", callback_data: "info_accepted" }],
            ],
          }),
        },
      };
    } else {
      //Tested
      err = new Error(`Incorrect registration code ${arguments.callee.name}.`);
      err.code = "PRM_ERR1";
      err.user_message = msqTemplates.incorrect_code;
      err.mongodblog = false;
      err.place_in_code = err.place_in_code || arguments.callee.name
      await mongo.insert_reg_eventPromise(
        msg.from.id,
        msg.chat.id,
        msg.from.is_bot,
        msg.from.first_name,
        msg.from.last_name,
        msg.from.username,
        msg.from.language_code,
        "failed register attempt",
        "user's command"
      );git 
      throw err
    }
}


function helpHandler(botInstance, msg) {
    if (adminArray.includes(msg.from.id)) {
      console.log(adminArray);
      return { text: msqTemplates.help + msqTemplates.help_advanced };
    } else {
      return { text: msqTemplates.help };
    }
}

function faqHandler(botInstance, msg) {
  return { text: msqTemplates.faq };
}

module.exports = {
  startHandler,
  helpHandler,
  noMessageText,
  registerHandler,
  unregisterHandler,
  infoHandler,
  infoacceptHandler,
  resetdialogHandler,
  changeRegimeHandlerPromise,
  sendtoallHandler,
  sendtomeHandler,
  adminHandler,
  faqHandler,
  settingsOptionsHandler,
  reportsOptionsHandler,
  unregisterAllNotUpToDate,
};
