const mongo = require("./mongo");
const msqTemplates = require("../config/telegramMsgTemplates");
const otherFunctions = require("./other_func");



async function main(obj){

  const replyMsgInstance = obj.replyMsgInstance
  let err = obj.error_object || {}
  err.mongodblog = err.mongodblog || true //Log to MongoDB by default
  
try{

    err.userid = replyMsgInstance?.user?.userid || null;
    err = enrichErrorObject(err)

//Log to mongodb
const error_to_log  = createErrorObject(err);
if(err.mongodblog){
const doc = await mongo.insert_error_logPromise(error_to_log)
err.mongodblog_id = doc._id
} else {
err.mongodblog_id = "was not logges to mongodb  - not needed"  
}

//Log to console
if(err.consolelog){
    console.log(new Date(),"Error:","Internal code: ",err.internal_code,"Original code:", err.code,"Message: ",err.message,"\nLog id in mongo db: ",err.mongodblog_id,"\nStack: ",err.stack)
}

//Send message to user

if(err.sendToUser){
    err.sendToUserText = "❗️" + " " + (err.user_message || msqTemplates.error_strange)
    if(err.mongodblog){
    err.sendToUserText += `\n<pre>Код ошибки: ${err.internal_code}. Запись в логе _id=<code>${err.mongodblog_id}</code></pre>`
    }
    const add_options = {disable_web_page_preview: true}
    const user_msg_result = await replyMsgInstance.simpleSendNewMessage(err.sendToUserText,null,"html",add_options)
}

//Send details to the admin
if( replyMsgInstance.user.isAdmin && err.mongodblog){
    let unfolded_text = JSON.stringify(error_to_log,null,4)
    unfolded_text = otherFunctions.wireHtml(unfolded_text)
    unfolded_text = msgShortener(unfolded_text)

    const unfoldedTextHtml = `<b>Error details:</b>\n${JSON.stringify(error_to_log,null,4)}`
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
    const admin_msg_result = await replyMsgInstance.simpleSendNewMessage(sendToAdminText,replyMarkap,"html",add_options)

}

} catch(error){

    console.log(new Date(),"(1) Error in error handling function (Main).", "Syntax problem:",error)
    console.log(new Date(),"(2) Initial error ", "Internal code: ",err.internal_code,"\nOriginal code:", err.code,"Message: ",err.message,"\nStack: ",err.stack)

}
}

function createErrorObject(error){
    const errorObject = {
        error: {
          original_code: error.code,
          internal_code: error.internal_code,
          message: otherFunctions.wireHtml(error.message),
          message_from_response:otherFunctions.wireHtml(error.message_from_response),
          stack: otherFunctions.wireHtml(error.stack),
          details:otherFunctions.wireHtml(error.details),
          place_in_code: otherFunctions.wireHtml(error.place_in_code),
          user_message: otherFunctions.wireHtml(error.user_message),
        },
        userid:error.userid
      }

    return errorObject
}

function msgShortener(text){
    let new_msg = text;
    const overheadSymbolsCount = 100;
    const limit = (global.appsettings.telegram_options.big_outgoing_message_threshold - overheadSymbolsCount)
    if (text.length > limit){
        new_msg = text.slice(0, limit) + "... (текст сокращен)"

      }
    return new_msg
}

function enrichErrorObject(err){

    if(err.code==="ETELEGRAM"){
        //Handle Telegram errors
        if (err.message.includes("400 Bad Request")) {
            err.internal_code = "TGR_ERR1"
            err.user_message = msqTemplates.telegram_TGR_ERR1}
          else  if (err.message.includes("429 Too Many Requests")) {
                err.internal_code = "TGR_ERR2"
                err.user_message = msqTemplates.telegram_TGR_ERR1
        } else {
            err.internal_code = "TGR_ERR99"
            err.user_message = msqTemplates.telegram_TGR_ERR99
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
    } else if(err.code && err.code.includes("OAI_ERR")){
        //Ничего не меняем
    } else if(err.code && err.code.includes("MDJ_ERR")){

        if (err.message.includes("run out of hours")) {
            err.internal_code = "MDJ_ERR1"
            err.user_message = msqTemplates.MDJ_ERR1
        }  else if (err.message.includes("403")){
            err.internal_code = "MDJ_ERR2"
            err.user_message = msqTemplates.MDJ_ERR2
            err.mongodblog = false //Don't log this error to MongoDB
        }
        //Ничего не меняем
    } else {
        //All other errors
        err.internal_code = "INT_ERR1"
        err.user_message = msqTemplates.INT_ERR
    }

    err.sendToUser = err.user_message ? true : false

    return err
}


module.exports = {
    main: main}