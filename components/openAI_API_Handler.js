//Подключаем и настраиваем OpenAI
const {
  Configuration,
  OpenAIApi
} = require("openai");
const FormData = require("form-data");
const telegramErrorHandler = require("./telegramErrorHandler.js");
const telegramFunctionHandler = require("./telegramFunctionHandler.js");
const otherFunctions = require("./other_func");
const msqTemplates = require("../config/telegramMsgTemplates");
const modelSettings = require("../config/telegramModelsSettings");
const modelConfig = require("../config/modelConfig");
const fs = require("fs");
const { Readable } = require("stream");
const mongo = require("./mongo");
const telegramRouter = require("../routerTelegram")


const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const axios = require("axios");

async function getModels() {
  try {
    return openai.listModels();
  } catch (err) {
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
}

async function UnSuccessResponseHandle(
  botInstance,
  msg,
  error,
  previous_dialogue_tokens,
  token_limit
) {
  try {
    //  var err = new Error(api_res.statusMessage); //создаем ошибку и наполняем содержанием

    if (error.message.includes("429")) {
      err = new Error(error.message);
      err.code = "OAI_ERR3";
      err.user_message = msqTemplates.error_api_too_many_req;
      err.mongodblog = false;
      err.place_in_code = err.place_in_code || arguments.callee.name;
      throw err;
    } else if (error.message.includes("503")) {
      err = new Error(error.message);
      err.code = "OAI_ERR1";
      err.user_message = msqTemplates.OAI_ERR1;
      err.mongodblog = true;
      err.place_in_code = err.place_in_code || arguments.callee.name;
      throw err;
    } else if (error.code === "ECONNABORTED") {
        err = new Error(error.message);
        err.code = "OAI_ERR1";
        err.user_message = msqTemplates.OAI_ERR1;
        err.mongodblog = true;
        err.place_in_code = err.place_in_code || arguments.callee.name;
        throw err;
    } else if (previous_dialogue_tokens > token_limit) {
      //Проверяем, что кол-во токенов не превышает лимит

      OverlengthErrorHandle(
        botInstance,
        msg,
        previous_dialogue_tokens,
        token_limit
      );
    } else {
      err = new Error(error.message);
      err.code = "OAI_ERR99";
      err.user_message = msqTemplates.error_api_other_problems;
      err.mongodblog = true;
      err.place_in_code = err.place_in_code || arguments.callee.name;
      throw err;
    }
  } catch (err) {
    if (err.mongodblog === undefined) {
      err.mongodblog = true;
    }
    err.place_in_code = err.place_in_code || arguments.callee.name;
    telegramErrorHandler.main(
      botInstance,
      msg.chat.id,
      err,
      err.place_in_code,
      err.user_message
    );
  }
}

async function OverlengthErrorHandle(
  botInstance,
  msg,
  number_of_tokens,
  token_limit
) {
  try {
    //Логируем ошибку и отправляем сообщение пользователю
    await botInstance.sendMessage(
      msg.chat.id,
      msqTemplates.overlimit_dialog_msg +
        ` Размер вашего диалога = ${number_of_tokens} токенов. Ограничение данной модели = ${token_limit} токенов.`
    );
    await mongo.deleteDialogByUserPromise([msg.from.id], null); //Удаляем диалог
    await botInstance.sendMessage(
      msg.chat.id,
      msqTemplates.dialogresetsuccessfully
    );
    //Сообщение, что диалог перезапущен
  } catch (err) {
    err.place_in_code = err.place_in_code || arguments.callee.name;
    throw err;
  }
}

async function VoiceToText(botInstance, msg) {
  try {
    //Проверяем ограничения
    //По формату файла т размеру файла
    var mimetype;
    if (msg.audio || msg.voice) {
      mimetype = (msg.audio || msg.voice).mime_type;
    } else if (msg.video_note) {
      mimetype = "video_note";
    }

    const filesize = (msg.audio || msg.voice || msg.video_note).file_size;
    const fileid = (msg.audio || msg.voice || msg.video_note).file_id;

    const file_size_limit =
      modelSettings.voicetotext.filesize_limit_mb * 1024 * 1024;
    if (!modelSettings.voicetotext.mime_types.includes(mimetype)) {
      let err = new Error("File format is not acceptable.");
      err.user_message = msqTemplates.audiofile_format_limit_error;
      err.mongodblog = false;
      err.code = "RQS_ERR4";
      throw err;
    }
    //По размеру
    if (filesize > file_size_limit) {
      let err = new Error("File size exceeds size limit of 25 Mb.");
      err.code = "RQS_ERR4";
      err.mongodblog = false;
      err.user_message = msqTemplates.audiofile_format_limit_error.replace(
        "[size]",
        modelSettings.voicetotext.filesize_limit_mb.toString()
      );
      throw err;
    }

    //Скачиваем файл
    const filelink = await botInstance.getFileLink(fileid);

    const response = await axios({
      url: filelink,
      method: "GET",
      responseType: "arraybuffer",
    });
    const fileData = Buffer.from(response.data, "binary");
    var audioReadStream = Readable.from(fileData);
    audioReadStream.path = filelink.split("/").pop();

    const formData = new FormData();
    formData.append("file", audioReadStream);
    formData.append("model", modelSettings.voicetotext.default_model);

    const headers = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
    mongo.insertUsageDialoguePromise(
      msg,
      null,
      otherFunctions.countTokens(transcript),
      "voicetotext",
      modelSettings.voicetotext.default_model
    ); //ассинхронно фиксируем потраченные токены
    return transcript;
  } catch (err) {
    if (err.mongodblog === undefined) {
      err.mongodblog = true;
    }
    err.place_in_code = err.place_in_code || arguments.callee.name;
    throw err;
  }
}

async function TextToVoice(botInstance, msg,regime,model,voice,open_ai_api_key) {
  try {
    console.log(msg)

    var openai_resp;
    try {

const options = {
      url: modelSettings[regime].hostname + modelSettings[regime].url_path,
      method: "POST",
      responseType: "arraybuffer",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${open_ai_api_key}`,
      },
      validateStatus: function (status) {
        return status == appsettings.http_options.SUCCESS_CODE;
      },
      data: {
        model:model,
        input: msg.text,
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

    mongo.insertUsageDialoguePromise(
      msg,
      otherFunctions.countTokens(msg.text),
      null,
      "texttovoice",
      model
    ); //ассинхронно фиксируем потраченные токены

    const formData = new FormData();
    formData.append('chat_id', msg.chat.id);
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
  botInstance,
  sent_msg_id,
  msg,
  regime,
  open_ai_api_key,
  model,
  temperature,
  functions
) {
  try {

    const dialogueList = await mongo.getDialogueByUserIdPromise(
      msg.from.id,
      regime
    ); //получаем из базы весь предыдущий диалог
     // console.log("3","start function",new Date())
    //Подсчитаем токены из предыдущего диалога

    const token_limit =
      modelConfig[allSettingsDict[msg.from.id][regime].model]
        .request_length_limit_in_tokens;

    const dialogueListEdited = dialogueList.map(({ role, content,function_call }) => {

    let result = {
        role,
        content
    }
    if(function_call !== undefined && function_call !== null){
      result['function_call'] = function_call;
  }
  return result;
    });

        //Учитываем потраченные токены
    const previous_dialogue_tokens = otherFunctions.countTokens(JSON.stringify(dialogueListEdited))+otherFunctions.countTokens(JSON.stringify(functions))


    //console.log(dialogueListEdited)

    var chunkJsonList = [];
    var chunks;
    var completionJson = new Object();

    const options = {
      url: modelSettings[regime].hostname + modelSettings[regime].url_path,
      method: "POST",
      encoding: "utf8",
      responseType: "stream",
      timeout: appsettings.http_options.OAI_request_timeout,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${open_ai_api_key}`,
      },
      validateStatus: function (status) {
        return status == appsettings.http_options.SUCCESS_CODE;
      },
      data: {
        model:model,
        temperature: temperature,
        messages: dialogueListEdited,
        stream: true,
      },
    };
    if(functions){
      //Add functions, if they exist
      options.data.functions = functions
    }
   // console.log("4","before axios",new Date())
    axios(options)
      .then((response) => {
        //Объявляем функцию для тротлинга
        const throttlingSending = otherFunctions.throttlePromise(
          sentEditedMessage,
          appsettings.telegram_options.send_throttle_ms
        );

        const headersObject = response.headers //Записываем хэдеры
        response.data.on("data", async (chunk) => {
          const func_name = "axious responce.data.on: data";
          
          try {
            const chunkString = chunk.toString("utf8");
            
            chunks = getJsonFromChunk(
              (chunks?.incomplete ?? "") + chunkString
            );
            chunkJsonList = chunks.complete;
             


            if (
              completionJson.content == undefined &&
              chunkJsonList.length > 0
            ) {
              //ловим первый чанк, чтобы ввести в игру completionJson

              const content_parts = {
                0: { id_message: sent_msg_id, to_send: "" },
              };

              const functionCallObject = chunkJsonList[0]?.choices[0]?.delta?.function_call

              completionJson = {
                //Формируем сообщение completion
                sourceid: chunkJsonList[0].id,
                TelegramMsgId: sent_msg_id,
                createdAtSourceTS: chunkJsonList[0].created,
                createdAtSourceDT_UTC: new Date(
                  chunkJsonList[0].created * 1000
                ),
                userid: msg.from.id,
                userFirstName: msg.from.first_name,
                userLastName: msg.from.last_name,
                model: chunkJsonList[0].model,
                telegamPaused: false,
                role: chunkJsonList[0]?.choices[0]?.delta?.role,
                content: "",
                function_call:functionCallObject,
                function_arguments:"",
                content_parts: content_parts,
                completion_ended: false,
                content_ending: "",
                tokens: 0,
                regime: regime,
                telegramMsgOptions: {
                  chat_id: msg.chat.id,
                  message_id: sent_msg_id,
                  parse_mode: functionCallObject ? null : "Markdown",
                  reply_markup: functionCallObject ? null : JSON.stringify({
                    one_time_keyboard: true,
                    inline_keyboard: [
                      [
                        {
                          text: msqTemplates.regenerate.replace(
                            "[temperature]",
                            allSettingsDict[msg.from.id][regime].temperature
                          ),
                          callback_data: "regenerate_" + regime,
                        }],
                        [{
                          text: msqTemplates.readaloud,
                          callback_data: "readaloud",
                        },
                      ]
                    ],
                  }),
                },
                finish_reason: chunkJsonList[0]?.choices[0]?.finish_reason,
              };
            } else if (chunkJsonList.length == 0){
              return
            }

            
            let content = "";
            let function_arguments = ""
            for (let i = 0; i < chunkJsonList.length; i++) {
              //собираем несколько сообщений в одно

              const choice = chunkJsonList[i]?.choices[0];
              content = content + (choice?.delta?.content ?? "");
              function_arguments = function_arguments + (choice?.delta?.function_call?.arguments ?? "");

              completionJson.finish_reason = choice.finish_reason;

              completionJson.tokens = completionJson.tokens + 1; //считаем токены в комплишене
            }
            completionJson.content = completionJson.content + content;
            completionJson.function_arguments = completionJson.function_arguments + function_arguments;
            
            if (!content === "") {
              return; //Если контент пустой, то дальше не идем.
            }

            var list_of_parts_messages = Object.keys(
              completionJson.content_parts
            );
            var last_part =
              list_of_parts_messages[list_of_parts_messages.length - 1];
            const current_part =
              (completionJson.content_parts[last_part]?.to_send ?? "") +
              content;

            if (
              current_part.length >
              appsettings.telegram_options.big_outgoing_message_threshold
            ) {
              last_part = (parseInt(last_part) + 1).toString();
              completionJson.content_parts[last_part] = { to_send: "" };
            }

            completionJson.content_parts[last_part].to_send =
              (completionJson.content_parts[last_part]?.to_send ?? "") +
              content;
            if (completionJson.finish_reason == "length") {
              completionJson.completion_ended = true;
              completionJson.content_ending = "... <ответ не завершен>";
              completionJson.content_parts[last_part].content_ending =
                "... <ответ не завершен>";
            } else if (completionJson.finish_reason == "stop") {
              completionJson.completion_ended = true;
              completionJson.content_ending = "";
              completionJson.content_parts[last_part].content_ending = "";
            } else {
              completionJson.content_ending = " ...";
              completionJson.content_parts[last_part].content_ending = " ...";
            }

            if (completionJson.function_call) {//Проверяем, что это не запрос функции
              return
            } else {
              throttlingSending(botInstance, completionJson); //Отправляем пользователю ответ
            }
            
          } catch (err) {
            err.mongodblog = true;
            err.place_in_code = err.place_in_code || func_name;
            err.details = completionJson
            telegramErrorHandler.main(
              botInstance,
              msg.chat.id,
              err,
              err.place_in_code,
              err.user_message
            );
          }
        });

        response.data.on("end", async () => {
          const func_name = "axious responce.data.on: end";
          try {

            if (completionJson.content === "" && completionJson.finish_reason != 'function_call') {
              //Если не получили токенов от API
              let err = new Error("Empty response from the service.");
              err.code = "OAI_ERR2";
              err.mongodblog = true;
              err.user_message = msqTemplates.empty_completion;
              throw err;
            } 

            let functionResult = "";
            if(completionJson.finish_reason == 'function_call'){ //Уведомляем пользователя, что запрошена функция
          //    console.log("5","it is function call",new Date())
              let sentMsgId = sent_msg_id

             // console.log("In case of error",JSON.stringify(completionJson))
              if(completionJson.function_call){
                completionJson.function_call.arguments = completionJson.function_arguments
                await mongo.upsertCompletionPromise(completionJson);

                let msgTGM = msqTemplates.function_request_status_msg
                if(allSettingsDict[msg.from.id][regime].sysmsg){//Если включена функция показа системных сообщений
                  msgTGM = msqTemplates.function_request_msg.replace("[function]",JSON.stringify(completionJson.function_call))
                  if(msgTGM.length>appsettings.telegram_options.big_outgoing_message_threshold){
                    msgTGM = msgTGM.substring(0, telegram_options.big_outgoing_message_threshold) +"...\nСообщение было обрезано..."
                  }
                }
                //Отправляем пользователю статус сообщение о том, что была запрошена функция
              await botInstance.editMessageText(msgTGM,{chat_id: completionJson.telegramMsgOptions.chat_id,message_id: sentMsgId});
           //   console.log("6","function requested msg",new Date())
              msgTGM = msqTemplates.function_result_status_msg
              if(allSettingsDict[msg.from.id][regime].sysmsg){ //Если включена функция показа системных сообщений
                const rst = await botInstance.sendMessage(completionJson.telegramMsgOptions.chat_id, msqTemplates.function_result_status_msg);
                sentMsgId = rst.message_id
                } else {
                  await botInstance.editMessageText(msgTGM,{chat_id: completionJson.telegramMsgOptions.chat_id,message_id: sentMsgId});
                }

              functionResult = await telegramFunctionHandler.runFunctionRequest(msg,completionJson.function_call)

          } else {
              functionResult = "No function name found"
          }
              await mongo.upsertFuctionResultsPromise(msg, regime,functionResult,functions); //записываем вызова функции в диалог
              
  
              let msgTGM = msqTemplates.function_result_status_msg
              //Сообщая пользователю
              if(allSettingsDict[msg.from.id][regime].sysmsg){ 
                msgTGM = msqTemplates.function_result_msg.replace("[result]",functionResult)
                if(msgTGM.length>appsettings.telegram_options.big_outgoing_message_threshold){
                  msgTGM = msgTGM.substring(0, appsettings.telegram_options.big_outgoing_message_threshold) + msqTemplates.too_long_message
                }
                await botInstance.editMessageText(msgTGM,{chat_id: completionJson.telegramMsgOptions.chat_id,message_id: sentMsgId});
              }

              await botInstance.sendChatAction(completionJson.telegramMsgOptions.chat_id, "typing"); //Отправляем progress msg

              if(allSettingsDict[msg.from.id][regime].sysmsg){ 
              const rst2 = await botInstance.sendMessage(completionJson.telegramMsgOptions.chat_id, "Ждем ответа OpenAi ...");
              sentMsgId = rst2.message_id
              }

           //   console.log("7","another request",new Date())
              await chatCompletionStreamAxiosRequest(
                botInstance,
                sentMsgId,
                msg,
                regime,
                process.env.OPENAI_API_KEY,
                model,
                temperature,
                functions
                )
              }

            await mongo.insertUsageDialoguePromise(
              msg,
              previous_dialogue_tokens,
              completionJson.tokens,
              regime,
              model
            ); //фиксируем потраченные токены
          } catch (err) {
            if (err.mongodblog === undefined) {
                err.mongodblog = true;
            }
            err.details = completionJson
            err.place_in_code = err.place_in_code || func_name;
            telegramErrorHandler.main(
              botInstance,
              msg.chat.id,
              err,
              err.place_in_code,
              err.user_message
            );
          }
        });
      })
      .catch(async (error) => {
        await UnSuccessResponseHandle(
          botInstance,
          msg,
          error,
          previous_dialogue_tokens,
          token_limit
        );
      });
  } catch (err) {
    if (err.mongodblog === undefined) {
      err.mongodblog = true;
    }
    err.place_in_code = err.place_in_code || arguments.callee.name;
    throw err;
  }
}

async function sentEditedMessage(botInstance, completionJson) {
  //console.log("inside throttle",new Date(),completionJson.content.length)
  try {
    
    //обрабатываем разные сценарии завершения/продолжения стрима токенов
    await mongo.upsertCompletionPromise(completionJson); //Сначала зписываем полученное сообщение в базу

   
    if (completionJson.telegamPaused) {
      //Если телеграм не принимает сообщения, то не отправляем
      return;
    }

    //const result_of_deletion = await botInstance.deleteMessage(options.chat_id, options.message_id);
    const doc = await mongo.getCompletionById(
      completionJson.sourceid,
      completionJson.regime
    ); //Запрашиваем сообщение из базы

    completionJson.telegamPaused = true;
    let resultArray =[];
    try{
    //resultArray = await editMessageInTelegramPromise(botInstance, doc[0]);
    resultArray = await deliverMessage(botInstance, doc[0]);
    } catch(err){
      if (err.message.includes("ETELEGRAM: 429 Too Many Requests")) {
        const regex = /retry after (\d+)/i;
        const match = err.message.match(regex);
        var seconds_to_wait = 1;

        if (match) {
          seconds_to_wait = match[1];
        } else {
          err.place_in_code = err.place_in_code || arguments.callee.name;     
          throw err 
        }

        resultArray = await  deliverMessageLater(botInstance, doc[0],seconds_to_wait)
      } else {
        err.place_in_code = err.place_in_code || arguments.callee.name;     
        throw err
      }
    }

    completionJson.telegamPaused = false;
    
    resultArray.forEach((item) => {
      completionJson.content_parts[item.id].id_message = item.id_message;
      completionJson.content_parts[item.id].sent = item.text;
      completionJson.TelegramMsgId = item.id_message;
      completionJson.telegramMsgOptions.message_id = item.id_message;
    });

    await mongo.upsertCompletionPromise(completionJson); //Снова записываем полученное сообщение в базу, чтобы отобразить отправленную часть сообщения

    if (completionJson.finish_reason == "length") {
      //Если сообение оборвалось незаконченным, то отправляем доп уведомление
      await botInstance.sendMessage(
        completionJson.telegramMsgOptions.chat_id,
        msqTemplates.token_limit_exceeded
      ); //Сообщение, что лимит исчерпан
      await mongo.deleteDialogByUserPromise(
        [completionJson.userid],
        completionJson.regime
      );
      await botInstance.sendMessage(
        completionJson.telegramMsgOptions.chat_id,
        msqTemplates.dialogresetsuccessfully
      );
    }
  } catch (err) {
    //Tested
    err.mongodblog = true;
    err.place_in_code = err.place_in_code || arguments.callee.name;
    err.details  = completionJson
    telegramErrorHandler.main(
      botInstance,
      completionJson.telegramMsgOptions.chat_id,
      err,
      err.place_in_code,
      err.user_message
    );
  }
}

function getJsonFromChunk(chunkString) {
  try {
    // Если пришло сразу несолько фрагментов, они разделяются двойным
    // символом новой строки; пропускам пустые строки
    const chunkLines = chunkString
      .split("\n")
      .filter((line) => line.trim() !== "");

    // Инициализируем объект ответа функции
    const result = {
      complete: [],
      incomplete: undefined,
    };

    // Проверяем, чем заканчивается строка последнего фрагмента
    const lastLineEnding = chunkLines[chunkLines.length - 1].slice(-3);

    // Если последний фрагмент не заканчивается на `}]}` (объект фрагмента)
    // или `NE]` ("data: [DONE]"), то это незавершенный фрагмент, записываем
    // его в incomplete и убираем из массива фрагментов
    if (!lastLineEnding.endsWith("}]}") && !lastLineEnding.endsWith("NE]")) {
      result.incomplete = chunkLines.splice(-1, 1)[0];
    }

    for (const line of chunkLines) {
      // Пропускаем префикс "data: "
      const message = line.substring(6);

      try {
        // Если получили "[DONE]", завершаем работу и возвращаем ответ
        if (message === "[DONE]") {
          return result;
        }

        // Парсим JSON и добавляем в массив целых фрагментов
        result.complete.push(JSON.parse(message));
      } catch (error) {
        console.error(
          "Could not JSON parse stream message",
          "+",
          message,
          "+",
          error
        );
        mongo.insertErrorLog(error, "attempt to getJsonFromChunk");
      }
    }

    return result;
  } catch (err) {
    err.place_in_code = err.place_in_code || arguments.callee.name;
    err.details = chunkLines
    throw err;
  }
}

async function deliverMessage(botInstance, object) {
  try {
    var list_of_parts_messages = Object.keys(object.content_parts);
    let resultArray = [];
    for (let i = 0; i < list_of_parts_messages.length; i++) {
      const part_id = list_of_parts_messages[i];
      let msg_id = object.content_parts[part_id].id_message;

      if (object.content_parts[part_id].to_send === object.content_parts[part_id].sent
        &&
        ! object.completion_ended
        ) {

        mongo.insert_details_logPromise(object,"components/openAI_API_Handler.js/deliverMessage/if()")
        continue;
      };

      let text = otherFunctions.wireStingForMarkdown(object.content_parts[part_id].to_send + object.content_parts[part_id].content_ending);

      let options = {
        chat_id: object.telegramMsgOptions.chat_id,
        message_id: msg_id,
        parse_mode: object.telegramMsgOptions.parse_mode,
      };
      if (object.completion_ended) {
        //Если отправялем последнюю часть сообщения
        options.reply_markup = object.telegramMsgOptions.reply_markup;
      }

      try{
        
      if (msg_id) {
        await botInstance.editMessageText(text, options);
        resultArray.push({id: part_id,id_message: msg_id,text: object.content_parts[part_id].to_send});
      } else {
        const newMessage = await botInstance.sendMessage(object.telegramMsgOptions.chat_id,text);
        
        if (object.completion_ended) {

          options.message_id = newMessage.message_id
          await botInstance.editMessageText(text, options);
        } 
        msg_id = newMessage.message_id;
        resultArray.push({id: part_id,id_message: msg_id, text: object.content_parts[part_id].to_send});
      }
    } catch(err){
      if (err.message.includes("can't parse entities")) {
        //   Recovered after MarkdownError
        delete options.parse_mode;
        await botInstance.editMessageText(text, options);
        //   resolve([{id:part_id,id_message:msg_id,text:object.content_parts[part_id].to_send}]); //Чтобы без троеточий
        resultArray.push({id: part_id,id_message: msg_id,text: object.content_parts[part_id].to_send});
      } else {
        err.mongodblog = true;
        err.details = object
        err.place_in_code = err.place_in_code || arguments.callee.name;
        throw err
      }
    }
    }
    return resultArray;
  } catch (err) {
    err.mongodblog = true;
    err.details = object
    err.place_in_code = err.place_in_code || arguments.callee.name;
    throw err
  }
}

async function deliverMessageLater(botInstance, object,seconds_to_wait){
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try{
  const waitMessage = await botInstance.sendMessage(
    object.telegramMsgOptions.chat_id,
    msqTemplates.telegram_wait_time.replace(
      "[seconds_to_wait]",
      seconds_to_wait
    )
  );
  const deleteMsgID = waitMessage.message_id
  setTimeout(async () => {
    try{
    await botInstance.deleteMessage(
      object.telegramMsgOptions.chat_id,
      deleteMsgID
    ); //Удаляем информационное сообщение
    const doc = await mongo.getCompletionById(
      object.sourceid,
      object.regime
    );

    result = await deliverMessage(botInstance, doc[0])
    resolve(result)
    } catch(err){
      err.details = object
      err.place_in_code = err.place_in_code || func_name;     
      reject(err) 
    }
  }, seconds_to_wait * 1000)
} catch(err){
  err.details = object
  err.place_in_code = err.place_in_code || func_name;     
  reject(err) 
}
});
}


module.exports = {
  getModels,
  deliverMessage,
  chatCompletionStreamAxiosRequest,
  VoiceToText,
  deliverMessageLater,
  TextToVoice,
};
