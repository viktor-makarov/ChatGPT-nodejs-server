const mongo = require("./mongo");
const msqTemplates = require("../config/telegramMsgTemplates");
const modelSettings = require("../config/telegramModelsSettings");
const reports = require("../config/telegramReportsConfig.js");
const otherFunctions = require("./other_func");
const modelConfig = require("../config/modelConfig");
const openAIApiHandler = require("./openAI_API_Handler.js");
const MdjMethods = require("./midjourneyMethods.js");
const aws = require("./aws_func.js")
const FunctionCall  = require("./objects/FunctionCall.js");
const toolsCollection  = require("./objects/toolsCollection.js");

async function messageBlock(requestInstance){
  let responses =[];
  responses.push({text:msqTemplates.message_block,add_options:{reply_parameters:{message_id:requestInstance.msgId}}})
  return responses
}

async function callbackBlock(){
  let responses =[];
  responses.push({text:msqTemplates.callback_block})
  return responses
}

async function fileRouter(requestMsgInstance,replyMsgInstance,dialogueInstance){
  let responses = [];
  
  const current_regime = requestMsgInstance.user.currentRegime

  if(current_regime === "voicetotext"){
        if(requestMsgInstance.fileType === "audio" || requestMsgInstance.fileType === "video_note"){
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
      

      if(current_regime==="translator"){
        await resetTranslatorDialogHandler(requestMsgInstance)
        const devPrompt = otherFunctions.getLocalizedPhrase("translator_prompt",requestMsgInstance.user.language_code)
        await dialogueInstance.commitDevPromptToDialogue(devPrompt)
      } else if (current_regime === "texteditor"){
        await resetTexteditorDialogHandler(requestMsgInstance)
        const devPrompt = otherFunctions.getLocalizedPhrase("texteditor_prompt",requestMsgInstance.user.language_code)
        await dialogueInstance.commitDevPromptToDialogue(devPrompt)
      }

      if(requestMsgInstance.fileType === "audio" || requestMsgInstance.fileType === "video_note"){
        const checkResult = requestMsgInstance.voiceToTextConstraintsCheck()
        if(checkResult.success===0){
          responses.push(checkResult.responce)
          return responses;
      }
        const result = await replyMsgInstance.sendAudioListenMsg()
        const transcript = await openAIApiHandler.VoiceToText(requestMsgInstance)
        replyMsgInstance.text = transcript;
        await replyMsgInstance.simpleMessageUpdate(transcript,
          {
          chat_id:replyMsgInstance.chatId,
          message_id:result.message_id
        })
        await dialogueInstance.commitPromptToDialogue(transcript,requestMsgInstance)
        dialogueInstance.emit('callCompletion')

      } else if(requestMsgInstance.fileType === "document"){
        
        const fileCaption =  requestMsgInstance.fileCaption

        const tgmFileLnk = await requestMsgInstance.getFileLinkFromTgm()

        const isAllowedFileType = requestMsgInstance.isAllowedFileType()

        const s3UploadResult = await uploadFileToS3Handler(requestMsgInstance)

        if(s3UploadResult.success === 0 || !isAllowedFileType){
          //Add info to the dialogue and notify user about problems with the file upload
          await dialogueInstance.commitDevPromptToDialogue(requestMsgInstance.unsuccessfullFileUploadSystemMsg);
          await replyMsgInstance.simpleSendNewMessage(requestMsgInstance.unsuccessfullFileUploadUserMsg,null,"html",null)

        } else {

            const url = s3UploadResult.Location
            const devPrompt = await dialogueInstance.commitFileToDialogue(url)
           // await dialogueInstance.sendSuccessFileMsg(devPrompt)
            if(fileCaption){
              await dialogueInstance.commitPromptToDialogue(fileCaption,requestMsgInstance)
            }
        }

        if(fileCaption){
          dialogueInstance.emit('callCompletion')
        } else if (current_regime === "translator" || current_regime === "texteditor"){
          dialogueInstance.emit('callCompletion')
        }
        
      } else if(requestMsgInstance.fileType === "image"){

        const fileCaption =  requestMsgInstance.fileCaption

        const tgmFileLnk = await requestMsgInstance.getFileLinkFromTgm()

        const isAllowedFileType = requestMsgInstance.isAllowedFileType()

        if(!isAllowedFileType){
          //Add info to the dialogue and notify user about problems with the file upload
          await dialogueInstance.commitDevPromptToDialogue(requestMsgInstance.unsuccessfullFileUploadSystemMsg);
          await replyMsgInstance.simpleSendNewMessage(requestMsgInstance.unsuccessfullFileUploadUserMsg,null,"html",null)

        } else {
            const fileComment = {
              fileid:requestMsgInstance.msgId,
              context:"User has sent the image to the bot.",
              public_url:tgmFileLnk
            }
            if(fileCaption){
              fileComment.user_prompt = fileCaption
            }
            await dialogueInstance.commitImageToDialogue(tgmFileLnk,fileComment)
        }

        if(fileCaption){
          dialogueInstance.emit('callCompletion')
        } else if (current_regime === "translator" || current_regime === "texteditor"){
          dialogueInstance.emit('callCompletion')
        }
      }
      
    } else {
          responses.push({text:msqTemplates.file_handler_wrong_regime})
      }

  return responses
}

async function textMsgRouter(requestMsgInstance,replyMsgInstance,dialogueInstance){
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
      await dialogueInstance.commitPromptToDialogue(requestMsgInstance.text,requestMsgInstance)
      dialogueInstance.emit('callCompletion')
      
    break;
    case "translator":
      await resetTranslatorDialogHandler(requestMsgInstance)
      const devePrompt = otherFunctions.getLocalizedPhrase("translator_prompt",requestMsgInstance.user.language_code)
      await dialogueInstance.commitDevPromptToDialogue(devePrompt)
      await dialogueInstance.commitPromptToDialogue(requestMsgInstance.text,requestMsgInstance)
      dialogueInstance.emit('callCompletion')

    break;
    case "texteditor":
      await resetTexteditorDialogHandler(requestMsgInstance)
      const devPrompt = otherFunctions.getLocalizedPhrase("texteditor_prompt",requestMsgInstance.user.language_code)
      await dialogueInstance.commitDevPromptToDialogue(devPrompt)
      await dialogueInstance.commitPromptToDialogue(requestMsgInstance.text,requestMsgInstance)
      dialogueInstance.emit('callCompletion')

    break;
    }

  return responses
}

