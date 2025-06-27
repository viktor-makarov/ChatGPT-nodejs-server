const { StringDecoder } = require('string_decoder');
const { Transform } = require('stream');
const otherFunctions = require("../common_functions.js");
const mongo = require("../apis/mongo.js");
const modelConfig = require("../../config/modelConfig");
const telegramErrorHandler = require("../errorHandler.js");
const openAIApi = require("../apis/openAI_API.js");
const FunctionCall  = require("./FunctionCall.js");
const toolsCollection = require("./toolsCollection.js");
const { error } = require('console');


class Completion extends Transform {

    #chunkBuffer;
    #isProcessingChunk;

    #chunkStringBuffer;
    #decoder;
    #countChunks = 0;

    #responseErrorRaw;
    #responseErrorMsg = "";
    #response_status;
    
    #responseHeaders;
    #user;
    #functionCalls = {};

    #telegramMsgBtns = false;
    #telegramMsgRegenerateBtns = false;
    #telegramMsgReplyMarkup = null;
    #telegramMsgIds = [];

    #message_output_item_status;
    #message_output_item_type

    #output_items;
    #requestMsg;
    #replyMsg;
    #dialogue;
    #responseId;
    #completionId;
    #completionCreatedTS;
    #completionCreatedDT_UTC;
    #completionRole;
    #completionContent;

    #completionFinishReason;
    #completionSystem_fingerprint;
    #tokenUsage;
    #completion_ended = false;
    #completionPreviousVersionsDoc;
    #completionPreviousVersionsContent = [];
    #completionPreviousVersionsLatexFormulas = [];
    #completionPreviousVersionsContentCount;
    #completionPreviousVersionNumber;
    #completionCurrentVersionNumber = 1;
    #long_wait_notes;
    #timeout;

    #throttledDeliverResponseToTgm;
    #deliverResponseToTgm;
    #toolCallsInstance;
    #tool_calls=[];
    #text ="";
    #message_sourceid;

