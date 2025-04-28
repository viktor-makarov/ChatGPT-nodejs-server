const { StringDecoder } = require('string_decoder');
const { Transform } = require('stream');
const msqTemplates = require("../../config/telegramMsgTemplates");
const otherFunctions = require("../other_func");
const aws = require("../aws_func.js")
const mongo = require("../mongo");
const modelConfig = require("../../config/modelConfig");
const telegramErrorHandler = require("../telegramErrorHandler.js");
const openAIApiHandler = require("../openAI_API_Handler.js");

class Completion extends Transform {

    #chunkBuffer;
    #isProcessingChunk

    #chunkStringBuffer;
    #decoder
    #countChunks = 0;

    #responseReceived;
    #responseErrorRaw
    #responseErrorMsg = "";
    #response_status;
    
    #responseHeaders;
    #user;


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
    #long_wait_notes;
    #timeout;

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
        this.#dialogue = obj.dialogueClass;
        this.#toolCallsInstance = this.#dialogue.toolCallsInstance;

        this.#replyMsg.on('msgDelivered',this.msgDeliveredHandler.bind(this))

        this.#completionRole = "assistant";

        this.#completionContent = "";
        this.#completionContentEnding ="";
        this.#chunkStringBuffer ="";
        
        this.#completionCreatedDT_UTC = new Date();

        this.#responseReceived = false;

