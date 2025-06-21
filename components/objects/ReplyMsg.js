const msqTemplates = require("../../config/telegramMsgTemplates");
const EventEmitter = require('events');
const otherFunctions = require("../common_functions");
const ErrorHandler = require("../errorHandler");
const FormData = require("form-data");
const axios = require("axios");

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

#completion_ended = false;
#completionRegenerateButtons;


#versionBtnsAllias = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"]

#msgThreshold = appsettings.telegram_options.big_outgoing_message_threshold;

constructor(obj) {
    super();
    this.#botInstance = obj.botInstance
    this.#chatId = obj.chatId
    this.#user = obj.userInstance

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

async pinChatMessage(msgId){
  return await this.#botInstance.pinChatMessage(this.#chatId, msgId,{disable_notification:true})
}

async unpinAllChatMessages(){
  return await this.#botInstance.unpinChatMessage(this.#chatId)
}

async sendAudioListenMsg(){
 return  await this.sendToNewMessage(msqTemplates.audio_dowload_progess)
}

async sendAudio(readableStream,filename){

      const formData = new FormData();
      formData.append('chat_id', this.#chatId);
      formData.append('audio', readableStream, {filename: filename || 'audio.mp3'});
      const result = await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendAudio`, 
          formData, {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });
      
      return result.data;
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

async sendMessageWithErrorHandling(text, reply_markup, parse_mode, add_options) {
  try {
    const result = await this.simpleSendNewMessage(text, reply_markup, parse_mode, add_options);
    return {success:1, message_id: result.message_id};
  } catch (err) {
    if (err.message.includes("can't parse entities")) {
      try {
        
        const result = await this.simpleSendNewMessage(text, reply_markup, null, add_options);
        err.sendToUser = false
        err.place_in_code = "sendMessageWithErrorHandling_can't_parse_entities";
        ErrorHandler.main({replyMsgInstance:this,error_object:err})
        return {success:1, message_id: result.message_id};
      } catch (retryErr) {
        // Enhance the retry error with details before throwing
        retryErr.mongodblog = true;
        retryErr.details = retryErr.message;
        retryErr.place_in_code = "sendMessageWithErrorHandling_retry";
        throw retryErr;
      }
    }
    
    err.mongodblog = true;
    err.details = err.message;
    err.place_in_code = err.place_in_code || "sendMessageWithErrorHandling";
    throw err;
  }
}

async simpleMessageUpdate(text,options){

  return await this.#botInstance.editMessageText(text, options)
}

async updateMessageWithErrorHandling(text, options) {

  // The options variable is already passed as a parameter, no need to redeclare it.
  options.chat_id = this.#chatId;

  try {
   const result =  await this.#botInstance.editMessageText(text, options)
   return {success:1, message_id: result.message_id};
  } catch (err) {
    if (err.message.includes("can't parse entities")) {
      try {
        const updatedOptions = { ...options };
        delete updatedOptions.parse_mode;
        const result = this.#botInstance.editMessageText(text, updatedOptions);
        err.sendToUser = false
        err.place_in_code = "updateMessageWithErrorHandling_can't_parse_entities"
        ErrorHandler.main({replyMsgInstance:this,error_object:err})
        return {success:1, message_id: result.message_id};
      } catch (retryErr) {
        // Enhance the retry error with details before throwing
        retryErr.mongodblog = true;
        retryErr.details = retryErr.message;
        retryErr.place_in_code = "updateMessageWithErrorHandling_retry";
        throw retryErr;
      }
    } else if (err.message.includes("message is not modified")) {
      err.sendToUser = false
      ErrorHandler.main({replyMsgInstance:this,error_object:err})
      return {success:0, error:err.message};
    }  else if (err.message.includes("ETELEGRAM: 429 Too Many Requests")) {
      const millisecondsToWait = this.extractWaitTimeFromErrorMs(err);
      if(millisecondsToWait>0){
        return {success:0, error:err.message, wait_time_ms:millisecondsToWait};
      } else {
        err.mongodblog = true;
        err.details = err.message;
        err.place_in_code = err.place_in_code || "updateMessageWithErrorHandling_too_many_requests";
        throw err;       
      }
    }
    
    err.mongodblog = true;
    err.details = err.message;
    err.place_in_code = err.place_in_code || "updateMessageWithErrorHandling";
    throw err;
  }
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

async sendDocumentAsBinary(fileBuffer,filename,mimetype,options = {}){ 
  try{

    const fileOptions ={}
    if(filename){
      fileOptions.filename = filename;
    }
    if(mimetype){
      fileOptions.contentType = mimetype;
    }
    await this.#botInstance.sendDocument(this.#chatId, fileBuffer, options, fileOptions);
    
} catch(err){ 
    err.code = "ETELEGRAM";
    err.place_in_code = "sendDocumentAsBinary";
    throw err;
}

}

async sendChoosenVersion(text,version,versionsCount){

  let buttons = {
    one_time_keyboard: true,
    inline_keyboard: [],
  };

  buttons = this.generateVersionButtons(version,versionsCount,buttons)

  const completionContent = await otherFunctions.encodeJson({text})
  
  const redaloudButtons = {
        text: "🔊",
        callback_data: JSON.stringify({e:"readaloud",d:completionContent}),
      };

      const PDFButtons = {
        text: "PDF",
        callback_data: JSON.stringify({e:"respToPDF",d:completionContent}),
      };

      const HTMLButtons = {
        text: "🌐",
        callback_data: JSON.stringify({e:"respToHTML",d:completionContent}),
      };

  const downRow = [redaloudButtons,HTMLButtons,PDFButtons,]

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
    const additionalMsgOptions = {disable_web_page_preview: true};
    let residualText = text;
    const textLastIndex = text.length - 1;
    let startIndex = 0;
    let endIndex = 0;
    let splitIndexes = [];
    while (endIndex < textLastIndex) {
      
      if(residualText.length < this.#msgThreshold){
        endIndex = textLastIndex
        const lineBreakIsUsed = false;
        splitIndexes.push([startIndex,endIndex,lineBreakIsUsed])
      } else {
        const lastNewlineIndex = residualText.lastIndexOf(splitLinesString, this.#msgThreshold);
        const lineBreakIsUsed = lastNewlineIndex === -1 ? false : true
        const cropIndex = lineBreakIsUsed ? lastNewlineIndex : this.#msgThreshold -1;
        residualText = residualText.slice(cropIndex+1);
        endIndex = startIndex + cropIndex;
        splitIndexes.push([startIndex,endIndex,lineBreakIsUsed])
        startIndex = endIndex + 1; 
      }
    }

    const textChunks = [];
    let index = 0;
    for (const [startIndex, endIndex, lineBreakIsUsed] of splitIndexes) {
      
      if (splitIndexes.length === 1) { // Single chunk case - use the entire text
        textChunks.push(text);
        break;
      }
      
      const chunk = text.slice(startIndex, endIndex + 1); // Extract chunk of text
      
      let splitFiller;
          if(index === splitIndexes.length - 1){
            splitFiller = ""
          } else {
            splitFiller = lineBreakIsUsed ? "" : "...";
          }
      textChunks.push(chunk + splitFiller);
      index ++;
    }

    let repairedText = [];
    let prefix = "";
    for (const chunk of textChunks){
      const brokenTags = otherFunctions.findBrokenTags(prefix + chunk);
      repairedText.push(prefix + chunk + brokenTags?.close)
      prefix = brokenTags?.open ?? ""; //it will be used for text in the next chunk
    }

    const sendOptions = repairedText.map((text, index) => {
      const conversionResult = otherFunctions.convertMarkdownToLimitedHtml(text,this.#user.language_code);
      const isLastChunk = index === repairedText.length - 1;
      return [conversionResult.html,isLastChunk ? reply_markup : null,parse_mode,additionalMsgOptions];
    });

    let results = []
    for (const [html,reply_markup,parse_mode,add_options] of sendOptions) {
      const result = await this.simpleSendNewMessage(html || "_",reply_markup,parse_mode,add_options)
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

extractWaitTimeFromErrorMs(err){

    const regex = /retry after (\d+)/i;
    const match = err.message.match(regex);
    
    if (match) {
      return match[1]*1000;
    } else {
      return -1; 
    }
}


async sendMdjImage(generateResult,prompt){

  const reply_markup = await this.generateMdjButtonsFromPIAPI(generateResult.mdjMsg);
  
  let sent_result = await this.simpleSendNewImage({
    caption:prompt,
    reply_markup:reply_markup,
    contentType:"image/png",
    fileName:`mdj_imagine_${generateResult.mdjMsg.id}.png`,
    imageBuffer:generateResult.imageBuffer
  });

  return sent_result
}

async generateMdjButtonsFromPIAPI(msg){

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
      task_type:button.task_type,
      index:button.index,
      zoom_ratio:button.zoom_ratio,
      direction:button.direction,
      prompt:msg.prompt,
      id:msg.id
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