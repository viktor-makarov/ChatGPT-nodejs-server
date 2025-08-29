const { StringDecoder } = require('string_decoder');
const EventEmitter = require('events');
const otherFunctions = require("../common_functions.js");
const mongo = require("../apis/mongo.js");
const modelConfig = require("../../config/modelConfig");
const ErrorHandler = require("./ErrorHandler.js");
const openAIApi = require("../apis/openAI_API.js");
const FunctionCall  = require("./FunctionCall.js");
const { error } = require('console');
const AsyncQueue = require("./AsyncQueue.js");
const { url } = require('inspector');
const { format } = require('path');
const awsApi = require("../apis/AWS_API.js")
const AvailableTools = require("./AvailableTools.js");
const { type } = require('os');


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
    #hostedMCPToolRequest;
    #MCPToolRequestAsyncQueue;
    #hostedMCPApprovalRequest;
    #hostedMCPCall;
    #tokenFetchLimitPcs = (appsettings?.functions_options?.fetch_text_limit_pcs ? appsettings?.functions_options?.fetch_text_limit_pcs : 80)/100;
    #overalTokenLimit;

    #reasoningTimer;
    #imageGenTimer;
    #codeIntTimer;
    #mcpToolsTimer;
    #mcpCallTimer;
    #statusMsg;

    #tgmMessagesQueue;
    #commitToDBQueue;
    #errorHandlerInstance;

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
        this.#errorHandlerInstance = new ErrorHandler({replyMsgInstance: this.#replyMsg, dialogueInstance: this.#dialogue});
      };

    async registerNewEvent(event,evensOccured){

        const {type} = event;
        if(!evensOccured.includes(type)){
          await mongo.saveNewEvent(event)
          evensOccured.push(type);
        }
    }

    timer(){
        const timeLaps = [];
        let isrunning = false;
        let lapStartTime;

        return {
          start_lap: () => {
            if (!isrunning) {
              lapStartTime = Date.now();
              isrunning = true;
            } else {
              console.log("Timer is already running. Please stop the current lap before starting a new one.");
            }
          },
          stop_lap: () => {
            if (isrunning) {
              const lapDuration = Date.now() - lapStartTime;
              timeLaps.push(lapDuration);
              isrunning = false;
            } else {
              console.log("Timer is not running. Please start a lap before stopping it.");
            }
          },
         get_laps: function() {
            if (isrunning) {
              const currentLapDuration = Date.now() - lapStartTime;
              return [...timeLaps, currentLapDuration];
            } else {
              return timeLaps;
            }
         },
        get_total_seconds: function() {
          const laps = this.get_laps();
          return laps.reduce((total, lap) => total + lap, 0) / 1000;
        },
        get_total_HHMMSS: function() {
          const totalSeconds = this.get_total_seconds();
          return otherFunctions.toHHMMSS(totalSeconds);
        }
      }
    }

    async responseEventsHandler(responseStream) {
    // Create a dedicated queue for event processing
    const eventProcessingQueue = new AsyncQueue({delayMs: 0,ttl: 60 * 60 * 1000,name: 'responseEventProcessing',replyInstance: this.#replyMsg});
    this.#tgmMessagesQueue = new AsyncQueue({delayMs: 0,ttl: 60 * 60 * 1000,name: 'tgmMessagesQueue',replyInstance: this.#replyMsg});
    this.#commitToDBQueue = new AsyncQueue({delayMs: 0,ttl: 60 * 60 * 1000,name: 'commitToDBQueue',replyInstance: this.#replyMsg});

    this.#output_items ={};
    this.#message_items = {};
    
    // Process events asynchronously but sequentially
    for await (const event of responseStream) {
      // console.log(event.sequence_number,new Date(),event.type,event.output_index,event.content_index)
      // Add each event to the queue for sequential processing 
      eventProcessingQueue.add(() => this.processEvent(event));
    }
  }

  async processEvent(event){
    try{
      switch (event.type) {
          case 'response.created':
            await this.handleResponseCreated(event);
            break;
          case 'response.output_item.added':
            this.#output_items[event.output_index] = {type:event.item.type,status:event.item.status}
            await this.handleOutputItemAdded(event);
            break;
          case 'response.output_text.delta':
            this.#message_items[event.output_index].text += event?.delta || "";

            if(this.#message_items[event.output_index].deliverResponseToTgm.sentMsgIds().length === 0){
              await this.#message_items[event.output_index].deliverResponseToTgm.setInitialSentMsgId(this.#statusMsg)
              this.#statusMsg = null;
            };
            this.#message_items[event.output_index].throttledDeliverResponseToTgm()
            break;
          case 'response.image_generation_call.partial_image':
            console.log("Partial image event")
            await this.#hostedImageGenerationCall.partialCommit(event)
            break
          case 'response.output_text.done':
            this.#message_items[event.output_index].text = event?.text || "";
            this.#message_items[event.output_index].completion_ended = true;
            this.#message_items[event.output_index].throttledDeliverResponseToTgm()
            break;
          case 'response.output_item.done':
              await this.handleOutputItemDone(event);
              this.completedOutputItem(event.output_index);
              break;
          case 'response.completed':
            console.log(new Date(),`Process event finished`);
            await this.#dialogue.finalizeTokenUsage(this.#user.currentModel,event.response.usage)
            break;
          case 'response.incomplete':
            await this.#dialogue.finalizeTokenUsage(this.#user.currentModel,event.response.usage)
            break;
          case 'response.failed':
              const {code,message} = event.response.error;
              const err = new Error(`${code}: ${message}`);
              err.code = "OAI_ERR99"
              err.user_message = message
              err.place_in_code = "responseEventsHandler.failed";
              throw err;
      }
    } catch (err) {
      err.place_in_code = err.place_in_code || `processEvent.${event.type}`;
      this.#errorHandlerInstance.handleError(err);
    };
};

  async handleResponseCreated(event){
      const {id,created_at} = event.response;
      this.#responseId = id;
      this.#completionCreatedTS= created_at;
      this.#completionCreatedDT_UTC = new Date(created_at * 1000).toISOString();
  };

  async handleOutputItemAdded(event){
    
    try{
      switch (event.item.type) {
        case 'message':
          this.handleMessageAdded(event)
          break;
        case 'function_call':
          await this.createFunctionCall(event)
          break;
        case 'web_search_call':
          this.#hostedSearchWebToolCall = this.searchWebToolCall(event)
          await this.#hostedSearchWebToolCall.initialCommitToTGM()
          break;
        case 'code_interpreter_call':
          if(!this.#hostedCodeInterpreterCall){
            this.#hostedCodeInterpreterCall = this.codeInterpreterCall()
            await this.#hostedCodeInterpreterCall.initialCommit()
          } else {
            await this.#hostedCodeInterpreterCall.resumeCommit()
          }
          break;
        case 'reasoning':
          if(!this.#hostedReasoningCall){
            this.#hostedReasoningCall = this.reasoningCall(event)
            await this.#hostedReasoningCall.initialCommit()
          } else {
            await this.#hostedReasoningCall.resumeCommit()
          }
          break;
        case 'image_generation_call':
          this.#hostedImageGenerationCall = this.imageGenerationCall(event)
          await this.#hostedImageGenerationCall.initialCommit()
          break;
        case 'mcp_list_tools':
          this.#hostedMCPToolRequest = this.MCPToolsRequest(event)
          await this.#hostedMCPToolRequest.initialCommit()
          break;
        case 'mcp_call':
          this.#hostedMCPCall = this.MCPCall(event)
          await this.#hostedMCPCall.initialCommit(event)
          break;
        case 'mcp_approval_request':
          this.#hostedMCPApprovalRequest = this.MCPApprovalRequest()
          break;
      }
      
    } catch (err) {
      err.place_in_code = err.place_in_code || `handleOutputItemAdded.${event.item.type}`;
      throw err;
    }
  }

  async handleMessageAdded(event){
        const {output_index,item} = event;
        const {role,status} = item;

        this.#message_items[output_index] =  this.#completionObjectDefault
        this.#message_items[output_index].sourceid = `${this.#responseId}_output_index_${output_index}`;
        this.#message_items[output_index].responseId = this.#responseId;
        this.#message_items[output_index].output_item_index = output_index;
        this.#message_items[output_index].createdAtSourceTS = this.#completionCreatedTS;
        this.#message_items[output_index].createdAtSourceDT_UTC = this.#completionCreatedDT_UTC;
        this.#message_items[output_index].type = event.item.type;
        this.#message_items[output_index].status = status;
        this.#message_items[output_index].role = role;
        this.#message_items[output_index].completion_ended = false;
        this.#message_items[output_index].text = "";
        this.#message_items[output_index].deliverResponseToTgm = this.deliverResponseToTgmHandler(output_index);
        this.#message_items[output_index].throttledDeliverResponseToTgm = this.throttleWithImmediateStart(this.#message_items[output_index].deliverResponseToTgm.run,appsettings.telegram_options.send_throttle_ms);
        this.#message_items[output_index].completion_version = this.#completionCurrentVersionNumber;
  }

  async handleOutputItemDone(event){
    const {output_index} = event;
    try{
    switch (this.#output_items[output_index].type){
      case 'message':
        await this.handleMessageDone(event)
        break;
      case 'function_call':
        await this.triggerFunctionCall(event)
        break;
      case 'web_search_call':
        await this.#hostedSearchWebToolCall.finalCommitToTGM(event)
        break;
      case 'code_interpreter_call':
        await this.#hostedCodeInterpreterCall.endCommit(event)
        break;
      case 'reasoning':
        await this.#hostedReasoningCall.endCommit(event)
        break;
      case 'image_generation_call':
        await this.#hostedImageGenerationCall.endCommit(event)
      break;
      case 'mcp_list_tools':
        await this.#hostedMCPToolRequest.endCommit(event)
      break;
      case 'mcp_call':
        await this.#hostedMCPCall.endCommit(event)
      break;
      case 'mcp_approval_request':
        await this.#hostedMCPApprovalRequest.approvalRequest(event)
      break;
    }
  } catch (err) {
      err.place_in_code = err.place_in_code || `handleOutputItemDone.${this.#output_items[output_index].type}`;
      throw err;
  }
  }

  async handleMessageDone(event){
    const {output_index,item} = event;
    if(this.#message_items[output_index].text !=""){
      this.#message_items[output_index].status = item?.status;
      this.#message_items[output_index].content = [item?.content[0]];
      const completionObj = this.#message_items[output_index];
      this.#commitToDBQueue.add(() => this.#dialogue.commitCompletionDialogue(completionObj));
    }
  }

    reasoningCall(initialEvent){

      let timerId = null;
      const INTERVAL_MS = 2000;
      const statusMsgIds = [];
        if(this.#statusMsg){
          statusMsgIds.push(this.#statusMsg.message_id)
          this.#statusMsg = null;
        }
      const {output_index,item} = initialEvent;
      const {type,status,id} = item;
      let functionDescription = "Рассуждение";
      this.#reasoningTimer = this.timer();
      
      return {
        "initialCommit":() => {
          this.#reasoningTimer.start_lap();
          let details = "думаю...";

          timerId = setInterval(()=> {
          const MsgText = `⏳ <b>${functionDescription}</b>: ${details}  ${this.#reasoningTimer.get_total_HHMMSS()}`
          this.#tgmMessagesQueue.add(() => (async () =>{
              if(statusMsgIds.length>0){
                await this.#replyMsg.simpleMessageUpdate(MsgText,{
                  chat_id:this.#replyMsg.chatId,
                  message_id:statusMsgIds.at(-1),
                  reply_markup:null,
                  parse_mode: "html"
                })
              } else {
                  const result = await this.#replyMsg.sendToNewMessage(MsgText,null,"html");
                  statusMsgIds.push(result.message_id)
              }
            })())}, INTERVAL_MS);
        },
        "resumeCommit": async () => {
          
          this.#reasoningTimer.start_lap();
          let details = "снова думаю ...";

          clearInterval(timerId);
          timerId = setInterval(()=> {
          const MsgText = `⏳ <b>${functionDescription}</b>: ${details} ${this.#reasoningTimer.get_total_HHMMSS()}`
          this.#tgmMessagesQueue.add(() =>  this.#replyMsg.simpleMessageUpdate(MsgText,{
            chat_id:this.#replyMsg.chatId,
            message_id:statusMsgIds.at(-1),
            reply_markup:null,
            parse_mode: "html"
          }))}, INTERVAL_MS);
        },
        "endCommit": async (reasoning_event) => {
          this.#reasoningTimer.stop_lap();
          const msgText = `✅ <b>${functionDescription}</b> ${this.#reasoningTimer.get_total_HHMMSS()}`
          clearInterval(timerId);
          this.#tgmMessagesQueue.add(() =>  this.#replyMsg.simpleMessageUpdate(msgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgIds.at(-1),
              reply_markup:null,
              parse_mode: "html"
          }))
         // this.#commitToDBQueue.add(() => this.#dialogue.commitReasoningToDialogue(this.#responseId,output_index,reasoning_event.item));
        }
    }
  }

    MCPToolsRequest(initialEvent){

      const statusMsgIds = [];
        if(this.#statusMsg){
          statusMsgIds.push(this.#statusMsg.message_id)
          this.#statusMsg = null;
        }
      const {output_index,item} = initialEvent;
      const {server_label} = item;
      let functionDescription = `${server_label.charAt(0).toUpperCase() + server_label.slice(1)}`;
      this.#mcpToolsTimer = this.timer();
      
      return {
        "initialCommit":() => {
          this.#mcpToolsTimer.start_lap();
          let details = "получаю список инструментов ...";
          const MsgText = `⏳ <b>${functionDescription}</b>: ${details}`
          this.#tgmMessagesQueue.add(() => (async () =>{

              if(statusMsgIds.length>0){
                await this.#replyMsg.simpleMessageUpdate(MsgText,{
                  chat_id:this.#replyMsg.chatId,
                  message_id:statusMsgIds.at(-1),
                  reply_markup:null,
                  parse_mode: "html"
                })
              } else {
                  const result = await this.#replyMsg.sendToNewMessage(MsgText,null,"html");
                  statusMsgIds.push(result.message_id)
              }
            })());
        },
        "endCommit": async (mcp_tool_event) => {
          this.#mcpToolsTimer.stop_lap();

          let details = "список инструментов";
          const msgText = `✅ <b>${functionDescription}</b>: ${details} ${this.#mcpToolsTimer.get_total_HHMMSS()}`

          this.#tgmMessagesQueue.add(() => this.#replyMsg.simpleMessageUpdate(msgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgIds.at(-1),
              reply_markup:null,
              parse_mode: "html"
          }));
          this.#commitToDBQueue.add(() => this.#dialogue.commitMCPToolsToDialogue(this.#responseId,output_index,mcp_tool_event.item,statusMsgIds.at(-1)));
        }
      }
    }

    MCPApprovalRequest(){

        return {
          "approvalRequest": async (event) => {

            const statusMsg = this.#statusMsg ? structuredClone(this.#statusMsg) : await this.#replyMsg.sendStatusMsg();
            this.#statusMsg = null;

            const {output_index,item} = event;
            const {type,server_label,id,name} = item;
            const call_arguments = item.arguments;

            const functionDescription = `${server_label.charAt(0).toUpperCase() + server_label.slice(1)}`;
            const MsgText = `<b>${functionDescription}</b> запрашивает подтверждение. \nПодтвердите выполнение запроса <code>${name}</code> со следующими агрументами: <code>${call_arguments}</code>.`

            const reply_markup = await this.craftReplyMarkupForMCPApprovalRequest(this.#responseId,output_index,item,statusMsg.message_id,MsgText);

            this.#tgmMessagesQueue.add(() => (async () =>{

                await this.#replyMsg.simpleMessageUpdate(MsgText,{
                  chat_id:this.#replyMsg.chatId,
                  message_id:statusMsg.message_id,
                  reply_markup:reply_markup,
                  parse_mode: "html"
                })

            })());
            this.#commitToDBQueue.add(() => this.#dialogue.commitMCPApprovalRequestToDialogue(this.#responseId,output_index,item,statusMsg.message_id));
          }
        }
      }

    async craftReplyMarkupForMCPApprovalRequest(responseId,output_index,item,tgm_msg_id,msg_text){

      const {server_label,id} = item;

      const approval_text = `${msg_text} \n\n✅ Подтвержден`
      const cancel_text = `${msg_text} \n\n❌ Отменен`

      const approve_object = {
        request_id: id,
        server_label,
        approve: true,
        reason: null,
        responseId,
        output_index,
        tgm_msg_id,
        msg_text: approval_text
      };

      const cancel_object = {
        request_id: id,
        server_label,
        approve: false,
        reason: null,
        responseId,
        output_index,
        tgm_msg_id,
        msg_text: cancel_text
      };

      const approve_hash = await otherFunctions.encodeJson(approve_object)
      const cancel_hash = await otherFunctions.encodeJson(cancel_object)

      const approve_callback_data = {e:"mcp_req",d:approve_hash}
      const cancel_callback_data = {e:"mcp_req",d:cancel_hash}

      const approve_button = {
        text: "Подтвердить",
        callback_data: JSON.stringify(approve_callback_data),
      };

      const cancel_button = {
        text: "Отменить",
        callback_data: JSON.stringify(cancel_callback_data),
      };

    return {
      one_time_keyboard: true,
      inline_keyboard: [[approve_button, cancel_button]],
    };
    }
    
    MCPCall(initialEvent){

        let timerId = null;
        const INTERVAL_MS = 2000;
        const statusMsgIds = [];
        if(this.#statusMsg){
          statusMsgIds.push(this.#statusMsg.message_id)
          this.#statusMsg = null;
        }

        const {output_index,item} = initialEvent;
        const {type,server_label,id,name,approval_request_id,} = item;
        let functionDescription = `${server_label.charAt(0).toUpperCase() + server_label.slice(1)}`;
        this.#mcpCallTimer = this.timer();
        
        return {
          "initialCommit":(event) => {
            this.#mcpCallTimer.start_lap();
            const {item} = event;
            const {name} = item;
            let details = `запрос '${name}'  ...`;

            timerId = setInterval(()=> {
            const MsgText = `⏳ <b>${functionDescription}</b>: ${details} ${this.#mcpCallTimer.get_total_HHMMSS()}`
            this.#tgmMessagesQueue.add(() => (async () =>{

              if(statusMsgIds.length>0){
                await this.#replyMsg.simpleMessageUpdate(MsgText,{
                  chat_id:this.#replyMsg.chatId,
                  message_id:statusMsgIds.at(-1),
                  reply_markup:null,
                  parse_mode: "html"
                })
              } else {
                  const result = await this.#replyMsg.sendToNewMessage(MsgText,null,"html");
                  statusMsgIds.push(result.message_id)
              }
            })())}, INTERVAL_MS);
          },
          "endCommit": async (event) => {
            const {output_index,item} = event;
            const {type,server_label,id,name,output,error} = item;
            const call_arguments = item.arguments;
            this.#mcpCallTimer.stop_lap();
            const itemDurationSec = this.#mcpCallTimer.get_total_seconds();
            const requestName = `запрос '${name}'`;
            let msgText;
            if (error) {
              msgText = `❌ <b>${functionDescription}</b>: ${requestName} ${this.#mcpCallTimer.get_total_HHMMSS()}`
            } else {
              msgText = `✅ <b>${functionDescription}</b>: ${requestName} ${this.#mcpCallTimer.get_total_HHMMSS()}`
            }

            const reply_markup = this.#user.showDetails ? await this.craftReplyMarkupForMCPCall(item,msgText) : null ;
            clearInterval(timerId);
            this.#tgmMessagesQueue.add(() => this.#replyMsg.simpleMessageUpdate(msgText,{
                chat_id:this.#replyMsg.chatId,
                message_id:statusMsgIds.at(-1),
                reply_markup:reply_markup,
                parse_mode: "html"
            })),
            this.#commitToDBQueue.add(() => this.#dialogue.commitMCPCallToDialogue(this.#responseId,output_index,item,statusMsgIds.at(-1)))
          }
      }
    }

    async craftReplyMarkupForMCPCall(call_item,msg_text){

      const unfoldedTextHtml = this.buildMCPCallOutputHtml(call_item)

      const infoForUserEncoded = await otherFunctions.encodeJson({unfolded_text:unfoldedTextHtml,folded_text:msg_text})
      const callback_data = {e:"un_f_up",d:infoForUserEncoded}

      const fold_button = {
        text: "Показать подробности",
        callback_data: JSON.stringify(callback_data),
      };

      return {
        one_time_keyboard: true,
        inline_keyboard: [[fold_button]],
      };
    }

    buildMCPCallOutputHtml(call_item){
          const {type,server_label,id,name,output,error} = call_item;
          const call_arguments = call_item.arguments;

          const request = `<pre>${otherFunctions.wireHtml(call_arguments)}</pre>`

          const result = error || output;
          const success = error ? 0 : 1;

          const responseUnwired = otherFunctions.unWireText(result)
          const reply = `<pre><code>${otherFunctions.wireHtml(responseUnwired)}</code></pre>`

          const htmlToSend = `<b>mcp server:</b> ${server_label}\n<b>name:</b> ${name}\n<b>id:</b> ${id}\n<b>type:</b> ${type}\n<b>success:</b> ${success}\n\n<b>request arguments:</b>\n${request}\n\n<b>reply:</b>\n${reply}`
          return htmlToSend;
        }

      imageGenerationCall(initialEvent){

        let timerId = null;
        const INTERVAL_MS = 2000;
        let statusMsgIds = [];
        if(this.#statusMsg){
          statusMsgIds.push(this.#statusMsg.message_id)
          this.#statusMsg = null;
        }

        let imageMsgIds = [];
        const {output_index,item} = initialEvent;
        const {type,status,id} = item;
        let functionDescription = "Изображение OpenAI";
        this.#imageGenTimer = this.timer();

        return {
          "initialCommit":async () => {
            this.#imageGenTimer.start_lap();
            let details = "генерирую ...";

            timerId = setInterval(()=> {
            const MsgText = `⏳ <b>${functionDescription}</b>: ${details} ${this.#imageGenTimer.get_total_HHMMSS()}`
            this.#tgmMessagesQueue.add(() => (async () =>{

              if(statusMsgIds.length>0){
                await this.#replyMsg.simpleMessageUpdate(MsgText,{
                  chat_id:this.#replyMsg.chatId,
                  message_id:statusMsgIds.at(-1),
                  reply_markup:null,
                  parse_mode: "html"
                })
              } else {
                  const result = await this.#replyMsg.sendToNewMessage(MsgText,null,"html");
                  statusMsgIds.push(result.message_id)
              }
            })())}, INTERVAL_MS);
          },
          "partialCommit": async (event) => {

            const {partial_image_index,partial_image_b64,output_format,item_id} = event;
            if(partial_image_index ===0) return;
            const partialImageBuffer = Buffer.from(partial_image_b64, 'base64');
            const filename = `partial_image_${item_id.slice(0, 10)}_${partial_image_index}.${output_format}`;
            const mime_type = otherFunctions.getMimeTypeFromPath(`test.${output_format}`);
            let details = "это еще не все. Продолжаю ..."
            const caption = `⏳ <b>${functionDescription}</b>: ${details} ${this.#imageGenTimer.get_total_HHMMSS()}`;

            clearInterval(timerId);
            this.#tgmMessagesQueue.add(() => Promise.all([
              (async () => { 
                const {message_id} = await this.#replyMsg.sendOAIImage(partialImageBuffer,caption,item_id,output_format,mime_type,"html")
                imageMsgIds.push(message_id);
              })(),
              
              (async () => {
                if(imageMsgIds.length>0){
                  const msgToDeleteID = imageMsgIds.at(-1);
                  await this.#replyMsg.deleteMsgByID(msgToDeleteID)
                  imageMsgIds = imageMsgIds.filter(item => item !== msgToDeleteID)
                }
              })()
            ]));

            this.#tgmMessagesQueue.add(() =>(async () => {
                if(statusMsgIds.length>0){
                  await this.#replyMsg.deleteMsgByID(statusMsgIds.at(-1))
                  statusMsgIds =[];
                }
              })());
    
          },
          "endCommit": async (completedEvent) => {
            this.#imageGenTimer.stop_lap();
 
            const {item,output_index} = completedEvent;
            const {status,background,output_format,quality,type,id,result,revised_prompt,size} = item;

            const mime_type = otherFunctions.getMimeTypeFromPath(`test.${output_format}`);
            const imageBuffer = Buffer.from(result, 'base64');
            const filename = otherFunctions.valueToMD5(String(this.#user.userid))+ "_" + this.#user.currentRegime + "_" + otherFunctions.valueToMD5(String(imageMsgIds.at(-1))) + "." + output_format;
            const msgText = `✅ <b>${functionDescription}</b> ${this.#imageGenTimer.get_total_HHMMSS()}`;
            
            let caption;

            if(revised_prompt<=appsettings.telegram_options.big_outgoing_caption_threshold){
             caption = `${msgText}\n\n${revised_prompt} --size ${size} --quality ${quality} --background ${background}`;
            } else {
             caption = `${msgText}\n\n${revised_prompt.slice(0, appsettings.telegram_options.big_outgoing_caption_threshold)}... --size ${size} --quality ${quality} --background ${background}`;
            }
                      
            clearInterval(timerId);
            this.#tgmMessagesQueue.add(() => Promise.all([
              (async () => {
                if(imageMsgIds.length>0){
                  const msgToDeleteID = imageMsgIds.at(-1);
                  await this.#replyMsg.deleteMsgByID(msgToDeleteID)
                }
              })(),
             (async () => {
              const {Location} = await  awsApi.uploadFileToS3FromBuffer(imageBuffer,filename)
              const reply_markup = this.craftReplyMarkupForImageGeneration(Location);
              const {message_id} = await this.#replyMsg.sendOAIImage(imageBuffer,caption,id,output_format,mime_type,"html",reply_markup);
              imageMsgIds.push(message_id);
             })()
            ]))

            this.#tgmMessagesQueue.add(() =>(async () => {
                if(statusMsgIds.length>0){
                  await this.#replyMsg.deleteMsgByID(statusMsgIds.at(-1))
                  statusMsgIds =[];
                }
              })());
            
            const fileComment = {
              image_id: id,
              format: output_format,
              revised_prompt: revised_prompt,
              content: "Image generated with image generation tool",
            }

            this.#commitToDBQueue.add(() => this.#dialogue.commitImageToDialogue(fileComment,{url:null,base64:result,sizeBytes:imageBuffer.length,mimetype:mime_type},0,null));
            
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

    craftReplyMarkupForImageGeneration(url){
        if(url){
              const btnText = otherFunctions.getLocalizedPhrase(`full_size_image`,this.#user.language);
              const reply_markup = {
                one_time_keyboard: true,
                inline_keyboard: [[{text: btnText, url:url}]]
              }
              return reply_markup;
            } else {
              return null
            }
    }

      codeInterpreterCall(){

        let timerId = null;
        const INTERVAL_MS = 2000;
        const statusMsgIds = [];
        if(this.#statusMsg){
          statusMsgIds.push(this.#statusMsg.message_id)
          this.#statusMsg = null;
        }
        let functionDescription = "Анализ данных";

        const codeInterpreterOutput = [];
        let finalMsgText;
        this.#codeIntTimer = this.timer();
        let reply_markup = null;

        return {
          "initialCommit":() => {
            this.#codeIntTimer.start_lap();
            let details = "в работе ...";
            timerId = setInterval(()=> {

            const MsgText = `⏳ <b>${functionDescription}</b>: ${details} ${this.#codeIntTimer.get_total_HHMMSS()}`
            this.#tgmMessagesQueue.add(() => (async () =>{
              if(statusMsgIds.length>0){
                await this.#replyMsg.simpleMessageUpdate(MsgText,{
                  chat_id:this.#replyMsg.chatId,
                  message_id:statusMsgIds.at(-1),
                  reply_markup:reply_markup,
                  parse_mode: "html"
                })
              } else {
                  const result = await this.#replyMsg.sendToNewMessage(MsgText,null,"html");
                  statusMsgIds.push(result.message_id)
              }
            })())}, INTERVAL_MS);
          },
          "resumeCommit": async () => {
            this.#codeIntTimer.start_lap();

            let details = "снова в работе ...";

            clearInterval(timerId);
            timerId = setInterval(()=> {
            const MsgText = `⏳ <b>${functionDescription}</b>: ${details} ${this.#codeIntTimer.get_total_HHMMSS()}`
            this.#tgmMessagesQueue.add(() => this.#replyMsg.simpleMessageUpdate(MsgText,{
              chat_id:this.#replyMsg.chatId,
              message_id:statusMsgIds.at(-1),
              reply_markup:reply_markup,
              parse_mode: "html"
            }))}, INTERVAL_MS);
          },
          "endCommit": async (completedEvent) => {
            this.#codeIntTimer.stop_lap();
            const {item,output_index} = completedEvent;
            const {code,outputs=[]} = item;
  
            const outputsImages = [];
            const outputsLogs = [];

            const safeOutputs = outputs || [];
            safeOutputs.forEach(output => {
              if(output.type === "image" && output.url){
                outputsImages.push(output.url);
                outputsLogs.push({type: "image",url: "base64 data"});
              }
              if(output.type === "logs" && output.logs){
                outputsLogs.push(output);
              }
            });

            codeInterpreterOutput.push({code, outputs: outputsLogs,output_index});

            this.#commitToDBQueue.add(() => this.#dialogue.commitCodeInterpreterOutputToDialogue(this.#responseId,output_index,item,statusMsgIds.at(-1)));

            finalMsgText = `✅ <b>${functionDescription}</b> ${this.#codeIntTimer.get_total_HHMMSS()}`;

            reply_markup = this.#user.showDetails ? await this.craftReplyMarkupForDetails(codeInterpreterOutput,finalMsgText) : null
            
            clearInterval(timerId);
            this.#tgmMessagesQueue.add(() =>  this.#replyMsg.simpleMessageUpdate(finalMsgText,{
                chat_id:this.#replyMsg.chatId,
                message_id:statusMsgIds.at(-1),
                reply_markup:reply_markup,
                parse_mode: "html"
            }))

            outputsImages.forEach((image, index) => {
              const {mimeType,encoding,data} = this.parseImageStringData(image);
              const imageBuffer = Buffer.from(data, encoding);
              const sizeBytes = imageBuffer.length;
              const fileExtention = mimeType.split('/')[1];
              const filename = otherFunctions.valueToMD5(String(this.#user.userid))+ "_" + this.#user.currentRegime + "_" + otherFunctions.valueToMD5(String(new Date())) + "_" + index + "." + fileExtention;

              this.#tgmMessagesQueue.add(() =>  (async () =>{
                const {Location} = await  awsApi.uploadFileToS3FromBuffer(imageBuffer,filename)
                const reply_markup = {
                  one_time_keyboard: true,
                  inline_keyboard: [[{text: "Полный размер", url: Location}]]
                };
                const fileComment = {
                context: "This image was genarated by Code Interpreter tool",
                public_url: Location
                };
                const {message_id} = await this.#replyMsg.sendCodeInterpreterImage(imageBuffer,null,filename,mimeType,"html",reply_markup);
                this.#commitToDBQueue.add(() => this.#dialogue.commitImageToDialogue(fileComment,{base64:data,mimetype:mimeType,sizeBytes},index,message_id));
              })())
            })


            mongo.insertCreditUsage({
                    userInstance: this.#user,
                    creditType: "code_interpreter",
                    creditSubType: item.container_id,
                    usage: 1,
                    details: {place_in_code:"codeInterpreterCall"}
                })

          }
      }
    }

    parseImageStringData(imageString) {

      const [header, data] = imageString.split(',');
    const [mimeType, encoding] = header.replace('data:', '').split(';');
    
    return {
        mimeType,
        encoding: encoding || null,
        data
    };

    }

      async craftReplyMarkupForDetails(output_result,msgText){

        let unfoldedTextHtml = `<b>function:</b> code_interpreter_call`;

        output_result.forEach((output) => {

          const snipet = `-------------------------
<b>output_index:</b> ${output.output_index}
<b>code:</b><pre><code class="python">${otherFunctions.wireHtml(otherFunctions.unWireText(output.code))}</code></pre>
<b>outputs:</b><pre><code class="json">${otherFunctions.wireHtml(otherFunctions.unWireText(JSON.stringify(output.outputs, null, 4)))}</code></pre>
`;
          unfoldedTextHtml += snipet;
        })

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

      searchWebToolCall(initialEvent){

        const statusMsgIds = [];
        if(this.#statusMsg){
          statusMsgIds.push(this.#statusMsg.message_id)
          this.#statusMsg = null;
        }

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
            this.#tgmMessagesQueue.add(() => (async () =>{

              if(statusMsgIds.length>0){
                await this.#replyMsg.simpleMessageUpdate(MsgText,{
                  chat_id:this.#replyMsg.chatId,
                  message_id:statusMsgIds.at(-1),
                  reply_markup:null,
                  parse_mode: "html"
                })
              } else {
                  const result = await this.#replyMsg.sendToNewMessage(MsgText,null,"html");
                  statusMsgIds.push(result.message_id)
              }
            })());
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

            this.#tgmMessagesQueue.add(() => this.#replyMsg.simpleMessageUpdate(msgText,{
                chat_id:this.#replyMsg.chatId,
                message_id:statusMsgIds.at(-1),
                reply_markup:null,
                parse_mode: "html"
            }));
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

      async createFunctionCall(event){

        const {item,output_index} = event;
        const {id,call_id,name,status} = item;
        const item_type = item.type;
        const statusMsg = this.#statusMsg ? structuredClone(this.#statusMsg) : await this.#replyMsg.sendStatusMsg();
        this.#statusMsg = null;

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
        
        this.#functionCalls[output_index].startFunctionTimer()
        this.#tgmMessagesQueue.add(() => this.#functionCalls[output_index].initStatusMessage())

      }

      async triggerFunctionCall(event){
        const {output_index,item} = event;

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

        this.#commitToDBQueue.add(() => this.#dialogue.commitFunctionCallToDialogue({
          tool_call_id:call_id,
          function_name:name,
          tool_config:this.#functionCalls[output_index].tool_config,
          output_item_index:output_index,
          responseId:this.#responseId,
          sourceid:`${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_call`,
          function_arguments:item?.arguments,
          status:status,
          type:item_type
        }))

        this.#commitToDBQueue.add(() => this.#dialogue.preCommitFunctionReply({
          tool_call_id:call_id,
          function_name:name,
          output_item_index:output_index,
          tool_config:this.#functionCalls[output_index].tool_config,
          sourceid:`${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_output`,
          status:"in_progress",
          type:"function_call_output"
        }))

        const outcome = await this.#functionCalls[output_index].router();

        const {supportive_data,success,tool_call_id,function_name} = outcome;
       
        const toolExecutionResult = {tool_call_id,success,function_name,
          sourceid:`${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_output`,
          duration: supportive_data?.duration || 0,
          fullContent:supportive_data?.fullContent,
          status:"completed",
          content:JSON.stringify(outcome,this.modifyStringify,2)
        }
        this.#commitToDBQueue.add(() => this.#dialogue.updateCommitToolReply(toolExecutionResult))
        this.#tgmMessagesQueue.add(() => this.commitImages(supportive_data,function_name,tool_call_id))

        this.#functionCalls[output_index].endFunctionTimer()
        
        return output_index
        
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
              mimetype:mimetype},0,null);

          } else if(function_name==="fetch_url_content" && page_screenshots && page_screenshots.length > 0){

            const commitFunctions = page_screenshots.map((screenshot, index) => {
                  const fileComment = {
                    context:"Page screenshot has been taken by 'fetch_url_content' function",
                    page_url:screenshot.page_url,
                    call_id: tool_call_id,
                }
                return this.#dialogue.commitImageToDialogue(fileComment,screenshot,index,null);
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
          this.#statusMsg = await this.#replyMsg.sendStatusMsg()

          this.#long_wait_notes = this.triggerLongWaitNotes(this.#statusMsg)

          const responseStream = await openAIApi.responseStream(this.#dialogue)

          this.clearLongWaitNotes();

          await this.responseEventsHandler(responseStream);
          await this.waitForFinalization()

          const functionCallsWereMade = Object.values(this.#output_items).some(item => item.type === "function_call");
          console.log("functionCallsWereMade",functionCallsWereMade)
          if(functionCallsWereMade){
            this.#dialogue.triggerCallCompletion();
          }
          
        } catch(err){
          this.clearLongWaitNotes();
          err.place_in_code = err.place_in_code || "completion.router";
          this.#errorHandlerInstance.handleError(err);
          
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

    deliverResponseToTgmHandler(output_index){
          const sentMsgIds = new Set([])
          let sentMsgsCharCount;
          let replyMarkUpCount = [null];
          const additionalMsgOptions = {disable_web_page_preview: true};
          let completion_delivered = false;
          const completionObject = this.#message_items[output_index];
           
      return {
        "sentMsgIds":() => Array.from(sentMsgIds),
        "setInitialSentMsgId": async (statusMsgInput) => {
          const statusMsg = statusMsgInput ? structuredClone(statusMsgInput) : await this.#replyMsg.sendStatusMsg()
          sentMsgIds.add(statusMsg.message_id)
          sentMsgsCharCount = [statusMsg.text.length]
        },
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
            this.#errorHandlerInstance.handleError(err);
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

          /*
      const regenerateButtons = {
            text: "🔄",
            callback_data: JSON.stringify({e:"regenerate",d:this.#user.currentRegime}),
      };*/

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

      /*if(this.#completionCurrentVersionNumber<10){
        downRow.unshift(regenerateButtons)
      }*/

      reply_markup.inline_keyboard.push(downRow)

      return reply_markup;
    }
    };
    
    module.exports = Completion;