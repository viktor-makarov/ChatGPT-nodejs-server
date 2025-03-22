const msqTemplates = require("../../config/telegramMsgTemplates");
const EventEmitter = require('events');
const otherFunctions = require("../other_func");
const { Deadline } = require("aws-sdk");

class ReplyMsg extends EventEmitter {

#callbackId;
#botInstance ;
#text = "";
#textLength = 0;
#textToSend = "";
#textToSendLength = 0;
#textSent = "";
#waitMsgInProgress = false;
#sentTextIndex = 0;
#user;
#chatId;
#lastMsgSentId
#msgIdsForDbCompletion =[];
#sendAttempts=0;
#deliverCompletionToTelegramThrottled;
#completion_ended = false;
#completionRegenerateButtons;
#completionRedaloudButtons = {
  text: msqTemplates.readaloud,
  callback_data: JSON.stringify({e:"readaloud"}),
}
;
#completionReplyMarkupTemplate = {
  one_time_keyboard: true,
  inline_keyboard: [],
};
#msgThreshold = appsettings.telegram_options.big_outgoing_message_threshold;

constructor(obj) {
    super();
    this.#botInstance = obj.botInstance
    this.#chatId = obj.chatId
    this.#user = obj.userInstance
    this.#deliverCompletionToTelegramThrottled = this.throttle(this.deliverCompletionToTelegram,appsettings.telegram_options.send_throttle_ms)
    this.#completionRegenerateButtons = 
      {
        text: msqTemplates.regenerate.replace(
          "[temperature]",
          this.#user.currentTemperature
        ),
        callback_data: JSON.stringify({e:"regenerate",d:this.#user.currentRegime}),
      };
};

set text(value){
  this.#text=value
  this.#textLength = this.#text.length
  this.calculateTextToSend()
};

async deliverCompletionToTelegramThrottled(completionInstance){
  await this.#deliverCompletionToTelegramThrottled(completionInstance)
};

calculateTextToSend(){
    this.#textToSend=this.#text.slice(this.#sentTextIndex)
    this.#textToSendLength = this.#textToSend.length
};

wireStingForMarkdown(inputString){
      //Replaces some symbols in a string to alow markdown work properly
  inputString = inputString.replace(/[.*+?^${}()|[\]\\]/g, "\$&");
  // Return the updated input string
  return inputString;
}

set completion_ended(value){
    this.#completion_ended =  value
}

get user(){
  return this.#user;
}

get botInstance(){
    return this.#botInstance
}
get chatId(){
    return this.#chatId;
}

get msgIdsForDbCompletion(){

  return this.#msgIdsForDbCompletion
}

set msgIdsForDbCompletion(value){

  this.#msgIdsForDbCompletion = value
}

get lastMsgSentId(){
    return this.#lastMsgSentId;
}


async sendTypingStatus(){
    await this.#botInstance.sendChatAction(this.#chatId, "typing");
}

async sendAudioListenMsg(){
 return  await this.sendToNewMessage(msqTemplates.audio_dowload_progess)
}

async sendStatusMsg(){
   const result = await this.sendToNewMessage("...")
   this.#msgIdsForDbCompletion.push(result.message_id)
   return result
}

async sendTelegramWaitMsg(seconds){
      const text = msqTemplates.telegram_wait_time.replace(
        "[seconds_to_wait]",
        seconds
      );
       return await this.simpleSendNewMessage(text,null,null)
};

async sendTextToSpeachWaiterMsg(seconds){
  const text = msqTemplates.texttospeech_progress
  return await this.sendToNewMessage(text)
};



async simpleSendNewImage(obj){

  const imageBuffer = obj.imageBuffer
  const fileName = obj.fileName
  const contentType = obj.contentType
  const caption = obj.caption
  const reply_markup = obj.reply_markup

  const options = {
    contentType: contentType ?? 'image/jpeg',
  }

  if(fileName){
    options.filename = fileName
  }

  if(contentType){
    options.contentType = contentType
  }

  if(caption){
    options.caption = caption
  }

  if(reply_markup){
    options.reply_markup = JSON.stringify(reply_markup)
  }


return await this.#botInstance.sendPhoto(
  this.#chatId,
  imageBuffer,
  options
)
}

async simpleSendNewMessage(text,reply_markup,parse_mode){

let options = {}
if(reply_markup){
  options["reply_markup"] = JSON.stringify(reply_markup)
}
if(parse_mode){
  options["parse_mode"] = parse_mode
}


return await this.#botInstance.sendMessage(this.#chatId,text,options)
}

async simpleMessageUpdate(text,options){

  return await this.#botInstance.editMessageText(text, options)
}

async deleteMsgByID(msgId){
  return await this.#botInstance.deleteMessage(this.#chatId, msgId)
}

async deleteMsgsByIDs(msgIds){
  let deleteCount =0;
 
  if(Array.isArray(msgIds) && msgIds.length >0){
    for (const msgId of msgIds){
      const deleted = await this.#botInstance.deleteMessage(this.#chatId, msgId)
      if(deleted){
      deleteCount += 1;
      }
    };
    return deleteCount
  } else {
    return deleteCount;
  }
}

copyValue(object){
  const value = JSON.parse(JSON.stringify(object))
  return value
}

async deletePreviousRegenerateButtons(msgIds){

  if(Array.isArray(msgIds) && msgIds.length>0){
    for (const id of msgIds){
      let reply_markup = this.copyValue(this.#completionReplyMarkupTemplate)
     // reply_markup.inline_keyboard.push(this.#completionRedaloudButtons)
     try{
      await this.#botInstance.editMessageReplyMarkup(
        reply_markup,
        {chat_id:this.#chatId,message_id:id}
    )
  } catch(err){
    
    console.log("error deletion completion msg",id)
  }
    

    }
    this.emit('btnsDeleted', {msgIds:msgIds})

    return msgIds.length
  } else {
    return 0
  }
}

async deleteToolsButtons(msgIds){
  
  if(Array.isArray(msgIds) && msgIds.length>0){
    for (const id of msgIds){
      let reply_markup = {
        one_time_keyboard: true,
        inline_keyboard: [],
      };
     // reply_markup.inline_keyboard.push(this.#completionRedaloudButtons)
     try{
      await this.#botInstance.editMessageReplyMarkup(
        reply_markup,
        {chat_id:this.#chatId,message_id:id}
    )
  } catch(err){

    console.log("error deletion tool msg",id)
  }
    

    }
    return msgIds.length
  } else {
    return 0
  }
}

async sendToNewMessage(text,reply_markup,parse_mode){

        const result = await this.simpleSendNewMessage(text,reply_markup,parse_mode)
        this.#lastMsgSentId = result.message_id
        this.#textSent = result.text

        return result
};

async sendDocumentByUrl(url) {
  await bot.sendDocument(this.#chatId, url);
}

async sendDocumentAsBinary(file,fileName) {

  if(fileName) {
    await bot.sendDocument(this.#chatId, file, {}, { filename: fileName });
  } else {
    await bot.sendDocument(this.#chatId, file);
  }


}

async sendChoosenVersion(text,formulas,version,versionsCount){

  let buttons = this.copyValue(this.#completionReplyMarkupTemplate)
  buttons = this.generateVersionButtons(version,versionsCount,buttons)
  if(formulas){
  buttons = this.generateFormulasButton(buttons)
  }            
  
  buttons.inline_keyboard.push([this.#completionRegenerateButtons])
  buttons.inline_keyboard.push([this.#completionRedaloudButtons])

  const resultObj = otherFunctions.convertMarkdownToLimitedHtml(text)

await this.deliverNewCompletionVersion(resultObj.html,buttons,"HTML")

}

async sendToNewMessageWithCheck(text,reply_markup){

  let results = [];

  const msgExceedsThreshold = text.length > this.#msgThreshold

  if(msgExceedsThreshold){

    const result = await this.simpleSendNewMessage(text.slice(0,this.#msgThreshold)+"...",null,null)
    this.#lastMsgSentId = result.message_id
    this.#textSent = result.text
    results.push(result)
    
    this.sendToNewMessageWithCheck(text.slice(this.#msgThreshold),reply_markup)

  } else {

  const result = await this.simpleSendNewMessage(text,reply_markup,null,null)
  this.#lastMsgSentId = result.message_id
  this.#textSent = result.text
  results.push(result)

  }

  return results

};

async deliverNewCompletionVersion(text,reply_markup,parse_mode){

  let results = [];

  const msgExceedsThreshold = text.length > this.#msgThreshold

  if(msgExceedsThreshold){


    const result = await this.simpleSendNewMessage(text.slice(0,this.#msgThreshold)+"...",null,parse_mode)
    this.#lastMsgSentId = result.message_id
    this.#msgIdsForDbCompletion.push(result.message_id)
    this.#textSent = result.text
    results.push(result)
    
    this.sendToNewMessageWithCheck(text.slice(this.#msgThreshold),reply_markup)

  } else {


  
  const result = await this.simpleSendNewMessage(text,reply_markup,parse_mode)
  this.#lastMsgSentId = result.message_id
  this.#msgIdsForDbCompletion.push(result.message_id)
  this.#textSent = result.text
  results.push(result)

  }

  return results

};

extractWaitTimeFromError(err){

    var seconds_to_wait;
    const errorType = "ETELEGRAM: 429 Too Many Requests"
    if (err.message.includes(errorType)) {
        const regex = /retry after (\d+)/i;
        const match = err.message.match(regex);
        
        if (match) {
          seconds_to_wait = match[1];
        } else {
          err.place_in_code = err.place_in_code || "extractWaitTimeFromError";
          err.details = `Error message doesn't containt "retry after" signpost. Error message: ${err.message}`     
          throw err 
        }

      } else {
        err.place_in_code = err.place_in_code || "extractWaitTimeFromError";
        err.details = `Error other then "ETELEGRAM: 429 Too Many Requests" occured. Error message: ${err.message}`     
        throw err
      }

return seconds_to_wait
}


async generateMdjButtons(msg,reply_markup){

  let version_row_buttons =[]


  const sorted_buttons = appsettings.mdj_options.sorted_buttons
  const exclude_buttons = appsettings.mdj_options.exclude_buttons;
  
  let buttons = msg.options.filter(button => !exclude_buttons.includes(button.label));
  buttons.sort((a, b) => sorted_buttons.indexOf(a.label) - sorted_buttons.indexOf(b.label));
  
  const buttonsCount =  buttons.length

  let i = 1;
  for (const button of buttons){

    const dataJson = {
      label:button.label,
      custom:button.custom,
      content:msg.content,
      id:msg.id,
      flags:msg.flags
    }
    const hash = await otherFunctions.encodeJson(dataJson)

    version_row_buttons.push({
      text: button.label,
      callback_data:JSON.stringify({e:"mdjbtn",d:hash})
    });

    if(i === buttonsCount || i % 2 === 0){
      reply_markup.inline_keyboard.push(version_row_buttons)
      version_row_buttons = [];
    }
    i++; 
  };

  return reply_markup
}

generateVersionButtons(completionCurrentVersionNumber,versionsCount,reply_markup){

  let version_row_buttons =[]
  for (let i = 1; i <= versionsCount; i++){
    
    let versionName = `Вер. ${i.toString()}`
    if(i === completionCurrentVersionNumber){
      versionName = versionName+" (тек.)"
    }
    version_row_buttons.push({
      text: versionName,
      callback_data:JSON.stringify({e:"choose_ver",d:i})
    })

    if(i === versionsCount || i % 2 === 0){
      reply_markup.inline_keyboard.push(version_row_buttons)
      version_row_buttons = [];
    }
  }

return reply_markup
}

generateFormulasButton(reply_markup){

  const buttonName = "Формулы в математическом виде"
      reply_markup.inline_keyboard.push([{
        text: buttonName,
        callback_data:JSON.stringify({e:"latex_formula"})
      }])

return reply_markup
}

async deliverCompletionToTelegram(completionInstance){

        if(this.#completion_ended){
          console.log(new Date(),"deliverCompletionToTelegram invoked. Test part 3.")
        }
        
            let oneMsgText;

            const isValidTextToSend = this.#textToSend && this.#textToSendLength>0 && this.#textToSend != this.#textSent
            if(!isValidTextToSend){
              return
            }

            if(this.#waitMsgInProgress){
              return
            }

            const msgExceedsThreshold = this.#textToSend.length > this.#msgThreshold
            if(msgExceedsThreshold){

                oneMsgText = this.#textToSend.slice(0,this.#msgThreshold) + "..."
                this.#sentTextIndex += this.#msgThreshold
                this.calculateTextToSend()

              
            } else {
                oneMsgText = this.#textToSend
            }

            let options = {
                chat_id:this.#chatId,
                message_id:this.#lastMsgSentId,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            }

            if(options.parse_mode==="HTML"){
              const resultObj = otherFunctions.convertMarkdownToLimitedHtml(oneMsgText)
              oneMsgText = resultObj.html
              completionInstance.completionLatexFormulas = resultObj.latex_formulas

            } else if (options.parse_mode==="Markdown"){
                oneMsgText = this.wireStingForMarkdown(oneMsgText)
            }

            const lastMsgPart = this.#completion_ended && !msgExceedsThreshold


            if (lastMsgPart) {
              
            //Если отправялем последнюю часть сообщения
              let reply_markup = this.copyValue(this.#completionReplyMarkupTemplate)
              if(completionInstance.completionCurrentVersionNumber>1){
                const currentVersionIndex = completionInstance.completionCurrentVersionNumber
                const totalVersionsCount = currentVersionIndex
                reply_markup = this.generateVersionButtons(currentVersionIndex,totalVersionsCount,reply_markup)
              }

              if(completionInstance.completionLatexFormulas){
              reply_markup = this.generateFormulasButton(reply_markup)
              }
              
              reply_markup.inline_keyboard.push([this.#completionRegenerateButtons])
              reply_markup.inline_keyboard.push([this.#completionRedaloudButtons])
              
              options.reply_markup = JSON.stringify(reply_markup);
              
              
              completionInstance.telegramMsgBtns = true;
              }

            try{
            
            var result;
            try{
              result = await this.simpleMessageUpdate(oneMsgText, options)

              if(lastMsgPart){
                this.emit('msgDelivered', {message_id:result.message_id});
              }
            } catch(err){
                if (err.message.includes("can't parse entities")) {
                    delete options.parse_mode;
                    result = await this.#botInstance.editMessageText(oneMsgText, options);
                    if(lastMsgPart){
                      this.emit('msgDelivered', {message_id:result.message_id});
                    }
                  } else {
                
                    err.mongodblog = true;
                    err.details = err.message
                    err.place_in_code = err.place_in_code || "sentToExistingMessage_Handler";
                    throw err
                  }
            }
            this.#textSent = result.text
            
              if(msgExceedsThreshold){
                  await this.sendStatusMsg()
     
                  await this.delay(appsettings.telegram_options.debounceMs)
                  this.deliverCompletionToTelegram(completionInstance)
              }
            } catch(err){
                const secondsToWait =  this.extractWaitTimeFromError(err)
                if(secondsToWait>0){
                    const waitMsgResult = await this.sendTelegramWaitMsg(secondsToWait)
  
                    this.#waitMsgInProgress = true
                    setTimeout(async () => {

                        await this.deleteMsgByID(waitMsgResult.message_id)
                        this.#waitMsgInProgress = false
                        await this.deliverCompletionToTelegram(completionInstance)
                    },secondsToWait * 1000)
                } else {
                    throw err;
                }
            } 
}

async delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async answerCallbackQuery(callbackId){
this.#callbackId = callbackId;
await this.#botInstance.answerCallbackQuery(callbackId);
}

async removeAllButtonsFromMsg(msgId){
    await this.#botInstance.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {chat_id:this.#chatId,message_id:msgId}
    )
}

throttle(fn, delay) {
    let timerId;
    let lastExecutedTime = 0;
  
    return function () {
      return new Promise((resolve) => {
      const context = this;
      const args = arguments;
  
      const execute = function () {
        resolve(fn.apply(context, args));
        lastExecutedTime = Date.now();
      };
  
      if (timerId) {
        clearTimeout(timerId);
      }
    //  console.log(Date.now() - lastExecutedTime)
      if (lastExecutedTime===0){ //first start
        lastExecutedTime = Date.now();
      }
      
      if (Date.now() - lastExecutedTime > delay) {
        execute();
      } else {
        timerId = setTimeout(execute, delay);
      }
    })
    };
  }


};

module.exports = ReplyMsg;