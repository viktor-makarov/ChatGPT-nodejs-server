const mongo = require("./mongo");
const scheemas = require("./mongo_Schemas.js");
const func = require("./other_func.js");
const axios = require("axios");
const { Readable } = require("stream");
const FormData = require("form-data");
const fs = require('fs');
const Jimp = require('jimp');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const modelConfig = require("../config/modelConfig");
const msqTemplates = require("../config/telegramMsgTemplates");
const telegramErrorHandler = require("./telegramErrorHandler.js");

async function notifyUser(botInstance,sysmsgOn,full_message,short_message,incoming_msg_id,chat_id,create_follow_up_msg){
//Sends a notification to the user and returns the last message_id

let full_message_to_send =full_message;
let short_message_to_send =short_message;
let outcoming_msg_id = incoming_msg_id;
try{

if(full_message_to_send.length>appsettings.telegram_options.big_outgoing_message_threshold){
    full_message_to_send = full_message_to_send.substring(0, telegram_options.big_outgoing_message_threshold) + msqTemplates.too_long_message
}

if(short_message_to_send.length>appsettings.telegram_options.big_outgoing_message_threshold){
    short_message_to_send = short_message.substring(0, telegram_options.big_outgoing_message_threshold) + msqTemplates.too_long_message
}

if(incoming_msg_id){   //Если есть входящий номер id

    if(sysmsgOn){ //Если включена функция показа системных сообщений

      //Сокдащаем сообщение, если оно превышает димит расмера сообщения телеграм.
        await botInstance.editMessageText(full_message_to_send,{chat_id:chat_id,message_id: incoming_msg_id,
          disable_web_page_preview: true});
        if(create_follow_up_msg){
            const rst = await botInstance.sendMessage(msg.chat_id, msqTemplates.function_request_status_msg2);
            outcoming_msg_id = rst.message_id
        }

    } else {
      await botInstance.editMessageText(short_message_to_send,{chat_id: chat_id,message_id: incoming_msg_id,
        disable_web_page_preview: true});
    }
} else {

if(sysmsgOn){ 
    const rst = await botInstance.sendMessage(msg.chat_id, full_message_to_send);
    outcoming_msg_id = rst.message_id
    if(create_follow_up_msg){
        const rst = await botInstance.sendMessage(msg.chat_id, msqTemplates.function_request_status_msg2);
        outcoming_msg_id = rst.message_id
    }
} else {
    const rst = await botInstance.sendMessage(msg.chat_id, short_message_to_send);
    outcoming_msg_id = rst.message_id
};
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


async function CreateImageRouter(function_call){

    try{

    const arguments = function_call?.function?.arguments

    if(arguments === "" || arguments === null || arguments === undefined){
        return {result:"unsuccessful", error:"No arguments provided. You should provide at least required arguments"};
    } 
    
    try{
    const argumentsjson = JSON.parse(arguments)   
    } catch(err){
        return {result:"unsuccessful", error:err};
    };
    
    if (argumentsjson.prompt === "" || argumentsjson.prompt === null || argumentsjson.prompt === undefined){
        return {result:"unsuccessful", error:"Prompt param contains no text. You should provide the text."};
    } 
    
    if (argumentsjson.prompt.length > 4000){
        return {result:"unsuccessful", error:`Prompt length exceeds limit of 4000 characters. Please reduce the prompt length.`};
    } 
    
        const prompt = argumentsjson.prompt
        const style = argumentsjson?.style
        const size = argumentsjson?.size
        const sizeArray = ["1024x1024","1792x1024","1024x1792"]
        const styleArray = ["vivid","natural"]

        if(!sizeArray.includes(size)&&size){
            return {result:"unsuccessful", error:`Size param can not have other value than 1024x1024, 1792x1024 or 1024x1792. Please choose one of the three.`};
        }

        if(!styleArray.includes(style)&&style){
            return {result:"unsuccessful", error:`Style param can not have other value than vivid or natural. Please choose one of the two.`};
        }

        const resp = await CreateImage(botInstance,prompt,"dall-e-3",size,style,msg)

        functionResult = {
            result:"The image has been generated and successfully sent to the user.", 
            instructions:`Translate the following description of the image:`+JSON.stringify(resp)
        };
        return functionResult
        
        } catch(err){
            err.place_in_code = err.place_in_code || arguments.callee.name;
            throw err;
        }
    };

async function CreateImage(botInstance,prompt,model,size,style,msg){
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

       const openai_resp = await axios(options);
       let resultList = []; 
       const photoList = openai_resp.data.data

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

    async function fetchUrlContent(url,tokenlimit){
        try{
        let response;
        try {
        response = await axios.get(url,{
            responseType: 'arraybuffer',
            responseEncoding: 'binary'})
        } catch(err){
            return  {"url":url,"error":err}
        };

        const contentType = response.headers['content-type'] || 'windows-1251';
        let match = contentType.match(/charset=([a-zA-Z0-9-]+)/);
        let encoding = match && match[1] ? match[1] : 'utf-8';

        let decodedHtml;
        try {
        decodedHtml = iconv.decode(response.data, encoding);
        } catch(err){
            return  {"url":url,"error":err}
        };

        const $ = cheerio.load(decodedHtml);
        
        let text = $('body').html();
  
        const tokenCount = Math.round(func.countTokensProportion(text))

        if(tokenCount>tokenlimit){
            const error = `Content of the resource has ${tokenCount} tokens which exceeds limit of ${tokenlimit} tokens.`        
            return  {url:url,error:error,instructions:"User should adjust the url or use a model with bigger dialogue limit."}
        } else {
            return {url:url,content:text}
        }
    } catch(err){
        err.place_in_code = err.place_in_code || arguments.callee.name;
        err.details = {"url":url}
        throw err;

    }
    };

    async function fetchUrlContentRouter(function_call){

    try{

    const dialogueSize = modelConfig[model].request_length_limit_in_tokens
    const tokensLimitForFetchedContent = dialogueSize*appsettings.functions_options.fetch_text_limit_pcs/100
    const arguments = function_call?.function?.arguments

    if(arguments === "" || arguments === null || arguments === undefined){
        return {result:"unsuccessful",error: "No arguments provided. You should provide at least required arguments"}
    } 

    let argumentsjson;

    try{
    argumentsjson = JSON.parse(arguments)
    } catch (err){
        return {result:"unsuccessful",error: `Received arguments object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`}
    }   

    if (argumentsjson.urls === "" || argumentsjson.urls === null || argumentsjson.urls === undefined){
        return {result:"unsuccessful",error:"Urls param contains no data. You should provide list of urls."}
    }

    const UrlsArray = argumentsjson.urls

    if(! Array.isArray(UrlsArray)){
        return {result:"unsuccessful",error:"Urls should be provided as an array."}
    };

    const tokenLimitPerURL = tokensLimitForFetchedContent/UrlsArray.length

    const promises = UrlsArray.map(url => fetchUrlContent(url, tokenLimitPerURL));
    const promiseResult = await Promise.all(promises)

    return {result:promiseResult}
        
        } catch(err){
            err.place_in_code = err.place_in_code || arguments.callee.name;
            throw err;
        }
    };

async function get_data_from_mongoDB_by_pipepine(function_call){

    const arguments = function_call?.function?.arguments

    let pipeline = [];
    if(arguments === "" || arguments === null || arguments === undefined){
        return {result:"unsuccessful",error:"No arguments provided.",instructions: "You should provide at least required arguments"}
    } 
    
    try {
        const argumentsjson = JSON.parse(arguments)              
        pipeline =  func.replaceNewDate(argumentsjson.aggregate_pipeline) 
    } catch (err){
        return {result:"unsuccessful",error:`Received aggregate pipeline is poorly formed which caused the following error on conversion to JSON: ${err.message}.`,instructions: "Correct the pipeline."}
    }

    try {
        const result = await mongo.queryTockensLogsByAggPipeline(pipeline)
        const strResult = JSON.stringify(result)

        if(strResult.length>appsettings.functions_options.max_characters_in_result){
            return {result:"unsuccessful",error:`Result of the function exceeds ${appsettings.functions_options.max_characters_in_result} characters.`,instructions: "Please adjust the query to reduce length of the result."}
        }
    
        return {result:result}
         
    } catch (err){

        return {result:"unsuccessful",error:`Error on applying the aggregation pipeline provided to the mongodb: ${err.message}`,instructions:"Adjust the pipeline provided and retry."}
    }

    };


async function toolsRouter(botInstance,msg,tool_calls,model,sentMsgIdObj,sysmsgOn,regime){

    let resultList =[];

try{

    let full_message = msqTemplates.function_request_msg.replace("[function]",JSON.stringify(tool_calls))
    let short_message = msqTemplates.function_request_status_msg
    sentMsgIdObj.sentMsgId = await notifyUser(botInstance,sysmsgOn,full_message,short_message,sentMsgIdObj.sentMsgId,msg.chat.id,true)

    if(tool_calls.length>0){

        let promisesList =[];
        for (let i = 0; i < tool_calls.length; i++) {

            const tool_call = tool_calls[i]
            if(tool_call.id && tool_call.type && tool_call.function){ //Проверяем call на наличие всех необъодимых атрибутов.
                if(tool_call.type==="function"){ 

                    promisesList.push(runFunctionRequest(botInstance,msg,tool_call,model,sentMsgIdObj,sysmsgOn,regime))

                } else { //Не функции обрабатывать пока не умеем.
                    resultList.push({id:tool_call.id,type:tool_call.type,error:"Non function types cannot be processed for now.",instructions:"Rework into a function"})
                }

            } else {
                resultList.push({id:tool_call?.id,function_name:tool_call?.function?.name,error:"Call is malformed. Required fields are missing",instructions:"Fix the call and retry."})
            }
        };

    const promiseResult = await Promise.all(promisesList) //Запускаем все функции параллеьно и ждем результата всех
        console.log(promiseResult)
        resultList = resultList

    } else {
        resultList = [{error:"No no tool calls have been provided",instructions: "Provide valid a tool call"}]
    }


    const tool_reply = {
        tool_call_id: function_call.id,
        name: function_name,
        content:JSON.stringify(resultList)}

    await mongo.upsertFuctionResultsPromise(msg, regime,tool_reply); //записываем вызова функции в диалог
    
    full_message = msqTemplates.function_result_msg.replace("[result]",JSON.stringify(tool_reply))
    short_message = msqTemplates.function_end.replace("[function]",function_name)
    sentMsgIdObj.sentMsgId = await notifyUser(botInstance,sysmsgOn,full_message,short_message,sentMsgIdObj.sentMsgId,msg.chat.id,true)
    //Добавить логирование в диалог и вывод пользователю

} catch(err) {

    const tool_reply = {
        tool_call_id: function_call.id,
        name: function_name,
        content:JSON.stringify([{error:err,instructions: "Provide the user with a brief description of the error and appologise that functions are not currently available."}] )}

        await mongo.upsertFuctionResultsPromise(msg, regime,tool_reply); //записываем вызова функции в диалог
        full_message = msqTemplates.function_result_msg.replace("[result]",JSON.stringify(tool_reply))
        short_message = msqTemplates.function_end.replace("[function]",function_name)
        sentMsgIdObj.sentMsgId = await notifyUser(botInstance,sysmsgOn,full_message,short_message,sentMsgIdObj.sentMsgId,msg.chat.id,true)
    //Добавить логирование в диалог и вывод пользователю
};

};

async function get_current_datetime(){

    try{
        return {result: new Date().toString()}
    } catch(err){
        err.place_in_code = err.place_in_code || arguments.callee.name;
        throw err;
    }
}

async function runFunctionRequest(botInstance,msg,function_call,model,sentMsgIdObj,sysmsgOn,regime){

try{

const function_name = function_call?.function?.name

let functionResult = ""

if(function_name==="get_current_datetime"){functionResult = await get_current_datetime()} 
else if(function_name==="fetch_url_content"){functionResult = await fetchUrlContentRouter(function_call)}
else if(function_name==="create_image"){functionResult = await CreateImageRouter(function_call)} 
else if(function_name==="get_users_activity"){functionResult = await get_data_from_mongoDB_by_pipepine(function_call)} 
else if(function_name==="get_chatbot_errors") {functionResult = await get_data_from_mongoDB_by_pipepine(function_call)
} else {functionResult = {error:`Function ${function_name} does not exist`,instructions:"Provide a valid function."}}

const tool_reply = {
    tool_call_id: function_call.id,
    name: function_name,
    content:JSON.stringify(functionResult)}

await mongo.upsertFuctionResultsPromise(msg, regime,tool_reply); //записываем вызова функции в диалог

full_message = msqTemplates.function_result_msg.replace("[result]",JSON.stringify(tool_reply))
short_message = msqTemplates.function_end.replace("[function]",function_name)
sentMsgIdObj.sentMsgId = await notifyUser(botInstance,sysmsgOn,full_message,short_message,sentMsgIdObj.sentMsgId,msg.chat.id,true)

return {tool_call_id: function_call.id, name: function_name,result:"success"}

} catch(err){
    err.consolelog = true;
    err.place_in_code = err.place_in_code || arguments.callee.name;
    await telegramErrorHandler.main(
      botInstance,
      msg.chat.id,
      err,
      err.place_in_code,
      err.user_message
    );
    const tool_reply = {
        tool_call_id: function_call.id,
        name: function_name,
        content:JSON.stringify({error:err,instructions:"Provide the user with a brief description of the error on this function."})}
    
    await mongo.upsertFuctionResultsPromise(msg, regime,tool_reply); //записываем вызова функции в диалог
    
    full_message = msqTemplates.function_result_msg.replace("[result]",JSON.stringify(tool_reply))
    short_message = msqTemplates.function_end.replace("[function]",function_name)
    sentMsgIdObj.sentMsgId = await notifyUser(botInstance,sysmsgOn,full_message,short_message,sentMsgIdObj.sentMsgId,msg.chat.id,true)

    return {tool_call_id: function_call.id, name: function_name,result:"error"}
}
};

async function toolsList(userid){

var functionList = []


if(global.allSettingsDict[userid].current_regime==="assistant"){

//Общедоступные функции
functionList.push(
{"type":"function",
"function":{
    "name": "get_current_datetime",
    "description": "Use this function to answer user's questions which require current date and time. This function returns value of date and time at the moment of request.",
    "parameters": {
        "type": "object",
        "properties": {}
    }
}}
);


functionList.push(
    {"type":"function",
    "function":{
    "name": "fetch_url_content",
    "description": "Use this function to fetch content from urls.",
    "parameters": {
        "type": "object",
        "properties": {
            "urls": {
                "type": "string",
                "description": `List of urls to fetch content from in the following pattern [url1,url2]`
            }
        },
        "required": ["urls"]
    }
}}
);


if (adminArray.includes(userid)) {

//Функции для админа

functionList.push(
    {"type":"function",
    "function":{
    "name": "get_users_activity",
    "description": `Use this function to report on this chatbot users' activity of users. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongo.mongooseVersion()}. One document represents one request of a user.`,
    "parameters": {
        "type": "object",
        "properties": {
            "aggregate_pipeline": {
                "type": "string",
                "description": `Mongodb aggregate pipeline extracting info about users' activity from a mongodb collection.\n The collection has the following schema: ${JSON.stringify(scheemas.TokensLogSheema.obj)}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
            }
        },
        "required": ["aggregate_pipeline"]
    }}
})

functionList.push(
    {"type":"function",
    "function":{
    "name": "get_chatbot_errors",
    "description": `Use this function to report on this chatbot errors. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongo.mongooseVersion()}. One document represents one error.`,
    "parameters": {
        "type": "object",
        "properties": {
            "aggregate_pipeline": {
                "type": "string",
                "description": `Mongodb aggregate pipeline extracting info about errors from a mongodb collection.\n The collection has the following schema: ${JSON.stringify(scheemas.LogsSheema.obj)}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
            }
        },
        "required": ["aggregate_pipeline"]
    }}
});

functionList.push(
    {"type":"function",
    "function":{
        "name": "create_image",
        "description": "Use this function to answer user's questions to create or draw an image given a prompt.",
        "parameters": {
            "type": "object",
            "properties": {
                "size": {
                    "type": "string",
                    "description": `Size of the image. It can be 1024x1024, 1792x1024, or 1024x1792.`
                },
                "style": {
                    "type": "string",
                    "description": `The style of the generated images. Must be one of vivid or natural. Vivid causes the model to lean towards generating hyper-real and dramatic images. Natural causes the model to produce more natural, less hyper-real looking images. Default must be vivid.`
                },
                "prompt": {
                    "type": "string",
                    "description": `A text description of the desired image(s). The maximum length is 4000 characters.`
                },
            },
            "required": ["prompt"]
        }
    }}
    );

}

//Завершаем. Если ни одной функции нет, то передаем null
if (functionList.length===0){
    return null
} else {
    return functionList
}

} else {
    return null
}
};


module.exports = {
    toolsList,
    runFunctionRequest,
    CreateImage,
    toolsRouter
}