    #actualModel;
    #tokenFetchLimitPcs = (appsettings?.functions_options?.fetch_text_limit_pcs ? appsettings?.functions_options?.fetch_text_limit_pcs : 80)/100;
    #overalTokenLimit;
    #message_output_item_index
    
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
        this.#chunkStringBuffer ="";
        this.#completionCreatedDT_UTC = new Date();
        this.#timeout = modelConfig[this.#user.currentModel]?.timeout_ms || 120000;
        this.#overalTokenLimit = this.#user?.currentModel ? modelConfig[this.#user.currentModel]?.request_length_limit_in_tokens : null
      };


      async registerNewEvent(event,evensOccured){

        const {type} = event;
        if(!evensOccured.includes(type)){
          await mongo.saveNewEvent(event)
          evensOccured.push(type);
        }
      }

      async responseEventsHandler(responseStream){

        let evensOccured = await mongo.getEventsList()

        for await (const event of responseStream) {
            const {sequence_number, response,output_index,item,content_index } = event;
            const response_type = event.type;
            await this.registerNewEvent(event,evensOccured)
          //  console.log(sequence_number,response_type,output_index,content_index)

            switch (response_type) {
                case 'response.created':
                    const {id,created_at} = response;

                    this.clearLongWaitNotes()
                    
                    this.#responseId = id;
                    this.#completionCreatedTS= created_at;
                    this.#completionCreatedDT_UTC = new Date(created_at * 1000).toISOString();
                    this.#output_items ={};
                    break;

                case 'response.output_item.added':
                    const {status,role} = item;
                    const item_type = item.type;
                    this.#message_output_item_status = status;
                    this.#output_items[output_index] = {type:item_type,status}
                    switch (item_type) {
                      case 'message':
                        this.#message_sourceid = `${this.#responseId}_output_index_${output_index}`;
                        this.#completionRole = role;
                        this.#message_output_item_type = item_type;
                        this.#message_output_item_status = status;
                        this.#message_output_item_index = output_index;
                        break;
                      case 'function_call':
                        await this.createFunctionCall(event)
                        break;
                    }
                    break;

                case 'response.output_text.delta':
                    switch (this.#output_items[output_index].type) {
                      case 'message':
                        this.#text += event?.delta || "";
                        this.#throttledDeliverResponseToTgm()
                      break;
                    }
                    
                    break;
                case 'response.output_item.done':
                    switch (this.#output_items[output_index].type) {
                      case 'message':
                        this.#completion_ended = true;
                        this.#replyMsg.completion_ended = true;
                        this.#message_output_item_status = item?.status;
                        this.#completionContent = item?.content[output_index];
                        await this.#dialogue.commitCompletionDialogue(this.currentCompletionObj)
                        this.completedOutputItem(output_index)
                      break;
                      case 'function_call':
                        this.triggerFunctionCall(event)
                        .then(index=> this.completedOutputItem(index))
                        .catch(index => this.failedOutputItem(index))
                        break;
                    }
                    break;
                case 'response.completed':
                    await this.#dialogue.finalizeTokenUsage(this.currentCompletionObj,response.usage)
                    break;

                case 'response.incomplete':
                    await this.#dialogue.finalizeTokenUsage(this.currentCompletionObj,response.usage)
                    break;

                case 'response.failed':
                    const {error} = response;
                    const {code,message} = error;
                    const err = new Error(`${code}: ${message}`);
                    err.code = "OAI_ERR99"
                    err.user_message = message
                    err.place_in_code = "responseEventsHandler.failed";
                    throw err;
            }
        }
      }

      completedOutputItem(output_index){
        this.#output_items[output_index].status = "completed";
      }

      failedOutputItem(output_index){
        this.#output_items[output_index].status = "failed";
      }

      async createFunctionCall(event){

        const {item,output_index} = event;
        const {id,call_id,name,status} = item;
        const item_type = item.type;

        const options ={
            functionCall:{
              responseId:id,
              status:status,
              tool_call_id:call_id,
              tool_call_index:output_index,
              tool_call_type:item_type,
              function_name:name,
              tool_config:await toolsCollection.toolConfigByFunctionName(name,this.#user)
           },
            replyMsgInstance:this.#replyMsg,
            dialogueInstance:this.#dialogue,
            requestMsgInstance:this.#requestMsg
        };
        this.#functionCalls[output_index] = new FunctionCall(options)
      }

      async triggerFunctionCall(event){
        const {output_index,item} = event;

        try{
        const {status,call_id,name} = item
        const item_type = item.type;
        this.#functionCalls[output_index].function_arguments = item?.arguments;
        const tollCallIndexes = Object.keys(this.#functionCalls)

        const currentTokenLimit = (this.#overalTokenLimit- await this.#dialogue.metaGetTotalTokens())*this.#tokenFetchLimitPcs;
        const divisor = tollCallIndexes.length === 0 ? 1 : tollCallIndexes.length;
        const tokensLimitPerCall = currentTokenLimit / divisor;

        tollCallIndexes.forEach((index) => {
          this.#functionCalls[index].tokensLimitPerCall = tokensLimitPerCall;
        })

        await this.#dialogue.commitFunctionCallToDialogue({
          tool_call_id:call_id,
          function_name:name,
          tool_config:this.#functionCalls[output_index].tool_config,
          output_item_index:output_index,
          responseId:this.#responseId,
          sourceid:`${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_call`,
          function_arguments:item?.arguments,
          status:status,
          type:item_type
        })

        await this.#dialogue.preCommitFunctionReply({
          tool_call_id:call_id,
          function_name:name,
          output_item_index:output_index,
          tool_config:this.#functionCalls[output_index].tool_config,
          sourceid:`${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_output`,
          status:"in_progress",
          type:"function_call_output"
        })

        const outcome = await this.#functionCalls[output_index].router();
        const {supportive_data,success,tool_call_id,function_name} = outcome;
       
        const toolExecutionResult = {tool_call_id,success,function_name,
          sourceid:`${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_output`,
          duration: supportive_data?.duration || 0,
          fullContent:supportive_data?.fullContent,
          status:"completed",
          content:JSON.stringify(outcome,this.modifyStringify,2)
        }

        const promiseInParallel = [
          this.#dialogue.updateCommitToolReply(toolExecutionResult),
          this.commitImage(supportive_data,function_name)
        ]

        await Promise.all(promiseInParallel)

        } catch(err){
          err.place_in_code = error.place_in_code || "triggerFunctionCall";
          telegramErrorHandler.main(
                          {
                          replyMsgInstance:this.#replyMsg,
                          error_object:err
                          }
                      );
          throw err;
        } finally {
          return output_index
        }
        }

        modifyStringify(key,value){

            if (key === 'supportive_data' || key === 'tool_call_id' || key === 'function_name') {
                return undefined; // Exclude this key from the JSON stringification
            }
        return value
        }

      async commitImage(supportive_data,function_name){

            const mdj_public_url = supportive_data?.image_url;
            const mdj_image_base64 = supportive_data?.base64;
            const mdj_prompt = supportive_data?.midjourney_prompt;

            if(function_name==="create_midjourney_image" && mdj_public_url){
            const fileComment = {
                midjourney_prompt:mdj_prompt,
                public_url:mdj_public_url,
                context:"Image has been generated by 'create_midjourney_image' function",
            }
            await this.#dialogue.commitImageToDialogue(mdj_public_url,mdj_image_base64,fileComment)
          }
        }

      async waitForFinalization(){
        while (Object.values(this.#output_items).some(item => item.status === "in_progress")){
          await otherFunctions.delay(1000)
        }
      }
      
      async router(){

        try{
          
          this.#completionPreviousVersionsDoc = await this.completionPreviousVersions();
          this.#updateCompletionVariables()
          
          await this.#replyMsg.sendTypingStatus()
          const statusMsg = await this.#replyMsg.sendStatusMsg()
          
          this.#long_wait_notes = this.triggerLongWaitNotes(statusMsg)
          
          this.#deliverResponseToTgm = this.deliverResponseToTgmHandler(statusMsg.message_id,statusMsg.text.length);
          this.#throttledDeliverResponseToTgm = this.throttleWithImmediateStart(this.#deliverResponseToTgm,appsettings.telegram_options.send_throttle_ms)
          
          let responseStream;
          try{
            responseStream = await openAIApi.responseStream(this.#dialogue)

          } catch(err){

            this.clearLongWaitNotes()
            if(err.resetDialogue){
              const response = await this.#dialogue.resetDialogue()
              await this.#replyMsg.simpleMessageUpdate(response.text,{
                chat_id:replyMsg.chatId,
                message_id:replyMsg.lastMsgSentId
              })
              await this.#replyMsg.sendToNewMessage(err.resetDialogue?.message_to_user,null,null)
              return
            } else {
              throw err
            }
          }

          await this.responseEventsHandler(responseStream);
          await this.waitForFinalization()

          if(Object.values(this.#output_items).some(item => item.type === "function_call")){
            this.#dialogue.emit('callCompletion');
          }
          
        } catch(err){

          await this.#replyMsg.simpleMessageUpdate("Ой-ой! :-(",{
            chat_id:this.#replyMsg.chatId,
            message_id:this.#replyMsg.lastMsgSentId
            })
          
          err.place_in_code = err.place_in_code || "completion.router";
          telegramErrorHandler.main(
            {
              replyMsgInstance:this.#replyMsg,
              error_object:err
            }
          );
        
        } finally{
          this.#decoder.end()
          this.#dialogue.regenerateCompletionFlag = false
        } 

      }

      async waitForTheStreamToFinish(stream){
  
      return new Promise((resolve, reject) => {
        stream.on('end', () => {
          resolve();
        });
        stream.on('error', (err) => {
          reject(err);
        });
      });

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

        this.#completionPreviousVersionsContent = lastCompletionDoc.content;

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

      triggerLongWaitNotes(statusMsg){
        
        const long_wait_notes = modelConfig[this.#user.currentModel]?.long_wait_notes
        
        let timeouts =[];
        if(long_wait_notes && long_wait_notes.length > 0){
            
            for (const note of long_wait_notes){
                
                const timeoutInstance = setTimeout(() => {
                  this.updateStatusMsg(note.comment,statusMsg.message_id,statusMsg.chat.id)
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
    }

    async msgDeliveredUpdater(data){
      await mongo.updateCompletionInDb({
        filter: {sourceid:data.sourceid},       
        updateBody:this.completionFieldsToUpdate
      })
    }

    get timeout(){
      return this.#timeout  
    }

    get completionFieldsToUpdate(){
      
      const result =  {
        telegramMsgId:this.#telegramMsgIds,
        telegramMsgBtns:this.#telegramMsgBtns,
        telegramMsgRegenerateBtns:this.#telegramMsgRegenerateBtns,
        telegramMsgReplyMarkup:this.#telegramMsgReplyMarkup
      }
      return result
    }
    
    get currentCompletionObj(){

      this.#completionPreviousVersionsContent[this.#completionCurrentVersionNumber-1] = this.#completionContent

      this.#completionId = this.#dialogue.regenerateCompletionFlag ?  this.#completionPreviousVersionsDoc?.sourceid : this.#completionId
      
      return {
            //Формируем сообщение completion
            sourceid: this.#message_sourceid,
            responseId: this.#responseId,
            createdAtSourceTS: this.#completionCreatedTS,
            createdAtSourceDT_UTC: this.#completionCreatedDT_UTC,
            telegramMsgId:this.#replyMsg.msgIdsForDbCompletion,
            telegramMsgBtns:this.#telegramMsgBtns,
            userid: this.#user.userid,
            output_item_index: this.#message_output_item_index,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            model: this.#user.currentModel,
            role: this.#completionRole,
            completion_version:this.#completionCurrentVersionNumber,
            regime: this.#user.currentRegime,
            status: this.#message_output_item_status,
            type: this.#message_output_item_type,
            completion_ended: this.#completion_ended,
            content: this.#completionPreviousVersionsContent,     
          }
    }

    get completionCurrentVersionNumber(){
      return this.#completionCurrentVersionNumber
    }

    get toolCalls(){
      return this.#tool_calls
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

    async end(chunk, encoding, callback){
      
      //Complete processing of chunks
      if (this.#chunkBuffer.length > 0) {
        const chunksToProcess = this.#chunkBuffer;
        this.#chunkBuffer = [];
        await this.processChunksBatch(chunksToProcess); //здесь выполнение должно быть именно синхронное
      }    
    }

    async processChunksBatch(chunksToProcess){

        this.#countChunks +=  chunksToProcess.length
        this.#isProcessingChunk = true;
        const concatenatedBatch = Buffer.concat(chunksToProcess);
        const batchString = this.#decoder.write(concatenatedBatch)
        
        const jsonChunks = await this.batchStringToJson(batchString);

        await this.extractData(jsonChunks)

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



    completionStausUpdate(){
      if (this.#completionFinishReason == "length" || this.#completionFinishReason == "stop") {
        
        this.#completion_ended = true;
        this.#replyMsg.completion_ended = true;
      }
    }

    async updateStatusMsg(user_message,message_id,chat_id){
      await this.#replyMsg.simpleMessageUpdate(
        user_message,
        {
          chat_id: chat_id,
          message_id: message_id,
        }
      );
  
    };

    deliverResponseToTgmHandler(initialMsgId,initialMsgCharCount = 0){
          const sentMsgIds = new Set([initialMsgId])
          let sentMsgsCharCount = [initialMsgCharCount];
          const additionalMsgOptions = {disable_web_page_preview: true};
          let completion_delivered = false;
          let completion_ended_occured_count = 0
           
      return async () =>{

          try{
            const text = this.#text

            if (text === undefined ||text === "") {
              return {success:0,error:"Empty response from the service."};
            };

            if (completion_ended_occured_count > 3) {
              return {success:0,error:"completion_ended_occured_count exceeded the limit."};
            }

            //Here we need to detect and extract tables.

            const splitIndexBorders = this.splitTextBoarders(text,appsettings.telegram_options.big_outgoing_message_threshold);
            const textChunks = this.splitTextChunksBy(text,splitIndexBorders,this.#completion_ended);
            const repairedText = this.repairBrokenMakrdowns(textChunks);
            const htmls = this.convertMarkdownToLimitedHtml(repairedText,this.#user.language_code);

            const sentMsgsCharCountTotal = sentMsgsCharCount.reduce((acc, val) => acc + val, 0);
            const messagesCharCountTotal = htmls.reduce((acc, val) => acc + val.length, 0);
            completion_delivered = sentMsgsCharCount.length === htmls.length && sentMsgsCharCountTotal === messagesCharCountTotal

            if(completion_delivered){ //final run when all messages are sent
              this.#telegramMsgIds = Array.from(sentMsgIds)
              
              await this.msgDeliveredUpdater({sourceid:this.#responseId})
              return {success:1,completion_delivered}
            }

            const messages = await this.createTGMMessagesFrom(htmls,this.#completion_ended,additionalMsgOptions,text)
            await this.deleteOldMessages(sentMsgIds,messages);

            const updateResult = await this.updateMessages(sentMsgIds, messages, sentMsgsCharCount);

            if(updateResult.success === 0 && updateResult.wait_time_ms!=-1){
                const waitResult =await this.#replyMsg.sendTelegramWaitMsg(updateResult.wait_time_ms/1000)
                sentMsgIds.add(waitResult.message_id)
                
                await otherFunctions.delay(updateResult.wait_time_ms)
                const result = await this.#deliverResponseToTgm() //deliver the response after delay
                return result
            }
            await this.sendMessages(messages,sentMsgIds,sentMsgsCharCount)
            
           
           let nested_result; 
            if(this.#completion_ended){
              completion_ended_occured_count ++
              nested_result = await this.#deliverResponseToTgm()
            }
           
           return nested_result ?? {success:1,completion_delivered}
          
          } catch(err){
            telegramErrorHandler.main(
            {
              replyMsgInstance:this.#replyMsg,
              error_object:err
            })
            return {success:0,error:err.message}
          }
          }
    }

    throttleWithImmediateStart(func, delay=0) {

      let throttleTimeout = null
      // console.log(new Date(),"throttleNew started")
      return (...args)=> {
        //  console.log(new Date(),"innerfunction execution")
        if(throttleTimeout === null) {
            throttleTimeout = setTimeout(async ()=> {
                //  console.log(new Date(),"callback triggered")
                await func(...args)
                throttleTimeout = null //this must be before the function call to release the throttle

            }, delay)
        }
      }
    }

    splitTextBoarders(text,tgmMsgThreshold){

      let residualText = text;
      const textLastIndex = text.length - 1;
      let startIndex = 0;
      let endIndex = 0;
      const splitLinesString = '\n';

      const splitIndexes = [];
      while (endIndex < textLastIndex) {
              if(residualText.length < tgmMsgThreshold){
                endIndex = textLastIndex
                const lineBreakIsUsed = false;
                splitIndexes.push([startIndex,endIndex,lineBreakIsUsed])
                
              } else {

                const lastNewlineIndex = residualText.lastIndexOf(splitLinesString, tgmMsgThreshold);
                const lineBreakIsUsed = lastNewlineIndex > 0
                const cropIndex = lineBreakIsUsed ? lastNewlineIndex : tgmMsgThreshold -1;
                residualText = residualText.slice(cropIndex+1);
                endIndex = startIndex + cropIndex;
                splitIndexes.push([startIndex,endIndex,lineBreakIsUsed])
                startIndex = endIndex + 1;              
              }
            }

      return splitIndexes
    }

     splitTextChunksBy(text,splitIndexBorders,completionEnded){

      //Split text into chunks
        const textChunks = [];
        let index = 0;
        for (const [startIndex, endIndex, lineBreakIsUsed] of splitIndexBorders) {
          
          if (splitIndexBorders.length === 1) { // Single chunk case - use the entire text
            textChunks.push(text);
            break;
          }
          
          const chunk = text.slice(startIndex, endIndex + 1); // Extract chunk of text
          
          let splitFiller;
          if(completionEnded && index === splitIndexBorders.length - 1){
            splitFiller = ""
          } else {
            splitFiller = lineBreakIsUsed ? "" : "...";
          }

          textChunks.push(chunk + splitFiller);
          index ++;
        }

        return textChunks;
    }

      repairBrokenMakrdowns(textChunks){
        let repairedText = [];
        let prefix = "";
        for (const chunk of textChunks){
          const brokenTags = otherFunctions.findBrokenTags(prefix + chunk);
          repairedText.push(prefix + chunk + brokenTags?.close)
          prefix = brokenTags?.open ?? ""; //it will be used for text in the next chunk
        }

        return repairedText;
    }


    convertMarkdownToLimitedHtml(repairedText,language_code){
      return repairedText.map((text) => {
        const conversionResult = otherFunctions.convertMarkdownToLimitedHtml(text,language_code)
        return conversionResult.html
    })
  }

    async createTGMMessagesFrom(htmls,completionEnded,additionalMsgOptions,text){
      
      const messages =[];
      let index = 0;
    
      for (const html of htmls) {

            const isLastChunk = index === htmls.length - 1 && completionEnded;
            const reply_markup = isLastChunk ? await this.craftReplyMarkup(text) : null;
            if(reply_markup){
              this.#telegramMsgBtns = true;
              this.#telegramMsgRegenerateBtns = true
              this.#telegramMsgReplyMarkup = reply_markup;
            }
            messages.push([html,reply_markup,"HTML",additionalMsgOptions]);
        index ++
      }
      return messages;
    }

    async deleteOldMessages(sentMsgIds,messages){

      const msgsToDelete = Array.from(sentMsgIds).filter((msg, index) => index > messages.length-1);

      for (const message_id of msgsToDelete) {
             await this.#replyMsg.deleteMsgByID(message_id)
             sentMsgIds.delete(message_id)
      }
    }

    async updateMessages(sentMsgIds, messages, sentMsgsCharCount){

    const msgsToUpdate =[];
    messages.forEach((msg,index) => {
      if(sentMsgsCharCount.length > index && msg[0].length != sentMsgsCharCount[index]){
        msgsToUpdate.push([...msg,Array.from(sentMsgIds)[index],index])
      }
    })

    for (const [html,reply_markup,parse_mode,add_options,message_id,original_index] of msgsToUpdate) {
               const result = await this.#replyMsg.updateMessageWithErrorHandling(html || "_", {
                message_id: message_id,
                reply_markup: reply_markup === null ? null : JSON.stringify(reply_markup),
                parse_mode,
                ...add_options,
               })

               sentMsgsCharCount[original_index] = html.length;

               if(result.success === 0 && result.wait_time_ms !=-1){
                return result
               }
    }

    return {success:1}
    }

    async sendMessages(messages,sentMsgIds,sentMsgsCharCount){

        const msgsToSend = messages.filter((msg, index) => index > sentMsgsCharCount.length - 1);

        for (const [html,reply_markup,parse_mode,add_options] of msgsToSend) {
            const result = await this.#replyMsg.sendMessageWithErrorHandling(html || "_",reply_markup,parse_mode,add_options)
            sentMsgIds.add(result.message_id)
            sentMsgsCharCount.push(html.length);
            }
    }

    async craftReplyMarkup(text=""){
      let reply_markup = {
            one_time_keyboard: true,
            inline_keyboard: [],
          };

      const regenerateButtons = {
            text: "🔄",
            callback_data: JSON.stringify({e:"regenerate",d:this.#user.currentRegime}),
      };

      const callbackData = await otherFunctions.encodeJson({text})
      
      const redaloudButtons = {
        text: "🔊",
        callback_data: JSON.stringify({e:"readaloud",d:callbackData}),
      };

      const PDFButtons = {
        text: "PDF",
        callback_data: JSON.stringify({e:"respToPDF",d:callbackData}),
      };

      const HTMLButtons = {
        text: "🌐",
        callback_data: JSON.stringify({e:"respToHTML",d:callbackData}),
      };

      if(this.#completionCurrentVersionNumber>1){
        reply_markup = this.#replyMsg.generateVersionButtons(this.#completionCurrentVersionNumber,this.#completionCurrentVersionNumber,reply_markup)
      }

      const downRow = [redaloudButtons,HTMLButtons,PDFButtons]

      if(this.#completionCurrentVersionNumber<10){
        downRow.unshift(regenerateButtons)
      }

      reply_markup.inline_keyboard.push(downRow)

      return reply_markup;
    }


    };
    
    module.exports = Completion;