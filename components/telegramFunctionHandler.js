const mongo = require("./mongo");

const func = require("./other_func.js");
const axios = require("axios");


const Jimp = require('jimp');
const msqTemplates = require("../config/telegramMsgTemplates");
const telegramErrorHandler = require("./telegramErrorHandler.js");

async function notifyUser(botInstance,sysmsgOn,full_message,short_message,incoming_msg_id,chat_id,follow_up_msg,format){
//Sends a notification to the user and returns the last message_id

let outcoming_msg_id = incoming_msg_id;
let text_to_send;

try{
    console.log(sysmsgOn,full_message,short_message)
    if(sysmsgOn){ 
        text_to_send = full_message;
    } else {
        text_to_send = short_message;
    };

//Проверям, что длина сообщения поместится в одно сообщения telegram.
if(text_to_send.length>appsettings.telegram_options.big_outgoing_message_threshold){
    text_to_send = text_to_send.substring(0, appsettings.telegram_options.big_outgoing_message_threshold) + msqTemplates.too_long_message
}

if(incoming_msg_id){   //Если есть входящий номер id

       let options = {chat_id:chat_id,message_id: incoming_msg_id,
        disable_web_page_preview: true}
        if(format==="Markdown"){
            options["parse_mode"]="Markdown"
        }
      //Сокдащаем сообщение, если оно превышает димит расмера сообщения телеграм.
        try{
        await botInstance.editMessageText(text_to_send,options)
        } catch(error){
            delete options.parse_mode;
            await botInstance.editMessageText(text_to_send,options)
        };
        if(follow_up_msg){
        const rst = await botInstance.sendMessage(chat_id, follow_up_msg);
        outcoming_msg_id = rst.message_id
        }
} else {
    const rst = await botInstance.sendMessage(chat_id, text_to_send);
    outcoming_msg_id = rst.message_id
    if(follow_up_msg){
    const rst2 = await botInstance.sendMessage(chat_id, follow_up_msg);
    outcoming_msg_id = rst2.message_id}
}


return outcoming_msg_id
} catch (err){
    err.consolelog = true;
    err.place_in_code = err.place_in_code || arguments.callee.name;
    telegramErrorHandler.main(
      botInstance,
      chat_id,
      err,
      err.place_in_code,
      err.user_message
    );
    throw err;
}

};

async function CreateImageRouter(botInstance,function_call,msg,sentMsgIdObj){
    try{

    const arguments = function_call?.function?.arguments

    if(arguments === "" || arguments === null || arguments === undefined){
        return {success:0, error:"No arguments provided. You should provide at least required arguments"};
    } 
    let argumentsjson;
    try{
    argumentsjson = JSON.parse(arguments)   
    } catch(err){
        return {success:0, error:{message: err.message,name: err.name}};
    };
    
    if (argumentsjson.prompt === "" || argumentsjson.prompt === null || argumentsjson.prompt === undefined){
        return {success:0, error:"Prompt param contains no text. You should provide the text."};
    } 
    
    if (argumentsjson.prompt.length > 4000){
        return {success:0, error:`Prompt length exceeds limit of 4000 characters. Please reduce the prompt length.`};
    } 
    
        const prompt = argumentsjson.prompt
        const style = argumentsjson?.style
        const size = argumentsjson?.size
        const sizeArray = ["1024x1024","1792x1024","1024x1792"]
        const styleArray = ["vivid","natural"]

        if(!sizeArray.includes(size)&&size){
            return {success:0, error:`Size param can not have other value than 1024x1024, 1792x1024 or 1024x1792. Please choose one of the three.`};
        }

        if(!styleArray.includes(style)&&style){
            return {success:0, error:`Style param can not have other value than vivid or natural. Please choose one of the two.`};
        }

        const resp = await CreateImage(botInstance,prompt,"dall-e-3",size,style,msg,sentMsgIdObj)

        await botInstance.deleteMessage(msg.chat.id,sentMsgIdObj.sentMsgId);
        const sendResult = await botInstance.sendMessage(msg.chat.id, "...");
        sentMsgIdObj.sentMsgList[function_call?.id]=sendResult.message_id

        functionResult = {
            success:1,
            result:"The image has been generated and successfully sent to the user.", 
            instructions:`Translate the following description of the image in the language of the user's prompt:`+JSON.stringify(resp)
        };
        return functionResult
        
        } catch(err){
            err.place_in_code = err.place_in_code || arguments.callee.name;
            throw err;
        }
    };

