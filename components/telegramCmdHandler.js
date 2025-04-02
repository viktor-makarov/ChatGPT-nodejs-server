const mongo = require("./mongo");
const msqTemplates = require("../config/telegramMsgTemplates");
const modelSettings = require("../config/telegramModelsSettings");
const reports = require("../config/telegramReportsConfig.js");
const otherFunctions = require("./other_func");
const modelConfig = require("../config/modelConfig");
const openAIApiHandler = require("./openAI_API_Handler.js");
const MdjMethods = require("./midjourneyMethods.js");
const aws = require("./aws_func.js")


async function messageBlock(requestInstance){
  let responses =[];
  responses.push({text:msqTemplates.message_block,add_options:{reply_parameters:{message_id:requestInstance.msgId}}})
  return responses
}

async function fileRouter(requestMsgInstance,replyMsgInstance,dialogueInstance,toolCallsInstance){
  let responses =[];
  
  const current_regime = requestMsgInstance.user.currentRegime

  if(current_regime === "voicetotext"){
        if(requestMsgInstance.fileType === "audio" || requestMsgInstance.fileType === "video_note"){
          console.log("audio received")
          const checkResult = requestMsgInstance.voiceToTextConstraintsCheck()
          if(checkResult.success===0){
            responses.push(checkResult.response)
            return
          }
          const result = await replyMsgInstance.sendAudioListenMsg()
          const transcript = await openAIApiHandler.VoiceToText(requestMsgInstance)
          replyMsgInstance.text = transcript;
          await replyMsgInstance.simpleMessageUpdate(transcript,
            {
            chat_id:replyMsgInstance.chatId,
            message_id:result.message_id
          })
        } else {
          responses.push({text:msqTemplates.file_type_cannot_be_converted_to_text})
        }
    } else if(current_regime ==="texttospeech"){
      responses.push({text:msqTemplates.file_is_not_handled_in_the_regime})

    } else if (current_regime === "chat" || current_regime === "translator" || current_regime === "texteditor"){
      if(requestMsgInstance.fileType === "audio" || requestMsgInstance.fileType === "video_note"){
        const checkResult = requestMsgInstance.voiceToTextConstraintsCheck()
        if(checkResult.success===0){
          responses.push(checkResult.responce)
          return;
      }
        const result = await replyMsgInstance.sendAudioListenMsg()
        const transcript = await openAIApiHandler.VoiceToText(requestMsgInstance)
        replyMsgInstance.text = transcript;
        await replyMsgInstance.simpleMessageUpdate(transcript,
          {
          chat_id:replyMsgInstance.chatId,
          message_id:result.message_id
        })
        await dialogueInstance.getDialogueFromDB()
        await dialogueInstance.commitPromptToDialogue(transcript,requestMsgInstance)

      } else if(requestMsgInstance.fileType === "image" || requestMsgInstance.fileType === "document"){
        
        await requestMsgInstance.getFileLinkFromTgm()

        if(requestMsgInstance.uploadFileError){
          await dialogueInstance.commitSystemToDialogue(requestMsgInstance.unsuccessfullFileUploadSystemMsg);
          await replyMsgInstance.simpleSendNewMessage(requestMsgInstance.unsuccessfullFileUploadUserMsg,null,"html",null)
          return;
        }
        
        let uploadResult;
        try{
        uploadResult = await uploadFileToS3Handler(requestMsgInstance)
        } catch(err){
          requestMsgInstance.uploadFileError = err.message
          requestMsgInstance.unsuccessfullFileUploadUserMsg = `❌ Файл <code>${requestMsgInstance.fileName}</code> не может быть добавлен в наш диалог, т.к. он имеет слишком большой размер.`
          requestMsgInstance.unsuccessfullFileUploadSystemMsg = `User tried to upload file named "${requestMsgInstance.fileName}", but failed with the following error: ${requestMsgInstance.uploadFileError}`
          await dialogueInstance.commitSystemToDialogue(requestMsgInstance.unsuccessfullFileUploadSystemMsg);
          await replyMsgInstance.simpleSendNewMessage(requestMsgInstance.unsuccessfullFileUploadUserMsg,null,"html",null)
          return;
        }
        
        const url = uploadResult.Location
        
        await dialogueInstance.commitFileToDialogue(url,requestMsgInstance)
        
      }} else {
          responses.push({text:msqTemplates.file_handler_is_not_realized})
      }

  return responses
}

