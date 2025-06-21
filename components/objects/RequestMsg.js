const modelSettings = require("../../config/telegramModelsSettings");
const msqTemplates = require("../../config/telegramMsgTemplates");
const otherFunctions = require("../common_functions");
const axios = require("axios");
const mime = require('mime-types');
const { Readable } = require("stream");

class RequestMsg{

#botInstance;

#callbackId;
#rawMsg;
#refRawMsg;
#refMsgId;
#text;
#callback_dataRaw;
#callback_event;
#callback_data;
#callback_msgTS;
#user;
#chatId;
#msgId;
#msgTS;
#isForwarded;

#commandName;
#kbdCmds = ["Перезапустить диалог"]
#fromId;
#inputType;

#uploadFileError;
#unsuccessfullFileUploadUserMsg;
#unsuccessfullFileUploadSystemMsg;
#fileType;
#fileName;
#fileCaption;
#fileExtention;
#fileMimeType;
#fileId;
#duration_seconds;
#fileUniqueId;
#fileSize;
#fileLink;

#msgIdsForDbCompletion =[];

constructor(obj) {
   // console.log(obj.requestMsg)
 
    this.#user = obj.userInstance
    this.#botInstance = obj.botInstance

    if(obj.requestMsg.data){

        this.#callbackId = obj.requestMsg.id;
        this.#callback_dataRaw = obj.requestMsg.data
        this.#inputType = "callback_query"
        
        this.#refMsgId = obj.requestMsg.message.message_id
        
        this.#refRawMsg = obj.requestMsg.message
        this.#callback_msgTS = obj.requestMsg.message.date;
        this.#text = obj.requestMsg.message.text;

        const callback_data_obj = JSON.parse(this.#callback_dataRaw)

        this.#callback_event = callback_data_obj.e
        this.#callback_data = callback_data_obj.d

        this.#chatId = obj.requestMsg.message.chat.id
        this.#fromId = obj.requestMsg.from.id

    } else if(obj.requestMsg.pinned_message) {
        this.#inputType = "pinned_message"
        this.#chatId = obj.requestMsg.chat.id
        this.#fromId = obj.requestMsg.from.id
        this.#msgId = obj.requestMsg.message_id
        this.#msgTS = obj.requestMsg.date
        
       } else {

        this.#chatId = obj.requestMsg.chat.id
        this.#fromId = obj.requestMsg.from.id
        this.#msgId = obj.requestMsg.message_id
        this.#msgIdsForDbCompletion.push(obj.requestMsg.message_id)
        this.#msgTS = obj.requestMsg.date

        if(obj.requestMsg.text){
   
            this.#rawMsg = obj.requestMsg; 

            if(obj.requestMsg.forward_from){
                this.#isForwarded = true;
                this.#text = "\n" + (obj.requestMsg.forward_from.first_name || "" ) + (obj.requestMsg.forward_from.username || "") + ":" + obj.requestMsg?.text;
            } else {
                this.#isForwarded =  false;
                this.#text = obj.requestMsg?.text;
            }  
            
            this.#commandName = this.checkIfCommand(obj.requestMsg)
    
            if(this.#commandName){
                this.#inputType = "text_command"
            } else {
                this.#inputType = "text_message"
            }
            
        } else if(obj.requestMsg.audio){ 
            this.#inputType = "file"
            this.#fileType = "audio"
            this.#duration_seconds = obj.requestMsg?.audio?.duration
            this.#isForwarded = obj.requestMsg?.forward_from ? true : false;
            this.#fileMimeType = obj.requestMsg.audio.mime_type
            this.#fileId = obj.requestMsg.audio.file_id
            this.#fileUniqueId = obj.requestMsg.audio.file_unique_id
            this.#fileSize = obj.requestMsg.audio.file_size
            this.#fileCaption = obj.requestMsg?.caption;
            
        } else if(obj.requestMsg.voice){ 
            this.#inputType = "file"
            this.#fileType = "voice"
            this.#duration_seconds = obj.requestMsg?.voice?.duration
            this.#isForwarded = obj.requestMsg?.forward_from ? true : false;
            this.#fileMimeType = obj.requestMsg.voice.mime_type
            this.#fileId = obj.requestMsg.voice.file_id
            this.#fileUniqueId = obj.requestMsg.voice.file_unique_id
            this.#fileSize = obj.requestMsg.voice.file_size
            this.#fileCaption = obj.requestMsg?.caption;
            
        } else if(obj.requestMsg.video_note){ 
            this.#inputType = "file"
            this.#fileType = "video_note"
            this.#duration_seconds = obj.requestMsg?.video_note?.duration
            this.#isForwarded = obj.requestMsg?.forward_from ? true : false;
            this.#fileMimeType = "video_note"
            this.#fileId = obj.requestMsg.video_note.file_id
            this.#fileUniqueId = obj.requestMsg.video_note.file_unique_id
            this.#fileSize = obj.requestMsg.video_note.file_size    
            this.#fileCaption = obj.requestMsg?.caption;

        } else if(obj.requestMsg.video){ 
            this.#inputType = "file"
            this.#fileType = "video"
            this.#fileName = obj.requestMsg.video?.file_name
            this.#duration_seconds = obj.requestMsg?.video?.duration
            this.#isForwarded = obj.requestMsg?.forward_from ? true : false;
            this.#fileMimeType = obj.requestMsg.video.mime_type
            this.#fileId = obj.requestMsg.video.file_id
            this.#fileUniqueId = obj.requestMsg.video.file_unique_id
            this.#fileSize = obj.requestMsg.video.file_size    
            this.#fileCaption = obj.requestMsg?.caption;
            
        } else if(obj.requestMsg.photo){
            
            this.#inputType = "file"
            this.#fileType = "image"
            this.#isForwarded = obj.requestMsg?.forward_from ? true : false;
            const photoParts = obj.requestMsg.photo
            const lastPart = photoParts.at(-1)
            this.#fileId = lastPart.file_id
            this.#fileUniqueId = lastPart.file_unique_id
            this.#fileSize = lastPart.file_size
            this.#fileCaption = obj.requestMsg?.caption;

            
        } else if(obj.requestMsg.document){ 
            
            this.#inputType = "file"
            this.#fileType = "document"
            this.#isForwarded = obj.requestMsg?.forward_from ? true : false;
            this.#fileName = obj.requestMsg.document?.file_name
            this.#fileExtention = otherFunctions.extractFileExtention(this.#fileName)
            this.#fileMimeType = obj.requestMsg.document?.mime_type
            this.#fileId = obj.requestMsg.document?.file_id
            this.#fileUniqueId = obj.requestMsg.document?.file_unique_id
            this.#fileSize = obj.requestMsg.document?.file_size
            this.#fileCaption = obj.requestMsg?.caption;

        } else {
            this.#inputType = "unknown"
            console.log("Unknown input type")
        }

    }
    
    //console.log("inputType",this.#inputType)
  };

extractFileExtention(fileName){

    const parts = fileName.split('.');
    if (parts.length < 2 || (parts.length === 2 && parts[0] === '')) {
        return '';
    };

    return parts[parts.length-1];
}

extractFileNameFromURL(fileLink){

    const parts = fileLink.split('/');
    if (parts.length < 2 || (parts.length === 2 && parts[0] === '')) {
        return '';
    };

    return parts[parts.length-1]
}



authenticateRequest(){

    const commandName = this.#commandName
    const callback_event = this.#callback_event
    const isRegistered = this.#user.isRegistered
    const profileIsActive = this.#user.active
    const userHasReadInfo = this.#user.hasReadInfo

    if(commandName && commandName === "start"){
        return {passed:true}
    }

    if(callback_event && callback_event === "info_accepted"){
        return {passed:true}
    }

    if(callback_event && callback_event === "manualToPDF"){
        return {passed:true}
    }

    if(!isRegistered){
        return {passed:false,response:[{text:msqTemplates.no_profile_yet}]}
    }

    if(!profileIsActive){
        return {passed:false,response:[{text:msqTemplates.profile_deactivated}]}
    }

    if(!userHasReadInfo){
        return {passed:false,response:[
            {text:this.guideHandler().text,buttons:this.guideHandler()?.buttons,parse_mode:this.guideHandler()?.parse_mode},
            {text:this.acceptHandler().text,buttons:this.acceptHandler()?.buttons}
        ]}
    };
    return {passed:true}
}

guideHandler() {

    const callback_data = {e:"manualToPDF"}
    return {
      text: msqTemplates.info,
      parse_mode:"html",
      buttons:{
      reply_markup: {
        inline_keyboard: [
          [{ text: "Скачать PDF", callback_data: JSON.stringify(callback_data) }],
        ],
      },
    }
    };
}

acceptHandler(){
    const callback_data = {e:"info_accepted"}
    return {
      text: msqTemplates.info_accept,
      buttons:{
        reply_markup: {
          inline_keyboard: [
            [{ text: "Подтверждаю", callback_data: JSON.stringify(callback_data) }],
          ],
        },
      },
    };

  }

async getChat(){
    return await this.#botInstance.getChat(this.#chatId)
}

async getChatMember(){
    return await this.#botInstance.getChatMember(this.#chatId,this.#user.userid)
}
  


async getFileLinkFromTgm(){
    
    try{
    this.#fileLink = await this.#botInstance.getFileLink(this.#fileId)
    } catch(err){
        this.#uploadFileError = err.message
        this.#unsuccessfullFileUploadUserMsg = `❌ Файл <code>${this.#fileName}</code> не может быть добавлен в наш диалог, т.к. он имеет слишком большой размер.`
        const placeholders = [{key:"[fileName]",filler:this.#fileName},{key:"[uploadFileError]",filler:this.#uploadFileError}]
        this.#unsuccessfullFileUploadSystemMsg = otherFunctions.getLocalizedPhrase("file_upload_failed",this.#user.language_code,placeholders)
        return null
    }
    this.#fileName = this.#fileName ? this.#fileName : otherFunctions.extractFileNameFromURL(this.#fileLink)
    this.#fileExtention = otherFunctions.extractFileExtention(this.#fileName)
    this.#fileMimeType = this.#fileMimeType ? this.#fileMimeType : mime.lookup(this.#fileName)
    
    return this.#fileLink
};

isAllowedFileType(){
    const prohibitedMimeTypes = appsettings.file_options.prohibited_mime_types

    if(prohibitedMimeTypes.includes(this.#fileMimeType)){
        this.#uploadFileError = `Files with mime types ${prohibitedMimeTypes.join(", ")} are not allowed to upload to the dialogue}`
        this.#unsuccessfullFileUploadUserMsg = `❌ Файл <code>${this.#fileName}</code> не может быть добавлен в наш диалог. К сожалению, файлы <code>${prohibitedMimeTypes.join(", ")}</code> не обрабатываются.`
        const placeholders = [{key:"[fileName]",filler:this.#fileName},{key:"[prohibitedMimeTypes]",filler:prohibitedMimeTypes.join(", ")}]
        this.#unsuccessfullFileUploadSystemMsg = otherFunctions.getLocalizedPhrase("file_upload_unsupported_format",this.#user.language_code,placeholders)
        return false
    } else {
        return true
    }
}

async audioReadableStreamFromTelegram(){
    const response = await axios({
        url: this.#fileLink,
        method: "GET",
        responseType: "arraybuffer",
      });
    const fileData = Buffer.from(response.data, "binary");  
    var audioReadStream = Readable.from(fileData);
    const fileLinkParts = this.#fileLink.split("/")
    const fileName = otherFunctions.extentionNormaliser(fileLinkParts[fileLinkParts.length-1],this.#fileMimeType)
    audioReadStream.path = fileName;
    return audioReadStream
};


print(){
    console.log(
        "Request: ",
        this.#inputType,
        "chatId",
        this.#chatId,
        "fromId",
        this.#fromId,
        "msg.id",
        this.#msgId,
        "timestemp",
        new Date(),
        "msg.lenght",
        (this.#text || "").length
      )

}

checkIfCommand(message) {

    if(!message.text){
        return null;
    } else if (message.text.startsWith('/')) {
        return message.text.split(' ')[0].substring(1);
    } else if (this.#kbdCmds.includes(message.text)) {
        return message.text 
    }
    return null;
  }


get fileMimeType(){
    return this.#fileMimeType
}

get fileType(){
    return this.#fileType
}

get isForwarded(){
    return this.#isForwarded
}

get uploadFileError(){
    return this.#uploadFileError
}

set uploadFileError(value){
    this.#uploadFileError = value
}



get unsuccessfullFileUploadUserMsg(){
    return this.#unsuccessfullFileUploadUserMsg
}

set unsuccessfullFileUploadUserMsg(value){
    this.#unsuccessfullFileUploadUserMsg = value
}

get unsuccessfullFileUploadSystemMsg(){
    return this.#unsuccessfullFileUploadSystemMsg
}

set unsuccessfullFileUploadSystemMsg(value){
    this.#unsuccessfullFileUploadSystemMsg = value
}

get botInstance(){
    return this.#botInstance
}

get user(){
    return this.#user;
}

get duration_seconds(){
   return this.#duration_seconds
}

get msgIdsForDbCompletion() {
    return this.#msgIdsForDbCompletion
}

get msg(){
    return this.#rawMsg
}
get fromId(){
    return this.#fromId
}

get chatId(){
    return this.#chatId
}

get callback_dataRaw(){
    return this.#callback_dataRaw
}
get callback_msgTS(){
    return this.#callback_msgTS
}

get callback_event(){
    return this.#callback_event
}
get callback_data(){
    return this.#callback_data
}

set callback_data(value){
    this.#callback_data = value
}

get callbackId(){
    return this.#callbackId
}

get msgId(){
    return this.#msgId
}

get fileLink(){
    return this.#fileLink
}
get fileSize(){
    return this.#fileSize
}

get fileName(){
    return this.#fileName
}

get fileCaption(){
    return this.#fileCaption
}

get fileExtention(){
    return this.#fileExtention
}

get msgTS(){
    return this.#msgTS
}

get refMsgId(){
    return this.#refMsgId
}

get inputType(){
    return this.#inputType
}

get commandName(){
    return this.#commandName
}

get text(){
    return this.#text
}


};



module.exports = RequestMsg;