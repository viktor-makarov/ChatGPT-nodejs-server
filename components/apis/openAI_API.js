//Подключаем и настраиваем OpenAI

const FormData = require("form-data");
const msqTemplates = require("../../config/telegramMsgTemplates.js");
const modelSettings = require("../../config/telegramModelsSettings.js");
const modelConfig = require("../../config/modelConfig.js");
const { Readable } = require("stream");
const mongo = require("./mongo.js");
const axios = require("axios");
const OpenAI = require("openai");
const AvailableTools = require("../objects/AvailableTools.js");
const otherFunctions = require("../common_functions.js");

// Polyfill global File (and Blob) for Node < 20 to support file uploads in OpenAI SDK
if (typeof globalThis.File === "undefined") {
    const { File, Blob } = require("node:buffer");
    globalThis.File = File;
    if (typeof globalThis.Blob === "undefined" && Blob) {
      globalThis.Blob = Blob;
    }
}

async function uploadFile(fileStream,purpose ='user_data',expires_seconds){

  const openai = new OpenAI({
    baseURL: `https://${process.env.OAI_URL}/v1`,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000
  });

  const options = {
    file: fileStream,
    purpose: purpose
  };

  if (expires_seconds){
    options.expires_after = {
      anchor: "created_at",
      seconds: expires_seconds
    }
  }

  return  await openai.files.create(options);
}

async function deleteFile(fileId){
  const openai = new OpenAI({
    baseURL: `https://${process.env.OAI_URL}/v1`,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000
  });
  const result = await openai.files.delete(fileId)
  return result;
}

async function listFiles(){
  const openai = new OpenAI({
    baseURL: `https://${process.env.OAI_URL}/v1`,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000
  });
  const result = await openai.files.list()
  return result;
}

async function responseStream(dialogueClass,instructions = null){

const userInstance = dialogueClass.userInstance
const model = userInstance.currentModel
const openai = new OpenAI({
  baseURL: `https://${process.env.OAI_URL}/v1`,
  apiKey: process.env.OPENAI_API_KEY,
  timeout: modelConfig[model].timeout_ms || 180000
});

const input = await dialogueClass.getDialogueForRequest(model,userInstance.currentRegime)

const options = {
    model: model,
    input: input,
    stream: true,
    store:false,
    background: false
};

const includeUsage = modelConfig[model].includeUsage

if (includeUsage) {
    options.include = includeUsage
}

const reasoningConfig = modelConfig[model].reasoning;
if (reasoningConfig) {
    options.reasoning = reasoningConfig;
}

if (instructions){
    options.instructions = instructions;
}

const modelCanUseTemperature = modelConfig[model].canUseTemperature

if (modelCanUseTemperature) {
    options.temperature = userInstance.currentTemperature;
}

const availableToolsInstance = new AvailableTools(userInstance);
const available_tools =  await availableToolsInstance.getAvailableToolsForCompletion(userInstance.currentRegime);
const modelCanUseTools = modelConfig[model].canUseTool

if(available_tools && available_tools.length > 0 && modelCanUseTools){
      options.tools = available_tools;
      options.tool_choice = "auto";
};
otherFunctions.saveTextToTempFile(JSON.stringify(options,null,4),`oai_request_${dialogueClass.id}.json`)

const responseStream = await openai.responses.create(options);

return responseStream;
}

async function responseSync(model,instructions, input,temperature = 0,tools = [],tool_choice = "auto",output_format = { "type": "text" },truncation = null) {

const openai = new OpenAI({
  baseURL: `https://${process.env.OAI_URL}/v1`,
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 180000,
});

const options = {
    model: model,
    instructions: instructions,
    input: input,
    temperature: temperature,
    store:false,
    background: false,
    tools: tools,
    tool_choice: tool_choice,
    text:{format:output_format},
    truncation: truncation
};

const includeUsage = modelConfig[model]?.includeUsage
if (includeUsage) {
    options.include = includeUsage
}

const reasoningConfig = modelConfig[model]?.reasoning;
if (reasoningConfig) {
    options.reasoning = reasoningConfig;
}

const response = await openai.responses.create(options);
return response;
}

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

async function VoiceToText(audioReadStream,openAIToken) {
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

async function getFileFromContainer(containerId, fileId) {
  const options = {
      url: `https://${process.env.OAI_URL}/v1/containers/${containerId}/files/${fileId}/content`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      responseType: 'arraybuffer'
    }

    const response = await axios(options)

    return Buffer.from(response.data)

}

module.exports = {
  getModels,
  VoiceToText,
  TextToVoice,
  responseStream,
  responseSync,
  uploadFile,
  deleteFile,
  listFiles,
  getFileFromContainer
};
