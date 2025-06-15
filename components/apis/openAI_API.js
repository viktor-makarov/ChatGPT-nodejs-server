//Подключаем и настраиваем OpenAI

const FormData = require("form-data");
const msqTemplates = require("../../config/telegramMsgTemplates.js");
const modelSettings = require("../../config/telegramModelsSettings.js");
const modelConfig = require("../../config/modelConfig.js");
const { Readable } = require("stream");
const mongo = require("./mongo.js");
const toolsCollection = require("../objects/toolsCollection.js");
const { StringDecoder } = require('string_decoder');
const otherFunctions = require("../common_functions.js");

const axios = require("axios");

async function getModels() {
    const options = {
      url: `https://${process.env.OAI_URL}/v1/models`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }

    const models = await axios(options)
    
    return models.data
};

async function VoiceToText(audioReadStream,openAIToken,userInstance) {
  try {

    
    const formData = new FormData();
    formData.append("file", audioReadStream);
    formData.append("model", appsettings.voice_to_text.oai_model_id);

    const headers = {
      Authorization: `Bearer ${openAIToken}`,
      ...formData.getHeaders(),
    };

    var openai_resp;
    try {
      openai_resp = await axios.post(
        `https://${process.env.OAI_URL}/v1/audio/transcriptions`,
        formData,
        {
          headers,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );
    } catch (err) {

      let error = new Error(err.message);
      error.code = "OAI_ERR99";
      error.message_from_response = JSON.stringify(err?.response?.data?.error)
      error.user_message = msqTemplates.error_api_other_problems;
      error.mongodblog = true;
      error.place_in_code = err.place_in_code || "VoiceToText";
      throw error;
    }

    var transcript = msqTemplates.empty_message;
    if (openai_resp.data) {
      transcript = openai_resp.data.text;
    }

    await mongo.insertTokenUsage({
      userInstance:userInstance,
      prompt_tokens:null,
      completion_tokens:null,
      mode:appsettings.voice_to_text.oai_model_id
    });
    return transcript;
  } catch (err) {
    if (err.mongodblog === undefined) {
      err.mongodblog = true;
    }
    err.place_in_code = err.place_in_code || "VoiceToText";
    throw err;
  }
}

async function TextToVoice(requestInstance,text) {
  try {

    var openai_resp;
    const voice = requestInstance.user.currentVoice || modelSettings["texttospeech"].voice
    const model = requestInstance.user.settings["texttospeech"].model
    try {

      let textToUse = text || requestInstance.text;
      
const options = {
      url: modelSettings["texttospeech"].hostname + modelSettings["texttospeech"].url_path,
      method: "POST",
      responseType: "arraybuffer",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requestInstance.user.openAIToken}`,
      },
      validateStatus: function (status) {
        return status == appsettings.http_options.SUCCESS_CODE;
      },
      data: {
        model:model,
        input: textToUse,
        voice: voice
    }};

    console.log("options",(text || requestInstance.text).length)

      openai_resp = await axios(options);

    } catch (err) {
      err = new Error(err.message);
      err.code = "OAI_ERR99";
      err.user_message = msqTemplates.error_api_other_problems;
      err.mongodblog = true;
      err.place_in_code = err.place_in_code || "TextToVoice";
      throw err;
    }
    const fileData = Buffer.from(openai_resp.data, 'binary');
    let audioReadStream = Readable.from(fileData);
    audioReadStream.path = voice+".mp3";

    await mongo.insertTokenUsage({
      userInstance:requestInstance.user,
      prompt_tokens:null,
      completion_tokens:null,
      model:model
  }); //ассинхронно фиксируем потраченные токены

    const formData = new FormData();
    formData.append('chat_id', requestInstance.chatId);
    formData.append('audio', audioReadStream);
  //  formData.append('title', "title");
    

    const response = await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendAudio`, 
    formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return response
  } catch (err) {
    
    
    if (err.mongodblog === undefined) {
      err.mongodblog = true;
    }
    err.place_in_code = err.place_in_code || "TextToVoice";
    throw err;
  }
} 

async function chatCompletionStreamAxiosRequest(
  requestMsg, 
  dialogueClass
) {

    const toolCallsInstance = dialogueClass.toolCallsInstance
    const completionInstance = dialogueClass.completionInstance

    const options = {
      url: modelSettings[requestMsg.user.currentRegime].hostname + modelSettings[requestMsg.user.currentRegime].url_path,
      method: "POST",
      encoding: "utf8",
      responseType: "stream",
      timeout: completionInstance.timeout,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requestMsg.user.openAIToken}`,
      },
      validateStatus: function (status) {
        return status == appsettings.http_options.SUCCESS_CODE;
      },
      data: {
        model:requestMsg.user.currentModel,
        messages: await dialogueClass.getDialogueForRequest(),
        stream: true,
        stream_options: {
          include_usage: true,
        }
      },
    };
    
    const available_tools =  await toolsCollection.getAvailableToolsForCompletion(dialogueClass.userInstance)

    const canUseTools = modelConfig[requestMsg.user.currentModel].canUseTool
    const canUseTemperature = modelConfig[requestMsg.user.currentModel].canUseTemperature
    
    if(canUseTemperature){
      options.data.temperature = requestMsg.user.currentTemperature
    }

    if(available_tools && available_tools.length>0 && canUseTools){
      //Add functions, if they exist
      options.data.tools = available_tools;
      options.data.tool_choice = toolCallsInstance.tool_choice
    }
   // console.log("4","before axios",new Date())
    
    try {
      return await axios(options);
    } catch (error) {

      const errorAugmented = await OpenAIErrorHandle(error,dialogueClass);
      throw errorAugmented
    }
}

    async function OpenAIErrorHandle(error,dialogueClass) {

        const oai_response_status = error.response ? error.response.status : null;
        let newErr = new Error(error.message);

        newErr.message_from_response = await deriveErrorDetailsFromOAIResponse(error)
        newErr.place_in_code = newErr.place_in_code || "openAi_API.OpenAIErrorHandle";

        if (oai_response_status === 400 || error.message.includes("400")) {

          newErr.code = "OAI_ERR_400";
          newErr.user_message = msqTemplates.OAI_ERR_400.replace("[original_message]",error?.message_from_response?.message ?? "отсутствует");
          
          // Regular expression to check if the error message indicates that the context length limit has been exceeded
          const contentExceededPattern = new RegExp(/context_length_exceeded/);
          const contentIsExceeded = contentExceededPattern.test(error.message_from_response)
          const imageSizeExceededPattern = new RegExp(/image size is (\d+(?:\.\d+)?[KMG]B), which exceeds the allowed limit of (\d+(?:\.\d+)?[KMG]B)/);
          const imageSizeIsExceededMatch = newErr.message_from_response.match(imageSizeExceededPattern)
          
          if(contentIsExceeded){
            newErr.resetDialogue = {
              message_to_user: otherFunctions.getLocalizedPhrase("token_limit_exceeded",dialogueClass.userInstance.language_code)
            }

          } else if (imageSizeIsExceededMatch){
            const placeholders = [{key:"[actualsize]",filler:imageSizeIsExceededMatch[1]},{key:"[limit]",filler:imageSizeIsExceededMatch[2]}]
            newErr.resetDialogue = {
              message_to_user: otherFunctions.getLocalizedPhrase("image_size_exceeded",dialogueClass.userInstance.language_code,placeholders)  
            }
          }
            return newErr;
          
        } else if (oai_response_status === 401 || error.message.includes("401")) {
          newErr.code = "OAI_ERR_401";
          newErr.user_message = msqTemplates.OAI_ERR_401.replace("[original_message]",err?.message_from_response?.message ?? "отсутствует");
          return newErr;
        } else if (oai_response_status === 429 || error.message.includes("429")) {
          newErr.code = "OAI_ERR_429";
          newErr.data = error.data
          newErr.user_message = msqTemplates.OAI_ERR_429.replace("[original_message]",newErr?.message_from_response?.message ?? "отсутствует");
          newErr.mongodblog = false;
          return newErr;
        } else if (oai_response_status === 501 || error.message.includes("501")) {
          newErr.code = "OAI_ERR_501";
          newErr.user_message = msqTemplates.OAI_ERR_501.replace("[original_message]",newErr?.message_from_response?.message ?? "отсутствует");
          return newErr;
        } else if (oai_response_status === 503 || error.message.includes("503")) {
          newErr.code = "OAI_ERR_503";
          newErr.user_message = msqTemplates.OAI_ERR_503.replace("[original_message]",newErr?.message_from_response?.message ?? "отсутствует");
          return newErr;
        }  else if (error.code === "ECONNABORTED") {
            newErr.code = "OAI_ERR_408";
            newErr.user_message = msqTemplates.OAI_ERR_408;
            return newErr;
        } else {
          newErr.code = "OAI_ERR99";
          newErr.user_message = msqTemplates.error_api_other_problems;
          return newErr;
        }
      }
      
      async function deriveErrorDetailsFromOAIResponse(error){
        const errorStream = error.response.data;
        const decoder = new StringDecoder("utf8"); 
        let errorDetails = "";
        const failedExtractionMsg = "Unable to derive error details from the service reply.";
        try {
          if (errorStream && typeof errorStream[Symbol.asyncIterator] === 'function') {
            for await (const chunk of errorStream) {
              errorDetails += decoder.write(chunk);
            }
          } else {
            errorDetails = typeof errorStream === 'string' ? errorStream : failedExtractionMsg;
          }
          return errorDetails || failedExtractionMsg;
        } catch (err) {
          return failedExtractionMsg;
        } finally {
          decoder.end();
        }
      }



module.exports = {
  getModels,
  chatCompletionStreamAxiosRequest,
  VoiceToText,
  TextToVoice,
};
