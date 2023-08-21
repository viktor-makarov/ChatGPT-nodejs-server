const mongo = require("./mongo");
const msqTemplates = require("../config/telegramMsgTemplates");

async function main(botInstance,chat_id,err,place_in_code,user_message){

try{

    //Refactor error object
    err.user_message = user_message
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
    } else {
        //All other errors
        err.code = "INT_ERR1"
        err.user_message = msqTemplates.INT_ERR
    }

//Fist we send error to user if needs be
if(err.user_message){
if(botInstance&&chat_id){
    await botInstance.sendMessage(chat_id, err.user_message || msqTemplates.error_strange)
    } else {
        var err = new Error("You forgot to input botInstans, chat_id into error handling function 'main', so message to user cannot be sent.")
        err.code = "INT_ERR2"
        err.user_message = msqTemplates.INT_ERR
        throw err
    }
}

//Secondly log to mongo if needs be.
var doc = new Object();
doc._id = "error was not logged to mongodb."

if(err.mongodblog){
    doc = await mongo.insert_error_logPromise(err, err.message)
    if(botInstance&&chat_id){
        await botInstance.sendMessage(chat_id, "Инфо для администратора. Код ошибки: "+err.code + ". Запись в логе: " + doc._id + ". https://t.me/Truvoruwka")
        } else {
            var err = new Error("You forgot to input botInstans, chat_id into error handling function 'main', so message to user cannot be sent.")
            err.code = "INT_ERR2"
            throw err
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

module.exports = {
    main: main}