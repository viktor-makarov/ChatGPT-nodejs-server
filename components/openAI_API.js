//Подключаем и настраиваем OpenAI

const FormData = require("form-data");
const msqTemplates = require("../config/telegramMsgTemplates.js");
const modelSettings = require("../config/telegramModelsSettings.js");
const modelConfig = require("../config/modelConfig.js");
const { Readable } = require("stream");
const mongo = require("./mongo.js");
const toolsCollection = require("./objects/toolsCollection.js");

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

async function VoiceToText(requestMsgInstance) {
  try {

    await requestMsgInstance.getFileLinkFromTgm()
    const audioReadStream = await requestMsgInstance.audioReadableStreamFromTelegram()
    const formData = new FormData();
    formData.append("file", audioReadStream);
    formData.append("model", modelSettings.voicetotext.default_model);

    const headers = {
      Authorization: `Bearer ${requestMsgInstance.user.openAIToken}`,
      "Content-Type": "multipart/form-data",
      ...formData.getHeaders(),
    };
    var openai_resp;
    try {
      openai_resp = await axios.post(
        modelSettings.voicetotext.hostname + modelSettings.voicetotext.url_path,
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
      userInstance:requestMsgInstance.user,
      prompt_tokens:null,
      completion_tokens:null,
      mode:modelSettings.voicetotext.default_model
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

async function TextToVoice(requestInstance) {
  try {

    var openai_resp;
    const voice = requestInstance.user.currentVoice || modelSettings["texttospeech"].voice
    const model = requestInstance.user.settings["texttospeech"].model
    try {

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
        input: requestInstance.text,
        voice: voice
    }};

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
  replyMsg,
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
      const response = await axios(options);
      completionInstance.response = response;
      await response.data.pipe(completionInstance);
    } catch (error) {

      await replyMsg.simpleMessageUpdate("Ой-ой! :-(",{
        chat_id:replyMsg.chatId,
        message_id:replyMsg.lastMsgSentId
      })

      await completionInstance.handleResponceError(error);
    }
}

module.exports = {
  getModels,
  chatCompletionStreamAxiosRequest,
  VoiceToText,
  TextToVoice,
};
