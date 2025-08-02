const { StringDecoder } = require('string_decoder');
const EventEmitter = require('events');
const otherFunctions = require("../common_functions.js");
const mongo = require("../apis/mongo.js");
const modelConfig = require("../../config/modelConfig");
const telegramErrorHandler = require("../errorHandler.js");
const openAIApi = require("../apis/openAI_API.js");
const FunctionCall  = require("./FunctionCall.js");
const { error } = require('console');
const AsyncQueue = require("./AsyncQueue.js");
const { url } = require('inspector');
const { format } = require('path');
const awsApi = require("../apis/AWS_API.js")
const AvailableTools = require("./AvailableTools.js");


class Completion extends EventEmitter {

    #chunkBuffer;
    #isProcessingChunk;

    #chunkStringBuffer;
    #decoder;
    #countChunks = 0;

    #responseErrorRaw;
    #responseErrorMsg = "";
    #response_status;
    #code_interpreter_items;
    #responseHeaders;
    #user;
    #functionCalls = {};
    #completionObjectDefault = {};
    #telegramMsgIds;
    #output_items;
    #message_items;
    #requestMsg;
    #replyMsg;
    #dialogue;
    #responseId;
    #completionId;
    #completionCreatedTS;
    #completionCreatedDT_UTC;
    #completionRole;
    #completionContent;
    #toolCallsInstance;

    #completionFinishReason;
    #completionPreviousVersionsDoc;
    #completionPreviousVersionsContent = [];
    #completionPreviousVersionsContentCount;
    #completionPreviousVersionNumber;
    #completionCurrentVersionNumber = 1;
    #long_wait_notes;
    #timeout;

    #reasoningAsyncQueue;
    #codeInterpreterAsyncQueue;
    #imageGenerationAsyncQueue
    #tool_calls=[];
    #hostedSearchWebToolCall;
    #hostedCodeInterpreterCall;
    #hostedReasoningCall;
    #hostedImageGenerationCall;
    #tokenFetchLimitPcs = (appsettings?.functions_options?.fetch_text_limit_pcs ? appsettings?.functions_options?.fetch_text_limit_pcs : 80)/100;
    #overalTokenLimit;
    
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

