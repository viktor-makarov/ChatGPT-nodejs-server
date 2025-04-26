const telegramCmdHandler = require("./components/telegramCmdHandler.js");
const openAIApiHandler = require("./components/openAI_API_Handler.js");
const telegramErrorHandler = require("./components/telegramErrorHandler.js");
const mongo = require("./components/mongo");
const msqTemplates = require("./config/telegramMsgTemplates.js");
const ReplyMsg = require("./components/objects/ReplyMsg.js");
const RequestMsg  = require("./components/objects/RequestMsg.js");
const User = require("./components/objects/User.js");
const Dialogue = require("./components/objects/Dialogue.js");
const MdjMethods = require("./components/midjourneyMethods.js");


async function MdjAccountInfo(){
  const info = await MdjMethods.executeInfo()
   console.log(new Date(),"Midjournet account info",info)
}

async function UpdateGlobalVariables() {

    await mongo.setDefaultVauesForNonExiting(); //Должно быть перед get_all_registeredPromise
    console.log(new Date(), "Success! Default values setted");
    const replaceResult = await mongo.replaceProfileValues(true);
    console.log(new Date(), "Success! Replacements performed" ,replaceResult);
}

async function GetModelsFromAPI() {
    const models_array = await openAIApiHandler.getModels(); //обновляем список моделей в базе
    const write_result = await mongo.update_models_listPromise(models_array.data);
    console.log(new Date(), `Success! OpenAI models updated: ${write_result}`);
};
async function setBotParameters(botInstance) {

    await botInstance.setMyCommands(appsettings.telegram_options.commands);
    await botInstance.setMyDescription({description:msqTemplates.bot_description});
    await botInstance.setMyShortDescription({short_description:msqTemplates.bot_description})
    console.log(new Date(),"Success! Bot parameters setted");
 
}

function router(botInstance) {
  botInstance.on("message", (event) => eventRouter(event,botInstance))
  botInstance.on("callback_query", (event) => eventRouter(event,botInstance))
  console.log(new Date(), "Telegram bot started and listening for messages...","TelegramBot options:",botInstance.options);
}

async function eventRouter(event,botInstance){

  let user,requestMsg,replyMsg;
    
  //Слушаем сообщения пользователей
  try {
    
    user = new User(event.from)
    await user.getUserProfileFromDB()

    requestMsg = new RequestMsg({
      requestMsg:event,
      userInstance:user,
      botInstance:botInstance
    });
    
    replyMsg = new ReplyMsg({
      botInstance:botInstance,
      chatId:event?.chat?.id || event?.message?.chat?.id,
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
      requestMsgInstance:requestMsg,
      userInstance:user
    })
    
    await dialogue.getMetaFromDB()
    
    if (process.env.PROD_RUN != "true") {
      requestMsg.print()
    }
   
    let responses = [];

      switch(requestMsg.inputType) {
        case "text_command":
          responses = await telegramCmdHandler.textCommandRouter(requestMsg,dialogue,replyMsg)
          break;
        case "file":
          responses = await telegramCmdHandler.fileRouter(requestMsg,replyMsg,dialogue)
          break;
        case "text_message":
            responses = await telegramCmdHandler.textMsgRouter(requestMsg,replyMsg,dialogue)
            break;

        case "callback_query":
              responses = await telegramCmdHandler.callbackRouter(requestMsg,replyMsg,dialogue)
              break;
        default:
            responses = [{text:msqTemplates.unknown_msg_type}]
    };

  for (const response of responses){
    await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,response?.parse_mode,response?.add_options);
  }

  } catch (err) {
    err.place_in_code = err.place_in_code || "routerTelegram.eventRouter";
    telegramErrorHandler.main(
      {
        replyMsgInstance:replyMsg,
        error_object:err
      }
    );
  }
}

module.exports = {
  router,
  setBotParameters,
  GetModelsFromAPI,
  UpdateGlobalVariables,
  MdjAccountInfo
};