        this.#sendWithDelay = this.throttleFunction(
          this.sendMsg,
          appsettings.telegram_options.send_throttle_ms
        );

        this.#timeout = modelConfig[this.#user.currentModel]?.timeout_ms || 120000;
            
      };

      async router(){

        try{

          this.#completionPreviousVersionsDoc = await this.completionPreviousVersions();

          this.#updateCompletionVariables()
          
          await this.#replyMsg.sendTypingStatus()
          await this.#replyMsg.sendStatusMsg()
          this.#long_wait_notes = this.triggerLongWaitNotes()

          await openAIApiHandler.chatCompletionStreamAxiosRequest(
            this.#requestMsg,
            this.#replyMsg,
            this.#dialogue
          );

        } catch(err){
          err.place_in_code = err.place_in_code || "completion.router";
          telegramErrorHandler.main(
            {
              replyMsgInstance:this.#replyMsg,
              error_object:err
            }
          );
        
        } finally {
          this.clearLongWaitNotes()
        }

      }

      #updateCompletionVariables(){

        if(!this.#dialogue.regenerateCompletionFlag){
          this.#completionPreviousVersionsContent = [];
          this.#completionPreviousVersionsLatexFormulas = []
          this.#completionPreviousVersionsContentCount = undefined;
          this.#completionPreviousVersionNumber = undefined;
          this.#completionCurrentVersionNumber = 1
          return
        }

        const lastCompletionDoc = this.#completionPreviousVersionsDoc

        if(!lastCompletionDoc){
          this.#completionPreviousVersionsContent = [];
          this.#completionPreviousVersionsLatexFormulas = []
          this.#completionPreviousVersionsContentCount = undefined;
          this.#completionPreviousVersionNumber = undefined;
          this.#completionCurrentVersionNumber = 1
          return 
        }

        //Standartization of content and latex formulas
        if(Array.isArray(lastCompletionDoc?.content)){
          this.#completionPreviousVersionsContent = lastCompletionDoc.content;
          this.#completionPreviousVersionsLatexFormulas = lastCompletionDoc?.content_latex_formula || [];

        } else {
          this.#completionPreviousVersionsContent = lastCompletionDoc.content ? [lastCompletionDoc.content] : [];
          this.#completionPreviousVersionsLatexFormulas = lastCompletionDoc?.content_latex_formula ? [lastCompletionDoc?.content_latex_formula] : [];

        }

        this.#completionPreviousVersionsContentCount = this.#completionPreviousVersionsContent.length
        this.#completionPreviousVersionNumber = lastCompletionDoc.completion_version;
        this.#completionCurrentVersionNumber = this.#completionPreviousVersionsContentCount + 1

      
      }


      async completionPreviousVersions(){

        const lastCompletionDoc = await this.#dialogue.getLastCompletionDoc()
  
        if(!lastCompletionDoc){
          return null
        }
         return lastCompletionDoc;
      }

      triggerLongWaitNotes(){
  
        const long_wait_notes = modelConfig[this.#user.currentModel]?.long_wait_notes
        let timeouts =[];
        if(long_wait_notes && long_wait_notes.length >0){
            
            for (const note of long_wait_notes){
                const timeoutInstance = setTimeout(() => {
                  this.updateStatusMsg(note.comment)
                }, note.time_ms);
                timeouts.push(timeoutInstance)
            }
        }
        return timeouts
    };

      clearLongWaitNotes() {
        if (this.#long_wait_notes && this.#long_wait_notes.length > 0) {
            this.#long_wait_notes.forEach(timeout => clearTimeout(timeout));
            this.#long_wait_notes = [];
        }
    }

    async msgDeliveredHandler(data){
      await mongo.updateCompletionInDb({
        filter: {telegramMsgId:data.message_id},       
        updateBody:this.completionFieldsToUpdate
      })
      console.log("Completion updated in DB")
    }

   

    async handleResponceError(value){

      this.#responseErrorRaw = value;

      this.#response_status = this.#responseErrorRaw.response.status 
      this.#responseReceived = true;

      try{
        this.#responseErrorRaw.response.data.on('data', chunk => {
          this.#responseErrorMsg += this.#decoder.write(chunk);
        });

        this.#responseErrorRaw.response.data.on('end', async () => {
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

    get timeout(){
      return this.#timeout  
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

      const completionId = this.#dialogue.regenerateCompletionFlag ?  this.#completionPreviousVersionsDoc?.sourceid : this.#completionId
      
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

    async UnSuccessResponseHandle(error) {

      try{
      this.#response_status = error.response.status
        let err = new Error(error.message);
        err.message_from_response = this.#responseErrorMsg
        err.place_in_code = err.place_in_code || "Completion.UnSuccessResponseHandle";
        if (this.#response_status === 400 || error.message.includes("400")) {
          if(this.#responseErrorMsg.includes("context_length_exceeded")){
            await this.#replyMsg.sendToNewMessage(msqTemplates.token_limit_exceeded,null,null)
            const response = await this.#dialogue.resetDialogue()
            await this.#replyMsg.sendToNewMessage(response.text,response?.buttons?.reply_markup,response?.parse_mode)
          } else {
            err.code = "OAI_ERR_400";
            err.user_message = msqTemplates.OAI_ERR_400.replace("[original_message]",err?.message_from_response ?? "отсутствует");
            throw err;
          }
        } else if (this.#response_status === 401 || error.message.includes("401")) {
          err.code = "OAI_ERR_401";
          err.user_message = msqTemplates.OAI_ERR_401.replace("[original_message]",err?.message_from_response ?? "отсутствует");
          throw err;
        } else if (this.#response_status === 429 || error.message.includes("429")) {
          err.code = "OAI_ERR_429";
          err.data = error.data
          err.user_message = msqTemplates.OAI_ERR_429.replace("[original_message]",err?.message_from_response?? "отсутствует");
          err.mongodblog = false;
          throw err;
        } else if (this.#response_status === 501 || error.message.includes("501")) {
          err.code = "OAI_ERR_501";
          err.user_message = msqTemplates.OAI_ERR_501.replace("[original_message]",err?.message_from_response ?? "отсутствует");
          throw err;
        } else if (this.#response_status === 503 || error.message.includes("503")) {
          err.code = "OAI_ERR_503";
          err.user_message = msqTemplates.OAI_ERR_503.replace("[original_message]",err?.message_from_response ?? "отсутствует");
          throw err;
        }  else if (error.code === "ECONNABORTED") {
            err.code = "OAI_ERR_408";
            err.user_message = msqTemplates.OAI_ERR_408;
            throw err;

        } else {
          err.code = "OAI_ERR99";
          err.user_message = msqTemplates.error_api_other_problems;
          throw err;
        }
      } catch(err){
        err.place_in_code = err.place_in_code || "completion.UnSuccessResponseHandle";
        telegramErrorHandler.main(
          {
            replyMsgInstance:this.#replyMsg,
            error_object:err
          }
        );
      }
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
      
      const completionObject = this.currentCompletionObj
      await this.#dialogue.commitCompletionDialogue(completionObject)

      await this.#dialogue.finalizeTokenUsage(completionObject,this.#tokenUsage)
      
      this.#dialogue.emit('triggerToolCall', completionObject.tool_calls) 

      this.#decoder.end()
      
      this.#dialogue.regenerateCompletionFlag = false
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
        this.#replyMsg.deliverCompletionToTelegramThrottled(this)
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
                
                this.#tool_calls.at(-1).type = this.#tool_calls.at(-1)?.type ?? tool_call.type
                this.#tool_calls.at(-1).function = this.#tool_calls.at(-1)?.function ?? tool_call.function
                this.#tool_calls.at(-1).function.name = this.#tool_calls.at(-1).function?.name ?? tool_call.function.name
                this.#tool_calls.at(-1).function.arguments += tool_call.function.arguments
              }
            }
          }
        }
      }
      this.#replyMsg.text = this.#completionContent;

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