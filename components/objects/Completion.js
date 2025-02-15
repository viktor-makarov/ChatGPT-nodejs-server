const { StringDecoder } = require('string_decoder');
const { Transform } = require('stream');
const msqTemplates = require("../../config/telegramMsgTemplates");

const mongo = require("../mongo");
const modelConfig = require("../../config/modelConfig");
const telegramErrorHandler = require("../telegramErrorHandler.js");
const fs = require('fs');

class Completion extends Transform {

    #chunkBuffer;
    #isProcessingChunk

    #chunkStringBuffer;
    #decoder
    #countChunks = 0;

    #responseReceived;
    #responseErrorRaw
    #responseErrorMsg;
    #response_status;
    
    #responseHeaders;
    #user;

    #overalltokensLimit;

    #telegramMsgBtns = false;

    #requestMsg;
    #replyMsg;
    #dialogue;

    #completionId;
    #completionCreatedTS;
    #completionCreatedDT_UTC;
    #completionRole;
    #completionContent;
    #completionLatexFormulas;
    #completionContentEnding
    #completionFinishReason;
    #completionSystem_fingerprint;
    #tokenUsage;
    #completion_ended = false
    #completionPreviousVersionsDoc;
    #completionPreviousVersionsContent = [];
    #completionPreviousVersionsLatexFormulas = [];
    #completionPreviousVersionsContentCount;
    #completionPreviousVersionNumber;
    #completionCurrentVersionNumber = 1;

    #toolCallsInstance;
    #tool_calls=[];

    #actualModel;
    #sendWithDelay;

    constructor(obj) {
        super({ readableObjectMode: true });
        this.#chunkBuffer =[];
        this.#isProcessingChunk = false;
        this.#decoder = new StringDecoder("utf8"); 

        this.#user = obj.userClass;
        this.#requestMsg = obj.requestMsg;
        this.#replyMsg = obj.replyMsg;
        this.#toolCallsInstance = obj.toolCallsInstance;
        this.#replyMsg.on('msgDelivered',this.msgDeliveredHandler.bind(this))
        this.#replyMsg.on('btnsDeleted',this.btnsDeletedHandler.bind(this))
        this.#dialogue = obj.dialogueClass;

        this.#completionRole = "assistant";

        this.#completionCreatedDT_UTC = new Date();
        
        this.#completionContent = "";
        this.#completionContentEnding ="";
        this.#chunkStringBuffer ="";
        
        this.#responseReceived = false;

        this.#overalltokensLimit = modelConfig[this.#user.currentModel].request_length_limit_in_tokens

        this.#sendWithDelay = this.throttleFunction(
          this.sendMsg,
          appsettings.telegram_options.send_throttle_ms
        );

        this.#completionPreviousVersionsDoc = this.completionPreviousVersions(this.#dialogue.dialogueFull);
        