async function textCommandRouter(requestMsgInstance,dialogueInstance,replyMsgInstance){

  const cmpName = requestMsgInstance.commandName
  const isRegistered = requestMsgInstance.user.isRegistered
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
          one_time_keyboard: false
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

    const prompt = getPromptFromMsg(requestMsgInstance)

    if(prompt){

    const functionName = "imagine_midjourney"
    const tool_config = await toolsCollection.toolConfigByFunctionName(functionName,dialogueInstance.userInstance)
    const functionArguments = {prompt}    

    const toolCallExtended = {
      tool_call_id:requestMsgInstance.msgId,
      tool_call_index:1,
      tool_call_type:'function',
      function_name:functionName,
      function_arguments:JSON.stringify(functionArguments),
      tool_config
    };

    const functionInstance = new FunctionCall({
      functionCall:toolCallExtended,
      replyMsgInstance:replyMsgInstance,
      dialogueInstance:dialogueInstance,
      requestMsgInstance:requestMsgInstance,
      tokensLimitPerCall:0
    });

    const outcome = await functionInstance.router();

    const placeholders = [{key:"[btnsDsc]",filler:JSON.stringify(outcome.buttonsDescription)}]
    
    const fileComment = {
      midjourney_prompt:prompt,
      public_url:outcome.image_url,
      context:otherFunctions.getLocalizedPhrase("imagine",requestMsgInstance.user.language_code,placeholders)
    }

    await dialogueInstance.commitImageToDialogue(outcome.image_url,fileComment)
    
    } else {
      responses.push({text:msqTemplates.mdj_lacks_prompt})
    }

  } else if(cmpName==="reports"){
    if (!isAdmin) {
      responses.push({text:msqTemplates.reports_no_permission,buttons:{reply_markup: {
        remove_keyboard: true,
      }}})
    } else {
      let response = await reportsOptionsHandler(requestMsgInstance);

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

async function callbackRouter(requestMsg,replyMsg,dialogue){
  let responses =[];

  const callback_event = requestMsg.callback_event;
  const callback_data_input = requestMsg.callback_data;

  await replyMsg.sendTypingStatus()
  
  if (callback_event === "info_accepted"){

    const response = await infoacceptHandler(requestMsg);
    
    responses.push(response)
    requestMsg.user.hasReadInfo = true

  } else if (callback_event === "dwnld_hash") {

    const content = await otherFunctions.decodeJson(callback_data_input)
    const date = new Date()
    const filename = (content?.folded_text || "file") + "_" + date.toISOString() + ".pdf"
    const formatedHtml =  otherFunctions.formatHtml(content.unfolded_text,filename)
    const filebuffer = await otherFunctions.htmlToPdfBuffer(formatedHtml)
    const mimetype = "application/pdf"
    const {sizeBytes,sizeString} = otherFunctions.calculateFileSize(filebuffer)
    otherFunctions.checkFileSizeToTgmLimit(sizeBytes,appsettings.telegram_options.file_size_limit)
    await  replyMsg.sendDocumentAsBinary(filebuffer,filename,mimetype)

  } else if (callback_event === "pdf_download"){

    await pdfdownloadHandler(replyMsg);

  } else if (callback_event === "regenerate"){

    if(requestMsg.user.currentRegime != callback_data_input){
      responses.push(checkResult.response)
      return responses;
    }

    const lastdoc = await dialogue.getLastCompletionDoc()
    lastdoc?.telegramMsgId && await replyMsg.deleteMsgsByIDs(lastdoc.telegramMsgId)
    
    dialogue.regenerateCompletionFlag = true

    dialogue.emit('callCompletion')
  } else if (callback_event === "choose_ver"){

    const doc = await dialogue.getLastCompletionDoc()
    await replyMsg.deleteMsgsByIDs(doc?.telegramMsgId)

    
    const choosenVersionIndex = callback_data_input
    const choosenContent = doc.content[choosenVersionIndex-1]
    const choosenContentFormulas = doc.content_latex_formula[choosenVersionIndex-1]
    const totalVersionsCount = doc.content.length;
    await replyMsg.sendChoosenVersion(choosenContent,choosenContentFormulas,choosenVersionIndex,totalVersionsCount)
    
    await mongo.updateCompletionInDb({
      filter: {telegramMsgId:{"$in":doc.telegramMsgId}},
      updateBody:{
        telegramMsgId:replyMsg.msgIdsForDbCompletion,
        completion_version:choosenVersionIndex
      }
    })

  } else if (callback_event === "latex_formula"){

    const lastdoc = await dialogue.getLastCompletionDoc()
    
   

    const letexObject = lastdoc.content_latex_formula[lastdoc.completion_version-1]
    let pngBuffer;
    try{
    pngBuffer  = await otherFunctions.generateCanvasPNG(letexObject);
    } catch(err){
      let error = new Error(`Error in generating PNG from LaTeX formula: ${err}`)
      error.place_in_code = error.place_in_code || "routerTelegram.on.callback_query.latex_formula.pngBuffer"
      throw error;
    }
    await replyMsg.simpleSendNewImage({
      imageBuffer:pngBuffer,
      fileName: `Формулы.png`,
      contentType: 'image/png',
      caption:`Формулы для ${currentVersionIndex} версии ответа`
    })

  } else if (callback_event === "readaloud"){

    const result = await replyMsg.sendTextToSpeachWaiterMsg()
    await openAIApiHandler.TextToVoice(requestMsg);
    await replyMsg.deleteMsgByID(result.message_id)

  } else if(callback_event === "un_f_up") {

    const contentObject = await otherFunctions.decodeJson(callback_data_input)
    const unfoldedFileSysMsg = msgShortener(contentObject.unfolded_text)
    
    const new_callback_data = {e:"f_f_up",d:callback_data_input}
    
    const fold_button = {
      text: "Скрыть",
      callback_data: JSON.stringify(new_callback_data),
    };
    const downloadPDF_button = {
      text: "Скачать PDF",
      callback_data: JSON.stringify({e:"dwnld_hash",d:callback_data_input}),
    };

    const reply_markup = {
      one_time_keyboard: true,
      inline_keyboard: [[fold_button],[downloadPDF_button]],
    };

    try{
      await replyMsg.simpleMessageUpdate(unfoldedFileSysMsg, {
        chat_id: requestMsg.chatId,
        message_id: requestMsg.refMsgId,
        parse_mode:"HTML",
        reply_markup: reply_markup
      })
  } catch(err){
    if(!err.message.includes('message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')){
      err.place_in_code = err.place_in_code || "routerTelegram.on.callback_query.un_f_up";
      throw err
    }
  }

  } else if(callback_event === "f_f_up"){

    const contentFoldObject = await otherFunctions.decodeJson(callback_data_input)

    const new_callback_data = {e:"un_f_up",d:callback_data_input};

    const unfold_button = {
      text: "Показать подробности",
      callback_data: JSON.stringify(new_callback_data),
    };

    const reply_markup_unfold = {
      one_time_keyboard: true,
      inline_keyboard: [[unfold_button],],
    };
    try{
    await replyMsg.simpleMessageUpdate(contentFoldObject.folded_text, {
      chat_id: requestMsg.chatId,
      message_id: requestMsg.refMsgId,
      parse_mode:"HTML",
      reply_markup: reply_markup_unfold
    })
  } catch(err){
    if(!err.message.includes('message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')){
      err.place_in_code = err.place_in_code || "routerTelegram.on.callback_query.f_f_up";
      throw err
    }
  }

  } else if (callback_event === "settings"){
    try{
      const response = await settingsOptionsHandler(
        requestMsg,
        dialogue
      );

      if(response.operation ==="update"){
      await replyMsg.simpleMessageUpdate(response.text, {
        chat_id: requestMsg.chatId,
        message_id: requestMsg.refMsgId,
        reply_markup: response?.buttons?.reply_markup,
      })
    } else if(response.operation ==="insert"){
      responses.push(response)
    }
    } catch(err){
      console.log(err)
      throw err
    }

  } else if(callback_event === "reports"){

    const response = await reportsOptionsHandler(
                requestMsg
              );
    if(response.operation ==="update"){
    await replyMsg.simpleMessageUpdate(response.text, {
      chat_id: requestMsg.chatId,
      message_id: requestMsg.refMsgId,
      reply_markup: response?.buttons?.reply_markup,
    });

  } else if(response.operation ==="insert"){
    responses.push(response)
  }

  } else if(callback_event === "mdjbtn"){

    const jsonDecoded = await otherFunctions.decodeJson(requestMsg.callback_data)

    const functionName = "custom_midjourney"
    const tool_config = await toolsCollection.toolConfigByFunctionName(functionName,dialogue.userInstance)
    const functionArguments = {
      buttonPushed : jsonDecoded.label,
      msgId: jsonDecoded.id,
      customId: jsonDecoded.custom,
      content: jsonDecoded.content,
      flags: jsonDecoded.flags
    }
    
    const toolCallExtended = {
      tool_call_id:requestMsg.refMsgId,
      tool_call_index:1,
      tool_call_type:'function',
      function_name:functionName,
      function_arguments:JSON.stringify(functionArguments),
      tool_config
    };

    const functionInstance = new FunctionCall({
      functionCall:toolCallExtended,
      replyMsgInstance:replyMsg,
      dialogueInstance:dialogue,
      requestMsgInstance:requestMsg,
      tokensLimitPerCall:0
    });

    const outcome = await functionInstance.router();
    
    const choosenButton = jsonDecoded.label
    const choosenBtnsDescription = otherFunctions.generateButtonDescription([choosenButton],[])
    const placeholders = [{key:"[choosenBtnDsc]",filler:JSON.stringify(choosenBtnsDescription)},{key:"[btnsDsc]",filler:JSON.stringify(outcome.buttonsDescription)}]
    
    const fileComment = {
      context: otherFunctions.getLocalizedPhrase("mdjBtns",requestMsg.user.language_code,placeholders),
      public_url:outcome.image_url,
      midjourney_prompt: outcome.midjourney_prompt
    };
    await dialogue.commitImageToDialogue(outcome.image_url,fileComment)
              
    
  } else {
    responses = [{text:msqTemplates.unknown_callback}]
  }
  return responses

}

function msgShortener(html){
  let new_msg_html = html;
  const overheadSymbolsCount = 100;
  const limit = (appsettings.telegram_options.big_outgoing_message_threshold - overheadSymbolsCount)
  if (html.length > limit){
    new_msg_html = closeUnclosedTags(html.slice(0, limit) + "... (текст сокращен)")
    }
  return new_msg_html
}

function closeUnclosedTags(htmlString) {
  const tags = [];
  const tagPattern = /<([a-zA-Z]+)(\s+[^>]*?)?>|<\/([a-zA-Z]+)>/gi;
  let match;

  // Scan the HTML string from beginning to end
  while ((match = tagPattern.exec(htmlString))) {
      const [fullMatch, group1, group2, group3] = match;
      const tagName = group1 ? group1 : group3
      if (fullMatch.startsWith('</')) {
          // If it's a closing tag, forget the corresponding opening tag
          const tagIndex = tags.lastIndexOf(tagName);
          if (tagIndex !== -1) {
              
              tags.splice(tagIndex, 1);
          }
      } else {
          // Otherwise, remember the opening tag
          tags.push(tagName);
      }
  }
  // Add unclosed tags to the end of the string
  const closingTags = tags.reverse().map(tag => `</${tag}>`).join('');
  return htmlString + closingTags;
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

async function infoacceptHandler(requestMsgInstance) {
    const result = await mongo.insert_read_sectionPromise(requestMsgInstance); // Вставляем новую секцию в базу данных
    return { text: msqTemplates.welcome };
}

async function pdfdownloadHandler(replyMsgInstance){
  
  const downloadedFile = await otherFunctions.fileDownload(appsettings.other_options.pdf_guide_url)
  console.log("downloadedFile",downloadedFile)
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

try{
const downloadStream = await otherFunctions.startFileDownload(requestMsgInstance.fileLink)
const filename = otherFunctions.valueToMD5(String(requestMsgInstance.user.userid))+ "_" + requestMsgInstance.user.currentRegime + "_" + otherFunctions.valueToMD5(String(requestMsgInstance.msgId)) + "." + requestMsgInstance.fileExtention;

let uploadResult  = await aws.uploadFileToS3(downloadStream,filename)
uploadResult.success = 1

return uploadResult
} catch(err){

  requestMsgInstance.uploadFileError = err.message
  requestMsgInstance.unsuccessfullFileUploadUserMsg = `❌ Файл <code>${requestMsgInstance.fileName}</code> не может быть добавлен в наш диалог, т.к. при обработке файла возникла ошибка.`
  const placeholders = [{key:"[fileName]",filler:requestMsgInstance.fileName},{key:"[uploadFileError]",filler:requestMsgInstance.uploadFileError}]
  requestMsgInstance.unsuccessfullFileUploadSystemMsg = otherFunctions.getLocalizedPhrase("file_upload_failed",requestMsgInstance.user.language_code,placeholders)
  
  let uploadResult = {success:0}
  return uploadResult
}
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
        `No match for pattern ${pattern} found in function ${"sendtomeHandler"}.`
      );
      //Tested
      err.code = "RQS_ERR3";
      err.user_message = msqTemplates.sendtome_error;
      err.place_in_code = err.place_in_code || "sendtomeHandler"
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
          `No match for pattern ${pattern} found in function ${"sendtoallHandler"}.`
        );
        //Tested
        err.code = "RQS_ERR3";
        err.user_message = msqTemplates.sendtome_error;
        err.mongodblog = false;
        throw err
      }
   
  } catch (err) {
    //Tested
    err.place_in_code = err.place_in_code || "sendtoallHandler"
    throw err;
  }
}