async function textMsgRouter(requestMsgInstance,replyMsgInstance,dialogueInstance,toolCallsInstance){
  let responses =[];

  switch(requestMsgInstance.user.currentRegime) {
    case "voicetotext":
      responses.push({text:msqTemplates.error_voicetotext_doesnot_process_text})
    break;   
    case "texttospeech":
      const checkResult = requestMsgInstance.textToSpeechConstraintsCheck()
      if(checkResult.success===0){
        responses.push(checkResult.response)
        break;
      }

      const result = await replyMsgInstance.sendTextToSpeachWaiterMsg()
      await openAIApiHandler.TextToVoice(requestMsgInstance);
      await replyMsgInstance.deleteMsgByID(result.message_id)
      
    break;
    case "chat":
      await dialogueInstance.getDialogueFromDB()
      await dialogueInstance.commitPromptToDialogue(requestMsgInstance.text,requestMsgInstance)

    break;
    case "translator":
      await resetTranslatorDialogHandler(requestMsgInstance)
      await dialogueInstance.commitSystemToDialogue(msqTemplates.translator_prompt)
      await dialogueInstance.commitPromptToDialogue(requestMsgInstance.text,requestMsgInstance)

    break;
    case "texteditor":
      await resetTexteditorDialogHandler(requestMsgInstance)
      await dialogueInstance.commitSystemToDialogue(msqTemplates.texteditor_prompt)
      await dialogueInstance.commitPromptToDialogue(requestMsgInstance.text,requestMsgInstance)

    break;
    }

  return responses
}

async function textCommandRouter(requestMsgInstance,dialogueInstance,replyMsgInstance,toolCallsInstance){

  const cmpName = requestMsgInstance.commandName
  const isRegistered = requestMsgInstance.user.isRegistered
  const hasReadInfo = requestMsgInstance.user.hasReadInfo
  const isAdmin = requestMsgInstance.user.isAdmin
  let responses =[];

  if(cmpName==="start"){

    if(isRegistered){
      responses.push({ text: msqTemplates.already_registered })
    } else {

      const result = await tokenValidation(requestMsgInstance);
      switch(result){
        case "blank":
        responses.push({ text: msqTemplates.blank_registration })
        break;
        case "valid":
          responses.push({
            text:requestMsgInstance.guideHandler().text,
            buttons:requestMsgInstance.guideHandler().buttons,
            parse_mode:requestMsgInstance.guideHandler()?.parse_mode
          })
          responses.push({text:requestMsgInstance.acceptHandler().text,buttons:requestMsgInstance.acceptHandler()?.buttons})
        break;
        case "invalid":
          responses.push({ text: msqTemplates.incorrect_code })
        break;
        case "already_used":
          responses.push({ text: msqTemplates.already_used_code })
        break;
      };
      requestMsgInstance.user.isRegistered =true
    }

  }  else if(cmpName==="resetchat" || cmpName==="Перезапустить диалог"){

    const response = await dialogueInstance.resetDialogue()

    responses.push(response)

  } else if(cmpName==="unregister"){
    const response = await unregisterHandler(requestMsgInstance);
    await dialogueInstance.deleteMeta()
    responses.push(response)

  } else if(cmpName==="help"){

    let response = {
      text:requestMsgInstance.guideHandler().text,
      buttons:requestMsgInstance.guideHandler()?.buttons,
      parse_mode:requestMsgInstance.guideHandler()?.parse_mode
    }
    responses.push(response)
    
  } else if(cmpName==="settings"){
    let response = await settingsOptionsHandler(requestMsgInstance);
    responses.push(response)

  } else if(cmpName==="chat" || cmpName==="translator" || cmpName==="texteditor" || cmpName==="voicetotext" || cmpName==="texttospeech"){
   
    requestMsgInstance.user.currentRegime = cmpName
    await dialogueInstance.getDialogueFromDB() //чтобы посчитать потраченные токены в диалоге
    let response = await changeRegimeHandlerPromise({
      newRegime:cmpName,
      requestMsgInstance:requestMsgInstance,
      dialogueInstance:dialogueInstance
    });

    if(cmpName==="chat"){
      response.buttons = {
        reply_markup: {
          keyboard: [['Перезапустить диалог']],
          resize_keyboard: true,
        }
      }
    } else {
      response.buttons = {
        reply_markup: {
          remove_keyboard: true,
        }
      }
    }

    responses.push(response)

  } else if(cmpName==="imagine"){

    const statusMsg = await replyMsgInstance.sendStatusMsg()

    const result = getPromtFomMsg(requestMsgInstance)

    if(result.success === 0){
      responses.push({text:result.error})
    } else {
      await  mdj_create_handler(replyMsgInstance,result.prompt)
    }

    await replyMsgInstance.deleteMsgByID(statusMsg.message_id)

  } else if(cmpName==="reports"){
    if (!isAdmin) {
      responses.push({text:msqTemplates.reports_no_permission,buttons:{reply_markup: {
        remove_keyboard: true,
      }}})
    } else {
      let response = await reportsOptionsHandler(requestMsgInstance);
      response.buttons = {reply_markup: {
        remove_keyboard: true,
      }}
      responses.push(response)
    }
  } else if(cmpName==="donate"){
    responses.push({ text: msqTemplates.donate,parse_mode:"HTML",buttons:{reply_markup: {
      remove_keyboard: true,
    }}})
  }  else if(cmpName==="create_free_account"){
    if (!isAdmin) {
      responses.push({text:msqTemplates.no_admin_permissions})
    } else {
      const response = await createNewFreeAccount();
      responses.push(response)
    }
  } else if(cmpName==="killserver"){
    if (isAdmin) {
      console.log(new Date(),"Получена команда killserver")
      setTimeout(() => {process.exit(0)}, 3000);
      responses.push({text:msqTemplates.killserver_success})
    } else {
      responses.push({text:msqTemplates.killserver_not_admin})
    }
  } else if(cmpName==="sendtome"){
    if(isAdmin){
      const response = sendtomeHandler(requestMsgInstance);
      responses.push(response)
    } else {
      responses.push({ text: msqTemplates.no_admin_permissions })
    }
  } else if(cmpName==="sendtoall"){
    if(isAdmin){
      const response = await sendtoallHandler(requestMsgInstance,replyMsgInstance);
      responses.push(response)
    } else {
      responses.push({ text: msqTemplates.no_admin_permissions })
    }
  } else {
    responses.push({text:msqTemplates.unknown_command})
  }
   return responses
}

