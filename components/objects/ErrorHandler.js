const mongo = require("../apis/mongo");
const msqTemplates = require("../../config/telegramMsgTemplates");
const otherFunctions = require("../common_functions");
const { APIError,APIConnectionTimeoutError } = require("openai");

class ErrorHandler {

#replyMsgInstance;
#dialogueInstance;
#userInstance
#userid;
#userLanguageCode;

  constructor({replyMsgInstance, dialogueInstance} = {}) {
    if (!replyMsgInstance) {
      throw new Error(`Reply message instance is required.`);
    }
    this.#replyMsgInstance = replyMsgInstance;
    this.#dialogueInstance = dialogueInstance;
    this.#userid = replyMsgInstance?.user?.userid || null;
    this.#userLanguageCode = replyMsgInstance.user.language_code;
    this.#userInstance = replyMsgInstance.user;
  }

  applyDefaults(err){
    err = err || {}
    err.mongodblog = err.mongodblog ?? true //Log to MongoDB by default

    return err
  }

async handleError(err){

  err = this.applyDefaults(err)

try{
console.log("Error occurred:", err)

err.userid = this.#userid;
err = await this.enrichErrorObject(err)


//Log to mongodb
const error_to_log  = this.createErrorObjectForMongo(err);
if(err.mongodblog){
    const doc = await mongo.insert_error_logPromise(error_to_log)
    err.mongodblog_id = doc._id
} else {
    err.mongodblog_id = "was not logged to mongodb - as it was not required"  
}

//Log to console
if(err.consolelog){
    console.log(new Date(),"Error:","Internal code: ",err.internal_code,"Original code:", err.code,"Message: ",err.message,"\nLog id in mongo db: ",err.mongodblog_id,"\nStack: ",err.stack)
}

//Send message to user
if(err.sendToUser){
    err.sendToUserText = "❗️" + " " + (err.user_message || msqTemplates.error_strange)
    let reply_markup = null;
    if(err.mongodblog){
    const detailsHtml = `<pre>Код ошибки: ${err.internal_code}. Запись в логе _id=<code>${err.mongodblog_id}</code></pre>\n\nПодробности:<pre><code class="json">${JSON.stringify(err.details,null,4)}</code></pre>`
    reply_markup = await this.replyMarkupForDetails(detailsHtml,err.sendToUserText)
    }
  /*  if(this.#replyMsgInstance.lastMsgSentId){
        await this.#replyMsgInstance.simpleMessageUpdate(err.sendToUserText,{
                  chat_id:this.#replyMsgInstance.chatId,
                  message_id:this.#replyMsgInstance.lastMsgSentId,
                  reply_markup:reply_markup,
                  parse_mode: "html"
                })
    }   else {*/
        await this.#replyMsgInstance.simpleSendNewMessage(err.sendToUserText,reply_markup,"html",{disable_web_page_preview: true})
         otherFunctions.logToTempFile(`Error ${new Date()} | ${err.user_message}`,`messageLog.txt`)
        //  }
}

//Add message to dialogue
if(err.systemMsg){
    const systemMsgStr = typeof err.systemMsg === "object" ? JSON.stringify(err.systemMsg) : err.systemMsg
    await this.#dialogueInstance.commitDevPromptToDialogue(systemMsgStr);
}

//Send details to the admin
if( this.#replyMsgInstance.user.isAdmin && err.adminlog && err.mongodblog){
    let unfolded_text = JSON.stringify(error_to_log,null,4)
    unfolded_text = otherFunctions.wireHtml(unfolded_text)

    const unfoldedTextHtml = `<b>Error details:</b>\n<pre><code class="json">${JSON.stringify(error_to_log,null,4)}</code></pre>`
    const sendToAdminText = "Детали ошибки из лога Mongo DB"

    let infoForUserEncoded = await otherFunctions.encodeJson({unfolded_text:unfoldedTextHtml,folded_text:sendToAdminText})
    
    const replyMarkap = {
        one_time_keyboard: true,
        inline_keyboard: [[{
            text: "Показать подробности",
            callback_data: JSON.stringify({e:"un_f_up",d:infoForUserEncoded}),
            }],],
        }
    
    const add_options = {disable_web_page_preview: true}
    const admin_msg_result = await this.#replyMsgInstance.simpleSendNewMessage(sendToAdminText,replyMarkap,"html",add_options)
}

} catch(error){

    console.log(new Date(),"(1) Error in error handling function (Main).", "Syntax problem:",error)
    console.log(new Date(),"(2) Initial error ", "Internal code: ",err.internal_code,"\nOriginal code:", err.code,"Message: ",err.message,"\nStack: ",err.stack)

}
}

async enrichErrorObject(err){

    if(err instanceof APIConnectionTimeoutError){

        console.log(err)
        err.user_message = otherFunctions.getLocalizedPhrase("OAI_timeout",this.#userLanguageCode)
        err.details = err.message
        err.mongodblog = false
        err.consolelog = false
        err.adminlog = false

    } else if(err instanceof APIError ){

        const {error} = err;
        const {message,type,param,code} = error;

        if(type==="invalid_request_error"){

            if(code==="context_length_exceeded"){
                const contentWindowPattern = new RegExp(/input exceeds the context window of this model/);
                const contentIsExceeded = contentWindowPattern.test(message)
                const imageSizeExceededPattern = new RegExp(/image size is (\d+(?:\.\d+)?[KMG]B), which exceeds the allowed limit of (\d+(?:\.\d+)?[KMG]B)/);
                const imageSizeIsExceededMatch = message.match(imageSizeExceededPattern);
                
                if(contentIsExceeded){
                    err.user_message = otherFunctions.getLocalizedPhrase("token_limit_exceeded",this.#userLanguageCode)
                    err.mongodblog = false
                    err.consolelog = false
                    err.adminlog = false
                    const response = await this.#dialogueInstance.resetDialogue()
                    if(this.#replyMsgInstance.lastMsgSentId){
                        await this.#replyMsgInstance.simpleMessageUpdate(response.text,{
                            chat_id:this.#replyMsgInstance.chatId,
                            message_id:this.#replyMsgInstance.lastMsgSentId
                        })
                    }

                } else if(imageSizeIsExceededMatch){

                    const placeholders = [{key:"[actualsize]",filler:imageSizeIsExceededMatch[1]},{key:"[limit]",filler:imageSizeIsExceededMatch[2]}]
                    err.user_message = otherFunctions.getLocalizedPhrase("image_size_exceeded",this.#userLanguageCode,placeholders)
                    err.mongodblog = false
                    err.consolelog = false
                    err.adminlog = false

                    const response = await this.#dialogueInstance.resetDialogue()
                    if(this.#replyMsgInstance.lastMsgSentId){
                        await this.#replyMsgInstance.simpleMessageUpdate(response.text,{
                            chat_id:this.#replyMsgInstance.chatId,
                            message_id:this.#replyMsgInstance.lastMsgSentId
                        })
                    }

                } else {
                    err.internal_code = "OAI_ERR_400"
                    err.user_message = msqTemplates.OAI_ERR_400
                    err.details = error
                    err.mongodblog = true
                    console.log("Unknown OAI context_length_exceeded error:", error)
                }

            } else if(message.includes("MCP approval requests do not have an approval")){
                err.internal_code = "OAI_ERR_400"
                err.user_message = otherFunctions.getLocalizedPhrase("mcp_approval_required",this.#userLanguageCode);
                err.mongodblog = false
                err.adminlog = false

            }else {
                err.internal_code = "OAI_ERR_400"
                err.user_message = msqTemplates.OAI_ERR_400
                err.details = error
                err.mongodblog = true
            }

        } else if(type==="server_error"){
           
          err.internal_code = "OAI_ERR_500"
          err.user_message = msqTemplates.OAI_ERR_500
          err.details = error
          err.mongodblog = true

        } else {

            err.internal_code = "OAI_ERR99"
            err.user_message = msqTemplates.OAI_ERR_500
            err.details = error
            err.mongodblog = true
            console.log("Unknown OAI error:", error)
        }

    } else if(err.code==="ETELEGRAM"){
        //Handle Telegram errors
        if (err.message.includes("400 Bad Request")) {
            err.internal_code = "TGR_ERR1"
            err.user_message = err.user_message || msqTemplates.telegram_TGR_ERR1
            err.consolelog = false
        } else  if (err.message.includes("429 Too Many Requests")) {
            err.internal_code = "TGR_ERR2"
            err.user_message = err.user_message || msqTemplates.telegram_TGR_ERR1
            err.consolelog = false
        } else {
            err.internal_code = "TGR_ERR99"
            err.user_message = err.user_message || msqTemplates.telegram_TGR_ERR99
            err.consolelog = false
        }
    } else if (err.code=="MONGO_ERR"){
        err.internal_code = "MDB_ERR1"
        err.user_message = msqTemplates.DB_ERROR
    } else if(err.code && err.code.includes("PRM_ERR")){
        //Ничего не меняем

    } else if(err.code && err.code.includes("FUNC_TIMEOUT")){
        //Ничего не меняем

    } else if(err.code && err.code.includes("RQS_ERR")){
        //Ничего не меняем
    } else if(err.code && err.code.includes("MDJ_ERR")){

        if (err.message.includes("run out of hours") || err.message.includes("account credit not enough")) {
            err.internal_code = "MDJ_ERR1"
            err.user_message = msqTemplates.MDJ_ERR1
        } else if (err.message.includes("403 ")){
            err.internal_code = "MDJ_ERR2"
            err.user_message = msqTemplates.MDJ_ERR2
            err.mongodblog = false //Don't log this error to MongoDB

        } else if (err.message.includes("You have been temporarily blocked from accessing Midjourney")){
            
            const errorMessage = err.message
            const timestampRegex = /<t:(\d+):R>/;
            const match = errorMessage.match(timestampRegex);
            let placeholders = []
            if (match) {
                const timestamp = parseInt(match[1], 10);
                // Преобразование временной метки в дату
                const date = new Date(timestamp * 1000); // умножаем на 1000 для преобразования в миллисекунды
                // Форматирование даты в удобочитаемый формат
                placeholders.push({key:"[timestamp]",filler:`недоступна до ${date.toLocaleString()} MSK`})
            } else {
                placeholders.push({key:"[timestamp]",filler:`временно недоступна`})
            }

            const userMessage = otherFunctions.getLocalizedPhrase("MDJ_ERR3", this.#userLanguageCode, placeholders)
            err.internal_code = "MDJ_ERR3"
            err.user_message = userMessage
            err.mongodblog = false //Don't log this error to MongoDB
        }
        //Ничего не меняем
    } else {
        //All other errors
        err.internal_code = "INT_ERR1"
        err.user_message = msqTemplates.INT_ERR
    }

    err.sendToUser = err.sendToUser ?? (err.user_message ? true : false)
    err.adminlog = err.adminlog ?? true

    return err
}

createErrorObjectForMongo(error){
    const errorObject = {
        error: {
          original_code: error.code,
          internal_code: error.internal_code,
          message: otherFunctions.wireHtml(error.message),
          message_from_response:otherFunctions.wireHtml(error.message_from_response),
          stack: otherFunctions.wireHtml(error.stack),
          details:otherFunctions.wireHtml(JSON.stringify(error.details,null,4)),
          place_in_code: otherFunctions.wireHtml(error.place_in_code),
          user_message: otherFunctions.wireHtml(error.user_message),
        },
        userid:error.userid
      }

    return errorObject
}

async replyMarkupForDetails(unfoldedtext,foldedText){
let infoForUserEncoded = await otherFunctions.encodeJson({unfolded_text:unfoldedtext,folded_text:foldedText})

const replyMarkup = {
        one_time_keyboard: true,
        inline_keyboard: [[{
            text: "Подробности ошибки",
            callback_data: JSON.stringify({e:"un_f_up",d:infoForUserEncoded}),
        }]],
    }

    return replyMarkup;
}

}


module.exports = ErrorHandler;