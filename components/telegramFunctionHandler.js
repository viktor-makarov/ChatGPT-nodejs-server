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
        return ["No image was provided by the service. Please retry."]
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

async function runFunctionRequest(botInstance,msg,function_call,model,sentMsgIdObj,sysmsgOn){
try{

    //>>>Уведомляем пользователя о начале работы функции
  if(sysmsgOn){ //Если включена функция показа системных сообщений
    let msgTGM = msqTemplates.function_request_msg.replace("[function]",JSON.stringify(function_call))
    if(msgTGM.length>appsettings.telegram_options.big_outgoing_message_threshold){
        msgTGM = msgTGM.substring(0, telegram_options.big_outgoing_message_threshold) + msqTemplates.too_long_message
    }
    await botInstance.editMessageText(msgTGM,{chat_id:msg.chat.id,message_id: sentMsgIdObj.sentMsgId,
        disable_web_page_preview: true});
    const rst = await botInstance.sendMessage(msg.chat.id, msqTemplates.function_request_status_msg2);
    sentMsgIdObj.sentMsgId = rst.message_id
    } else {
        //Добавялем сообщение, что выполняется
      await botInstance.editMessageText(msqTemplates.function_request_status_msg,{chat_id: msg.chat.id,message_id: sentMsgIdObj.sentMsgId,
        disable_web_page_preview: true});
    }
   //<<<Уведомляем пользователя о начале работы функции

const function_name = function_call?.name

let functionResult = ""

const dialogueSize = modelConfig[model].request_length_limit_in_tokens
const tokensLimitForFetchedContent = dialogueSize*appsettings.functions_options.fetch_text_limit_pcs/100

if (!function_name){

    functionResult = "No function name found"

} else if(function_name==="get_current_datetime"){

    functionResult = new Date().toString()

} else if(function_name==="fetch_url_content"){

    const arguments = function_call?.arguments

    if(arguments === "" || arguments === null || arguments === undefined){
        functionResult = "No arguments provided. You should provide at least required arguments"
        return functionResult
    } 

    let argumentsjson;

    try{
    argumentsjson = JSON.parse(arguments)
    } catch (err){
        functionResult = `Received arguments object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`
        return functionResult
    }   

    if (argumentsjson.urls === "" || argumentsjson.urls === null || argumentsjson.urls === undefined){
        functionResult = "Urls param contains no data. You should provide list of urls."
        return functionResult
    }

    const UrlsArray = argumentsjson.urls

    if(! Array.isArray(UrlsArray)){
        functionResult = "Urls should be provided as an array."
        return functionResult
    };

    const tokenLimitPerURL = tokensLimitForFetchedContent/UrlsArray.length

    const promises = UrlsArray.map(url => fetchUrlContent(url, tokenLimitPerURL));
    const promiseResult = await Promise.all(promises)

    const resultText = JSON.stringify(promiseResult)

    return resultText

} else if(function_name==="create_image"){

    const arguments = function_call?.arguments

    if(arguments === "" || arguments === null || arguments === undefined){

        functionResult = {result:"unsuccessful", error:"No arguments provided. You should provide at least required arguments"};

        const resultText = JSON.stringify(functionResult)

        return resultText
    } 
    
    const argumentsjson = JSON.parse(arguments)   
    
    if (argumentsjson.prompt === "" || argumentsjson.prompt === null || argumentsjson.prompt === undefined){

        functionResult = {result:"unsuccessful", error:"Prompt param contains no text. You should provide the text."};

        const resultText = JSON.stringify(functionResult)

        return resultText

    } else if (argumentsjson.prompt.length > 4000){

        functionResult = {result:"unsuccessful", error:`Prompt length exceeds limit of 4000 characters. Please reduce the prompt length.`};

        const resultText = JSON.stringify(functionResult)

        return resultText
    } else {
        const prompt = argumentsjson.prompt
        const style = argumentsjson?.style
        const size = argumentsjson?.size

        const sizeArray = ["1024x1024","1792x1024","1024x1792"]
        const styleArray = ["vivid","natural"]

        if(!sizeArray.includes(size)&&size){
            functionResult = `Size param can not have other value than 1024x1024, 1792x1024 or 1024x1792. Please choose one of the three.`
            return functionResult
        }

        if(!styleArray.includes(style)&&style){
            functionResult = `Style param can not have other value than vivid or natural. Please choose one of the two.`
            return functionResult
        }

        const resp = await CreateImage(botInstance,prompt,"dall-e-3",size,style,msg)

        functionResult = {
            result:"The image has been generated and successfully sent to the user.", 
            instructions:`Translate the following description of the image:`+JSON.stringify(resp)
        };

        const resultText = JSON.stringify(functionResult)
        return resultText
    };

} else if(function_name==="get_users_activity"){

    const arguments = function_call?.arguments
    let pipeline = [];
    if(arguments === "" || arguments === null || arguments === undefined){

        functionResult = "No arguments provided. You should provide at least required arguments"

        return functionResult
    } else {

        try {
            const argumentsjson = JSON.parse(arguments)              
           pipeline =  func.replaceNewDate(argumentsjson.aggregate_pipeline)
            
        } catch (err){
            functionResult = `Received aggregate pipeline is poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the pipeline.`
            return functionResult
        }
    };

        try {
            const result = await mongo.queryTockensLogsByAggPipeline(pipeline)
            const strResult = JSON.stringify(result)
    
            if(strResult.length>appsettings.functions_options.max_characters_in_result){

                functionResult = `Result of the function exceeds ${appsettings.functions_options.max_characters_in_result} characters. Please adjust the query to reduce length of the result.`
                return functionResult

            } else{
                functionResult = strResult
          
                return functionResult
            }
          
        } catch (err){

            functionResult = `Error on applying the aggregation pipeline provided to the mongodb: ${err.message}`
            return functionResult
        }

} else if(function_name==="get_chatbot_errors") {

    const arguments = function_call?.arguments
    let pipeline = [];
    if(arguments === "" || arguments === null || arguments === undefined){

        functionResult = "No arguments provided. You should provide at least required arguments"

        return functionResult
    } else {

        try {
            const argumentsjson = JSON.parse(arguments)      
           pipeline =  func.replaceNewDate(argumentsjson.aggregate_pipeline)
            
        } catch (err){
            functionResult = `Received aggregate pipeline is poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the pipeline.`
            return functionResult
        }
    };

        try {
            const result = await mongo.queryLogsErrorByAggPipeline(pipeline)
            functionResult = JSON.stringify(result)
          
            return functionResult
        } catch (err){

            functionResult = `Error on applying the aggregation pipeline provided to the mongodb: ${err.message}`
            return functionResult
        }


} else {

    functionResult = `Function ${function_name} does not exist`
}

return functionResult

} catch(err){
    err.place_in_code = err.place_in_code || arguments.callee.name;
    throw err;
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
})

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
    CreateImage
}