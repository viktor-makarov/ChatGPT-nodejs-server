const mongo = require("./mongo");
const msqTemplates = require("../config/telegramMsgTemplates");
const otherFunctions = require("./other_func");

async function main(obj){

  const replyMsgInstance = obj.replyMsgInstance
  let err = obj.error_object
  let user_message = obj.user_message
  let place_in_code = obj.place_in_code

try{

    //Refactor error object
    err.user_message = user_message
    err.userid = replyMsgInstance.user.userid;
    err.original_code = err.code
    err.place_in_code=place_in_code
    if(err.original_code==="ETELEGRAM"){
        //Handle Telegram errors
        if (err.message.includes("400 Bad Request")) {
            err.code = "TGR_ERR1"
            err.user_message = msqTemplates.telegram_TGR_ERR1}
          else  if (err.message.includes("429 Too Many Requests")) {
                err.code = "TGR_ERR2"
                err.user_message = msqTemplates.telegram_TGR_ERR1
        } else {
            err.code = "TGR_ERR99"
            err.user_message = msqTemplates.telegram_TGR_ERR99
        }
    } else if (err.original_code=="MONGO_ERR"){
        err.code = "MDB_ERR1"
        err.user_message = msqTemplates.DB_ERROR
    } else if(err.original_code && err.original_code.includes("PRM_ERR")){
        //Ничего не меняем

    } else if(err.original_code && err.original_code.includes("RQS_ERR")){
        //Ничего не меняем
    } else if(err.original_code && err.original_code.includes("OAI_ERR")){
        //Ничего не меняем
    } else if(err.original_code && err.original_code.includes("MDJ_ERR")){

        if (err.message.includes("run out of hours")) {
            err.code = "MDJ_ERR1"
            err.user_message = msqTemplates.MDJ_ERR1
        }  else if (err.message.includes("403")){
            err.code = "MDJ_ERR2"
            err.user_message = msqTemplates.MDJ_ERR2
        }
        //Ничего не меняем
    } else {
        //All other errors
        err.code = "INT_ERR1"
        err.user_message = msqTemplates.INT_ERR
    }

//Fist we send error to user if needs be
let user_msg_text,user_msg_result;
if(err.user_message){
if(replyMsgInstance){
    user_msg_text = "❗️" + " " + (err.user_message || msqTemplates.error_strange)
    user_msg_result = await replyMsgInstance.simpleSendNewMessage(user_msg_text,null,"html",null)
    } else {
        var err_local = new Error("You forgot to input replyMsgInstance into error handling function 'main', so message to user cannot be sent.")
        err_local.code = "INT_ERR2"
        err_local.user_message = msqTemplates.INT_ERR
        throw err_local
    }
}

//Secondly log to mongo if needs be.
var doc = new Object();
doc._id = "error was not logged to mongodb."

if(err.mongodblog){
    let errorJSON  = createErrorObject(err);
    doc = await mongo.insert_error_logPromise(errorJSON)
    errorJSON._id = doc._id

    if(user_msg_result){
    if(replyMsgInstance){
                if( replyMsgInstance.user.isAdmin ){
                    let unfolded_text = JSON.stringify(errorJSON,null,4)
                    unfolded_text = otherFunctions.wireHtml(unfolded_text)
                    unfolded_text = msgShortener(unfolded_text)

                    const unfoldedTextHtml = `<b>Error details:</b>\n${JSON.stringify(errorJSON,null,4)}`
                    
                    let infoForUserEncoded = await otherFunctions.encodeJson({unfolded_text:unfoldedTextHtml,folded_text:user_msg_text})
                    const update_msg_options = {
                        chat_id:replyMsgInstance.chatId,
                        message_id:user_msg_result.message_id,
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                        reply_markup:{
                            one_time_keyboard: true,
                            inline_keyboard: [[{
                                text: "Показать подробности",
                                callback_data: JSON.stringify({e:"un_f_up",d:infoForUserEncoded}),
                                }],],
                          }
                    }
                    await replyMsgInstance.simpleMessageUpdate(user_msg_text,update_msg_options)

                } else {
                    const msg_text = "Инфо для администратора. Код ошибки: _id="+err.code + ". Запись в логе: " + doc._id + ". https://t.me/Truvoruwka"
                    await replyMsgInstance.simpleSendNewMessage(msg_text,null,"html",null)
                }
        } else {
            var err_local = new Error("You forgot to input replyMsgInstance into error handling function 'main', so message to user cannot be sent.")
            err_local.code = "INT_ERR2"
            throw err_local
        }
    }
}

//Thirdly we log to console.
if(err.consolelog){
    console.log(new Date(),"Error ", "Code: ",err.code,"Original code:", err.original_code,"Message: ",err.message,"\n Log id in mongo db: ",doc._id,"\nStack: ",err.stack)
}

} catch(error){

    console.log(new Date(),"Error in error handling function (Main).", "Syntax problem:",error)
    console.log(new Date(),"Initial error ", "Code: ",err.code,"\nOriginal code:", err.original_code,"Message: ",err.message,"\nStack: ",err.stack)

}
}

function createErrorObject(error){
    const errorObject = {
        error: {
          code: error.code,
          original_code: error.original_code,
          message: otherFunctions.wireHtml(error.message),
          message_from_response:otherFunctions.wireHtml(error.message_from_response),
          stack: otherFunctions.wireHtml(error.stack),
          details:otherFunctions.wireHtml(error.details),
          place_in_code: otherFunctions.wireHtml(error.place_in_code),
          user_message: otherFunctions.wireHtml(error.user_message),
        },
        userid:error.userid,
        comment: otherFunctions.wireHtml(error.message),
      }

    return errorObject
}

function msgShortener(text){
    let new_msg = text;
    const overheadSymbolsCount = 100;
    const limit = (appsettings.telegram_options.big_outgoing_message_threshold - overheadSymbolsCount)
    if (text.length > limit){
        new_msg = text.slice(0, limit) + "... (текст сокращен)"

      }
    return new_msg
}

module.exports = {
    main: main}