async function CreateImage(botInstance,prompt,model,size,style,msg,sentMsgIdObj){
    try {
    
      const options = {
        url: "https://api.openai.com/v1/images/generations",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        validateStatus: function (status) {
          return status == appsettings.http_options.SUCCESS_CODE;
        },
        data: {
          model:model,
          prompt:prompt,
          n: 1,
     //     response_format:"b64_json" 
      }};
      if (size){
        options.data.size = size
      }

      if (style){
        options.data.style = style
      }



       await botInstance.editMessageText("Создаю изображение ...",{chat_id:msg.chat.id,message_id: sentMsgIdObj.sentMsgId})
       const openai_resp = await axios(options);
       let resultList = []; 
       const photoList = openai_resp.data.data

       await botInstance.editMessageText("Сжимаю изображение ...",{chat_id:msg.chat.id,message_id: sentMsgIdObj.sentMsgId})
       if (!(photoList&&photoList.length>0)){
        throw new Error("No image was provided by OpenAI service. Please retry.");
       }

       for (let i = 0; i < photoList.length; i++) {
        const photo = photoList[i]
       // console.log(photo)
     //   const filePath = './img/img-resided_600_600.png';
     //   const readableStream = fs.createReadStream(filePath);
        resultList.push(photo.revised_prompt)

        const response = await axios({
            method: 'get',
            url: photo.url,
            responseType: "arraybuffer"
          });
        const fileData = Buffer.from(response.data, "binary");


        const image = await Jimp.read(fileData)
        const inputWidth = image.bitmap.width
        const inputHeight = image.bitmap.height

        const outputWidth = 240
        const outputHeight = outputWidth*(inputHeight/inputWidth)
        const resizedImage = image.resize(outputWidth, outputHeight);
        const outputBuffer = await resizedImage.getBufferAsync(Jimp.MIME_JPEG);

        await botInstance.sendPhoto(msg.chat.id, outputBuffer,
            {filename: model+'.jpg',
            contentType: 'image/jpeg',
            caption:"Revised_prompt: "+photo.revised_prompt,
            reply_markup: JSON.stringify({ 
                inline_keyboard: [
                  [{ text: 'Открыть в оригинальном размере', url: photo.url}]
                ]
              })
            }
            )

      }
      
        return resultList
    } catch (err){
      if (err.mongodblog === undefined) {
        err.mongodblog = true;
      }
      err.place_in_code = err.place_in_code || arguments.callee.name;
      throw err;
    }
    }



async function get_data_from_mongoDB_by_pipepine(function_call,table_name,tokensLimitPerCall){

    const arguments = function_call?.function?.arguments

    let pipeline = [];
    if(arguments === "" || arguments === null || arguments === undefined){
        return {success:0,error:"No arguments provided.",instructions: "You should provide at least required arguments"}
    } 
    
    try {
        const argumentsjson = JSON.parse(arguments)              
        pipeline =  func.replaceNewDate(argumentsjson.aggregate_pipeline) 
    } catch (err){
        return {success:0,error:`Received aggregate pipeline is poorly formed which caused the following error on conversion to JSON: ${err.message}.`,instructions: "Correct the pipeline."}
    }

    try {
        let result;
        if(table_name==="errors_log"){
            result = await mongo.queryLogsErrorByAggPipeline(pipeline)
        } else if (table_name==="tokens_logs"){
            result = await mongo.queryTockensLogsByAggPipeline(pipeline)
        }

        const actialTokens = func.countTokensProportion(JSON.stringify(result))

        if(actialTokens>tokensLimitPerCall){
            return {success:0,error:`Result of the function exceeds ${tokensLimitPerCall} characters.`,instructions: "Please adjust the query to reduce length of the result."}
        }
        let response = {success:1,result:result}

        //Post validation
        if(result.length===0){
            response["hint"]= "Empty result might be caused by two reasons. (1) Incorrect data type used in the query. Make sure you correctly apply the instructions regarding date format given in the function description. (2) You have misspelled the values used in the filters. To check spelling, retrieve a list of unique values of the columns on which filters should be applyed. Take into consideration both points and retry the request. Do not ask the user for an approval to retry."
            response["warning"] = "But do not undertake more than three attempts to retry the function."
        };

        return response
         
    } catch (err){

        return {success:0,error:`Error on applying the aggregation pipeline provided to the mongodb: ${err.message}`,instructions:"Adjust the pipeline provided and retry."}
    }

    };

function hasAllRequiredAtributes(tool_call){

    if(tool_call.id && tool_call.type && tool_call.function){
        return true
    } else {
        return false
    } 
}








module.exports = {
        CreateImage
}