        this.#chunkStringBuffer ="";
        this.#completionCreatedDT_UTC = new Date();
        this.#timeout = modelConfig[this.#user.currentModel]?.timeout_ms || 120000;
        this.#overalTokenLimit = this.#user?.currentModel ? modelConfig[this.#user.currentModel]?.request_length_limit_in_tokens : null
        this.#completionObjectDefault = {
          userid: this.#user.userid,
          userFirstName: this.#user.user_first_name,
          userLastName: this.#user.user_last_name,
          model: this.#user.currentModel,
          regime: this.#user.currentRegime,
          includeInSearch: true
        }
      };


      async registerNewEvent(event,evensOccured){

        const {type} = event;
        if(!evensOccured.includes(type)){
          await mongo.saveNewEvent(event)
          evensOccured.push(type);
        }
      }

      async responseEventsHandler(responseStream,statusMsg){

        let evensOccured = await mongo.getEventsList()

        for await (const event of responseStream) {
            const {sequence_number, response,output_index,item,content_index } = event;
            const response_type = event.type;
            await this.registerNewEvent(event,evensOccured)
            //console.log(sequence_number,new Date(),response_type,output_index,content_index)

            switch (response_type) {
                case 'response.created':
                    const {id,created_at} = response;

                    this.clearLongWaitNotes()
                    
                    this.#responseId = id;
                    this.#completionCreatedTS= created_at;
                    this.#completionCreatedDT_UTC = new Date(created_at * 1000).toISOString();
                    this.#output_items ={};
                    this.#message_items = {};
                    
                    break;

                case 'response.output_item.added':
                    const {status,role} = item;
                    const item_type = item.type;
                    this.#output_items[output_index] = {type:item_type,status}
                    if(!statusMsg){
                      statusMsg = await this.#replyMsg.sendStatusMsg()
                    }
                    this.#telegramMsgIds = [statusMsg.message_id];

                    switch (item_type) {
                      case 'message':
                        this.#message_items[output_index] =  this.#completionObjectDefault
                        this.#message_items[output_index].sourceid = `${this.#responseId}_output_index_${output_index}`;
                        this.#message_items[output_index].responseId = this.#responseId;
                        this.#message_items[output_index].output_item_index = output_index;
                        this.#message_items[output_index].createdAtSourceTS = this.#completionCreatedTS;
                        this.#message_items[output_index].createdAtSourceDT_UTC = this.#completionCreatedDT_UTC;
                        this.#message_items[output_index].type = item_type;
                        this.#message_items[output_index].status = status;
                        this.#message_items[output_index].role = role;
                        this.#message_items[output_index].completion_ended = false;
                        this.#message_items[output_index].text = "";
                        this.#message_items[output_index].deliverResponseToTgm = this.deliverResponseToTgmHandler(statusMsg.message_id,statusMsg.text.length,output_index);
                        this.#message_items[output_index].completion_version = this.#completionCurrentVersionNumber;
                        statusMsg =null;
                        this.#message_items[output_index].throttledDeliverResponseToTgm = this.throttleWithImmediateStart(this.#message_items[output_index].deliverResponseToTgm.run,appsettings.telegram_options.send_throttle_ms)        
                        
                        if(this.#hostedCodeInterpreterCall){
                          this.#hostedCodeInterpreterCall.finalyze()
                        }
                        break;
                      case 'function_call':
                        await this.createFunctionCall(event,statusMsg)
                        statusMsg =null;
                        break;
                      case 'web_search_call':
                        this.#hostedSearchWebToolCall = this.searchWebToolCall(event,statusMsg)
                        statusMsg =null;
                        this.#hostedSearchWebToolCall.initialCommitToTGM() //intentionally async
                        break;

                      case 'code_interpreter_call':
                        if(!this.#hostedCodeInterpreterCall){
                          this.#hostedCodeInterpreterCall = this.codeInterpreterCall(event,statusMsg)
                          this.#codeInterpreterAsyncQueue = new AsyncQueue({delayMs: 0, ttl: 20 * 60 * 1000});
                          statusMsg = null;
                          this.#hostedCodeInterpreterCall.initialCommit() //intentionally async
                        } else {
                          this.#hostedCodeInterpreterCall.resumeCommit() //intentionally async
                        }
                        break;
                      case 'reasoning':

                        if(!this.#hostedReasoningCall){
                          this.#hostedReasoningCall = this.reasoningCall(event,statusMsg)
                          this.#reasoningAsyncQueue = new AsyncQueue({delayMs: 0, ttl: 20 * 60 * 1000});
                          statusMsg = null;

                          this.#hostedReasoningCall.initialCommit() //intentionally async
                        } else {
                          this.#hostedReasoningCall.resumeCommit() //intentionally async
                        }
                        break;
                      case 'image_generation_call':
                          this.#hostedImageGenerationCall = this.imageGenerationCall(event,statusMsg)
                          this.#imageGenerationAsyncQueue = new AsyncQueue({delayMs: 100, ttl: 20 * 60 * 1000});
                          statusMsg = null;
                          this.#hostedImageGenerationCall.initialCommit() //intentionally async
                      break;
                    }
                    break;
                case 'response.output_text.delta':
                    switch (this.#output_items[output_index].type) {
                      case 'message':
                        this.#message_items[output_index].text += event?.delta || "";
                        this.#message_items[output_index].throttledDeliverResponseToTgm()
                      break;
                    }
                    break;
                case 'response.output_text.done':
                    switch (this.#output_items[output_index].type) {
                      case 'message':
                        this.#message_items[output_index].text = event?.text || "";
                        this.#message_items[output_index].completion_ended = true;
                        this.#message_items[output_index].throttledDeliverResponseToTgm()
                      break;
                    };
                    break;
                case 'response.output_item.done':
                    switch (this.#output_items[output_index].type) {
                      case 'message':
                        
                        if(this.#message_items[output_index].text !=""){
                          this.#message_items[output_index].status = item?.status;
                          this.#message_items[output_index].content = [item?.content[0]];
                          const completionObj = this.#message_items[output_index];
                          await this.#dialogue.commitCompletionDialogue(completionObj)
                        } else {
                          this.#replyMsg.deleteMsgByID(this.#message_items[output_index].deliverResponseToTgm.statusMsgId);
                        }
                        this.completedOutputItem(output_index)
                      break;
                      case 'function_call':
                        this.triggerFunctionCall(event)
                        .then(index=> this.completedOutputItem(index))
                        .catch(index => this.failedOutputItem(index))
                        break;
                      case 'web_search_call':
                        this.#hostedSearchWebToolCall.finalCommitToTGM(event)
                        this.completedOutputItem(output_index)
                        break;
                      case 'code_interpreter_call':
                        this.#hostedCodeInterpreterCall.endCommit(event)
                        this.completedOutputItem(output_index)
                        break;
                      case 'reasoning':
                        this.#hostedReasoningCall.endCommit()
                        this.completedOutputItem(output_index)
                        break;
                      case 'image_generation_call':
                        this.#hostedImageGenerationCall.endCommit(event)
                        
                        this.completedOutputItem(output_index)
                      break;
                    }
                    break;

                case 'response.image_generation_call.partial_image':

                    this.#hostedImageGenerationCall.partialCommit(event)
                break

                case 'response.completed':
                    
                    await this.#dialogue.finalizeTokenUsage(this.#user.currentModel,response.usage)
                    break;

                case 'response.incomplete':
      
                    await this.#dialogue.finalizeTokenUsage(this.#user.currentModel,response.usage)
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

      reasoningCall(initialEvent,statusMsg){

        const statusMsgId = statusMsg?.message_id
        const {output_index,item} = initialEvent;
        const {type,code,status,id} = item;
        let functionDescription = "Рассуждение";
        let totalDurationSec = 0;
        let itemStartTime;
        let itemEndTime;
        
        return {
          "initialCommit":() => {
            itemStartTime = Date.now();
            let details = "думаю...";
            const MsgText = `⏳ <b>${functionDescription}</b>: ${details}`

            console.log(`reasoning initialCommit msgID: ${statusMsgId}`)
            this.#reasoningAsyncQueue.add(() =>  this.#replyMsg.simpleMessageUpdate(MsgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgId,
              reply_markup:null,
              parse_mode: "html"
            }))
          },
          "resumeCommit": async () => {
            itemStartTime = Date.now();
            let details = "снова думаю ...";
            const MsgText = `⏳ <b>${functionDescription}</b>: ${details}`
            console.log(`reasoning resumeCommit msgID: ${statusMsgId}`)
            this.#reasoningAsyncQueue.add(() =>  this.#replyMsg.simpleMessageUpdate(MsgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgId,
              reply_markup:null,
              parse_mode: "html"
            }))
          },
          "endCommit": async () => {
            itemEndTime = Date.now();
            const itemDurationSec = (itemEndTime - itemStartTime) / 1000;
            totalDurationSec += itemDurationSec;
            const msgText = `✅ <b>${functionDescription}</b> ${otherFunctions.toHHMMSS(totalDurationSec)}`
            console.log(`reasoning endCommit msgID: ${statusMsgId}`)
            this.#reasoningAsyncQueue.add(() =>  this.#replyMsg.simpleMessageUpdate(msgText,{
                chat_id:this.#replyMsg.chatId,
                message_id:statusMsgId,
                reply_markup:null,
                parse_mode: "html"
            }))
          }
      }
    }

      imageGenerationCall(initialEvent,statusMsg){

        const statusMsgId = statusMsg?.message_id
        let imageMsgId;
        const {output_index,item} = initialEvent;
        const {type,status,id} = item;
        let functionDescription = "Изображение OpenAI";
        let totalDurationSec = 0;
        let itemStartTime;
        let itemEndTime;
        const reply_markup = {
                one_time_keyboard: true,
                inline_keyboard: []
              }

        return {
          "initialCommit":async () => {
            let details = "генерирую ...";
            itemStartTime = Date.now();
            const MsgText = `⏳ <b>${functionDescription}</b>: ${details}`
            this.#replyMsg.simpleMessageUpdate(MsgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgId,
              reply_markup:null,
              parse_mode: "html"
            })
          },
          "partialCommit": async (event) => {
            const {partial_image_index,partial_image_b64,output_format,item_id} = event;
            const partialImageBuffer = Buffer.from(partial_image_b64, 'base64');
            const filename = `partial_image_${item_id.slice(0, 10)}_${partial_image_index}.${output_format}`;
            const mime_type = otherFunctions.getMimeTypeFromPath(`test.${output_format}`);
            let details = "это еще не все. Продолжаю ..."
            const caption = `⏳ <b>${functionDescription}</b>: ${details}`;

            if(!imageMsgId){
              console.log(`imageGenerationCall delete status message: ${statusMsgId}`)
            const [{message_id},deleteResult] = await Promise.all([
              this.#replyMsg.sendOAIImage(partialImageBuffer,caption,item_id,output_format,mime_type,"html"),
              this.#replyMsg.deleteMsgByID(statusMsgId)
            ]);
            imageMsgId = message_id;
            } else {
              this.#imageGenerationAsyncQueue.add(() => this.#replyMsg.updateMediaFromBuffer(imageMsgId,partialImageBuffer,filename,"photo",caption,null));
            }

          },
          "endCommit": async (completedEvent) => {
            itemEndTime = Date.now();
            const itemDurationSec = (itemEndTime - itemStartTime) / 1000;
            totalDurationSec += itemDurationSec;
            const {item,output_index} = completedEvent;
            const {status,background,output_format,quality,type,id,result,revised_prompt,size} = item;

            
            const mime_type = otherFunctions.getMimeTypeFromPath(`test.${output_format}`);
            const imageBuffer = Buffer.from(result, 'base64');
            const filename = `image_${id}.${output_format}`;
            const msgText = `✅ <b>${functionDescription}</b> ${otherFunctions.toHHMMSS(totalDurationSec)}`;
            
            let caption;
            console.log("caption check",revised_prompt,appsettings.telegram_options.big_outgoing_caption_threshold)
            if(revised_prompt<=appsettings.telegram_options.big_outgoing_caption_threshold){
             caption = `${msgText}\n\n${revised_prompt} --size ${size} --quality ${quality} --background ${background}`;
            } else {
             caption = `${msgText}\n\n${revised_prompt.slice(0, appsettings.telegram_options.big_outgoing_caption_threshold)}... --size ${size} --quality ${quality} --background ${background}`;
            }
            
            const fileComment = {
              image_id: id,
              format: output_format,
              revised_prompt: revised_prompt,
              content: "User used OpenAI image generation tool",
            }
   
            this.#imageGenerationAsyncQueue.add(() => this.#replyMsg.updateMediaFromBuffer(imageMsgId,imageBuffer,filename,"photo",caption,null))
            const [ImageCommitResult,{Location}] = await Promise.all([
             this.#dialogue.commitImageToDialogue(fileComment,{url:null,base64:result,sizeBytes:imageBuffer.length,mimetype:mime_type}),
             awsApi.uploadFileToS3FromBuffer(imageBuffer,`oai_image_${id}.${output_format}`)
            ])

            if(Location){
              const btnText = otherFunctions.getLocalizedPhrase(`full_size_image`,this.#user.language);
              reply_markup.inline_keyboard.push([{text: btnText, url:Location}])
              this.#imageGenerationAsyncQueue.add(() => this.#replyMsg.updateMessageReplyMarkup(imageMsgId,reply_markup))
            }

            mongo.insertCreditUsage({
                    userInstance: this.#user,
                    creditType: "oai_image_generation",
                    creditSubType: "create",
                    usage: 1,
                    details: {place_in_code:"imageGenerationCall"}
                })

          }
      }
    }

      codeInterpreterCall(initialEvent,statusMsg){

        const statusMsgId = statusMsg?.message_id
        const {output_index,item} = initialEvent;
        const {type,code,status,container_id,id} = item;
        let functionDescription = "Код на Python";
        
        let codeInterpreterOutputText = "";
        let reply_markup = null;
        let totalDurationSec = 0;
        let itemStartTime;
        let itemEndTime;

        return {
          "initialCommit":() => {
            itemStartTime = Date.now();
            let details = "в работе ...";
            const MsgText = `⏳ <b>${functionDescription}</b>: ${details}`
            console.log(`codeInterpreter initialCommit msgID: ${statusMsgId}`)
            this.#codeInterpreterAsyncQueue.add(() => this.#replyMsg.simpleMessageUpdate(MsgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgId,
              reply_markup:null,
              parse_mode: "html"
            }))
          },
          "resumeCommit": async () => {
            itemStartTime = Date.now();
            let details = "снова в работе ...";
            const MsgText = `⏳ <b>${functionDescription}</b>: ${details}`
            console.log(`codeInterpreter resumeCommit msgID: ${statusMsgId}`)
            this.#codeInterpreterAsyncQueue.add(() => this.#replyMsg.simpleMessageUpdate(MsgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgId,
              reply_markup:null,
              parse_mode: "html"
            }))
          },
          "endCommit": async (completedEvent) => {
            itemEndTime = Date.now();
            const itemDurationSec = (itemEndTime - itemStartTime) / 1000;
            totalDurationSec += itemDurationSec;
            const {item,output_index} = completedEvent;
            const {action,type,code,outputs} = item;
            if(code){
              codeInterpreterOutputText += `\n${code}`;
            }
            if(outputs[0]){
              const {type,logs} = outputs[0];
              if(type === "logs" && logs && logs.length > 0){
                codeInterpreterOutputText += `\n--------------\nOutput: ${logs}\n--------------`;
              } else {
                console.log("Unknown output format from 'code interpreter'", outputs[0]);
              }
            }

            const msgText = `✅ <b>${functionDescription}</b> ${otherFunctions.toHHMMSS(totalDurationSec)}`
            console.log(`codeInterpreter endCommit msgID: ${statusMsgId}`)
            this.#codeInterpreterAsyncQueue.add(() =>  this.#replyMsg.simpleMessageUpdate(msgText,{
                chat_id:this.#replyMsg.chatId,
                message_id:statusMsgId,
                reply_markup:null,
                parse_mode: "html"
            }))

            reply_markup = await this.craftReplyMarkupForDetails(item,codeInterpreterOutputText,msgText)
          },
          "finalyze": async () => {
            await Promise.all([
             this.#replyMsg.updateMessageReplyMarkup(statusMsgId,reply_markup),
             this.#dialogue.commitCodeInterpreterOutputToDialogue(id,codeInterpreterOutputText)
           ])

           mongo.insertCreditUsage({
                    userInstance: this.#user,
                    creditType: "code_interpreter",
                    creditSubType: "create",
                    usage: 1,
                    details: {place_in_code:"codeInterpreterCall"}
                })
        }
      }
    }

      async craftReplyMarkupForDetails(item,output_text,msgText){

        const {id,type,} = item;

        const result = {
          code_and_results: "\n" + output_text
        };

        const stringifiedResult = otherFunctions.unWireText(JSON.stringify(result, null, 2));

        const unfoldedTextHtml = `<b>function:</b> ${type}\n<b>id:</b> ${id}\n<pre><code class="json">${otherFunctions.wireHtml(stringifiedResult)}</code></pre>`
        const infoForUserEncoded = await otherFunctions.encodeJson({unfolded_text:unfoldedTextHtml,folded_text:msgText})
        const callback_data = {e:"un_f_up",d:infoForUserEncoded}

        const fold_button = {
        text: "Показать подробности",
        callback_data: JSON.stringify(callback_data),
      };

      return {
        one_time_keyboard: true,
        inline_keyboard: [[fold_button],],
      };
      }

      searchWebToolCall(initialEvent,statusMsg){

        const statusMsgId = statusMsg?.message_id
        const {output_index,item} = initialEvent; 
        const {type,action} = item;
        let functionDescription;
        let actionType = item?.action?.type
        switch (type) {
          case "web_search_call":
            switch (actionType){
              case "search":
                functionDescription = "Поиск в интернете";
              break;
              case "open_page":
                functionDescription = "Просмотр страницы";
              break;
              case "find_in_page":
                functionDescription = "Поиск по странице";
              break;
              default:
                 functionDescription = "Неизвестная функция";
              break;
            }
          break;
          default:
            functionDescription = "Неизвестная функция";
            break;
        }

        return {
          "initialCommitToTGM":async () => {

            let toolType;
            switch (type) {
              case "web_search_call":
                toolType = "web_search_preview";
            };
            const MsgText = `⏳ <b>${functionDescription}</b> `
            await this.#replyMsg.simpleMessageUpdate(MsgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgId,
              reply_markup:null,
              parse_mode: "html"
            })

          },
          "finalCommitToTGM": async (completedEvent) => {
          
            const {item,output_index} = completedEvent;
            const {action,type} = item;
            let details = "";
            switch (actionType){
              case "search":
                details = action.query;
              break;
              case "open_page":
                details = action.url;
              break;
              case "find_in_page":
                details = `${action.pattern} -> ${action.url}`;
              break;
            }

            const msgText = `✅ <b>${functionDescription}</b>: ${details}`

            await this.#replyMsg.simpleMessageUpdate(msgText,{
                chat_id:this.#replyMsg.chatId,
                message_id:statusMsgId,
                reply_markup:null,
                parse_mode: "html"
            })
          }
        }
      }

      buildHostedToolCompletionHtml(event){
        const {item,output_index} = event;
        const {action,type,id} = item;
        let argsText = JSON.stringify(action,this.modifyStringify,2)
        argsText = otherFunctions.unWireText(argsText)
        const request = `<pre>${otherFunctions.wireHtml(argsText)}</pre>`

        const htmlToSend = `<b>type: ${type}</b>\nid: ${id}\noutput_index: ${output_index}\n\n<b>request:</b>\n${request}`

        return htmlToSend
      }

      setStatusMsgAsUsed(statusMsg){
        statusMsg = null;
      }

      completedOutputItem(output_index){
        this.#output_items[output_index].status = "completed";
      }

      failedOutputItem(output_index){
        this.#output_items[output_index].status = "failed";
      }

      async createFunctionCall(event,statusMsg){

        const {item,output_index} = event;
        const {id,call_id,name,status} = item;
        const item_type = item.type;

        const availableTools = new AvailableTools(this.#user);
        const toolConfig = await availableTools.toolConfigByFunctionName(name);
        const options ={
            functionCall:{
              responseId:id,
              status:status,
              tool_call_id:call_id,
              tool_call_index:output_index,
              tool_call_type:item_type,
              function_name:name,
              tool_config:toolConfig
           },
            replyMsgInstance:this.#replyMsg,
            dialogueInstance:this.#dialogue,
            requestMsgInstance:this.#requestMsg,
              statusMsg:statusMsg
        };
        this.#functionCalls[output_index] = new FunctionCall(options)
        this.#functionCalls[output_index].initStatusMessage(statusMsg?.message_id)
      }

      async triggerFunctionCall(event){
        const {output_index,item} = event;

        try{
        const {status,call_id,name} = item
        const item_type = item.type;
        this.#functionCalls[output_index].function_arguments = item?.arguments;
        //console.log("item?.arguments",item?.arguments)
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
       
        await Promise.all([
          this.#dialogue.updateCommitToolReply(toolExecutionResult),
          this.commitImages(supportive_data,function_name,tool_call_id)
        ]);

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

      async commitImages(supportive_data,function_name,tool_call_id){
          
            const mdj_public_url = supportive_data?.image_url;
            const page_screenshots = supportive_data?.screenshots;
            
            if(function_name==="create_midjourney_image" && mdj_public_url){

            const mdj_image_base64 = supportive_data?.base64;
            const mdj_prompt = supportive_data?.midjourney_prompt;
            const size_bites = supportive_data?.size_bites;
            const mimetype = supportive_data?.mimetype || "image/jpeg";

            const fileComment = {
                midjourney_prompt:mdj_prompt,
                public_url:mdj_public_url,
                context:"Image has been generated by 'create_midjourney_image' function",
            }
            
            await this.#dialogue.commitImageToDialogue(fileComment,{
              url:mdj_public_url,
              base64:mdj_image_base64,
              sizeBytes:size_bites,
              mimetype:mimetype});

          } else if(function_name==="fetch_url_content" && page_screenshots && page_screenshots.length > 0){

            const commitFunctions = page_screenshots.map((screenshot, index) => {
                  const fileComment = {
                    context:"Page screenshot has been taken by 'fetch_url_content' function",
                    page_url:screenshot.page_url,
                    call_id: tool_call_id,
                }
                return this.#dialogue.commitImageToDialogue(fileComment,screenshot,index);
              });
              await Promise.all(commitFunctions);
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

          await this.responseEventsHandler(responseStream,statusMsg);
          await this.waitForFinalization()

          const functionCallsWereMade = Object.values(this.#output_items).some(item => item.type === "function_call");
          console.log("functionCallsWereMade",functionCallsWereMade)
          if(functionCallsWereMade){
            this.#dialogue.triggerCallCompletion();
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
          this.#completionPreviousVersionsContentCount = undefined;
          this.#completionPreviousVersionNumber = undefined;
          this.#completionCurrentVersionNumber = 1
          return
        }

        const lastCompletionDoc = this.#completionPreviousVersionsDoc

        if(!lastCompletionDoc){
          this.#completionPreviousVersionsContent = [];
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

    async msgDeliveredUpdater(completionObject){
      await mongo.updateCompletionInDb({
        filter: {sourceid:completionObject.sourceid},       
        updateBody:{
          telegramMsgId: completionObject.telegramMsgIds,
          telegramMsgBtns: completionObject.telegramMsgBtns,
          telegramMsgRegenerateBtns: completionObject.telegramMsgRegenerateBtns,
          telegramMsgReplyMarkup: completionObject.telegramMsgReplyMarkup,
        }
      })
    }

    get timeout(){
      return this.#timeout  
    }

    get completionCurrentVersionNumber(){
      return this.#completionCurrentVersionNumber
    }

    get toolCalls(){
      return this.#tool_calls
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

    async updateStatusMsg(user_message,message_id,chat_id){
      await this.#replyMsg.simpleMessageUpdate(
        user_message,
        {
          chat_id: chat_id,
          message_id: message_id,
        }
      );
    };

    deliverResponseToTgmHandler(initialMsgId,initialMsgCharCount = 0,output_index){
          const sentMsgIds = new Set([initialMsgId])
          let sentMsgsCharCount = [initialMsgCharCount];
          let replyMarkUpCount = [null];
          const additionalMsgOptions = {disable_web_page_preview: true};
          let completion_delivered = false;
          const completionObject = this.#message_items[output_index];
           
      return {
        "statusMsgId": initialMsgId,
        "run":async () =>{

          try{
            const text = completionObject.text || ""
            const completion_ended = completionObject.completion_ended || false;

            if (text === "") return {success:0,error:"Empty response from the service."};

            if(completion_delivered) return {success:0,error:"Completion already delivered."};

            const splitIndexBorders = this.splitTextBoarders(text,appsettings.telegram_options.big_outgoing_message_threshold);
            const textChunks = this.splitTextChunksBy(text,splitIndexBorders,completion_ended);
            const repairedText = this.repairBrokenMakrdowns(textChunks);
            const htmls = this.convertMarkdownToLimitedHtml(repairedText,this.#user.language_code);

            const messages = await this.createTGMMessagesFrom(htmls,completion_ended,additionalMsgOptions,text,completionObject)
            await this.deleteOldMessages(sentMsgIds,messages);

            const updateResult = await this.updateMessages(sentMsgIds, messages, sentMsgsCharCount,replyMarkUpCount);

            if(updateResult.success === 0 && updateResult.wait_time_ms!=-1){
                const waitResult =await this.#replyMsg.sendTelegramWaitMsg(updateResult.wait_time_ms/1000)
                sentMsgIds.add(waitResult.message_id)
                sentMsgsCharCount.push(waitResult.text.length)
                replyMarkUpCount.push(null)
                
                await otherFunctions.delay(updateResult.wait_time_ms)
                const result = await completionObject.deliverResponseToTgm.run() //deliver the response after delay
                return result
            }
            await this.sendMessages(messages,sentMsgIds,sentMsgsCharCount,replyMarkUpCount)
            
            if(completion_ended){
              completion_delivered = true;
              completionObject.telegramMsgIds = Array.from(sentMsgIds)
              await this.msgDeliveredUpdater(completionObject)
              return {success:1,completion_delivered}
            }

            if(!completion_delivered && completionObject.completion_ended){
              const result = await completionObject.deliverResponseToTgm.run()
              return result
            }
           return {success:1,completion_delivered}
          
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

    async createTGMMessagesFrom(htmls,completionEnded,additionalMsgOptions,text,completionObject){
      const messages =[];
      let index = 0;
      
      for (const html of htmls) {
            const isLastChunk = index === htmls.length - 1 && completionEnded;
            const reply_markup = isLastChunk ? await this.craftReplyMarkup(text) : null;
            if(reply_markup){
              completionObject.telegramMsgBtns = true;
              completionObject.telegramMsgRegenerateBtns = true
              completionObject.telegramMsgReplyMarkup = reply_markup;
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

    async updateMessages(sentMsgIds, messages, sentMsgsCharCount,replyMarkUpCount){
    const msgsToUpdate =[];
    messages.forEach((msg,index) => {
      if(sentMsgsCharCount.length > index 
        && 
        (msg[0].length != sentMsgsCharCount[index]  || (msg[1] !== replyMarkUpCount[index]))
        
      ){
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
               replyMarkUpCount[original_index] = reply_markup;

               if(result.success === 0 && result.wait_time_ms !=-1){
                return result
               }
    }

    return {success:1}
    }

    async sendMessages(messages,sentMsgIds,sentMsgsCharCount,replyMarkUpCount){

        const msgsToSend = messages.filter((msg, index) => index > sentMsgsCharCount.length - 1);
        for (const [html,reply_markup,parse_mode,add_options] of msgsToSend) {
            const result = await this.#replyMsg.sendMessageWithErrorHandling(html || "_",reply_markup,parse_mode,add_options)
            sentMsgIds.add(result.message_id)
            sentMsgsCharCount.push(html.length);
            replyMarkUpCount.push(reply_markup);
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