async function handleCancelCommand(call_id){

  console.log("handleCancelCommand",call_id)
  const func = global.activeFunctions[call_id];
  if(func){
    await func.cancelFunction()
    delete global.activeFunctions[call_id]
  }
}

function noMessageText() {
  return msqTemplates.no_text_msg;
}


function generateButtonDescription(buttonLabels,buttonsShownBefore){

  let description ={};
  let lables = buttonLabels;
  const descriptionSource = appsettings.mdj_options.buttons_description
  const exclude_buttons = appsettings.mdj_options.exclude_buttons;
  lables = lables.filter(label => !exclude_buttons.includes(label));
  lables = lables.filter(label => !buttonsShownBefore.includes(label));

  for (const label of lables){
    description[label] = descriptionSource[label]
  }
  return description
}


async function infoacceptHandler(requestMsgInstance) {
    const result = await mongo.insert_read_sectionPromise(requestMsgInstance); // Вставляем новую секцию в базу данных
    return { text: msqTemplates.welcome };
}

async function pdfdownloadHandler(replyMsgInstance){
  
  const downloadedFile = await otherFunctions.fileDownload(appsettings.other_options.pdf_guide_url)
  const fileName = "Manual";
  
  await replyMsgInstance.sendDocumentAsBinary(downloadedFile,fileName)
  
};