async function changeRegimeHandlerPromise(obj){
   
   await mongo.updateCurrentRegimeSetting(obj.requestMsgInstance);

      if (obj.newRegime == "chat") {
        const previous_dialogue_tokens = await obj.dialogueInstance.metaGetTotalTokens()

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
              .replace(
                "[response_style]",
                modelSettings[obj.newRegime].options.response_style.options[obj.requestMsgInstance.user.response_style].name
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
            ).replace(
              "[response_style]",
              modelSettings[obj.newRegime].options.response_style.options[obj.requestMsgInstance.user.response_style].name
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
    await aws.deleteS3FilesByPefix(requestMsgInstance.user.userid,requestMsgInstance.user.currentRegime) //to delete tater
    await aws.deleteS3FilesByPefix(otherFunctions.valueToMD5(String(requestMsgInstance.user.userid)),requestMsgInstance.user.currentRegime)
    //И отправляем сообщение пользователю
    return { text: msqTemplates.unregistered };
}

async function createNewFreeAccount(){
  const date = new Date();
  const dateString = date.toString();
  const newToken = otherFunctions.valueToMD5(dateString)

  const result = await mongo.insert_blank_profile(newToken)
  const accountToken = result.token
  return {text:`Используте линк для регистрации в телеграм боте R2D2\nhttps://t.me/${process.env.TELEGRTAM_BOT_NAME}?start=${accountToken}`}
}

async function resetTranslatorDialogHandler(requestMsgInstance) {
  await mongo.deleteDialogByUserPromise([requestMsgInstance.user.userid], "translator");
  await aws.deleteS3FilesByPefix(requestMsgInstance.user.userid,"translator") //to delete tater
  await aws.deleteS3FilesByPefix(otherFunctions.valueToMD5(String(requestMsgInstance.user.userid)),"translator")
  return;
}

async function resetTexteditorDialogHandler(requestMsgInstance) {
  await mongo.deleteDialogByUserPromise([requestMsgInstance.user.userid], "texteditor");
  await aws.deleteS3FilesByPefix(requestMsgInstance.user.userid,"texteditor") //to delete tater
  await aws.deleteS3FilesByPefix(otherFunctions.valueToMD5(String(requestMsgInstance.user.userid)),"texteditor")
  return;
}


async function settingsChangeHandler(requestMsgInstance,dialogueInstance) {

  let callbackArray = [requestMsgInstance.commandName ? requestMsgInstance.commandName : requestMsgInstance.callback_event]

  if(requestMsgInstance.callback_data){
      const callback_data = await otherFunctions.decodeJson(requestMsgInstance.callback_data)
      callbackArray =  callbackArray.concat(callback_data)
    }

    const end_value = callbackArray.pop()
    const pathString = callbackArray.join(".");

    let templateResponseMsg = "";
    let objectToParce = {
      settings: {
        options_desc: msqTemplates.settings_intro,
        options: modelSettings,
      },
    };

    callbackArray.forEach((part) => {
      //Получаем объект, который нужно превратить в кнопки
      templateResponseMsg = objectToParce[part].templateRespMsg;
      objectToParce = objectToParce[part].options;
    });

    const result = await mongo.UpdateSettingPromise(requestMsgInstance, pathString, end_value);

    if(callbackArray.includes("response_style") && callbackArray.includes("chat") && end_value !="neutral"){
      let devPrompt = "";
      devPrompt +=otherFunctions.getLocalizedPhrase("and_now",requestMsgInstance.user.language_code)
      devPrompt += otherFunctions.getLocalizedPhrase("response_style_"+end_value,requestMsgInstance.user.language_code)
      await dialogueInstance.commitDevPromptToDialogue(devPrompt)
    }

    //console.log("Обновление результатов",result)
    return {operation:"insert",text:templateResponseMsg.replace("[value]", objectToParce[end_value].name)}
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

      settingsKeyboard = await otherFunctions.optionsToButtons(
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

async function settingsOptionsHandler(requestMsgInstance,dialogueInstance) {

    let callback_data_array = [requestMsgInstance.commandName ? requestMsgInstance.commandName : requestMsgInstance.callback_event]
    if(requestMsgInstance.callback_data){
      const callback_data = await otherFunctions.decodeJson(requestMsgInstance.callback_data)
      callback_data_array =  callback_data_array.concat(callback_data)
    }

    if(callback_data_array.includes("currentsettings")){
      return {operation:"insert", text: msqTemplates.current_settings.replace("[settings]",otherFunctions.jsonToText(requestMsgInstance.user.settings)) };
    } else if (callback_data_array.includes("back")) {
      callback_data_array = callback_data_array.slice(0, callback_data_array.length - 2);
      const callback_data = await otherFunctions.decodeJson(requestMsgInstance.callback_data)
      requestMsgInstance.callback_data = await otherFunctions.encodeJson(callback_data.slice(0, callback_data.length - 2)); //убираем последний участок пути, чтобы переключиться на предыдущий уровень
      //console.log("back trigger",callbackArray)
    }
    
    let settingsKeyboard = [];
    let objectToParce = {
      settings: {
        options_desc: msqTemplates.settings_intro,
        options: modelSettings,
      },
    };

    let msgText = "";
    callback_data_array.forEach((part) => {
      
      //Получаем объект, который нужно превратить в кнопки
      msgText = objectToParce[part].options_desc;
      objectToParce = objectToParce[part]?.options;

    });
    // console.log("final object",JSON.stringify(objectToParce))

    if (objectToParce) {
      //Если объект с опциями существует
      //Обновляем меню
      settingsKeyboard = await otherFunctions.optionsToButtons(
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
      const response = await settingsChangeHandler(requestMsgInstance,dialogueInstance);
      return response;
    }
};

function getPromptFromMsg(requestMsgInstance) {
    // Extract prompt by removing the command and trimming whitespace
  const prompt = requestMsgInstance.text.substring("/imagine".length).trim();
  
  // Check if the prompt exists and is not empty
  if (!prompt || prompt === "") {
    return null
  } else {
    return prompt 
  }
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






module.exports = {
  noMessageText,
  unregisterHandler,
  infoacceptHandler,
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
  pdfdownloadHandler,
  messageBlock,
  callbackBlock,
  handleCancelCommand,
  callbackRouter
};
