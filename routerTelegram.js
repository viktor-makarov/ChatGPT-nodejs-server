const telegramCmdHandler = require("./components/telegramCmdHandler.js");
const openAIApi = require("./components/apis/openAI_API.js");
const elevenLabsApi = require("./components/apis/elevenlabs_API.js");
const telegramErrorHandler = require("./components/telegramErrorHandler.js");
const mongo = require("./components/mongo");
const msqTemplates = require("./config/telegramMsgTemplates.js");
const ReplyMsg = require("./components/objects/ReplyMsg.js");
const RequestMsg  = require("./components/objects/RequestMsg.js");
const User = require("./components/objects/User.js");
const Dialogue = require("./components/objects/Dialogue.js");
const MdjApi = require("./components/apis/midjourney_API.js");
const otherFunctions = require("./components/other_func.js");

async function MdjAccountInfo(){
  const info = await MdjApi.executeInfo()
   console.log(new Date(),"Midjournet account info",info)
}

async function UpdateGlobalVariables() {

    await mongo.setDefaultVauesForNonExiting(); //Должно быть перед get_all_registeredPromise
    console.log(new Date(), "Success! Default values setted");
    const replaceResult = await mongo.replaceProfileValues(false);
    console.log(new Date(), "Success! Replacements performed" ,replaceResult);
}

async function GetLibrariesFromAPIs() {
    const oai_models_array = await openAIApi.getModels(); //обновляем список моделей в базе
    const write_oai_models = await mongo.update_models_listPromise(oai_models_array.data);
    console.log(new Date(), `Success! OpenAI models updated: ${write_oai_models}`);

    const elevenlabs_models_array = await elevenLabsApi.getAvailableModels(); //обновляем список моделей в базе
    global.elevenlabs_models = otherFunctions.arrayToObjectByKey(elevenlabs_models_array,"modelId")
    const write_elevenlabs_models = await mongo.update_elevenlabs_models_list(elevenlabs_models_array);
    if(global.elevenlabs_models[appsettings.text_to_speach.model_id] === undefined){
        throw new Error(`Default model ${appsettings.text_to_speach.model_id} not found in ElevenLabs models list`);
    }
    console.log(new Date(),`Success! ElevenLabs models updated: ${write_elevenlabs_models}`)
    
    const elevenlabs_voices_array = await elevenLabsApi.getAvailableVoices(); //обновляем список голосов в базе
    global.elevenlabs_voices = otherFunctions.arrayToObjectByKey(elevenlabs_voices_array,"name")
    const write_elevenlabs_voices = await mongo.update_elevenlabs_voices_list(elevenlabs_voices_array);
    if(global.elevenlabs_voices[appsettings.text_to_speach.default_voice_name] === undefined){
        throw new Error(`Default voice ${appsettings.text_to_speach.default_voice_name} not found in ElevenLabs voices list`);
    }
    console.log(new Date(),`Success! ElevenLabs voices updated: ${write_elevenlabs_voices}`)

};

async function setBotParameters(botInstance) {

    await botInstance.setMyCommands(appsettings.telegram_options.commands);
    await botInstance.setMyDescription({description:msqTemplates.bot_description});
    await botInstance.setMyShortDescription({short_description:msqTemplates.bot_description})
    const botInfo = await botInstance.getMe();
    await mongo.registerBotUser(botInfo)
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
        case "pinned_message":
              //ignore this type of message
              break
        default:
            responses = [{text:msqTemplates.unknown_msg_type}]
    };

  for (const response of responses){
    const result = await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,response?.parse_mode,response?.add_options);
    if(response.pin){
      try{
        await replyMsg.unpinAllChatMessages()
      } catch(err){
        console.log("Error unpinning messages",err.message)
      }
      await replyMsg.pinChatMessage(result.message_id);
    }
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
  GetLibrariesFromAPIs,
  UpdateGlobalVariables,
  MdjAccountInfo
};
