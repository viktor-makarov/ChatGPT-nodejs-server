const { StringDecoder } = require('string_decoder');
const { Transform } = require('stream');
const msqTemplates = require("../../config/telegramMsgTemplates");
const otherFunctions = require("../other_func");
const mongo = require("../mongo");
const modelConfig = require("../../config/modelConfig");
const telegramErrorHandler = require("../telegramErrorHandler.js");
const openAIApi = require("../openAI_API.js");
const { error } = require('console');

class Completion extends Transform {

    #chunkBuffer;
    #isProcessingChunk

    #chunkStringBuffer;
    #decoder
    #countChunks = 0;

    #responseErrorRaw
    #responseErrorMsg = "";
    #response_status;
    
    #responseHeaders;
    #user;


    #telegramMsgBtns = false;
    #telegramMsgIds = []

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

    #throttledDeliverResponseToTgm;
    #deliverResponseToTgm;
    #toolCallsInstance
    #tool_calls=[];
    #text;

    #actualModel;
    #completionRedaloudButtons = {
      text: "🔊",
      callback_data: JSON.stringify({e:"readaloud"}),
    };
    
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

        this.#timeout = modelConfig[this.#user.currentModel]?.timeout_ms || 120000;
      };

      async router(){

        try{
          
          this.#completionPreviousVersionsDoc = await this.completionPreviousVersions();

          this.#updateCompletionVariables()
          
          await this.#replyMsg.sendTypingStatus()
          const statusMsg = await this.#replyMsg.sendStatusMsg()
          
          this.#long_wait_notes = this.triggerLongWaitNotes(statusMsg)

          this.#deliverResponseToTgm = this.deliverResponseToTgmHandler(statusMsg.message_id,statusMsg.text.length);
          this.#throttledDeliverResponseToTgm = this.throttleWithImmediateStart(this.#deliverResponseToTgm,appsettings.telegram_options.send_throttle_ms)
          
          let oai_response;
          try{
            oai_response =  await openAIApi.chatCompletionStreamAxiosRequest(
              this.#requestMsg,
              this.#dialogue
            );
          } catch(err){

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
          } finally{
              this.clearLongWaitNotes()
          }

          this.#responseHeaders = oai_response.headers
          oai_response.data.pipe(this)
          await this.waitForTheStreamToFinish(oai_response.data)

          this.checkIfCompletionIsEmpty()
      
          const completionObject = this.currentCompletionObj
          await this.#dialogue.commitCompletionDialogue(completionObject)

          await this.#dialogue.finalizeTokenUsage(completionObject,this.#tokenUsage)
      
          completionObject.tool_calls && this.#dialogue.emit('triggerToolCall', completionObject.tool_calls) 

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
        telegramMsgId:this.#telegramMsgIds,
     //   telegramMsgId:this.#replyMsg.msgIdsForDbCompletion,
        telegramMsgBtns:this.#telegramMsgBtns,
        content: this.#completionPreviousVersionsContent,
        content_latex_formula:this.#completionPreviousVersionsLatexFormulas
      }
      return result
    }
    
    get currentCompletionObj(){

      this.#completionPreviousVersionsContent[this.#completionCurrentVersionNumber-1] = this.#completionContent
      this.#completionPreviousVersionsLatexFormulas[this.#completionCurrentVersionNumber-1] = this.#completionLatexFormulas

      this.#completionId = this.#dialogue.regenerateCompletionFlag ?  this.#completionPreviousVersionsDoc?.sourceid : this.#completionId
      
      return {
            //Формируем сообщение completion
            sourceid: this.#completionId,
            createdAtSourceTS: this.#completionCreatedTS,
            createdAtSourceDT_UTC: this.#completionCreatedDT_UTC,
         //   telegramMsgId:this.#telegramMsgIds,
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
      }    
    }

    async processChunksBatch(chunksToProcess){

        this.#countChunks +=  chunksToProcess.length
        this.#isProcessingChunk = true;
        const concatenatedBatch = Buffer.concat(chunksToProcess);
        const batchString = this.#decoder.write(concatenatedBatch)
        
        const jsonChunks = await this.batchStringToJson(batchString);

        await this.extractData(jsonChunks)
        // this.#replyMsg.deliverCompletionToTelegramThrottled(this)
       // this.#throttledDeliverCompletionToTelegram(this)

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
            this.#replyMsg.text = this.#completionContent;
            this.#throttledDeliverResponseToTgm()

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
            const text = this.#completionContent

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
            const messages = this.createTGMMessagesFrom(repairedText,this.#completion_ended,additionalMsgOptions)

            const sentMsgsCharCountTotal = sentMsgsCharCount.reduce((acc, val) => acc + val, 0);
            const messagesCharCountTotal = messages.reduce((acc, val) => acc + val[0].length, 0);
            completion_delivered = sentMsgsCharCount.length === messages.length && sentMsgsCharCountTotal === messagesCharCountTotal

            if(completion_delivered){ //final run when all messages are sent
              this.#telegramMsgIds = Array.from(sentMsgIds)
              this.#telegramMsgBtns = true;
              await this.msgDeliveredUpdater({sourceid:this.#completionId})
              return {success:1,completion_delivered}
            }

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
                const lineBreakIsUsed = lastNewlineIndex === -1 ? false : true
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

    createTGMMessagesFrom(repairedText,completionEnded,additionalMsgOptions){
      
    return repairedText.map((text, index) => {
            const conversionResult = otherFunctions.convertMarkdownToLimitedHtml(text);
            const isLastChunk = index === repairedText.length - 1 && completionEnded;
            
            const reply_markup = isLastChunk ? this.craftReplyMarkup() : null;
            
            return [conversionResult.html,reply_markup,"HTML",additionalMsgOptions];
          });
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

    craftReplyMarkup(){
      let reply_markup = {
            one_time_keyboard: true,
            inline_keyboard: [],
          };

      const completionRegenerateButtons = {
            text: "🔄",
            callback_data: JSON.stringify({e:"regenerate",d:this.#user.currentRegime}),
          };
      const completionRedaloudButtons = this.#completionRedaloudButtons

      const currentVersionNumber =  this.#completionCurrentVersionNumber
      const latexFormulas =  this.#completionLatexFormulas

      if(currentVersionNumber>1){
        reply_markup = this.#replyMsg.generateVersionButtons(currentVersionNumber,currentVersionNumber,reply_markup)
      }

      if(latexFormulas){
        reply_markup = this.#replyMsg.generateFormulasButton(reply_markup)
      }

      const downRow = [completionRedaloudButtons]

      if(currentVersionNumber<10){
        downRow.unshift(completionRegenerateButtons)
      }

      reply_markup.inline_keyboard.push(downRow)

      return reply_markup
    }


    };
    
    module.exports = Completion;