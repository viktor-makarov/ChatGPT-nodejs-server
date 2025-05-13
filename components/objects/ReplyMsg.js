const msqTemplates = require("../../config/telegramMsgTemplates");
const EventEmitter = require('events');
const otherFunctions = require("../other_func");
const ErrorHandler = require("../telegramErrorHandler");
const awsApi = require("../AWS_API.js")

class ReplyMsg extends EventEmitter {

#botInstance ;
#text = "";
#text_prefix;
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
  text: "🔊",
  callback_data: JSON.stringify({e:"readaloud"}),
};
#completionReplyMarkupTemplate = {
  one_time_keyboard: true,
  inline_keyboard: [],
};
#versionBtnsAllias = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"]

#msgThreshold = appsettings.telegram_options.big_outgoing_message_threshold;

constructor(obj) {
    super();
    this.#botInstance = obj.botInstance
    this.#chatId = obj.chatId
    this.#user = obj.userInstance
    this.#deliverCompletionToTelegramThrottled = this.throttle(this.deliverCompletionToTelegram,appsettings.telegram_options.send_throttle_ms)
    
    this.#completionRegenerateButtons = 
      {
        text: "🔄",
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

    
    this.#textToSend =  this.#text_prefix ? 
                                this.#text_prefix + this.#text.slice(this.#sentTextIndex)
                                :
                                this.#text.slice(this.#sentTextIndex)
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

async getUrlByTgmFileId(fileId){
  return await this.#botInstance.getFileLink(fileId)
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
       return await this.simpleSendNewMessage(text,null,null,null)
};

async sendTextToSpeachWaiterMsg(){
  const text = msqTemplates.texttospeech_progress
  return await this.sendToNewMessage(text)
};

async sendDocumentDownloadWaiterMsg(){
  const text = otherFunctions.getLocalizedPhrase(`documentDownload_progress`,this.#user.language)
  return await this.sendToNewMessage(text)
};

async sendUserManualWaiterMsg(){
  const text = otherFunctions.getLocalizedPhrase(`manual_file_progress`,this.#user.language)
  return await this.sendToNewMessage(text)
};

async sendLatexFormulaWaiterMsg(){
  const text = otherFunctions.getLocalizedPhrase(`latexFormula_progress`,this.#user.language)
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


async simpleSendNewImageByUrl(obj){
  

  const url = obj.url
  const caption = obj.caption
  const reply_markup = obj.reply_markup

  let options = {}
  
  if(caption){
    options.caption = caption
  }

  if(reply_markup){
    options.reply_markup = JSON.stringify(reply_markup)
  }


return await this.#botInstance.sendPhoto(
  this.#chatId,
  url,
  options
)
}



async simpleSendNewMessage(text,reply_markup,parse_mode,add_options){

let options = {}  
if(add_options){
  options = add_options
}

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

async updateMessageReplyMarkup(msgId,reply_markup){

  await this.#botInstance.editMessageReplyMarkup(
    reply_markup,
    {chat_id:this.#chatId,message_id:msgId}
)
}

async sendToNewMessage(text,reply_markup,parse_mode,add_options){

        const result = await this.simpleSendNewMessage(text,reply_markup,parse_mode,add_options)
        this.#lastMsgSentId = result.message_id
        this.#textSent = result.text

        return result
};

async sendDocumentByUrl(url) {
  await this.#botInstance.sendDocument(this.#chatId, url);
}

async sendDocumentAsBinary(fileBuffer,filename,mimetype) {

  try{

    let options = {};
    if(filename){
      options.filename = filename;
    }
    if(mimetype){
      options.contentType = mimetype;
    }
    await this.#botInstance.sendDocument(this.#chatId, fileBuffer, {}, options);
    
} catch(err){ 
    err.code = "ETELEGRAM";
    err.place_in_code = "sendDocumentAsBinary";
    throw err;
}

}


async sendChoosenVersion(text,formulas,version,versionsCount){

  let buttons = structuredClone(this.#completionReplyMarkupTemplate)
  buttons = this.generateVersionButtons(version,versionsCount,buttons)
  if(formulas){
  buttons = this.generateFormulasButton(buttons)
  }     
  
  const downRow = [this.#completionRedaloudButtons]

  if(versionsCount<10){
    downRow.unshift(this.#completionRegenerateButtons)
  }

  buttons.inline_keyboard.push(downRow)

  return await this.deliverNewCompletionVersion(text,buttons,"HTML")
}

async sendToNewMessageWithCheck(text,reply_markup){

  let results = [];

  const msgExceedsThreshold = text.length > this.#msgThreshold

  if(msgExceedsThreshold){

    const result = await this.simpleSendNewMessage(text.slice(0,this.#msgThreshold)+"...",null,null,null)
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

    const splitLinesString = '\n';
    let residualText = text;
    let startIndex = 0;
    let endIndex = 0;
    let splitIndexes = [];
    while (endIndex < text.length) {
      
      if(residualText.length < this.#msgThreshold){
        endIndex = text.length
        splitIndexes.push([startIndex,endIndex,false])
      } else {
        const lastNewlineIndex = residualText.lastIndexOf(splitLinesString, this.#msgThreshold);
        const lineBreakIsUsed = lastNewlineIndex !== -1
        endIndex = lineBreakIsUsed ? lastNewlineIndex : this.#msgThreshold;
        splitIndexes.push([startIndex,endIndex,lineBreakIsUsed])
        startIndex = endIndex + (lineBreakIsUsed ? splitLinesString.length : 0);
        residualText = residualText.slice(startIndex);
      }
    }

    const textChunks = [];
    for (const [startIndex, endIndex, lineBreakIsUsed] of splitIndexes) {
      
      if (splitIndexes.length === 1) { // Single chunk case - use the entire text
        textChunks.push(text);
        break;
      }
      
      const chunk = text.slice(startIndex, endIndex); // Extract chunk of text
      
      const splitFiller = lineBreakIsUsed ? "" : "...";
      textChunks.push(chunk + splitFiller);
    }

    
    let repairedText = [];
    let prefix = "";
    for (const chunk of textChunks){
      const brokenTags = otherFunctions.findBrokenTags(prefix + chunk);
      repairedText.push(prefix + chunk + brokenTags?.close)
      prefix = brokenTags?.open; //it will be used for text in the next chunk
    }

    const sendOptions = repairedText.map((text, index) => {
      const conversionResult = otherFunctions.convertMarkdownToLimitedHtml(text);
      const isLastChunk = index === repairedText.length - 1;
      return [conversionResult.html,isLastChunk ? reply_markup : null,parse_mode,null];
    });

    let results = []
    for (const [html,reply_markup,parse_mode,add_options] of sendOptions) {
      const result = await this.simpleSendNewMessage(html,reply_markup,parse_mode,add_options)
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

async uploadFileToS3FromTgm(tgmFileId,userInstance){

  const tgm_url = await this.getUrlByTgmFileId(tgmFileId)
  const fileName = otherFunctions.extractFileNameFromURL(tgm_url)
  const fileExtension = otherFunctions.extractFileExtention(fileName)
  const downloadStream = await otherFunctions.startFileDownload(tgm_url)
  const filename = otherFunctions.valueToMD5(String(userInstance.userid))+ "_" + userInstance.currentRegime + "_" + otherFunctions.valueToMD5(String(fileName)) + "." + fileExtension;  

  let uploadResult  = await awsApi.uploadFileToS3(downloadStream,filename)

  return uploadResult.Location
}


async sendMdjImage(generateResult,prompt){

  console.time("sending image")
  const reply_markup = await this.generateMdjButtons(generateResult.mdjMsg);

  let sent_result = await this.simpleSendNewImage({
    caption:prompt,
    reply_markup:reply_markup,
    contentType:"image/jpeg",
    fileName:`mdj_imagine_${generateResult.mdjMsg.id}.jpeg`,
    imageBuffer:generateResult.imageBuffer
  });


  sent_result.aws_url = await this.uploadFileToS3FromTgm(sent_result.photo.at(-1).file_id,this.#user)

  console.timeEnd("sending image")
  return sent_result
}

async generateMdjButtons(msg){

  let version_row_buttons =[]

  let reply_markup = {
    one_time_keyboard: true,
    inline_keyboard: []
  };

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

  const big_picture_url = msg.uri

  if(big_picture_url){
    const btnText = otherFunctions.getLocalizedPhrase(`full_size_image`,this.#user.language)
    reply_markup.inline_keyboard.push([{text:btnText, url:big_picture_url}])
  }

  return reply_markup
}



generateVersionButtons(completionCurrentVersionNumber,versionsCount,reply_markup){

  let version_row_buttons =[]
  const buttonsInOneRow = 5;
  for (let i = 1; i <= versionsCount; i++){
    
    let versionName = `${this.#versionBtnsAllias[i-1] || `Вер. ${i}`}`
    if(i === completionCurrentVersionNumber){
      versionName = `${versionName} 🟢`
    }
    version_row_buttons.push({
      text: versionName,
      callback_data:JSON.stringify({e:"choose_ver",d:i})
    })

    if(i === versionsCount || i % buttonsInOneRow === 0){
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

truncateTextByThreshold(text) {
  
  const splitLinesString = '\n';
  const lastNewlineIndex = text.lastIndexOf(splitLinesString, this.#msgThreshold); //find previous line break for smooth split
  
  const lineBreakIsUsed = lastNewlineIndex !== -1
  const splitIndex = lineBreakIsUsed ? lastNewlineIndex : this.#msgThreshold;

  this.#sentTextIndex += splitIndex + (lineBreakIsUsed ? splitLinesString.length : 0) - (this.#text_prefix ? this.#text_prefix.length : 0);

  const truncatedText = text.slice(0, splitIndex);
 
  const brokenTags = otherFunctions.findBrokenTags(truncatedText);
  this.#text_prefix = brokenTags?.open; //it will be used for text in the next message
  
  const splitFiller = lineBreakIsUsed ? "" : "...";

  return truncatedText + splitFiller + brokenTags?.close;
}

addMissingClosingTags(text){

  const brokenTags = otherFunctions.findBrokenTags(text)
  return text + brokenTags?.close
}

async deliverCompletionToTelegram(completionInstance){

  try{
        if(this.#completion_ended){
          console.log(new Date(),"deliverCompletionToTelegram invoked. Test part 3.")
        }
            let oneMsgText;
            
            const isValidTextToSend = this.#textToSend && this.#textToSendLength>0
            if(!isValidTextToSend){
              return
            }

            if(this.#waitMsgInProgress){
              return
            }

            const msgExceedsThreshold = this.#textToSend.length > this.#msgThreshold
            if(msgExceedsThreshold){

                oneMsgText = this.truncateTextByThreshold(this.#textToSend)
                this.calculateTextToSend()
              
            } else {
                oneMsgText = this.addMissingClosingTags(this.#textToSend)
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
              let reply_markup = structuredClone(this.#completionReplyMarkupTemplate)
              if(completionInstance.completionCurrentVersionNumber>1){

                reply_markup = this.generateVersionButtons(completionInstance.completionCurrentVersionNumber,completionInstance.completionCurrentVersionNumber,reply_markup)
              }

              if(completionInstance.completionLatexFormulas){
              reply_markup = this.generateFormulasButton(reply_markup)
              }
              
                const downRow = [this.#completionRedaloudButtons]

              if(completionInstance.completionCurrentVersionNumber<10){
                downRow.unshift(this.#completionRegenerateButtons)
              }

              reply_markup.inline_keyboard.push(downRow)
              
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
                  } else if (err.message.includes(" message is not modified")){
                    
                    //Do nothing. It just happens)
                  } else {
                    
                    err.mongodblog = true;
                    err.details = err.message
                    err.place_in_code = err.place_in_code || "sentToExistingMessage_Handler";
                    throw err
                  }

                            } 
            
              if(msgExceedsThreshold){
                  await this.sendStatusMsg()
                
                  await otherFunctions.delay(appsettings.telegram_options.debounceMs)
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
          }  catch(err){
            
            ErrorHandler.main(
            {
              replyMsgInstance:this,
              error_object:err
            }
      );
          }
}

async answerCallbackQuery(callbackId){
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