const telegramCmdHandler = require("./msgRouter.js");
const openAIApi = require("./apis/openAI_API.js");
const elevenLabsApi = require("./apis/elevenlabs_API.js");
const telegramErrorHandler = require("./errorHandler.js");
const mongo = require("./apis/mongo.js");
const msqTemplates = require("../config/telegramMsgTemplates.js");
const ReplyMsg = require("./objects/ReplyMsg.js");
const RequestMsg  = require("./objects/RequestMsg.js");
const User = require("./objects/User.js");
const Dialogue = require("./objects/Dialogue.js");
const MdjApi = require("./apis/midjourney_API.js");
const otherFunctions = require("./common_functions.js");
const modelSettings = require("../config/telegramModelsSettings.js");
const modelConfig = require("../config/modelConfig.js");
const { chat } = require("../config/telegramModelsSettings.js");

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
  botInstance.on("inline_query", (inlineQuery) => inlineQueryRouter(inlineQuery,botInstance))
  botInstance.on("callback_query", (event) => eventRouter(event,botInstance))
  console.log(new Date(), "Telegram bot started and listening for messages...","TelegramBot options:",botInstance.options);
}

async function inlineQueryRouter(inlineQuery,botInstance){
console.log(inlineQuery)

const {query,id} = inlineQuery;


console.log(new Date(),"Inline query received:",query,id);

const answerText = query.length > 0
    ? `Пока данный функционал недоступен.`
    : `Введите вопрос после @${process.env.TELEGRTAM_BOT_NAME}`;

const results = [{
    type: 'article',
    id: 'unique-id-1',
    title: `Ответ бота`,
    description: answerText,
    input_message_content: {
      message_text: answerText,
    },
  }];

await botInstance.answerInlineQuery(id, results);


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

    if(response.operation === "updatePinnedMsg" ){
      user.pinnedHeaderAllowed === true && await updatePinnedMsg(requestMsg,replyMsg)
    } else if (response.operation === "removePinnedMsg"){
      await unpinAllChatMessages(replyMsg)
    } else if(response.operation === "updateSettings") {

      await replyMsg.simpleMessageUpdate(response.text, {
                chat_id: requestMsg.chatId,
                message_id: response?.message_id || requestMsg.msgId,
                reply_markup: response?.buttons?.reply_markup,
                parse_mode: response?.parse_mode,
              })
    } else {
      await replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,response?.parse_mode,response?.add_options)
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

function pinnedMsg(userInstance) {
  const pinnedMSgText = modelSettings[userInstance.currentRegime].header_msg
              .replace(
                "[model]",
                modelConfig[userInstance.currentModel].name
              )
              .replace(
                "[response_style]",
                modelSettings[userInstance.currentRegime]?.options.response_style?.options[userInstance?.response_style ?? "neutral"].name
              )
        return pinnedMSgText
}

async function unpinAllChatMessages(replyMsg){
     try{
        await replyMsg.unpinAllChatMessages()
      } catch(err){
        console.log("Error unpinning messages",err.message)
      }
}

async function updatePinnedMsg(requestMsg,replyMsg) {

      const pinnedMsgText = pinnedMsg(requestMsg.user)

      const chatInfo = await requestMsg.getChat()
      const pinnedMessageId = chatInfo?.pinned_message?.message_id;

      if(pinnedMessageId){       
        try{
            await replyMsg.simpleMessageUpdate(pinnedMsgText, {
                      chat_id: requestMsg.chatId,
                      message_id: pinnedMessageId,
                      parse_mode:"HTML",
                      reply_markup: null
                    })
              return "updated";
        } catch(err){

          if(!err.message.includes("message is not modified")){
            err.sendToUser = false
            err.place_in_code = err.place_in_code || "updatePinnedMsg.updatePinnedMsg";
            telegramErrorHandler.main({replyMsgInstance:replyMsg,error_object:err})
          }
        }
      }
      
      try{
        await replyMsg.unpinAllChatMessages()
      } catch(err){
        console.log("Error unpinning messages",err.message)
      }

      const messageToPin = await replyMsg.sendToNewMessage(pinnedMsgText,null,"HTML",null);
      await replyMsg.pinChatMessage(messageToPin.message_id);
      return "inserted";
}

module.exports = {
  router,
  setBotParameters,
  GetLibrariesFromAPIs,
  UpdateGlobalVariables,
  MdjAccountInfo
};