async function adminHandler(requestMsgInstance) {
 try{
  const adminCode = process.env.ADMIN_KEY;
  let prompt = requestMsgInstance.text.substring("/admin".length).trim();

  if (prompt === "") {
    return { text: msqTemplates.blank_admin_code };
  }

  if (adminCode === prompt) {
    
      await mongo.insert_adminRolePromise(requestMsgInstance);
      await mongo.insert_reg_eventPromise(
        requestMsgInstance.user.userid,
        requestMsgInstance.chatId,
        requestMsgInstance.user.is_bot,
        requestMsgInstance.user.user_first_name,
        requestMsgInstance.user.user_last_name,
        requestMsgInstance.user.user_username,
        requestMsgInstance.user.language_code,
        "admin permissions granted",
        "user's command"
      );

      return { text: msqTemplates.admin_welcome };
    } else {
      return { text: msqTemplates.admin_reject };
    }
  } catch(err){
    console.log("err",err)
  }
}

async function uploadFileToS3Handler(requestMsgInstance){

const downloadStream = await otherFunctions.startFileDownload(requestMsgInstance.fileLink)
const filename = requestMsgInstance.user.userid + "_" + requestMsgInstance.msgId + "." + requestMsgInstance.fileExtention;

const uploadResult  = await aws.uploadFileToS3(downloadStream,filename)

return uploadResult
}


