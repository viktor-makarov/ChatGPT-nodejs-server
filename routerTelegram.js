const telegramCmdHandler = require("./components/telegramCmdHandler.js");
const openAIApiHandler = require("./components/openAI_API_Handler.js");
const telegramErrorHandler = require("./components/telegramErrorHandler.js");
const mongo = require("./components/mongo");
const msqTemplates = require("./config/telegramMsgTemplates.js");
const otherFunctions = require("./components/other_func");
const ReplyMsg = require("./components/objects/ReplyMsg.js");
const RequestMsg  = require("./components/objects/RequestMsg.js");
const User = require("./components/objects/User.js");
const Dialogue = require("./components/objects/Dialogue.js");
const ToolCalls  = require("./components/objects/ToolCalls.js");

async function UpdateGlobalVariables() {
  try {
    await mongo.setDefaultVauesForNonExiting(); //Должно быть перед get_all_registeredPromise
  } catch (err) {
    err.consolelog = true;
    err.place_in_code = err.place_in_code || arguments.callee.name;
    console.log("UpdateGlobalVariables", err);
    /* telegramErrorHandler.main(
    {
      replyMsgInstance:null,
      error_object:err,
      place_in_code:arguments.callee.name,
      user_message:null
    })*/
  }
}

async function GetModelsFromAPI() {
  try {
    const models_array = await openAIApiHandler.getModels(); //обновляем список моделей в базе
    const write_result = await mongo.update_models_listPromise(
      models_array.body.data
    );
    console.log(new Date(), "Models updated", write_result);
  } catch (err) {
    err.consolelog = true;
    console.log("GetModelsFromAPI", err);
    /* telegramErrorHandler.main(
     {
      replyMsgInstance:null,
      error_object:err,
      place_in_code:arguments.callee.name,
      user_message:err.user_message
    })*/
  }
}
async function setBotParameters(botInstance) {
  try {
    await botInstance.setMyCommands(appsettings.telegram_options.commands);
    await botInstance.setMyDescription(msqTemplates.bot_description);
  } catch (err) {
    err.consolelog = true;
    console.log("setBotParameters", err);
   /* telegramErrorHandler.main(
     {
      replyMsgInstance:null,
      error_object:err,
      place_in_code:arguments.callee.name,
      user_message:null
    })*/
  }
}
function router(botInstance) {

  botInstance.on("message", async (msg) => {

    let user,requestMsg,replyMsg;
    
    //Слушаем сообщения пользователей
    try {
   
      user = new User(msg.from)
      await user.getUserProfileFromDB()

      requestMsg = new RequestMsg({
        requestMsg:msg,
        userInstance:user,
        botInstance:botInstance
      });
      
      replyMsg = new ReplyMsg({
        botInstance:botInstance,
        chatId:msg.chat.id,
        userInstance:user
      });

      const authResult = requestMsg.authenticateRequest()

      if(!authResult.passed){
        for (const response of authResult.response){
          await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,response.parse_mode);
        }
        return
      }

      const dialogue = new Dialogue({
        replyMsgInstance:replyMsg,
        userInstance:user
      })

      await dialogue.getMetaFromDB()
      
      const toolCalls = new ToolCalls({
        replyMsgInstance:replyMsg,
        userInstance:user,
        requestMsgInstance:requestMsg,
        dialogueInstance:dialogue
      })
      
      dialogue.on('callCompletion', () => callCompletion({
        requestMsgInstance:requestMsg, 
        replyMsgInstance:replyMsg,
        dialogueInstance:dialogue,
        toolCallsInstance:toolCalls
      }))

      dialogue.on('triggerToolCall', () => triggerToolCall({
        toolCallsInstance:toolCalls
      }))

      if (process.env.PROD_RUN != "true") {
        requestMsg.print()
      }
      
      let responses;

      const functionInProgress = dialogue.functionInProgress

      if(functionInProgress){

        responses = await telegramCmdHandler.messageBlock(requestMsg)

      } else {

        switch(requestMsg.inputType) {
          case "text_command":
            responses = await telegramCmdHandler.textCommandRouter(requestMsg,dialogue,replyMsg,toolCalls)
            break;
          case "file":
            responses = await telegramCmdHandler.fileRouter(requestMsg,replyMsg,dialogue,toolCalls)
            break;
          case "text_message":
              responses = await telegramCmdHandler.textMsgRouter(requestMsg,replyMsg,dialogue,toolCalls)
              break;
          default:
              responses = [{text:msqTemplates.unknown_msg_type}]
      };
      };

    for (const response of responses){
      await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,response?.parse_mode,response?.add_options);
    }

      //обрабатываем остальные сообщения, то есть сообщения с текстом.
     
    } catch (err) {
      if (err.mongodblog === undefined) {
        err.mongodblog = true;
      }
      err.place_in_code = err.place_in_code || arguments.callee.name;
      telegramErrorHandler.main(
        {
          replyMsgInstance:replyMsg,
          error_object:err,
          place_in_code:err.place_in_code,
          user_message:err.user_message
        }
      );
    }
  });

  botInstance.on("callback_query", async (callback_msg) => {

    let user,requestMsg,replyMsg;
    
    try {

      user = new User(callback_msg.from)

      await user.getUserProfileFromDB()

      requestMsg = new RequestMsg({
        requestMsg:callback_msg,
        userInstance:user
      })
      replyMsg = new ReplyMsg({
        botInstance:botInstance,
        chatId:callback_msg.message.chat.id,
        userInstance:user
      });

      const authResult = requestMsg.authenticateRequest()
      if(!authResult.passed){
        for (const response of authResult.response){
          await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,response.parse_mode);
        }
        return
      }

      const dialogue = new Dialogue({
        replyMsgInstance:replyMsg,
        userInstance:user
      })

      await dialogue.getMetaFromDB()

      const toolCalls = new ToolCalls({
        replyMsgInstance:replyMsg,
        userInstance:user,
        requestMsgInstance:requestMsg,
        dialogueInstance:dialogue
      })

      dialogue.on('callCompletion', () => callCompletion({
        requestMsgInstance:requestMsg, 
        replyMsgInstance:replyMsg,
        dialogueInstance:dialogue,
        toolCallsInstance:toolCalls
      }))

      dialogue.on('fileSystemCommited', () => fileSystemCommited({
        requestMsgInstance:requestMsg, 
        replyMsgInstance:replyMsg,
        dialogueInstance:dialogue
      }))

      dialogue.on('triggerToolCall', () => triggerToolCall({
        toolCallsInstance:toolCalls
      }))

      let responses =[];
      
      await replyMsg.answerCallbackQuery(requestMsg.callbackId);
        switch(requestMsg.callback_event) {
          case "info_accepted":

            const response_i = await telegramCmdHandler.infoacceptHandler(
              requestMsg
            );

            responses.push(response_i)
            user.hasReadInfo = true

            break;

          case "pdf_download":
          
            await telegramCmdHandler.pdfdownloadHandler(replyMsg);

            break;
          case "regenerate":

            const checkResult = requestMsg.regenerateCheckRegimeCoinsideness()
            if(checkResult.success===0){
              responses.push(checkResult.response)
              break;
            }

            await dialogue.getDialogueFromDB()
            const previousVersionMsgIds = dialogue.getLastCompletionTelegramMsgIds()
            console.log("previousVersionMsgIds",previousVersionMsgIds)
            await replyMsg.deleteMsgsByIDs(previousVersionMsgIds)
            
            dialogue.regenerateCompletionFlag = true

            await callCompletion({
              requestMsgInstance:requestMsg, 
              replyMsgInstance:replyMsg,
              dialogueInstance:dialogue,
              toolCallsInstance:toolCalls
          });      

          break;
          case "choose_ver":
          
            await dialogue.getDialogueFromDB()
            const doc = dialogue.getLastCompletionDoc()
            await replyMsg.deleteMsgsByIDs(doc.telegramMsgId)
            await replyMsg.sendTypingStatus()
            const choosenVersionIndex = requestMsg.callback_data
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

            break;
          case "latex_formula":
            
            await dialogue.getDialogueFromDB()
            const lastdoc = dialogue.getLastCompletionDoc()
            
            await replyMsg.sendTypingStatus()
            const currentVersionIndex = lastdoc.completion_version
            const letexObject = lastdoc.content_latex_formula[currentVersionIndex-1]

            const pngBuffer  = await otherFunctions.generateCanvasPNG(letexObject);
            
            await replyMsg.simpleSendNewImage({
              imageBuffer:pngBuffer,
              fileName: `Формулы.png`,
              contentType: 'image/png',
              caption:`Формулы для ${currentVersionIndex} версии ответа`
            })

            
            break;
          case "readaloud":
            const result = await replyMsg.sendTextToSpeachWaiterMsg()
            await openAIApiHandler.TextToVoice(requestMsg);
            await replyMsg.deleteMsgByID(result.message_id)

            break;
                const toolCallFriendlyNameObj = await mongo.getToolCallFriendlyName(requestMsg.callback_data)
                
                const foldedSysMsg = telegramCmdHandler.formFoldedSysMsg(toolCallFriendlyNameObj,requestMsg.callback_data)
              try{
                await replyMsg.simpleMessageUpdate(foldedSysMsg.text, {
                  chat_id: callback_msg.message.chat.id,
                  message_id: callback_msg.message.message_id,
                  reply_markup: foldedSysMsg?.reply_markup
                })
              } catch(err){
                if(!err.message.includes('message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')){
                  throw err
                }
              }
  
          break;
          case "un_f_up":
          
            const hash_unfolded = requestMsg.callback_data
            
            const contentObject = await otherFunctions.decodeJson(hash_unfolded)           

            const unfoldedFileSysMsg = msgShortener(contentObject.unfolded_text)

            const callback_data = {e:"f_f_up",d:hash_unfolded}
            
            const fold_button = {
              text: "Скрыть",
              callback_data: JSON.stringify(callback_data),
            };

            const reply_markup = {
              one_time_keyboard: true,
              inline_keyboard: [[fold_button],],
            };

            try{
              await replyMsg.simpleMessageUpdate(unfoldedFileSysMsg, {
                chat_id: callback_msg.message.chat.id,
                message_id: callback_msg.message.message_id,
                parse_mode:"HTML",
                reply_markup: reply_markup
              })
          } catch(err){
            if(!err.message.includes('message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')){
              throw err
            }
          }
            break;
          case "f_f_up":
              const hash_folded = requestMsg.callback_data
               const contentFoldObject = await otherFunctions.decodeJson(hash_folded)

               const callback_data_fold = {e:"un_f_up",d:hash_folded};
            
               const unfold_button = {
                 text: "Показать подробности",
                 callback_data: JSON.stringify(callback_data_fold),
               };
   
               const reply_markup_unfold = {
                 one_time_keyboard: true,
                 inline_keyboard: [[unfold_button],],
               };
                try{
                await replyMsg.simpleMessageUpdate(contentFoldObject.folded_text, {
                  chat_id: callback_msg.message.chat.id,
                  message_id: callback_msg.message.message_id,
                  parse_mode:"HTML",
                  reply_markup: reply_markup_unfold
                })
              } catch(err){
                if(!err.message.includes('message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')){
                  throw err
                }
              }
  
          break;
          case "settings":
            try{
            const response_s = await telegramCmdHandler.settingsOptionsHandler(
              requestMsg
            );

            if(response_s.operation ==="update"){
            await replyMsg.simpleMessageUpdate(response_s.text, {
              chat_id: callback_msg.message.chat.id,
              message_id: callback_msg.message.message_id,
              reply_markup: response_s?.buttons?.reply_markup,
            })
          } else if(response_s.operation ==="insert"){
            responses.push(response_s)
          }
          } catch(err){
            console.log(err)
            throw err
          }

          break;
          case "reports":

          const response_r = await telegramCmdHandler.reportsOptionsHandler(
            requestMsg
          );

          if(response_r.operation ==="update"){
          await replyMsg.simpleMessageUpdate(response_r.text, {
            chat_id: callback_msg.message.chat.id,
            message_id: callback_msg.message.message_id,
            reply_markup: response_r?.buttons?.reply_markup,
          });
        } else if(response_r.operation ==="insert"){
          responses.push(response_r)
        }

          break;
          case "mdjbtn":
          
          const resultMdj = await telegramCmdHandler.mdj_custom_handler(requestMsg,replyMsg)

          const buttons = resultMdj.replymsg.options
          const labels = buttons.map(button => button.label)
          const buttonsShownBefore = dialogue.metaGetMdjButtonsShown
          const btnsDescription = telegramCmdHandler.generateButtonDescription(labels,buttonsShownBefore)
          await dialogue.metaSetMdjButtonsShown(labels)
          const choosenButton = resultMdj.buttonPushed
          const choosenBtnsDescription = telegramCmdHandler.generateButtonDescription([{label:choosenButton}])         
          const text = `User has pushed the button ${JSON.stringify(choosenBtnsDescription)} and has the following further options ${JSON.stringify(btnsDescription)}`
          await dialogue.commitSystemToDialogue(text)
          
          break;
          default:
              responses = [{text:msqTemplates.unknown_callback}]
        }

      for (const response of responses){
        await replyMsg.sendToNewMessageWithCheck(response.text,response?.buttons?.reply_markup,response?.parse_mode);
      }
      
    } catch (err) {
      if (err.mongodblog === undefined) {
        err.mongodblog = true;
      }
      err.place_in_code = err.place_in_code || arguments.callee.name;
      telegramErrorHandler.main(
        {
          replyMsgInstance:replyMsg,
          error_object:err,
          place_in_code:err.place_in_code,
          user_message:err.user_message
        }
      );
    }
  });
}

async function callCompletion(obj){


  const replyMsgInstance = obj.replyMsgInstance;
  const requestMsgInstance = obj.requestMsgInstance;
  const dialogueInstance = obj.dialogueInstance;
  const toolCallsInstance = obj.toolCallsInstance

  await replyMsgInstance.sendTypingStatus()
  await replyMsgInstance.sendStatusMsg()
  await openAIApiHandler.chatCompletionStreamAxiosRequest(
    requestMsgInstance, 
    replyMsgInstance,
    dialogueInstance,
    toolCallsInstance
  );

}

async function triggerToolCall(obj){
  const toolCallsInstance = obj.toolCallsInstance

  await toolCallsInstance.router()
}

function msgShortener(text){
  let new_msg = text;
  const overheadSymbolsCount = 100;
  const limit = (appsettings.telegram_options.big_outgoing_message_threshold - overheadSymbolsCount)
  if (text.length > limit){
      new_msg = text.slice(0, limit) + "... (текст сокращен)"

    }
  return new_msg
}

module.exports = {
  router,
  setBotParameters,
  GetModelsFromAPI,
  UpdateGlobalVariables
};