        setTimeout(() => {this.updateStatusMsg(msqTemplates.timeout_messages[0],this.#responseReceived)}, appsettings?.http_options?.first_timeout_notice ? appsettings?.http_options?.first_timeout_notice : 15000);
        setTimeout(() => {this.updateStatusMsg(msqTemplates.timeout_messages[1],this.#responseReceived)}, appsettings?.http_options?.second_timeout_notice ? appsettings?.http_options?.second_timeout_notice : 30000);
        setTimeout(() => {this.updateStatusMsg(msqTemplates.timeout_messages[2],this.#responseReceived)}, appsettings?.http_options?.third_timeout_notice ? appsettings?.http_options?.third_timeout_notice : 45000);
        setTimeout(() => {this.updateStatusMsg(msqTemplates.timeout_messages[3],this.#responseReceived)}, appsettings?.http_options?.fourth_timeout_notice ? appsettings?.http_options?.fourth_timeout_notice : 60000);
        setTimeout(() => {this.updateStatusMsg(msqTemplates.timeout_messages[4],this.#responseReceived)}, appsettings?.http_options?.fiveth_timeout_notice ? appsettings?.http_options?.fiveth_timeout_notice : 90000);     
      };

    async msgDeliveredHandler(data){
      await mongo.updateCompletionInDb({
        filter: {telegramMsgId:data.message_id},       
        updateBody:this.completionFieldsToUpdate
      })
    }

    async btnsDeletedHandler(data){
      await mongo.updateCompletionInDb({
        filter: {telegramMsgId:{"$in":data.msgIds}},
        updateBody:{telegramMsgBtns:false}
      })
    }

    completionPreviousVersions(dialogueFromDB){

      if(!Array.isArray(dialogueFromDB) || dialogueFromDB.length ===0){
        return null;
      }

      const lastDocumentInDialogue = dialogueFromDB[dialogueFromDB.length-1]

      if(lastDocumentInDialogue.role === "assistant"){
        this.#completionPreviousVersionsContent = lastDocumentInDialogue.content;
        this.#completionPreviousVersionsLatexFormulas = lastDocumentInDialogue.content_latex_formula;
        if(Array.isArray(this.#completionPreviousVersionsContent)){
          this.#completionPreviousVersionsContentCount = this.#completionPreviousVersionsContent.length
          this.#completionPreviousVersionNumber = lastDocumentInDialogue.completion_version;
          this.#completionCurrentVersionNumber = this.#completionPreviousVersionsContentCount + 1
          
        }
        return lastDocumentInDialogue;
      } else {
        return null;
      };
    }

    async handleResponceError(value){
      this.#responseErrorRaw = value;

      this.#response_status = value.response.status 
      this.#responseReceived = true;

      this.#replyMsg.simpleMessageUpdate("Ой-ой! :-(",{
        chat_id:this.#replyMsg.chatId,
        message_id:this.#replyMsg.lastMsgSentId
      })

      try{
        value.response.data.on('data', chunk => {
          this.#responseErrorMsg += this.#decoder.write(chunk);
        });

        value.response.data.on('end', async () => {
          await this.UnSuccessResponseHandle(this.#responseErrorRaw)
        });

      } catch(err){
        this.#responseErrorMsg = {error:"Unable to derive error details from the service reply."}
        await this.UnSuccessResponseHandle(this.#responseErrorRaw)
      }
      
    };
    
    set response(value){
        this.#responseHeaders = value.headers
        this.#responseReceived = true;
    }

    set completionLatexFormulas(value){
      this.#completionLatexFormulas = value;
    }

    get completionLatexFormulas(){
      return this.#completionLatexFormulas
    } 

    set telegramMsgBtns(value){
      this.#telegramMsgBtns = value
    }

    get completionFieldsToUpdate(){

      this.#completionPreviousVersionsContent[this.#completionCurrentVersionNumber-1] = this.#completionContent
      this.#completionPreviousVersionsLatexFormulas[this.#completionCurrentVersionNumber-1] = this.#completionLatexFormulas
      
      const result =  {
        telegramMsgId:this.#replyMsg.msgIdsForDbCompletion,
        telegramMsgBtns:this.#telegramMsgBtns,
        content: this.#completionPreviousVersionsContent,
        content_latex_formula:this.#completionPreviousVersionsLatexFormulas
      }
      return result
    }
    
    get currentCompletionObj(){

      this.#completionPreviousVersionsContent[this.#completionCurrentVersionNumber-1] = this.#completionContent
      this.#completionPreviousVersionsLatexFormulas[this.#completionCurrentVersionNumber-1] = this.#completionLatexFormulas

      const completionId = this.#completionPreviousVersionsDoc?.sourceid ? this.#completionPreviousVersionsDoc.sourceid : this.#completionId
      
      const completionTokenCount = this.#completionPreviousVersionsDoc?.tokens ? this.#completionPreviousVersionsDoc?.tokens + this.#tokenUsage.completion_tokens : this.#tokenUsage.completion_tokens
        return {
            //Формируем сообщение completion
            sourceid: completionId,
            createdAtSourceTS: this.#completionCreatedTS,
            createdAtSourceDT_UTC: this.#completionCreatedDT_UTC,
            telegramMsgId:this.#replyMsg.msgIdsForDbCompletion,
            telegramMsgBtns:this.#telegramMsgBtns,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            model: this.#user.currentModel,
            role: this.#completionRole,
            
            roleid:2,
            tool_calls:this.#tool_calls,
            tool_choice:this.#dialogue.tool_choice,
            completion_version:this.#completionCurrentVersionNumber,
            content: this.#completionPreviousVersionsContent,
            content_latex_formula:this.#completionPreviousVersionsLatexFormulas,           
            completion_ended: this.#completion_ended,
            content_ending: this.#completionContentEnding,
            tokens: completionTokenCount,
            regime: this.#user.currentRegime,
            finish_reason: this.#completionFinishReason,
          }
    }

    get completionCurrentVersionNumber(){
      return this.#completionCurrentVersionNumber
    }

    get toolCalls(){

      return this.#tool_calls
    }

    async UnSuccessResponseHandle(
      error
    ) {
      try {
        //  var err = new Error(api_res.statusMessage); //создаем ошибку и наполняем содержанием
        
        let err
        if (this.#response_status === 400 || error.message.includes("400")) {
          err = new Error(error.message);
          err.code = "OAI_ERR_400";
          err.message_from_response = this.#responseErrorMsg
          err.user_message = msqTemplates.OAI_ERR_400.replace("[original_message]",err?.message_from_response ?? "отсутствует");
          err.mongodblog = true;
          err.place_in_code = err.place_in_code || "UnSuccessResponseHandle";
          throw err;
        } else if (this.#response_status === 401 || error.message.includes("401")) {
          err = new Error(error.message);
          err.code = "OAI_ERR_401";
          err.message_from_response = this.#responseErrorMsg
          err.user_message = msqTemplates.OAI_ERR_401.replace("[original_message]",err?.message_from_response ?? "отсутствует");
          err.mongodblog = true;
          err.place_in_code = err.place_in_code || "UnSuccessResponseHandle";
          throw err;
        } else if (this.#response_status === 429 || error.message.includes("429")) {
          err = new Error(error.message);
          err.code = "OAI_ERR_429";
          err.data = error.data
          err.message_from_response = this.#responseErrorMsg
          err.user_message = msqTemplates.OAI_ERR_429.replace("[original_message]",err?.message_from_response?? "отсутствует");
          err.mongodblog = false;
          err.place_in_code = err.place_in_code || "UnSuccessResponseHandle";
          throw err;
        } else if (this.#response_status === 501 || error.message.includes("501")) {
          err = new Error(error.message);
          err.code = "OAI_ERR_501";
          err.message_from_response = this.#responseErrorMsg
          err.user_message = msqTemplates.OAI_ERR_501.replace("[original_message]",err?.message_from_response ?? "отсутствует");
          err.mongodblog = true;
          err.place_in_code = err.place_in_code || "UnSuccessResponseHandle";
          throw err;
        } else if (this.#response_status === 503 || error.message.includes("503")) {
          err = new Error(error.message);
          err.code = "OAI_ERR_503";
          err.message_from_response = this.#responseErrorMsg
          err.user_message = msqTemplates.OAI_ERR_503.replace("[original_message]",err?.message_from_response ?? "отсутствует");
          err.mongodblog = true;
          err.place_in_code = err.place_in_code || "UnSuccessResponseHandle";
          throw err;
        }  else if (error.code === "ECONNABORTED") {
            err = new Error(error.message);
            err.code = "OAI_ERR_408";
            err.user_message = msqTemplates.OAI_ERR_408;
            err.mongodblog = true;
            err.place_in_code = err.place_in_code || "UnSuccessResponseHandle";
            throw err;
        } else if (this.#dialogue.allDialogueTokens > this.#overalltokensLimit) {
          //Проверяем, что кол-во токенов не превышает лимит
    
          await this.OverlengthErrorHandle();
        } else {
          err = new Error(error.message);
          err.code = "OAI_ERR99";
          err.user_message = msqTemplates.error_api_other_problems;
          err.mongodblog = true;
          err.place_in_code = err.place_in_code || "UnSuccessResponseHandle";
          throw err;
        }
      } catch (err) {
        if (err.mongodblog === undefined) {
          err.mongodblog = true;
        }
    
        err.place_in_code = err.place_in_code || "UnSuccessResponseHandle";
        telegramErrorHandler.main({
          replyMsgInstance:this.#replyMsg,
          error_object:err,
          place_in_code:err.place_in_code,
          user_message:err.user_message
        });
      }
    }

    async OverlengthErrorHandle() {
        //Логируем ошибку и отправляем сообщение пользователю
        await this.#replyMsg.simpleSendNewMessage(msqTemplates.overlimit_dialog_msg +
          ` Размер вашего диалога = ${this.#dialogue.tokensWithCurrentPrompt} токенов. Ограничение данной модели = ${this.#overalltokensLimit} токенов.`) 
        
        await mongo.deleteDialogByUserPromise([this.#user.userid], null); //Удаляем диалог
        await aws.deleteS3FilesByPefix(this.#user.userid) 
        await this.#replyMsg.simpleSendNewMessage(msqTemplates.dialogresetsuccessfully)
        //Сообщение, что диалог перезапущен
    }

    _transform(chunk, encoding, callback) {
      this.#chunkBuffer.push(chunk);
      if (!this.#isProcessingChunk && this.#chunkBuffer.length > 0) {
          const chunksToProcess = this.#chunkBuffer;
          this.#chunkBuffer = [];
          this.processChunksBatch(chunksToProcess); //здесь нужно выполнять асинхронно
      }
      callback();
    };

    checkIfCompletionIsEmpty(){

      if (this.#completionContent === "" && this.#completionFinishReason != 'tool_calls') {
        //Если не получили токенов от API
        let err = new Error("Empty response from the service.");
        err.code = "OAI_ERR2";
        err.mongodblog = true;
        err.user_message = msqTemplates.empty_completion;
        throw err;
      };
    }

    async end(chunk, encoding, callback){
      
      //Complete processing of chunks
      if (this.#chunkBuffer.length > 0) {
        const chunksToProcess = this.#chunkBuffer;
        this.#chunkBuffer = [];
        await this.processChunksBatch(chunksToProcess); //здесь выполнение должно быть именно синхронное
        console.log(new Date(),"end: part inside this.#chunkBuffer.length > 0.Test part 2.")
      }
      console.log(new Date(),"end: part outside this.#chunkBuffer.length > 0. Test part 2.")

      this.checkIfCompletionIsEmpty()

      await this.#dialogue.commitCompletionDialogue(this.currentCompletionObj,this.#tokenUsage)
      
      this.#decoder.end()
      this.#chunkStringBuffer="";
      this.#responseReceived = true;
    //  console.log(JSON.stringify(this.currentCompletionObj,null,4))
    }

    async processChunksBatch(chunksToProcess){

        this.#countChunks +=  chunksToProcess.length
        this.#isProcessingChunk = true;
        const concatenatedBatch = Buffer.concat(chunksToProcess);
        const batchString = this.#decoder.write(concatenatedBatch)
        
        const jsonChunks = await this.batchStringToJson(batchString);

        await this.extractData(jsonChunks)
        //if(!this.#replyMsg.sendingInProgress){
        this.#replyMsg.deliverCompletionToTelegramThrottled(this)
        //}
        this.#isProcessingChunk = false;
    }

    async batchStringToJson(batchString){

    const augumentedBatchString = this.#chunkStringBuffer + batchString

    const stringChunks = augumentedBatchString
      .split("\n")  
      .filter((piece) => piece.trim() !== "")

      let jsonChunks = []

      if(stringChunks.length===0){
        this.#chunkStringBuffer="";
        return jsonChunks
      };

      for (const stringChunk of stringChunks){
        if(stringChunk==="data: [DONE]"){
          this.#chunkStringBuffer = "";
          this.#completion_ended = false;
          return jsonChunks
        } else {
          try{
            const jsonChunk = JSON.parse(stringChunk.trim().substring(6))
            jsonChunks.push(jsonChunk)
            this.#chunkStringBuffer = "";
          } catch(err) {
            this.#chunkStringBuffer = stringChunk;
          }
        }
      };

      return jsonChunks
    }

    async extractData(jsonChunks){
   //   console.log(JSON.stringify(jsonChunks,null,4))

      
      //console.log(jsonChunks[0].choices[0].delta.content)
      for (const chunk of jsonChunks){
        
        this.#completionId = this.#completionId ?? chunk.id
        this.#completionCreatedTS = this.#completionCreatedTS ?? chunk.created
        this.#completionSystem_fingerprint = this.#completionSystem_fingerprint ?? chunk.system_fingerprint
        this.#actualModel = this.#actualModel ?? chunk.model
        this.#tokenUsage = this.#tokenUsage ?? chunk.usage
        const choices = chunk.choices
        if (choices && choices.length >0){

          for (const choice of choices){
            this.#completionFinishReason = this.#completionFinishReason ?? choice?.finish_reason
            this.completionStausUpdate()

            const delta = choice?.delta

            const content = (delta?.content ?? "");
            this.#completionContent += content

            const tool_calls = delta?.tool_calls;
            let tool_call = tool_calls ? tool_calls[0] : null;

            if (tool_call) {
              if(tool_call.id){ //id is present in the chunks. It means that new tool_call starts
                if(tool_call?.function){ //ensure arguments field is present in the object
                  if(!tool_call.function?.arguments){
                    tool_call.function.arguments = ""
                  }
                } else {
                  tool_call["function"] = {"arguments": ""}
                }
                this.#tool_calls.push(tool_call)
              } else {
                
                const lastKey = this.#tool_calls.length - 1;
                this.#tool_calls[lastKey].type = this.#tool_calls[lastKey]?.type ?? tool_call.type
                this.#tool_calls[lastKey].function = this.#tool_calls[lastKey]?.function ?? tool_call.function
                this.#tool_calls[lastKey].function.name = this.#tool_calls[lastKey].function?.name ?? tool_call.function.name
                this.#tool_calls[lastKey].function.arguments += tool_call.function.arguments
              }
            }
          }
        }
      }
      this.#replyMsg.text = this.#completionContent;
      this.#toolCallsInstance.tool_calls = this.#tool_calls;

    }

    completionStausUpdate(){
      if (this.#completionFinishReason == "length" || this.#completionFinishReason == "stop") {
        this.#completion_ended = true;
        console.log(new Date(),"Completion finished. Test part 1")
        this.#replyMsg.completion_ended = true;
      }
    }

    async updateStatusMsg(user_message){

    if(!this.#responseReceived){

      await this.#replyMsg.simpleMessageUpdate(
        user_message,
        {
          chat_id: this.#replyMsg.chatId,
          message_id: this.#replyMsg.lastMsgSentId,
        }
      );
      }
    };

    throttleFunction(fn, delay) {
      let timerId;
      let lastExecutedTime = 0;
    
      return function () {
        return new Promise((resolve) => {
        const context = this;
        const args = arguments;
    
        const execute = function () {
          resolve(fn.apply(context, args));
          lastExecutedTime = Date.now();
        };
    
        if (timerId) {
          clearTimeout(timerId);
        }
      //  console.log(Date.now() - lastExecutedTime)
        if (lastExecutedTime===0){ //first start
          lastExecutedTime = Date.now();
        }
        
        if (Date.now() - lastExecutedTime > delay) {
          execute();
        } else {
          timerId = setTimeout(execute, delay);
        }
      })
      };
    }

    };
    
    module.exports = Completion;