function sendtomeHandler(requestMsgInstance) {
    const pattern = /\[(.*?)\]/gm; // Regular expression pattern to match strings inside []
    const matches = requestMsgInstance.text.match(pattern); // Array of all matches found

    if (matches) {
      const substrings = matches.map((match) => match.slice(1, -1)); // Extracting substring between []
      let buttons = {reply_markup:{
        one_time_keyboard: true,
        inline_keyboard: [],
      }};
      buttons.reply_markup.inline_keyboard.push()

      return { text: substrings.join(" "),parse_mode:"HTML"};
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

async function unregisterAllNotUpToDate(requestMsgInstance) {

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

          await requestMsgInstance.botInstance.sendMessage(
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

      return { text: msqTemplates.unregisteredAllResultMsg.replace("[number]",resultDeleted.deletedCount.toString()) };
}

async function sendtoallHandler(requestMsgInstance,replyMsgInstance) {
  try {

      const pattern = /\[(.*?)\]/gm; // Regular expression pattern to match strings inside []
      const matches = requestMsgInstance.text.match(pattern); // Array of all matches found

      if (matches) {
        const substrings = matches.map((match) => match.slice(1, -1)); // Extracting substring between []
        let text_to_send = substrings.join(" ");
        const profile_list = await mongo.get_all_profiles();
        let i = 0;
        let ii = 0;
        for (const item of profile_list){
            if (item.id_chat) {

                try{
                await replyMsgInstance.botInstance.sendMessage(
                  item.id_chat,
                  text_to_send + "\n\n Сообщение от Администратора.",
                  {parse_mode:"html"}
                );
              i = i + 1;
              } 
                catch(err){
                  console.log(`Ошибка отправки пользователю ${item.id_chat}`)
                ii = ii + 1;
                }
            }
      };
        return {
          text:
            msqTemplates.sendtoall_success +
            ` ${i} пользователям. ${ii} отправить не удалось.`
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
   
  } catch (err) {
    //Tested
    err.place_in_code = err.place_in_code || arguments.callee.name
    throw err;
  }
}

async function changeRegimeHandlerPromise(obj){
  
   await mongo.updateCurrentRegimeSetting(obj.requestMsgInstance);

      if (obj.newRegime == "chat") {
        const previous_dialogue_tokens = obj.dialogueInstance.allDialogueTokens
             
        if (previous_dialogue_tokens > 0) {
          return {
            text: modelSettings[obj.newRegime].incomplete_msg
              .replace(
                "[temperature]",
                obj.requestMsgInstance.user.currentTemperature
              )
              .replace(
                "[model]",
                modelConfig[obj.requestMsgInstance.user.currentModel].name
              )
              .replace("[previous_dialogue_tokens]", previous_dialogue_tokens)
              .replace(
                "[request_length_limit_in_tokens]",
                modelConfig[obj.requestMsgInstance.user.currentModel].request_length_limit_in_tokens
              ),
          };
        } else {
          return {
            text: modelSettings[obj.newRegime].welcome_msg
            .replace(
              "[temperature]",
              obj.requestMsgInstance.user.currentTemperature
            ).replace(
              "[model]",
              modelConfig[obj.requestMsgInstance.user.currentModel].name
            ),
          };
        }
      } else if (obj.newRegime == "translator" || obj.newRegime == "texteditor") {
        return {
          text: modelSettings[obj.newRegime].welcome_msg
          .replace(
            "[temperature]",
            obj.requestMsgInstance.user.currentTemperature
          ).replace(
            "[model]",
            modelConfig[obj.requestMsgInstance.user.currentModel].name
          ),
        };

      } else if (obj.newRegime == "voicetotext") {
        return {
          text: modelSettings[obj.newRegime].welcome_msg.replace(
            "[size]",
            modelSettings.voicetotext.filesize_limit_mb.toString()
          ),
        };
      } else if (obj.newRegime == "texttospeech"){
        return {
          text: modelSettings[obj.newRegime].welcome_msg
          .replace(
            "[limit]",
            appsettings.telegram_options.big_message_threshold
          )
          .replace(
            "[voice]",
            obj.requestMsgInstance.user.currentVoice
          ),
        };
      } else {
        return {
          text: modelSettings[obj.newRegime].welcome_msg
          .replace(
            "[temperature]",
            obj.requestMsgInstance.user.currentTemperature
          ).replace(
            "[model]",
            modelConfig[obj.requestMsgInstance.user.currentModel].name
          ),
        };
      }
  };

async function unregisterHandler(requestMsgInstance) {
    await mongo.delete_profile_by_id_arrayPromise([requestMsgInstance.user.userid]);
    await mongo.insert_reg_eventPromise(
      requestMsgInstance.user.userid,
      requestMsgInstance.chatId,
      requestMsgInstance.user.is_bot,
      requestMsgInstance.user.user_first_name,
      requestMsgInstance.user.user_last_name,
      requestMsgInstance.user.user_username,
      requestMsgInstance.user.language_code,
      "unregister",
      "user's command"
    );

    await mongo.deleteDialogByUserPromise([requestMsgInstance.user.userid], null); //Удаляем диалог данного пользователя
    await aws.deleteS3FilesByPefix(requestMsgInstance.user.userid) 
    //И отправляем сообщение пользователю
    return { text: msqTemplates.unregistered };
}

async function createNewFreeAccount(){
  const date = new Date();
  const dateString = date.toString();
  const newToken = otherFunctions.valueToSHA1(dateString)

  const result = await mongo.insert_blank_profile(newToken)
  const accountToken = result.token
  return {text:`Используте линк для регистрации в телеграм боте R2D2\nhttps://t.me/${process.env.TELEGRTAM_BOT_NAME}?start=${accountToken}`}
}

async function resetTranslatorDialogHandler(requestMsgInstance) {
  await mongo.deleteDialogByUserPromise([requestMsgInstance.user.userid], "translator");

  return;
}

async function resetTexteditorDialogHandler(requestMsgInstance) {
  await mongo.deleteDialogByUserPromise([requestMsgInstance.user.userid], "texteditor");

  return;
}

async function resetdialogHandler(requestMsgInstance) {
    await mongo.deleteDialogByUserPromise([requestMsgInstance.user.userid], "chat");
    const deleteS3Results = await aws.deleteS3FilesByPefix(requestMsgInstance.user.userid) 
    const deletedFiles = deleteS3Results.Deleted

    const buttons = {
      reply_markup: {
        keyboard: [['Перезапустить диалог']],
        resize_keyboard: true,
      }
    }

   if(deletedFiles){
    return { text: msqTemplates.dialogresetsuccessfully_extended.replace("[files]",deletedFiles.length),buttons:buttons};
   } else {
    return { text: msqTemplates.dialogresetsuccessfully,buttons:buttons};
   }
}

async function settingsChangeHandler(requestMsgInstance) {

  let callbackArray = [requestMsgInstance.commandName ? requestMsgInstance.commandName : requestMsgInstance.callback_event]
    if(requestMsgInstance.callback_data){
      callbackArray =  callbackArray.concat(requestMsgInstance.callback_data)
    }
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
    const result = await mongo.UpdateSettingPromise(requestMsgInstance, pathString, value);
    //console.log("Обновление результатов",result)
    return {operation:"insert",text:templateResponseMsg.replace("[value]", value)}
}

async function reportsSendHandler(requestMsgInstance) {
    let callbackArray = [requestMsgInstance.commandName ? requestMsgInstance.commandName : requestMsgInstance.callback_event]
    if(requestMsgInstance.callback_data){
      callbackArray =  callbackArray.concat(requestMsgInstance.callback_data)
    }
    let templateResponseMsg = "";
    let objectToParce = reports;
    callbackArray.forEach((part) => {
      //Получаем объект, который нужно превратить в кнопки
      templateResponseMsg = objectToParce[part].templateRespMsg;
      objectToParce = objectToParce[part].options;
    });

    //console.log("Обновление результатов",result)
    let report = "";
    if (callbackArray.includes("currentProfiles")) {
      const docs = await mongo.get_all_profiles();
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
    } else if (callbackArray.includes("oldusers")) {
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

    } else if (callbackArray.includes("userActivity")) {
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
    } else if (callbackArray.includes("regimeUsage")) {
      const docs = await mongo.get_tokenUsageByRegimes();
      let count = 1;
      docs.forEach((doc) => {
        report =
          report +
          `\n${count}. ${doc._id.regime} ${doc.requests} req. ${doc.tokens} tok.`;
        count += 1;
      });
    } else if (callbackArray.includes("errors")) {
      const docs = await mongo.get_errorsByMessages();
      let count = 1;
      docs.forEach((doc) => {
        report = report + `\n${count}. ${doc._id} = (${doc.count}).`;
        count += 1;
      });
    } else if (callbackArray.includes("tokenUsage")) {
      const docs = await mongo.get_tokenUsageByDates();
      let count = 1;
      docs.forEach((doc) => {
        report =
          report +
          `\n${doc._id} ${doc.requests} req. ${doc.tokens} tok. ${doc.uniqueUsers} users.`;
        count += 1;
      });
    }
    return {operation:"insert",text:templateResponseMsg.replace("[report]", report)};
}

async function reportsOptionsHandler(requestMsgInstance) {


  let callbackArray = [requestMsgInstance.commandName ? requestMsgInstance.commandName : requestMsgInstance.callback_event]
    if(requestMsgInstance.callback_data){
      callbackArray =  callbackArray.concat(requestMsgInstance.callback_data)
    }
    // console.log("callbackArray",callbackArray)
    let settingsKeyboard = [];
    let objectToParce = reports;
    //  console.log("initialObject",objectToParce)
    let msgText = "";

    if (callbackArray[callbackArray.length - 1] === "back") {
      callbackArray = callbackArray.slice(0, callbackArray.length - 2);    
      requestMsgInstance.callback_data = requestMsgInstance.callback_data.slice(0, requestMsgInstance.callback_data.length - 2); //убираем последний участок пути, чтобы переключиться на предыдущий уровень
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
        requestMsgInstance
      );
      //  console.log("Обновленная клавиатура",settingsKeyboard)
      return {
        operation:"update",
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
      const response = await reportsSendHandler(requestMsgInstance);
      return response;
    }
}

async function settingsOptionsHandler(requestMsgInstance) {

    let callback_data_array = [requestMsgInstance.commandName ? requestMsgInstance.commandName : requestMsgInstance.callback_event]
    if(requestMsgInstance.callback_data){
      callback_data_array =  callback_data_array.concat(requestMsgInstance.callback_data)
    }
    console.log("callback_data_array",callback_data_array)
    if(callback_data_array.includes("currentsettings")){
      return {operation:"insert", text: msqTemplates.current_settings.replace("[settings]",otherFunctions.jsonToText(requestMsgInstance.user.settings)) };
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

    if (callback_data_array[callback_data_array.length - 1] === "back") {
      callback_data_array = callback_data_array.slice(0, callback_data_array.length - 2);
      requestMsgInstance.callback_data = requestMsgInstance.callback_data.slice(0, requestMsgInstance.callback_data.length - 2); //убираем последний участок пути, чтобы переключиться на предыдущий уровень
      //console.log("back trigger",callbackArray)
    }

    callback_data_array.forEach((part) => {
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
        requestMsgInstance
      );
       
      //console.log("Обновленная клавиатура",settingsKeyboard)
      return {
        operation:"update",
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
      const response = await settingsChangeHandler(requestMsgInstance);
      return response;
    }
};

function getPromtFomMsg(requestMsgInstance){

 const prompt = requestMsgInstance.text.substring("/imagine".length).trim();

 if(prompt){
  if(prompt===""){
    return {success:0,error:msqTemplates.mdj_lacks_prompt}
  } else {
    return {success:1,prompt:prompt}
  }
 } else {
  return {success:0,error:msqTemplates.mdj_lacks_prompt}
};

}

async function tokenValidation(requestMsgInstance) {

    const token = requestMsgInstance.text.substring("/start".length).trim();

    if (token === "") {
      await mongo.insert_reg_eventPromise(
        requestMsgInstance.user.userid,
        requestMsgInstance.chatId,
        requestMsgInstance.user.is_bot,
        requestMsgInstance.user.user_first_name,
        requestMsgInstance.user.user_last_name,
        requestMsgInstance.user.user_username,
        requestMsgInstance.user.language_code,
        "failed register attempt",
        "user's command"
      );
      return "blank";
    }

    const getResult = await mongo.getUserProfileByToken(token)

    
    if(getResult.length ===0){
      return "invalid";
    }

    const userIdAlreadyExists = getResult[0]?.id ? true : false;

    if (userIdAlreadyExists) {
      return "already_used"
    } else {
    const updateResult = await mongo.registerUser(requestMsgInstance,token); //Пробуем вставить профиль
      await mongo.insert_reg_eventPromise(
        requestMsgInstance.user.userid,
        requestMsgInstance.chatId,
        requestMsgInstance.user.is_bot,
        requestMsgInstance.user.user_first_name,
        requestMsgInstance.user.user_last_name,
        requestMsgInstance.user.user_username,
        requestMsgInstance.user.language_code,
        "register",
        "user's command"
      );

      return "valid";
    }
}

async function mdj_create_handler(prompt){

  const info = await MdjMethods.executeInfo()
  console.log(info)

let msg;
try{
  msg = await MdjMethods.executeImagine(prompt);
} catch(err){
  err.code = "MDJ_ERR"
  err.user_message = err.message
  throw err
}

  const imageBuffer = await otherFunctions.getImageByUrl(msg.uri)
  
  return {
    imageBuffer:imageBuffer,
    replymsg:msg
  }
}

function extractTextBetweenDoubleAsterisks(text) {
  const matches = text.match(/\*\*(.*?)\*\*/);
  return matches ? matches[1] : null;
}

async function mdj_custom_handler(requestInstance,replyInstance){

  const jsonDecoded = await otherFunctions.decodeJson(requestInstance.callback_data)

  const buttonPushed = jsonDecoded.label

  const statusMsg = await replyInstance.simpleSendNewMessage(`${buttonPushed}. Выполняется.`,null,null,null)
  let msg;
  try{
    msg = await MdjMethods.executeCustom({
    msgId:jsonDecoded.id,
    customId:jsonDecoded.custom,
    content:jsonDecoded.content,
    flags:jsonDecoded.flags
    });
  } catch(err){
    err.code = "MDJ_ERR"
    err.user_message = err.message
    throw err
  }

  let reply_markup = {
    one_time_keyboard: true,
    inline_keyboard: []
  };
  reply_markup = await replyInstance.generateMdjButtons(msg,reply_markup);
  const imageBuffer = await otherFunctions.getImageByUrl(msg.uri);
  
  await replyInstance.deleteMsgByID(statusMsg.message_id)
  await replyInstance.simpleSendNewImage({
    caption:extractTextBetweenDoubleAsterisks(jsonDecoded.content),
    reply_markup:reply_markup,
    contentType:"image/jpeg",
    fileName:`mdj_image_custom_${msg.id}.jpeg`,
    imageBuffer:imageBuffer
});

return {
  imageBuffer:imageBuffer,
  replymsg:msg,
  buttonPushed:buttonPushed
}
};


module.exports = {
  noMessageText,
  unregisterHandler,
  infoacceptHandler,
  resetdialogHandler,
  changeRegimeHandlerPromise,
  sendtoallHandler,
  sendtomeHandler,
  adminHandler,
  settingsOptionsHandler,
  reportsOptionsHandler,
  unregisterAllNotUpToDate,
  textCommandRouter,
  fileRouter,
  textMsgRouter,
  mdj_custom_handler,
  mdj_create_handler,
  generateButtonDescription,
  pdfdownloadHandler,
  messageBlock,
  handleCancelCommand
};
