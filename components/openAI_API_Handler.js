//Подключаем и настраиваем OpenAI
const OpenAI = require("openai");
const FormData = require("form-data");
const telegramErrorHandler = require("./telegramErrorHandler.js");
const msqTemplates = require("../config/telegramMsgTemplates");
const modelSettings = require("../config/telegramModelsSettings");
const { Readable } = require("stream");
const mongo = require("./mongo");
const Completion = require("./objects/Completion.js");

const axios = require("axios");

async function getModels() {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const models = await openai.models.list()
    return models
  } catch (err) {
    console.log("err",err)
    err.consolelog = true;
    err.place_in_code = err.place_in_code || arguments.callee.name;
    telegramErrorHandler.main(
      null,
      null,
      err,
      err.place_in_code,
      err.user_message
    );
  }
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
      err = new Error(err.message);
      err.code = "OAI_ERR99";
      err.user_message = msqTemplates.error_api_other_problems;
      err.mongodblog = true;
      err.place_in_code = err.place_in_code || arguments.callee.name;
      throw err;
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
    err.place_in_code = err.place_in_code || arguments.callee.name;
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
      err.place_in_code = err.place_in_code || arguments.callee.name;
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
    err.place_in_code = err.place_in_code || arguments.callee.name;
    throw err;
  }
} 

async function chatCompletionStreamAxiosRequest(
  requestMsg, 
  replyMsg,
  dialogueClass,
  toolCallsInstance
) {
  try {

    const completionInstance = new Completion(
      {
       requestMsg:requestMsg,
       replyMsg:replyMsg,
       userClass:requestMsg.user,
       dialogueClass:dialogueClass,
       toolCallsInstance:toolCallsInstance
      });

    const options = {
      url: modelSettings[requestMsg.user.currentRegime].hostname + modelSettings[requestMsg.user.currentRegime].url_path,
      method: "POST",
      encoding: "utf8",
      responseType: "stream",
      timeout: appsettings.http_options.OAI_request_timeout,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requestMsg.user.openAIToken}`,
      },
      validateStatus: function (status) {
        return status == appsettings.http_options.SUCCESS_CODE;
      },
      data: {
        model:requestMsg.user.currentModel,
        temperature: requestMsg.user.currentTemperature,
        messages: dialogueClass.dialogueForRequest,
        stream: true,
        stream_options: {
          include_usage: true,
        }
      },
    };

    const available_tools =  await toolCallsInstance.generateAvailableTools(requestMsg.user)
    if(available_tools){
      //Add functions, if they exist
      options.data.tools = available_tools;
      options.data.tool_choice = toolCallsInstance.tool_choice
    }
   // console.log("4","before axios",new Date())
    
    axios(options)
      .then((response) => {
        //Объявляем функцию для тротлинга       
        completionInstance.response = response
        response.data.pipe(completionInstance)
      })
      .catch(async (error) => {
        
        await completionInstance.handleResponceError(error);
      });
  } catch (err) {
    if (err.mongodblog === undefined) {
      err.mongodblog = true;
    }
    err.place_in_code = err.place_in_code || arguments.callee.name;
    throw err;
  }
}

module.exports = {
  getModels,
  chatCompletionStreamAxiosRequest,
  VoiceToText,
  TextToVoice,
};
