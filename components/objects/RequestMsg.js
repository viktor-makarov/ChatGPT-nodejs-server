const modelSettings = require("../../config/telegramModelsSettings");
const msqTemplates = require("../../config/telegramMsgTemplates");
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
#user;
#chatId;
#msgId;
#msgTS;
#isForwarded;

#commandName;

#fromId;
#inputType;

#fileType;
#fileName;
#fileCaption;
#fileExtention;
#fileMimeType;
#fileId;
#fileUniqueId;
#fileSize;
#voiceToTextFoleSizeLimit = modelSettings.voicetotext.filesize_limit_mb * 1024 * 1024;
#voiceToTextAllowedMimeTypes = modelSettings.voicetotext.mime_types;
#fileLink;

#msgIdsForDbCompletion =[];

constructor(obj) {
 //   console.log(obj.requestMsg)

    this.#user = obj.userInstance
    this.#botInstance = obj.botInstance
    if(obj.requestMsg.data){
        this.#inputType = "call_back"
        this.#callbackId = obj.requestMsg.id;
        this.#callback_dataRaw = obj.requestMsg.data

        this.#refMsgId = obj.requestMsg.message.message_id
        
        this.#refRawMsg = obj.requestMsg.message
        this.#text = obj.requestMsg.message.text;

        const callback_data_obj = JSON.parse(this.#callback_dataRaw)

        this.#callback_event = callback_data_obj.e
        this.#callback_data = callback_data_obj.d

        this.#chatId = obj.requestMsg.message.chat.id
        this.#fromId = obj.requestMsg.from.id

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
            this.#fileMimeType = obj.requestMsg.audio.mime_type
            this.#fileId = obj.requestMsg.audio.file_id
            this.#fileUniqueId = obj.requestMsg.audio.file_unique_id
            this.#fileSize = obj.requestMsg.audio.file_size
            
        } else if(obj.requestMsg.voice){ 
            this.#inputType = "file"
            this.#fileType = "audio"
            this.#fileMimeType = obj.requestMsg.voice.mime_type
            this.#fileId = obj.requestMsg.voice.file_id
            this.#fileUniqueId = obj.requestMsg.voice.file_unique_id
            this.#fileSize = obj.requestMsg.voice.file_size
            
        } else if(obj.requestMsg.video_note){ 
            this.#inputType = "file"
            this.#fileType = "video_note"
            this.#fileMimeType = "video_note"
            this.#fileId = obj.requestMsg.video_note.file_id
            this.#fileUniqueId = obj.requestMsg.video_note.file_unique_id
            this.#fileSize = obj.requestMsg.video_note.file_size    
            
        } else if(obj.requestMsg.photo){
            
            this.#inputType = "file"
            this.#fileType = "image"
            const photoParts = obj.requestMsg.photo
            const lastPart = photoParts[photoParts.length-1]
            this.#fileId = lastPart.file_id
            this.#fileUniqueId = lastPart.file_unique_id
            this.#fileSize = lastPart.file_size
            this.#fileCaption = obj.requestMsg?.caption;

            
        } else if(obj.requestMsg.document){ 
            
            this.#inputType = "file"
            this.#fileType = "document"

            this.#fileName = obj.requestMsg.document?.file_name
            this.#fileExtention = this.extractFileExtention(this.#fileName)
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
    
    console.log("inputType",this.#inputType)
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

voiceToTextConstraintsCheck(){

if(!this.#voiceToTextAllowedMimeTypes.includes(this.#fileMimeType)){
 return {success:0,response:{text:msqTemplates.audiofile_format_limit_error}}
}

if(this.#fileSize > this.#voiceToTextFoleSizeLimit){

    return {success:0,response:{text:msqTemplates.audiofile_format_limit_error.replace(
        "[size]",
        modelSettings.voicetotext.filesize_limit_mb.toString()
      )}}
}

 return {success:1}
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

    if(!isRegistered){
        return {passed:false,response:[{text:msqTemplates.no_profile_yet}]}
    }

    if(!profileIsActive){
        return {passed:false,response:[{text:msqTemplates.profile_deactivated}]}
    }

    if(!userHasReadInfo){
        return {passed:false,response:[
            {text:this.infoHandler().mainText},
            {text:this.infoHandler().acceptText,buttons:this.infoHandler()?.buttons}
        ]}
    };
    
    return {passed:true}

}

infoHandler() {

    const callback_data = {e:"info_accepted"}
    return { 
      mainText: msqTemplates.info,
      acceptText: msqTemplates.info_accept,
      buttons:{
      reply_markup: {
        inline_keyboard: [
          [{ text: "Подтверждаю", callback_data: JSON.stringify(callback_data) }],
        ],
      },
    }};
  }
  
regenerateCheckRegimeCoinsideness(){

if( this.#user.currentRegime != this.#callback_data){
    
    return {success:0,response:{text:msqTemplates.wrong_regime.replace(
        "[regime]",
        modelSettings[this.#callback_data].name
      )}}
 }

 return {success:1}
}

textToSpeechConstraintsCheck(){
    if(this.#text>appsettings.telegram_options.text_to_speach_limit){
        return {success:0,response:{text:msqTemplates.texttospeech_length_error.replace("[limit]",appsettings.telegram_options.text_to_speach_limit)}}
    }
 return {success:1}

}

async getFileLinkFromTgm(){
    this.#fileLink = await this.#botInstance.getFileLink(this.#fileId)
    this.#fileName = this.#fileName ? this.#fileName : this.extractFileNameFromURL(this.#fileLink)
    this.#fileExtention = this.extractFileExtention(this.#fileName)
    this.#fileMimeType = this.#fileMimeType ? this.#fileMimeType : mime.lookup(this.#fileName)
    return this.#fileLink
};


async audioReadableStreamFromTelegram(){
    const response = await axios({
        url: this.#fileLink,
        method: "GET",
        responseType: "arraybuffer",
      });
    const fileData = Buffer.from(response.data, "binary");  
    var audioReadStream = Readable.from(fileData);
    const fileLinkParts = this.#fileLink.split("/")
    audioReadStream.path = fileLinkParts[fileLinkParts.length-1];
    return audioReadStream
};

print(){
    console.log(
        "Request: ",
        "chatId",
        this.#chatId,
        "fromId",
        this.#fromId,
        "msg.id",
        this.#msgId,
        "timestemp",
        new Date(),
        "msg.lenght",
        (this.#text || "").length,
        "msg"
        //,msg.text
      )

}

checkIfCommand(message) {

    if (message.text && message.text.startsWith('/')) {
    return message.text.split(' ')[0].substring(1);
    }
    return null;
  }

isCommand(){

    if(/^\//i.test(this.#text)){
        return true
    } else {
        return false
    }
};

get fileMimeType(){
    return this.#fileMimeType
}

get fileType(){
    return this.#fileType
}

get botInstance(){
    return this.#botInstance
}

get user(){
    return this.#user;
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