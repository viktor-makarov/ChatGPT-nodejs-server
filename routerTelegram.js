const telegramCmdHandler = require("./components/telegramCmdHandler.js");
const telegramFunctionHandler = require("./components/telegramFunctionHandler.js");
const openAIApiHandler = require("./components/openAI_API_Handler.js");
const modelSettings = require("./config/telegramModelsSettings");
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
    // telegramErrorHandler.main(null,null,err,err.place_in_code,null)
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

  botInstance.on("message", async (msg) => {
    //Слушаем сообщения пользователей
    try {
      const user = new User(msg.from)
      await user.getUserProfileFromDB()

      const requestMsg = new RequestMsg({
        requestMsg:msg,
        userInstance:user,
        botInstance:botInstance
      })

      const replyMsg = new ReplyMsg({
        botInstance:botInstance,
        chatId:msg.chat.id,
        userInstance:user
      });

      const authResult = requestMsg.authenticateRequest()
      if(!authResult.passed){
        for (const response of authResult.response){
          await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,null);
        }
        return
      }

      const dialogue = new Dialogue({
        replyMsgInstance:replyMsg,
        userInstance:user
      })

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
    

    for (const response of responses){
      await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,response?.parse_mode);
    }

      //обрабатываем остальные сообщения, то есть сообщения с текстом.
     
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
      const user = new User(callback_msg.from)

      await user.getUserProfileFromDB()

      const requestMsg = new RequestMsg({
        requestMsg:callback_msg,
        userInstance:user
      })
      const replyMsg = new ReplyMsg({
        botInstance:botInstance,
        chatId:callback_msg.message.chat.id,
        userInstance:user
      });

      const authResult = requestMsg.authenticateRequest()
      if(!authResult.passed){
        for (const response of authResult.response){
          await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,null);
        }
        return
      }

      const dialogue = new Dialogue({
        replyMsgInstance:replyMsg,
        userInstance:user
      })

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

      let responses =[];

        switch(requestMsg.callback_event) {
          case "info_accepted":

            const response_i = await telegramCmdHandler.infoacceptHandler(
              requestMsg
            );

            responses.push(response_i)
            user.hasReadInfo = true

            break;
          case "regenerate":

            const checkResult = requestMsg.regenerateCheckRegimeCoinsideness()
            if(checkResult.success===0){
              responses.push(checkResult.response)
              break;
            }

            await dialogue.getDialogueFromDB()
            const previousVersionMsgIds = dialogue.getLastCompletionTelegramMsgIds()
            
            await replyMsg.deleteMsgsByID(previousVersionMsgIds)
            

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
            await replyMsg.deleteMsgsByID(doc.telegramMsgId)
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
          case "unfold_sysmsg":
              const callsAndReplies = await mongo.getToolCallsAndReplesById(requestMsg.callback_data)

              const unfoldedSysMsg = telegramCmdHandler.formCallsAndRepliesMsg(callsAndReplies,requestMsg.callback_data);
    
              try{
              await replyMsg.simpleMessageUpdate(unfoldedSysMsg.text, {
                chat_id: callback_msg.message.chat.id,
                message_id: callback_msg.message.message_id,
                parse_mode:"HTML",
                reply_markup: unfoldedSysMsg?.reply_markup
              })
            } catch(err){
              if(!err.message.includes('message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')){
                throw err
              }
            }

              break;
          case "fold_sysmsg":
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
          case "reroll":
          await telegramCmdHandler.mdj_reroll_handler(requestMsg,replyMsg)
          break;
          
          default:
              responses = [{text:msqTemplates.unknown_callback}]
        }


      for (const response of responses){
        await replyMsg.sendToNewMessageWithCheck(response.text,response?.buttons?.reply_markup,response?.parse_mode);
      }
      await replyMsg.answerCallbackQuery(requestMsg.callbackId);

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

module.exports = {
  router,
  setBotParameters,
  GetModelsFromAPI,
  UpdateGlobalVariables
};
