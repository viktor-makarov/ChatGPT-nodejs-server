const { StringDecoder } = require('string_decoder');
const EventEmitter = require('events');
const otherFunctions = require("../common_functions.js");
const mongo = require("../apis/mongo.js");
const modelConfig = require("../../config/modelConfig");
const ErrorHandler = require("./ErrorHandler.js");
const openAIApi = require("../apis/openAI_API.js");
const FunctionCall = require("./FunctionCall.js");
const { error, clear } = require('console');
const AsyncQueue = require("./AsyncQueue.js");
const { url } = require('inspector');
const { format } = require('path');
const awsApi = require("../apis/AWS_API.js")
const AvailableTools = require("./AvailableTools.js");
const { type } = require('os');
const { chat } = require('../../config/telegramModelsSettings.js');
const { set } = require('mongoose');
const mcp_tools_API = require("../apis/mcp_tools_API.js");
const { last } = require('pdf-lib');


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
  #responseStream;
  #responseIdShort

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
  #tool_calls = [];
  #hostedSearchWebToolCall;
  #hostedCodeInterpreterCall;
  #hostedReasoningCall;
  #hostedImageGenerationCall;
  #hostedMCPToolRequest;
  #MCPToolRequestAsyncQueue;
  #hostedMCPApprovalRequest;
  #hostedMCPCall;
  #tokenFetchLimitPcs = (appsettings?.functions_options?.fetch_text_limit_pcs ? appsettings?.functions_options?.fetch_text_limit_pcs : 80) / 100;
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
  #stopStreamFlag;
  #artificialEvents;

  constructor(obj) {
    super({ readableObjectMode: true });
    this.#chunkBuffer = [];
    this.#isProcessingChunk = false;
    this.#decoder = new StringDecoder("utf8");

    this.#user = obj.userClass;
    this.#requestMsg = obj.requestMsg;
    this.#replyMsg = obj.replyMsg;
    this.#dialogue = obj.dialogueClass;
    this.#toolCallsInstance = this.#dialogue.toolCallsInstance;

    this.#chunkStringBuffer = "";
    this.#completionCreatedDT_UTC = new Date();
    this.#timeout = modelConfig[this.#user.currentModel]?.timeout_ms || 120000;
    this.#overalTokenLimit = this.#user?.currentModel ? modelConfig[this.#user.currentModel]?.request_length_limit_in_tokens : null
    this.#completionObjectDefault = {
      userid: this.#user.userid,
      chatid: this.#requestMsg.chatId,
      userFirstName: this.#user.user_first_name,
      userLastName: this.#user.user_last_name,
      model: this.#user.currentModel,
      regime: this.#user.currentRegime,
      includeInSearch: true
    }
    this.#errorHandlerInstance = new ErrorHandler({ replyMsgInstance: this.#replyMsg, dialogueInstance: this.#dialogue });
    this.#stopStreamFlag = false;
    this.#artificialEvents = [];
  };

  async registerNewEvent(event, evensOccured) {
    const { type } = event;
    if (!evensOccured.includes(type)) {
      await mongo.saveNewEvent(event)
      evensOccured.push(type);
    }
  }

  async cancelProcessByError(err) {

    this.#output_items.generalTimer.stop_lap();
    clearInterval(this.#output_items.intervalTimerId);
    this.#output_items.status = "failed";
    this.#output_items.error = err.message;

    const in_process_output_indexes = this.getInProcessEventsIndexes();
    in_process_output_indexes.forEach(item => {
      this.#output_items[item].status = "cancelled";
      this.#output_items[item].details = `операция отменена из-за ошибки процесса`;
      this.#output_items[item].error = err.message;
      this.#output_items[item].individualTimer.stop_lap();
      clearTimeout(this.#output_items[item].timeoutTimerId);
    });
    otherFunctions.saveTextToTempFile(JSON.stringify({ ...this.#output_items, place: "cancelProcessByError" }, this.removeCircularKeys, 4), `output_items.json`)
    this.#tgmMessagesQueue.add(() => this.deliverProgressMsgToTgm("process_cancelled_by_error"));
  }

  cancelEventByError(err, output_index) {
    this.#output_items[output_index].status = "failed";
    delete global.completionInstances[this.#responseIdShort]
    this.#output_items[output_index].error = err.message;
    this.#output_items[output_index].details = `операция завершилась с ошибкой`;
    this.#output_items[output_index].individualTimer.stop_lap();
    clearTimeout(this.#output_items[output_index].timeoutTimerId);
    otherFunctions.saveTextToTempFile(JSON.stringify({ ...this.#output_items, place: "cancelEventByError" }, this.removeCircularKeys, 4), `output_items.json`)
    this.#tgmMessagesQueue.add(() => this.deliverProgressMsgToTgm("event_cancelled_by_error"));
  };

  async cancelProcessByUser() {


    this.#responseStream.controller.abort();
    clearInterval(this.#output_items.intervalTimerId);
    this.#output_items.generalTimer.stop_lap();
    this.#output_items.status = "cancelled";
    this.#output_items.cancel_reason = "by_user";
    delete global.completionInstances[this.#responseIdShort]

    const in_process_output_indexes = this.getInProcessEventsIndexes();

    in_process_output_indexes.forEach(item => {
      this.#output_items[item].status = "cancelled";
      this.#output_items[item].details = `Задача отменена пользователем`;
      this.#output_items[item].individualTimer.stop_lap();
      clearTimeout(this.#output_items[item].timeoutTimerId);
    });

    otherFunctions.saveTextToTempFile(JSON.stringify({ ...this.#output_items, place: "cancelProcessByUser" }, this.removeCircularKeys, 4), `output_items.json`)
    this.#commitToDBQueue.add(() => mongo.deleteMsgFromDialogByResponseId(this.#user.userid, this.#responseId));
    this.#tgmMessagesQueue.add(() => this.deliverProgressMsgToTgm("process_cancelled_by_user"));
  };

  async cancelEventByTimeout(timeout_ms, output_index) {
    const item = this.#output_items[output_index];
    item.status = "cancelled";
    item.cancel_reason = "timeout";
    item.individualTimer.stop_lap();
    item.error = `Cancelled by timeout ${timeout_ms} мс`;
    item.details = `истекло время ожидания операции`;
    delete global.completionInstances[this.#responseIdShort]

    otherFunctions.saveTextToTempFile(JSON.stringify({ ...this.#output_items, place: "cancelEventByTimeout" }, this.removeCircularKeys, 4), `output_items.json`)
    this.#tgmMessagesQueue.add(() => this.deliverProgressMsgToTgm("event_cancelled_by_timeout"));
  };

  async deliverProgressMsgToTgm(place_in_code) {
    if (this.#output_items.status === "not_started") return;
    //console.log(new Date(), "deliverProgressMsgToTgm called from:", place_in_code) 
    const progress_text_message = this.craftProgressMsgText();
    if (!progress_text_message) return;
    const reply_markup = await this.craftProgressMsgReplyMarkup(progress_text_message);
   // console.log("reply_markup:", reply_markup.inline_keyboard[0])
    const { last_progress_message_sent, sameProgressMsgCount, statusMsgId } = this.#output_items;

    if (last_progress_message_sent && progress_text_message === last_progress_message_sent) {
      // console.log(`deliverGeneralMsgToTgm triggered with duplicate text messages to deliver: ${progress_text_message}, previous: ${last_progress_message_sent}`)
      if (sameProgressMsgCount && sameProgressMsgCount >= 10) clearInterval(this.#output_items.intervalTimerId);
      this.#output_items.sameProgressMsgCount++;
      return;
    } else {
      if (statusMsgId) {
        await this.#replyMsg.simpleMessageUpdate(progress_text_message, {
          chat_id: this.#replyMsg.chatId,
          message_id: statusMsgId,
          reply_markup: reply_markup,
          parse_mode: "html"
        });
      } else {
        const { message_id } = await this.#replyMsg.sendToNewMessage(progress_text_message, reply_markup, "html");
        this.#output_items.statusMsgId = message_id;
      };
      this.#output_items.sameProgressMsgCount = 0;
      this.#output_items.last_progress_message_sent = progress_text_message;
    }
  };

  getStatusSet() {

    const set = {};
    const { last_output_index } = this.#output_items;

    for (let i = 0; i <= Number(last_output_index); i++) {
      const { status, friendlyName, details, individualTimer, timeoutTimerId, type } = this.#output_items[i];

      if (type == 'message' || type == 'mcp_approval_request') continue;

      if (set[status]) {
        set[status].push({ friendlyName, details, individualTimer, timeoutTimerId, output_index: i, type });
      } else {
        set[status] = [{ friendlyName, details, individualTimer, timeoutTimerId, output_index: i, type }];
      }
    }

    return set;
  }

  getAllItemsSet() {

    const all_items = [];
    const { last_output_index } = this.#output_items;
    for (let i = 0; i <= Number(last_output_index); i++) {
      const { type, status, friendlyName, details, individualTimer, timeoutTimerId, response, request, error } = this.#output_items[i];
      if (type == 'message' || type == 'mcp_approval_request') continue;
      all_items.push({ status, friendlyName, details, individualTimer, timeoutTimerId, output_index: i, type, response, request, error });
    }
    return all_items;
  }

  getInProcessEventsIndexes() {

    const in_process_output_indexes = [];
    const { last_output_index } = this.#output_items;

    for (let i = 0; i <= Number(last_output_index); i++) {
      const { status, type } = this.#output_items[i];

      if (type == 'message' || type == 'mcp_approval_request') continue;
      if (status === "in_progress") {
        in_process_output_indexes.push(i);
      }
    }
    return in_process_output_indexes;
  }

  craftProgressMsgText() {
    const statusSet = this.getStatusSet();
    const { generalTimer, status } = this.#output_items;
    const totalTime = generalTimer.get_total_HHMMSS();
    const allItems = this.getAllItemsSet();
    const stepCount = allItems.filter(item => item.type != "reasoning").length;

    if (allItems.length === 1 && allItems[0].type === 'reasoning') {
      const { details } = allItems[0];
      if (details) {
        return `${details} ${totalTime}`
      } else {
        return null
      }
    }

    const statusText = status === "in_progress" ? "обрабатываю запрос" : status === "completed" ? "обработка завершена" : status === "failed" ? "возникла ошибка" : status === "cancelled" ? "запрос отменен" : status === "not_started" ? "запрос не начал выполняться" : "происходит что-то странное";
    const stepString = stepCount != 0 ? "(" + String(stepCount) + ") " : "";
    let output_message = `<b>${stepString}${statusText}</b> ${totalTime}`;

    if (statusSet?.in_progress) {
      const in_progress_tasks_breakdown = statusSet.in_progress.map(item => {
        if (item.friendlyName && item.details) {
          if (item.type === 'reasoning') {
            return `- ${item.details}`
          } else {
            return `- <i>${item.friendlyName}</i>: ${item.details}`
          }
        }
      }).join("\n");
      output_message += "\n" + in_progress_tasks_breakdown;
    } else {
      if (status === "in_progress"){
        output_message += "\n - перехожу к новой операции";
      }
    }
    return output_message;
  }

  async craftProgressMsgReplyMarkup(shortMessage) {

    const { last_output_index, generalTimer, status } = this.#output_items;
    const statusSet = this.getStatusSet();
    const allItems = this.getAllItemsSet();

    const reply_markup = {
      one_time_keyboard: true,
      inline_keyboard: [],
    };

    if (this.#output_items.status === "in_progress") {
      reply_markup.inline_keyboard.push([
        {
          text: `Отменить`,
          callback_data: JSON.stringify({ e: "cnsl_proc", d: this.#responseIdShort })
        }
      ]);
      return reply_markup;
    } else {
      const shortReport = this.craftShortProcessReport();
      const fullReport = this.craftFullProcessReport();
      const callback_data_data = {
        short_msg: shortMessage,
        short_report: shortReport,
        full_report: fullReport,
        full_report_filename: `process_report_${this.#responseId}.txt`
      };
      const callback_data_hash = await otherFunctions.encodeJson(callback_data_data)
      reply_markup.inline_keyboard.push([
        {
          text: `Смотреть отчет`,
          callback_data: JSON.stringify({ e: "un_f_up", d: callback_data_hash })
        }
      ]);
      return reply_markup
    }
  }

  craftShortProcessReport() {

    const all_items = this.getAllItemsSet();

    let report = `<b>Отчет о выполнении</b>\n\n`;
    report += `Время выполнения: ${this.#output_items.generalTimer.get_total_HHMMSS()}\n`;
    report += `Финальный статус: ${this.#output_items.status}\n`;
    if (this.#output_items.error) {
      report += `Ошибка: ${this.#output_items.error}\n`;
    }

    report += `\n<b>Шаги:</b>\n`;

    all_items
      .filter(item => item.type != "reasoning")
      .forEach(item => {
        report += `  <i>${item.friendlyName}</i> - ${item.details} (время ${item.individualTimer.get_total_seconds()} сек.)\n`;
      });

    return report;
  }

  craftFullProcessReport() {
    const all_items = this.getAllItemsSet();

    let report = `<p><b>Подробный отчет о выполнении</b></p>\n\n`;

    let status = `
    <div><b>Время выполнения:</b> ${this.#output_items.generalTimer.get_total_HHMMSS()}</div>
    <div><b>Шагов:</b> ${all_items.length}</div>
    <div><b>Результат:</b> ${this.#output_items.status}</div>
    `;
    if (this.#output_items.error) {
      status += `<div><b>Ошибка:</b> ${this.#output_items.error}</div>\n`;
    }
    report += `<p>${status}</p>\n\n`;

    report += `\n<div><b>Шаги:</b></div>\n`;

    all_items.forEach(item => {
      let step = `<div>- ${item.individualTimer.get_total_HHMMSS()} - ${item.status} - ${item.friendlyName} - ${item.details}</div>\n`;

      if (item.request) {
        step += `<div><b>Запрос:</b></div>\n  <div><code class=json>${JSON.stringify(item.request, null, 2)}</code></div>\n`;
      };
      if (item.response) {
        step += `<div><b>Ответ:</b></div>\n  <div><code class=json>${JSON.stringify(item.response, null, 2)}</code></div>\n`;
      };
      if (item.error) {
        step += `<div><b>Ошибка:</b></div>\n  <div><code class=json>${JSON.stringify(item.error, null, 2)}</code></div>\n`;
      }
      report += `<p>${step}</p>`;
    });

    return report;

  }

  timer() {
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
      get_laps: function () {
        if (isrunning) {
          const currentLapDuration = Date.now() - lapStartTime;
          return [...timeLaps, currentLapDuration];
        } else {
          return timeLaps;
        }
      },
      get_total_seconds: function () {
        const laps = this.get_laps();
        return laps.reduce((total, lap) => total + lap, 0) / 1000;
      },
      get_total_HHMMSS: function () {
        const totalSeconds = this.get_total_seconds();
        return otherFunctions.toHHMMSS(totalSeconds);
      }
    }
  }

  updateOutputItemDetails(output_index, details) {
    this.#output_items[output_index].details = details;
  }

  get output_items() {
    return this.#output_items;
  }

  async responseEventsHandler(responseStream) {

    const { oai_server_error_threshold } = appsettings.other_options
    // Create a dedicated queue for event processing
    const eventProcessingQueue = new AsyncQueue({ delayMs: 0, ttl: 60 * 60 * 1000, name: 'responseEventProcessing', replyInstance: this.#replyMsg });
    this.#tgmMessagesQueue = new AsyncQueue({ delayMs: 0, ttl: 60 * 60 * 1000, name: 'tgmMessagesQueue', replyInstance: this.#replyMsg });
    this.#commitToDBQueue = new AsyncQueue({ delayMs: 0, ttl: 60 * 60 * 1000, name: 'commitToDBQueue', replyInstance: this.#replyMsg });

    this.#output_items = {
      triggerNextCompletion: false,
      replyMsg: this.#replyMsg,
      last_output_index: null,
      intervalTimerId: null,
      interval_ms: 2000,
      generalTimer: this.timer(),
      status: "not_started",
      deliverCaptionToTgm: async function (output_index) {
        const output_item = this[output_index];
        if (output_item === undefined) return;

        const { caption_message, caption_message_last_sent, imageMsgId, sameCaptionMsgCount, parse_mode } = output_item;

        if (caption_message === caption_message_last_sent) {
          if (sameCaptionMsgCount && sameCaptionMsgCount >= 10) clearInterval(this[output_index].timerId);
          // Skip adding duplicate message
          this[output_index].sameCaptionMsgCount++;
          return;
        } else {
          await this.replyMsg.editMessageCaption(caption_message, imageMsgId, parse_mode || "html")
          this[output_index].sameCaptionMsgCount = 0;
          this[output_index].caption_message_last_sent = caption_message;
        }
      }
    };

    this.#message_items = {};

    // Process events asynchronously but sequentially
    try {
      for await (const event of responseStream) {

        // Add each event to the queue for sequential processing
        this.scanEvents(event);
        //console.log(event.sequence_number,new Date(),event.type,event.output_index,event.content_index)
        eventProcessingQueue.add(() => this.processEvent(event));

        if (this.#artificialEvents.length > 0) {
          for (const aEvent of this.#artificialEvents) {
            eventProcessingQueue.add(() => this.processEvent(aEvent));
          }
          this.#artificialEvents = [];
          break;
        }

      }
      this.#dialogue.clearServerErrorsCount();
    } catch (err) {

      this.cancelProcessByError(err);

      if (err.error.type === 'server_error') {

        if (this.#dialogue.server_errors_count <= oai_server_error_threshold) {

          this.#output_items.triggerNextCompletion = true;
          err.adminlog = false;
          err.place_in_code = "responseEventsHandler.openAI_server_error < threshold";
          this.#dialogue.incrementServerErrorsCount()
          this.#errorHandlerInstance.handleError(err);

        } else {

          err.user_message = `❗️ К сожалению, ошибка повторилась 3 раза подряд. Похоже, сервис перегружен. Попробуйте повторить попытку позже.`
          this.#output_items.triggerNextCompletion = false;
          this.#dialogue.clearServerErrorsCount();
          err.place_in_code = "responseEventsHandler.openAI_server_error < threshold";
          throw err;
        }

      } else {
        throw err;
      }
    }
  }

  scanEvents(event) {

    const { type: eventType, item, output_index } = event;
    const itemType = item?.type;
    const { name, output, arguments: itemArguments, server_label } = item || {};

    if (
      eventType === "response.output_item.done"
      && itemType
      && itemType === "mcp_call"
      && name
      && name === "get_file_contents"
      && server_label
      && server_label === "github"
      && output
      && output?.includes("successfully downloaded text file")
    ) {
      this.#responseStream.controller.abort();

      this.#artificialEvents.push({
        type: "artificial.output_item",
        output_index: output_index + 1,
        item: {
          type: "github_resource_upload",
          arguments: itemArguments,
          name: name
        }
      });
    }
  }

  completeProcess() {

    if (this.#output_items.status === "in_progress") {
      this.#output_items.generalTimer.stop_lap();
      clearInterval(this.#output_items.intervalTimerId);
      this.#output_items.status = "completed";
    }
    this.#tgmMessagesQueue.add(() => this.deliverProgressMsgToTgm(`complete_process`))
  }

  markStatusMsgAsUsed() {
    this.#statusMsg = null;
  }

  initialiseProcess() {

    this.#output_items.generalTimer.start_lap();
    this.#output_items.statusMsgId = this.#statusMsg?.message_id || this.#output_items.statusMsgId;

    this.#output_items.intervalTimerId = otherFunctions.setIntervalAdvanced(
      () => this.#tgmMessagesQueue.add(() => this.deliverProgressMsgToTgm(`on_start_of_process and interval`)), this.#output_items.interval_ms
    );
    this.#output_items.status = "in_progress"
  }

  completedOutputItem(output_index) {

    const { type, individualTimer, timeoutTimerId, text } = this.#output_items[output_index];
    if (type === 'message' || type === 'mcp_approval_request') return;

    individualTimer && individualTimer.stop_lap();
    clearTimeout(timeoutTimerId);

    this.#tgmMessagesQueue.add(() => this.deliverProgressMsgToTgm(`on_event_completed: ${output_index}`));
  }

  async processEvent(event) {
    const { output_index, response, item, text } = event;
    try {
      switch (event.type) {
        case 'response.created':
          await this.handleResponseCreated(event);
          break;
        case 'response.output_item.added':
          await this.handleOutputItemAdded(event);
          break;
        case 'response.output_text.delta':
          this.#message_items[output_index].text += event?.delta || "";

          if (this.#message_items[output_index].deliverResponseToTgm.sentMsgIds().length === 0) {
            await this.#message_items[output_index].deliverResponseToTgm.setInitialSentMsgId(this.#statusMsg)
            this.markStatusMsgAsUsed();
          };
          this.#message_items[output_index].throttledDeliverResponseToTgm()
          break;
        case 'response.image_generation_call.partial_image':
          await this.#hostedImageGenerationCall.partialCommit(event)
          break

        case 'response.output_text.done':

          this.#message_items[output_index].text = text || "";
          this.#message_items[output_index].completion_ended = true;
          this.#message_items[output_index].throttledDeliverResponseToTgm()
          break;

        case 'response.mcp_call.in_progress':
          break;
        case 'response.mcp_list_tools.completed':
          // console.log('MCP list tools completed',event.output_index, JSON.stringify(event,null,4));
          break;
        case 'response.output_item.done':
          if (this.#output_items[output_index].status === "failed") return;

          try {
            await this.handleOutputItemDone(event);
          } catch (err) {
            throw err;
          } finally {
            this.completedOutputItem(output_index);
          }
          break;
        case 'response.completed':
          await this.#dialogue.finalizeTokenUsage(this.#user.currentModel, response.usage)
          delete global.completionInstances[this.#responseIdShort]
          break;
        case 'response.incomplete':
          await this.#dialogue.finalizeTokenUsage(this.#user.currentModel, response.usage)
          delete global.completionInstances[this.#responseIdShort]
          break;
        case 'response.failed':
          delete global.completionInstances[this.#responseIdShort]
          const { code, message } = response.error;
          const err = new Error(`${code}: ${message}`);
          err.code = "OAI_ERR99"
          err.user_message = message
          err.place_in_code = "responseEventsHandler.failed";
          throw err;
        case 'artificial.output_item':
          await this.handleArtificialEvents(event)
          this.completedOutputItem(output_index);
          break;
      }
    } catch (err) {
      console.log("Error in processEvent:", err);

      err.place_in_code = err.place_in_code || `processEvent.${event.type}`;

      this.cancelEventByError(err, event.output_index);
      this.#errorHandlerInstance.handleError(err);
    };
  };

  async handleResponseCreated(event) {
    const { id, created_at } = event.response;
    this.#responseId = id;
    this.#responseIdShort = otherFunctions.valueToMD5(id);
    global.completionInstances[this.#responseIdShort] = this;

    this.#completionCreatedTS = created_at;
    this.#completionCreatedDT_UTC = new Date(created_at * 1000).toISOString();
  };

  async handleOutputItemAdded(event) {
    const { output_index, item: { type } } = event;

    try {
      this.#output_items[output_index] = {
        type: type,
        status: "in_progress",
        individualTimer: this.timer()
      };
      this.#output_items.last_output_index = event.output_index ? event.output_index : this.#output_items.last_output_index;

      if (['message', 'mcp_approval_request'].includes(type)) {
        this.completeProcess()
      } else {
        this.#output_items[output_index].individualTimer.start_lap();
        if (output_index === 0) this.initialiseProcess();

        if (type === 'reasoning' && output_index === 0) {

        } else {
          this.markStatusMsgAsUsed();
        }
      }

      switch (event.item.type) {
        case 'message':
          this.handleMessageAdded(event)
          break;
        case 'function_call':
          await this.createFunctionCall(event)
          break;
        case 'web_search_call':
          this.#hostedSearchWebToolCall = this.searchWebToolCall()
          await this.#hostedSearchWebToolCall.initialCommit(event)
          break;
        case 'code_interpreter_call':
          this.#hostedCodeInterpreterCall = this.codeInterpreterCall()
          await this.#hostedCodeInterpreterCall.initialCommit(event)
          break;
        case 'reasoning':
          this.#hostedReasoningCall = this.reasoningCall()
          await this.#hostedReasoningCall.initialCommit(event)
          break;
        case 'image_generation_call':
          this.#hostedImageGenerationCall = this.imageGenerationCall()
          await this.#hostedImageGenerationCall.initialCommit(event)
          break;
        case 'mcp_list_tools':
          this.#hostedMCPToolRequest = this.MCPToolsRequest(event)
          await this.#hostedMCPToolRequest.initialCommit(event)
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
    } finally {
      this.#tgmMessagesQueue.add(() => this.deliverProgressMsgToTgm(`on_event_added: ${output_index}`));

    }
  }

  async handleMessageAdded(event) {
    const { output_index, item } = event;
    const { role, status } = item;

    this.#message_items[output_index] = this.#completionObjectDefault
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
    this.#message_items[output_index].throttledDeliverResponseToTgm = this.throttleWithImmediateStart(this.#message_items[output_index].deliverResponseToTgm.run, appsettings.telegram_options.send_throttle_ms);
    this.#message_items[output_index].completion_version = this.#completionCurrentVersionNumber;
  }

  async handleOutputItemDone(event) {
    const { output_index } = event;

    try {
      switch (this.#output_items[output_index].type) {
        case 'message':
          await this.handleMessageDone(event)
          this.#output_items.triggerNextCompletion = false;
          break;
        case 'function_call':
          await this.triggerFunctionCall(event)
          this.#output_items.triggerNextCompletion = true;
          break;
        case 'web_search_call':
          await this.#hostedSearchWebToolCall.finalCommit(event)
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

  async handleMessageDone(event) {
    const { output_index, item } = event;
    const { content = [] } = item;
    this.#output_items[output_index].status = item?.status;
    if (this.#message_items[output_index].text != "") {
      this.#message_items[output_index].status = item?.status;
      this.#message_items[output_index].content = [item?.content[0]];
      const completionObj = this.#message_items[output_index];
      this.#commitToDBQueue.add(() => this.#dialogue.commitCompletionDialogue(completionObj));
    }

    const annotations = content[0] ? content[0].annotations : null;
    if (annotations) {
      const fileCitations = annotations
        .filter(ann => ann.type === "container_file_citation")
        .map(ann => {
          return { container_id: ann.container_id, file_id: ann.file_id, filename: ann.filename }
        });

        const getFilePromises = fileCitations.map(citation => (async () => {
          const {container_id, file_id,filename} = citation;
          
          const file_buffer = await openAIApi.getFileFromContainer(container_id, file_id);

          if(file_buffer && filename){
          const mimetype = otherFunctions.getMimeTypeFromPath(filename)
          await this.#replyMsg.sendDocumentAsBinary(file_buffer, filename, mimetype || 'text/plain', { caption:null, parse_mode: "html", reply_markup:null });
          }
        })());
        await Promise.all(getFilePromises);
    }
  }

  async messageUpdate(text, message_id, reply_markup, parse_mode = "html") {

      return await this.#replyMsg.simpleMessageUpdate(text, {
        chat_id: this.#replyMsg.chatId,
        message_id: message_id,
        reply_markup: reply_markup,
        parse_mode: parse_mode
      })
    }

  async handleArtificialEvents(event) {
      const { output_index, item: { type } } = event;

      this.#output_items[output_index] = {
        type,
        status: "in_progress",
        individualTimer: this.timer()
      };
      this.#output_items[output_index].individualTimer.start_lap();
      this.#output_items.last_output_index = event.output_index ? event.output_index : this.#output_items.last_output_index;
      try {
        switch (this.#output_items[output_index].type) {
          case 'github_resource_upload':
            await this.handleGithubResourceUpload(event)
            this.#output_items.triggerNextCompletion = true;
            break;
        }
      } catch (err) {
        err.place_in_code = err.place_in_code || `handleArtificialEvents.${this.#output_items[output_index].type}`;
        throw err;
      }
    }

  async handleGithubResourceUpload(event) {
      const { output_index, item } = event;
      const tokenLimitPerResource = (this.#overalTokenLimit - await this.#dialogue.metaGetTotalTokens()) * this.#tokenFetchLimitPcs;
      const { arguments: argumentsStr, name } = item;

      this.#output_items[output_index].friendlyName = "GitHub";
      this.#output_items[output_index].details = "загружаю ресурс из репозитория";
      this.#output_items[output_index].request = { arguments: argumentsStr, name: name };
      this.#output_items[output_index].timeoutTimerId = setTimeout(() => this.cancelEventByTimeout(appsettings.other_options?.github_resource_upload_timeout_ms || 120000, output_index), appsettings.other_options?.github_resource_upload_timeout_ms || 120000);
      
      const data = {};
      const resourceId = otherFunctions.convertStringToUniqueNumber(argumentsStr);
      try {

        await this.#dialogue.commitResourceToTempStorage("github_resource", resourceId);
        const argumentsObj = JSON.parse(argumentsStr);

        const auth_token = this.#user.mcp?.auth?.github?.token;

        if (!auth_token) throw new Error('No github auth token provided.');
        const mcpCallResult = await mcp_tools_API.githubMCPCall(name, argumentsObj, auth_token)

        const text = JSON.stringify(mcpCallResult, null, 4);
        data["resourceData.content_json"] = mcpCallResult;
        data["resourceData.content_text"] = text;
        data.extracted = true; data.charCount = text.length;
        data.tokenCount = await otherFunctions.countTokensLambda(text, this.#user.currentModel);

        otherFunctions.saveTextToTempFile(text, `github_resource_.json`);

        if (data.tokenCount < tokenLimitPerResource) {
          await this.#dialogue.commitExtractedTextToDialogue(text, resourceId)
          data.embeddedInDialogue = true;
        } else {
          data.embeddedInDialogue = false;
          data.comments = `The text volume (${data.tokenCount} tokens) exceeds the token limit of ${tokenLimitPerResource} tokens, so it cannot be included into dialogue.`
        }

        this.#output_items[output_index].status = "completed";
        this.#output_items[output_index].details = "ресурс загружен из репозитория";
        this.#output_items[output_index].response = mcpCallResult;

      } catch (err) {
        data.extracted = true;
        data.embeddedInDialogue = false;
        data.error = err.message;
        this.#output_items[output_index].status = "failed";
        this.#output_items[output_index].details = "ресурс загружен из репозитория";
        this.#output_items[output_index].error = { error: err.message };
        await this.#dialogue.commitExtractedTextToDialogue(err.message, resourceId)
        err.sendToUser = false;
        err.adminlog = false;
        err.place_in_code = `handleGithubResourceUpload`;
        this.#errorHandlerInstance.handleError(err);
      } finally {
        mongo.updateDataInTempStorage(this.#user.userid, resourceId, data)
      }
    }

    reasoningCall() {
      return {
        "initialCommit": (event) => {
          const { output_index } = event;
          this.#output_items[output_index].friendlyName = "Рассуждение";
          this.#output_items[output_index].details = "думаю...";
          this.#output_items[output_index].timeoutTimerId = setTimeout(() => this.cancelEventByTimeout(appsettings.other_options?.reasoning_timeout_ms || 120000, output_index), appsettings.other_options?.reasoning_timeout_ms || 120000);
        },
        "endCommit": async (event) => {
          const { output_index, item } = event;
          const { summary } = item;
          this.#output_items[output_index].details = "завершено";
          this.#output_items[output_index].status = "completed";
          this.#output_items[output_index].response = { summary };

          this.#commitToDBQueue.add(() => this.#dialogue.commitReasoningToDialogue(this.#responseId, output_index, item));

        }
      }
    }

    MCPToolsRequest(initialEvent) {

      const { server_label } = initialEvent.item;
      const availableToolsInstance = new AvailableTools(this.#user);

      return {
        "initialCommit": async (mcp_tool_event) => {
          const { output_index } = mcp_tool_event;
          this.#output_items[output_index].friendlyName = server_label.charAt(0).toUpperCase() + server_label.slice(1);
          this.#output_items[output_index].details = `получаю список инструментов ...`;

          const tools = await availableToolsInstance.getMCPToolsForCompletion("main");
          const result = tools.find(server => server.server_label === server_label && typeof (server?.server_url) === "undefined");
          const { server_url, authorization } = result || {};
          try {
            if (server_url) {
              const result = await mcp_tools_API.connectMCP(server_url, authorization);
              const mcp_session_id = result?.transport?.sessionId;
              if (mcp_session_id) {
                this.#commitToDBQueue.add(() => otherFunctions.commitMCPSessionIdsToProfile(this.#user.userid, { server_label, mcp_session_id }))
              }
            }
          } catch (err) {
            console.log(JSON.stringify({ error: err.message, server_label }));
          } finally {
            this.#output_items[output_index].timeoutTimerId = setTimeout(() => this.cancelEventByTimeout(appsettings.other_options?.mcp_tools_timeout_ms || 120000, output_index), appsettings.other_options?.mcp_tools_timeout_ms || 120000);
          }
        },
        "endCommit": async (mcp_tool_event) => {
          const { output_index, item } = mcp_tool_event;
          const { error, output } = item;
          if (error) {
            this.#output_items[output_index].status = "failed";
            this.#output_items[output_index].details = "не удалось получить список инструментов";
            this.#output_items[output_index].error = { error };
          } else {
            this.#output_items[output_index].status = "completed";
            this.#output_items[output_index].details = "список инструментов получен";
            this.#output_items[output_index].response = { output };
            this.#commitToDBQueue.add(() => otherFunctions.commitMCPToolsToProfile(this.#user.userid, item));
          }
        }
      }
    }

    MCPApprovalRequest() {

      return {
        "approvalRequest": async (event) => {

          const { output_index, item } = event;
          const { server_label, name, arguments: { call_arguments } } = item;

          const functionDescription = `${server_label.charAt(0).toUpperCase() + server_label.slice(1)}`;
          const text_message = `<b>${functionDescription}</b> запрашивает подтверждение. \nПодтвердите выполнение запроса <code>${name}</code> со следующими агрументами: <code>${call_arguments}</code>.`
          const reply_markup = await this.craftReplyMarkupForMCPApprovalRequest(this.#responseId, output_index, item, text_message);
          this.#output_items[output_index].status = "completed";

          this.#tgmMessagesQueue.add(() => this.#replyMsg.sendToNewMessage(text_message, reply_markup, "html"));
          this.#commitToDBQueue.add(() => this.#dialogue.commitMCPApprovalRequestToDialogue(this.#responseId, output_index, item));
        }
      }
    }

  async craftReplyMarkupForMCPApprovalRequest(responseId, output_index, item, msg_text) {

      const { server_label, id } = item;

      const approval_text = `${msg_text} \n\n✅ Подтвержден`
      const cancel_text = `${msg_text} \n\n❌ Отменен`

      const approve_object = {
        request_id: id,
        server_label,
        approve: true,
        reason: null,
        responseId,
        output_index,
        msg_text: approval_text
      };

      const cancel_object = {
        request_id: id,
        server_label,
        approve: false,
        reason: null,
        responseId,
        output_index,
        msg_text: cancel_text
      };

      const approve_hash = await otherFunctions.encodeJson(approve_object)
      const cancel_hash = await otherFunctions.encodeJson(cancel_object)

      const approve_callback_data = { e: "mcp_req", d: approve_hash }
      const cancel_callback_data = { e: "mcp_req", d: cancel_hash }

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

    MCPCall(initialEvent) {
      const { server_label } = initialEvent.item;

      return {
        "initialCommit": (event) => {
          const { item, output_index } = event;
          const { name, arguments: argumentsStr } = item;
          this.#output_items[output_index].friendlyName = server_label.charAt(0).toUpperCase() + server_label.slice(1);
          this.#output_items[output_index].details = `запрос '${name}'  ...`;

          this.#output_items[output_index].timeoutTimerId = setTimeout(() => this.cancelEventByTimeout(appsettings.other_options?.mcp_call_timeout_ms || 120000, output_index), appsettings.other_options?.mcp_call_timeout_ms || 120000);
        },
        "endCommit": async (event) => {
          const { output_index, item } = event;
          const { name, error, output, arguments: argumentsStr } = item;

          if (error) {
            if (error.type === "mcp_protocol_error") {
              const { tools, mcpSessionId } = await mcp_tools_API.getMCPToolsList(this.#user, "main");
              const toolsPromises = tools.map(tool => otherFunctions.commitMCPToolsToProfile(this.#user.userid, tool));
              const mcpSessionPromises = mcpSessionId.map(sessionid => otherFunctions.commitMCPSessionIdsToProfile(this.#user.userid, sessionid));
              this.#commitToDBQueue.add(() => Promise.all([...toolsPromises, ...mcpSessionPromises]));
            };
            this.#output_items[output_index].status = "failed";
            this.#output_items[output_index].request = { arguments: argumentsStr };
            this.#output_items[output_index].details = `запрос '${name}' выдал ошибку`;
            this.#output_items[output_index].error = { error };
          } else {
            this.#output_items[output_index].status = "completed";
            this.#output_items[output_index].request = { arguments: argumentsStr };
            this.#output_items[output_index].details = `запрос '${name}' выполнен`;
            this.#output_items[output_index].response = { output };
          };
          this.#commitToDBQueue.add(() => this.#dialogue.commitMCPCallToDialogue(this.#responseId, output_index, item))
        }
      }
    }


    imageGenerationCall() {

      return {
        "initialCommit": async (event) => {
          const { output_index } = event;

          this.#output_items[output_index].friendlyName = "Изображение OpenAI";
          this.#output_items[output_index].details = `генерирую ...`;
          this.#output_items[output_index].timeoutTimerId = setTimeout(() => this.cancelEventByTimeout(appsettings.other_options?.image_generation_timeout_ms || 120000, output_index), appsettings.other_options?.image_generation_timeout_ms || 120000);
        },
        "partialCommit": async (event) => {
          const { output_index } = event;
          const { partial_image_index, partial_image_b64, output_format, item_id } = event;
          if (partial_image_index === 0) return;
          const partialImageBuffer = Buffer.from(partial_image_b64, 'base64');
          const filename = `partial_image_${item_id.slice(0, 10)}_${partial_image_index}.${output_format}`;
          const mime_type = otherFunctions.getMimeTypeFromPath(`test.${output_format}`);
          this.#output_items[output_index].details = "это еще не все. Продолжаю ..."
          this.#output_items[output_index].caption_message = `⏳ <b>${this.#output_items[output_index].friendlyName}</b>: ${this.#output_items[output_index].details} ${this.#output_items[output_index].individualTimer.get_total_HHMMSS()}`;

          this.#tgmMessagesQueue.add(() => Promise.all([
            (async () => {
              if (this.#output_items[output_index].imageMsgId) {
                await this.#replyMsg.updateMediaFromBuffer(this.#output_items[output_index].imageMsgId, partialImageBuffer, filename, "photo", null, null, "html")
              } else {
                const { message_id } = await this.#replyMsg.sendOAIImage(partialImageBuffer, null, item_id, output_format, mime_type, "html", null);
                this.#output_items[output_index].imageMsgId = message_id;
              }
            })()
          ]));

          clearInterval(this.#output_items[output_index].timerId);
          this.#output_items[output_index].timerId = otherFunctions.setIntervalAdvanced(() => {
            this.#output_items[output_index].caption_message = `⏳ <b>${this.#output_items[output_index].friendlyName}</b>: ${this.#output_items[output_index].details} ${this.#output_items[output_index].individualTimer.get_total_HHMMSS()}`;
            this.#tgmMessagesQueue.add(() => this.#output_items.deliverCaptionToTgm(output_index));
          }, this.#output_items.interval_ms);

          clearTimeout(this.#output_items[output_index].timeoutTimerId);
          this.#output_items[output_index].timeoutTimerId = setTimeout(() => this.cancelEventByTimeout(appsettings.other_options?.image_generation_timeout_ms || 120000, output_index), appsettings.other_options?.image_generation_timeout_ms || 120000);
        },
        "endCommit": async (completedEvent) => {
          const { item, output_index } = completedEvent;
          const { background, output_format, quality, type, id, result, revised_prompt, size } = item;

          const mime_type = otherFunctions.getMimeTypeFromPath(`test.${output_format}`);
          const imageBuffer = Buffer.from(result, 'base64');
          const filename = otherFunctions.valueToMD5(String(this.#user.userid)) + "_" + this.#user.currentRegime + "_" + otherFunctions.valueToMD5(String(this.#output_items[output_index].imageMsgId)) + "." + output_format;
          const { Location } = await awsApi.uploadFileToS3FromBuffer(imageBuffer, filename)
          this.#output_items[output_index].details = `генерация завершена`;
          this.#output_items[output_index].status = "completed";
          this.#output_items[output_index].response = { result: "image generated and delivered to the user", image_url_s3: Location, filename, mime_type, revised_prompt, size, quality, background };

          let prompt_used = revised_prompt <= appsettings.telegram_options.big_outgoing_caption_threshold ?
            revised_prompt :
            revised_prompt.slice(0, appsettings.telegram_options.big_outgoing_caption_threshold) + "...";
          this.#output_items[output_index].caption_message = `✅ <b>${this.#output_items[output_index].friendlyName}</b>: ${this.#output_items[output_index].details} ${this.#output_items[output_index].individualTimer.get_total_HHMMSS()}\n\n${prompt_used} --size ${size} --quality ${quality} --background ${background}`;

          clearInterval(this.#output_items[output_index].timerId);
          this.#tgmMessagesQueue.add(() => Promise.all([
            (async () => {
              if (this.#output_items[output_index].imageMsgId) {
                await this.#replyMsg.updateMediaFromBuffer(this.#output_items[output_index].imageMsgId, imageBuffer, filename, "photo", this.#output_items[output_index].caption_message, null, "html")
              } else {
                const { message_id } = await this.#replyMsg.sendOAIImage(imageBuffer, this.#output_items[output_index].caption_message, id, output_format, mime_type, "html", null);
                this.#output_items[output_index].imageMsgId = message_id;
              }

              const reply_markup = this.craftReplyMarkupForImageGeneration(Location);
              await this.#replyMsg.updateMessageReplyMarkup(this.#output_items[output_index].imageMsgId, reply_markup)
              mongo.saveTempReplyMarkup(this.#user.userid, this.#output_items[output_index].imageMsgId, reply_markup)
            })()
          ]))

          const fileComment = {
            image_id: id,
            format: output_format,
            revised_prompt: revised_prompt,
            public_url: Location,
            content: "Image generated with image generation tool",
          }

          this.#commitToDBQueue.add(() => this.#dialogue.commitImageToDialogue(fileComment, { url: null, base64: result, sizeBytes: imageBuffer.length, mimetype: mime_type }, 0, this.#output_items[output_index].imageMsgId));

          setTimeout(() => this.#replyMsg.removeReplyMarkupFromMsg(this.#output_items[output_index].imageMsgId).catch(err => console.log(`Cannot delete ${this.#output_items[output_index].imageMsgId}`)), global.appsettings.telegram_options.edit_message_timeout_ms)

          mongo.insertCreditUsage({
            userInstance: this.#user,
            creditType: "oai_image_generation",
            creditSubType: "create",
            usage: 1,
            details: { place_in_code: "imageGenerationCall" }
          })
        }
      }
    }

    craftReplyMarkupForImageGeneration(url) {
      if (url) {
        const btnText = otherFunctions.getLocalizedPhrase(`full_size_image`, this.#user.language);
        const reply_markup = {
          one_time_keyboard: true,
          inline_keyboard: [[{ text: btnText, url: url }]]
        }
        return reply_markup;
      } else {
        return null
      }
    }

    codeInterpreterCall() {
      return {
        "initialCommit": (initialEvent) => {
          const { output_index } = initialEvent;

          this.#output_items[output_index].friendlyName = "Анализ данных"
          this.#output_items[output_index].details = `в работе ...`;
          this.#output_items[output_index].timeoutTimerId = setTimeout(() => this.cancelEventByTimeout(appsettings.other_options?.code_interpreter_timeout_ms || 120000, output_index), appsettings.other_options?.code_interpreter_timeout_ms || 120000);
        },
        "endCommit": async (completedEvent) => {
          const { item, output_index } = completedEvent;
          const { code, outputs = [] } = item;

          const outputsLogs = [];

          const safeOutputs = outputs || [];
          safeOutputs.forEach(output => {
            if (output.type === "image" && output.url) {
              outputsLogs.push({ type: "image", url: "base64 data" });
            }
            if (output.type === "logs" && output.logs) {
              outputsLogs.push(output);
            }
          });

          this.#commitToDBQueue.add(() => this.#dialogue.commitCodeInterpreterOutputToDialogue(this.#responseId, output_index, item, this.#output_items[output_index].statusMsgId));
          this.#output_items[output_index].details = `готово`;
          this.#output_items[output_index].status = "completed";
          this.#output_items[output_index].response = { code, outputs: outputsLogs };



          mongo.insertCreditUsage({
            userInstance: this.#user,
            creditType: "code_interpreter",
            creditSubType: item.container_id,
            usage: 1,
            details: { place_in_code: "codeInterpreterCall" }
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

  async craftReplyMarkupForDetails(output_result, msgText) {

      let unfoldedTextHtml = `<b>function:</b> code_interpreter_call`;

      output_result.forEach((output) => {

        const snipet = `-------------------------
<b>output_index:</b> ${output.output_index}
<b>code:</b><pre><code class="python">${otherFunctions.wireHtml(otherFunctions.unWireText(output.code))}</code></pre>
<b>outputs:</b><pre><code class="json">${otherFunctions.wireHtml(otherFunctions.unWireText(JSON.stringify(output.outputs, null, 4)))}</code></pre>
`;
        unfoldedTextHtml += snipet;
      })

      const infoForUserEncoded = await otherFunctions.encodeJson({ unfolded_text: unfoldedTextHtml, folded_text: msgText })
      const callback_data = { e: "un_f_up", d: infoForUserEncoded }

      const fold_button = {
        text: "Показать подробности",
        callback_data: JSON.stringify(callback_data),
      };

      return {
        one_time_keyboard: true,
        inline_keyboard: [[fold_button],],
      };
    }

    searchWebToolCall() {

      return {
        "initialCommit": async (event) => {

          const { output_index, item } = event;
          const { type } = item;
          let toolType;
          switch (type) {
            case "web_search_call":
              toolType = "ищу в Bing";
          };
          this.#output_items[output_index].friendlyName = "Интернет поиск";
          this.#output_items[output_index].details = `{toolType} ...`;
          this.#output_items[output_index].timeoutTimerId = setTimeout(() => this.cancelEventByTimeout(appsettings.other_options?.web_search_tool_timeout_ms || 120000, output_index), appsettings.other_options?.web_search_tool_timeout_ms || 120000);
        },
        "finalCommit": async (completedEvent) => {

          const { item, output_index } = completedEvent;
          const { action: { type, query, url, pattern }, error, output } = item;
          switch (type) {
            case "search":
              this.#output_items[output_index].details = query;
              break;
            case "open_page":
              this.#output_items[output_index].details = url;
              break;
            case "find_in_page":
              this.#output_items[output_index].details = `${pattern} -> ${url}`;
              break;
          }

          if (error) {
            this.#output_items[output_index].status = "failed";
            this.#output_items[output_index].details = `возникла ошибка`;
            this.#output_items[output_index].error = { error };
          } else {
            this.#output_items[output_index].status = "completed";
            this.#output_items[output_index].details = `готово `;
            this.#output_items[output_index].response = { output };
          }
          //add commit to dialogue here
        }
      }
    }

    buildHostedToolCompletionHtml(event) {
      const { item, output_index } = event;
      const { action, type, id } = item;
      let argsText = JSON.stringify(action, this.modifyStringify, 2)
      argsText = otherFunctions.unWireText(argsText)
      const request = `<pre>${otherFunctions.wireHtml(argsText)}</pre>`

      const htmlToSend = `<b>type: ${type}</b>\nid: ${id}\noutput_index: ${output_index}\n\n<b>request:</b>\n${request}`

      return htmlToSend
    }

    setStatusMsgAsUsed(statusMsg) {
      statusMsg = null;
    }



  async createFunctionCall(event) {

      const { item, output_index } = event;
      const { id, call_id, name, status } = item;
      const item_type = item.type;

      const availableTools = new AvailableTools(this.#user);
      const toolConfig = await availableTools.toolConfigByFunctionName(name);

      this.#output_items[output_index].friendlyName = toolConfig?.friendly_name || name;
      this.#output_items[output_index].details = `получаем параметры функции ...`;

      const wiredFunctionName = otherFunctions.wireFunctionName(name);
      const options = {
        functionCall: {
          responseId: id,
          status: status,
          tool_call_id: call_id,
          tool_call_index: output_index,
          tool_call_type: item_type,
          function_name: wiredFunctionName,
          tool_config: toolConfig
        },
        replyMsgInstance: this.#replyMsg,
        dialogueInstance: this.#dialogue,
        requestMsgInstance: this.#requestMsg,
        completionInstance: this,
        output_index: output_index
      };
      this.#functionCalls[output_index] = new FunctionCall(options)

    }

  async triggerFunctionCall(event) {
      const { output_index, item } = event;
      const outputItem = this.#output_items[output_index];

      const { status, call_id, name } = item;
      const item_type = item.type;
      this.#functionCalls[output_index].function_arguments = item?.arguments;
      const tollCallIndexes = Object.keys(this.#functionCalls)

      outputItem.request = { arguments: item?.arguments, name: name };

      const currentTokenLimit = (this.#overalTokenLimit - await this.#dialogue.metaGetTotalTokens()) * this.#tokenFetchLimitPcs;
      const divisor = tollCallIndexes.length === 0 ? 1 : tollCallIndexes.length;
      const tokensLimitPerCall = currentTokenLimit / divisor;

      tollCallIndexes.forEach((index) => {
        this.#functionCalls[index].tokensLimitPerCall = tokensLimitPerCall;
      });

      this.#commitToDBQueue.add(() => this.#dialogue.commitFunctionCallToDialogue({
        tool_call_id: call_id,
        function_name: name,
        tool_config: this.#functionCalls[output_index].tool_config,
        output_item_index: output_index,
        responseId: this.#responseId,
        sourceid: `${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_call`,
        function_arguments: item?.arguments,
        status: status,
        type: item_type
      }))

      this.#commitToDBQueue.add(() => this.#dialogue.preCommitFunctionReply({
        tool_call_id: call_id,
        function_name: name,
        output_item_index: output_index,
        tool_config: this.#functionCalls[output_index].tool_config,
        sourceid: `${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_output`,
        status: "in_progress",
        type: "function_call_output"
      }))

      if (!this.#functionCalls[output_index].tool_config) {
        console.log("Error of function call", output_index)
      };

      const outcome = this.#functionCalls[output_index].tool_config ?
        await this.#functionCalls[output_index].router() :
        { success: 0, error: `${name} function does not exist in the list of available functions`, tool_call_id: call_id, function_name: name }

      const { supportive_data, success, tool_call_id, function_name } = outcome;

      if (success !== 1) {
        outputItem.status = "failed";
        outputItem.details = `завершено с ошибкой`;
        outputItem.error = { error: outcome.error || "Unknown error during function execution" };
      } else {
        outputItem.status = "completed";
        outputItem.details = `завершено успешно`;
        outputItem.response = { outcome };
      };

      const toolExecutionResult = {
        tool_call_id, success, function_name,
        sourceid: `${this.#functionCalls[output_index].responseId}_output_index_${output_index}_function_output`,
        duration: supportive_data?.duration || 0,
        fullContent: supportive_data?.fullContent,
        status: "completed",
        content: JSON.stringify(outcome, this.modifyStringify, 2)
      };

      this.#commitToDBQueue.add(() => this.#dialogue.updateCommitToolReply(toolExecutionResult))
      this.#tgmMessagesQueue.add(() => this.commitImages(supportive_data, function_name, tool_call_id))

      return output_index

    }

    modifyStringify(key, value) {
      if (key === 'supportive_data' || key === 'tool_call_id' || key === 'function_name') {
        return undefined; // Exclude this key from the JSON stringification
      }
      return value
    }

  async commitImages(supportive_data, function_name, tool_call_id) {

      const mdj_public_url = supportive_data?.image_url;

      if (function_name === "create_midjourney_image" && mdj_public_url) {

        const mdj_image_base64 = supportive_data?.base64;
        const mdj_prompt = supportive_data?.midjourney_prompt;
        const size_bites = supportive_data?.size_bites;
        const mimetype = supportive_data?.mimetype || "image/jpeg";

        const fileComment = {
          midjourney_prompt: mdj_prompt,
          public_url: mdj_public_url,
          context: "Image has been generated by 'create_midjourney_image' function",
        }

        await this.#dialogue.commitImageToDialogue(fileComment, {
          url: mdj_public_url,
          base64: mdj_image_base64,
          sizeBytes: size_bites,
          mimetype: mimetype
        }, 0, null);

      }
    }

  async waitForFinalization() {
      const startTime = Date.now();
      const timeoutMs = appsettings?.other_options?.completion_finalization_timeout_ms || 360_000_000; // Use instance timeout or default 120 seconds

      while (Object.values(this.#output_items).some(item => item && item.status === "in_progress")) {
        const incompleteItems = Object.values(this.#output_items).filter(item => item && item.status === "in_progress").map(item => ({ output_index: item.output_index, type: item.type }));
        console.log(new Date, "Incomplete cycles, waiting...", JSON.stringify(incompleteItems));

        if (Date.now() - startTime > timeoutMs) {
          const err = new Error(`Timeout waiting for output items to complete after ${timeoutMs}ms`);
          err.code = "COMPLETION_TIMEOUT";
          err.sendToUser = false;
          err.details = Object.values(this.#output_items).map(item => ({ output_index: item.output_index, type: item.type, status: item.status, statusMsgId: item.statusMsgId }));
          err.adminlog = false;
          err.place_in_code = "waitForFinalization";
          this.#errorHandlerInstance.handleError(err);
          break;
        }
        await otherFunctions.delay(1000)
      };
    }

  async filesLoadingHandler() {

      let currentText = "initial"

      while (await this.#dialogue.metaOAIStorageFilesUploadInProgress()) {

        if (currentText == "initial") {
          const msg = otherFunctions.getLocalizedPhrase(`files_loading_msg`, this.#user.language)
          this.updateStatusMsg(msg, this.#statusMsg.message_id, this.#statusMsg.chat.id)
          currentText = "loading"
        }
        await otherFunctions.delay(appsettings?.file_options?.loading_files_wait_ms || 2000)
      }
      if (currentText == "loading") {
        const msg = otherFunctions.getLocalizedPhrase(`status_msg`, this.#user.language)
        this.updateStatusMsg(msg, this.#statusMsg.message_id, this.#statusMsg.chat.id)
        currentText = "initial"
      }
    };

  async router() {

      try {

        this.#completionPreviousVersionsDoc = await this.completionPreviousVersions();
        this.#updateCompletionVariables()

        await this.#replyMsg.sendTypingStatus()
        this.#statusMsg = await this.#replyMsg.sendStatusMsg()

        await this.filesLoadingHandler()

        this.#long_wait_notes = this.triggerLongWaitNotes(this.#statusMsg)

        this.#responseStream = await openAIApi.responseStream(this.#dialogue);

        this.clearLongWaitNotes();

        await this.responseEventsHandler(this.#responseStream);
        await this.waitForFinalization()
        this.completeProcess();
        otherFunctions.saveTextToTempFile(JSON.stringify({ ...this.#output_items, place: "router" }, this.removeCircularKeys, 4), `output_items.json`)
        if (this.#output_items.triggerNextCompletion) {
          this.#dialogue.triggerCallCompletion();
        }

      } catch (err) {
        console.log("Error in completion router:", err.message);
        this.clearLongWaitNotes();
        err.place_in_code = err.place_in_code || "completion.router";
        this.#errorHandlerInstance.handleError(err);

      } finally {

        this.#decoder.end()
        this.#dialogue.regenerateCompletionFlag = false
      }
    }

    removeCircularKeys(key, value) {

      if (key === 'timerId' || key === 'timeoutID' || key === 'individualTimer' || key === 'generalTimer' || key === 'intervalTimerId' || key === 'timeoutTimerId') {
        return undefined; // Exclude this key from the JSON stringification
      }
      return value
    }

  async waitForTheStreamToFinish(stream) {

      return new Promise((resolve, reject) => {
        stream.on('end', () => {
          resolve();
        });
        stream.on('error', (err) => {
          reject(err);
        });
      });

    }

    #updateCompletionVariables() {

      if (!this.#dialogue.regenerateCompletionFlag) {
        this.#completionPreviousVersionsContent = [];
        this.#completionPreviousVersionsContentCount = undefined;
        this.#completionPreviousVersionNumber = undefined;
        this.#completionCurrentVersionNumber = 1
        return
      }

      const lastCompletionDoc = this.#completionPreviousVersionsDoc

      if (!lastCompletionDoc) {
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


  async completionPreviousVersions() {

      const lastCompletionDoc = await this.#dialogue.getLastCompletionDoc()

      if (!lastCompletionDoc) {
        return null
      }
      return lastCompletionDoc;
    }

    triggerLongWaitNotes(statusMsg) {

      const long_wait_notes = modelConfig[this.#user.currentModel]?.long_wait_notes

      let timeouts = [];
      if (long_wait_notes && long_wait_notes.length > 0) {

        for (const note of long_wait_notes) {
          const timeoutInstance = setTimeout(() => {
            this.updateStatusMsg(note.comment, statusMsg.message_id, statusMsg.chat.id)
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

  async msgDeliveredUpdater(completionObject) {
      await mongo.updateCompletionInDb({
        filter: { sourceid: completionObject.sourceid },
        updateBody: {
          telegramMsgId: completionObject.telegramMsgIds,
          telegramMsgBtns: completionObject.telegramMsgBtns,
          telegramMsgRegenerateBtns: completionObject.telegramMsgRegenerateBtns,
          telegramMsgReplyMarkup: completionObject.telegramMsgReplyMarkup,
        }
      })
    }

  get timeout() {
      return this.#timeout
    }

  get completionCurrentVersionNumber() {
      return this.#completionCurrentVersionNumber
    }

  get toolCalls() {
      return this.#tool_calls
    }

  async processChunksBatch(chunksToProcess) {

      this.#countChunks += chunksToProcess.length
      this.#isProcessingChunk = true;
      const concatenatedBatch = Buffer.concat(chunksToProcess);
      const batchString = this.#decoder.write(concatenatedBatch)

      const jsonChunks = await this.batchStringToJson(batchString);

      await this.extractData(jsonChunks)

      this.#isProcessingChunk = false;
    }

  async batchStringToJson(batchString) {

      const augumentedBatchString = this.#chunkStringBuffer + batchString

      const stringChunks = augumentedBatchString
        .split("\n")
        .filter((piece) => piece.trim() !== "")

      let jsonChunks = []

      if (stringChunks.length === 0) {
        this.#chunkStringBuffer = "";
        return jsonChunks
      };

      for (const stringChunk of stringChunks) {
        if (stringChunk === "data: [DONE]") {
          this.#chunkStringBuffer = "";
          return jsonChunks
        } else {
          try {
            const jsonChunk = JSON.parse(stringChunk.trim().substring(6))
            jsonChunks.push(jsonChunk)
            this.#chunkStringBuffer = "";
          } catch (err) {
            this.#chunkStringBuffer = stringChunk;
          }
        }
      };

      return jsonChunks
    }

  async updateStatusMsg(user_message, message_id, chat_id) {
      await this.messageUpdate(user_message, message_id, null, "html")
    };

    deliverResponseToTgmHandler(output_index) {
      const sentMsgIds = new Set([])
      let sentMsgsCharCount;
      let replyMarkUpCount = [null];
      const additionalMsgOptions = { disable_web_page_preview: true };
      let completion_delivered = false;
      const completionObject = this.#message_items[output_index];

      return {
        "sentMsgIds": () => Array.from(sentMsgIds),
        "setInitialSentMsgId": async (statusMsgInput) => {
          const statusMsg = statusMsgInput ? structuredClone(statusMsgInput) : await this.#replyMsg.sendStatusMsg()
          sentMsgIds.add(statusMsg.message_id)
          sentMsgsCharCount = [statusMsg.text.length]
        },
        "run": async () => {

          try {
            const text = completionObject.text || ""
            const completion_ended = completionObject.completion_ended || false;

            if (text === "") return { success: 0, error: "Empty response from the service." };

            if (completion_delivered) return { success: 0, error: "Completion already delivered." };

            const splitIndexBorders = this.splitTextBoarders(text, appsettings.telegram_options.big_outgoing_message_threshold);
            const textChunks = this.splitTextChunksBy(text, splitIndexBorders, completion_ended);
            const repairedText = this.repairBrokenMakrdowns(textChunks);
            const htmls = this.convertMarkdownToLimitedHtml(repairedText, this.#user.language_code);

            const messages = await this.createTGMMessagesFrom(htmls, completion_ended, additionalMsgOptions, text, completionObject)
            await this.deleteOldMessages(sentMsgIds, messages);

            const updateResult = await this.updateMessages(sentMsgIds, messages, sentMsgsCharCount, replyMarkUpCount);

            if (updateResult.success === 0 && updateResult.wait_time_ms != -1) {
              const waitResult = await this.#replyMsg.sendTelegramWaitMsg(updateResult.wait_time_ms / 1000)
              sentMsgIds.add(waitResult.message_id)
              sentMsgsCharCount.push(waitResult.text.length)
              replyMarkUpCount.push(null)

              await otherFunctions.delay(updateResult.wait_time_ms)
              const result = await completionObject.deliverResponseToTgm.run() //deliver the response after delay
              return result
            }
            await this.sendMessages(messages, sentMsgIds, sentMsgsCharCount, replyMarkUpCount)

            if (completion_ended) {
              completion_delivered = true;
              completionObject.telegramMsgIds = Array.from(sentMsgIds)
              await this.msgDeliveredUpdater(completionObject)
              return { success: 1, completion_delivered }
            }

            if (!completion_delivered && completionObject.completion_ended) {
              const result = await completionObject.deliverResponseToTgm.run()
              return result
            }
            return { success: 1, completion_delivered }

          } catch (err) {
            this.#errorHandlerInstance.handleError(err);
            return { success: 0, error: err.message }
          }
        }
      }
    }

    throttleWithImmediateStart(func, delay = 0) {

      let throttleTimeout = null
      // console.log(new Date(),"throttleNew started")
      return (...args) => {
        //  console.log(new Date(),"innerfunction execution")
        if (throttleTimeout === null) {
          throttleTimeout = setTimeout(async () => {
            //  console.log(new Date(),"callback triggered")
            await func(...args)
            throttleTimeout = null //this must be before the function call to release the throttle

          }, delay)
        }
      }
    }

    splitTextBoarders(text, tgmMsgThreshold) {

      let residualText = text;
      const textLastIndex = text.length - 1;
      let startIndex = 0;
      let endIndex = 0;
      const splitLinesString = '\n';

      const splitIndexes = [];
      while (endIndex < textLastIndex) {
        if (residualText.length < tgmMsgThreshold) {
          endIndex = textLastIndex
          const lineBreakIsUsed = false;
          splitIndexes.push([startIndex, endIndex, lineBreakIsUsed])

        } else {

          const lastNewlineIndex = residualText.lastIndexOf(splitLinesString, tgmMsgThreshold);
          const lineBreakIsUsed = lastNewlineIndex > 0
          const cropIndex = lineBreakIsUsed ? lastNewlineIndex : tgmMsgThreshold - 1;
          residualText = residualText.slice(cropIndex + 1);
          endIndex = startIndex + cropIndex;
          splitIndexes.push([startIndex, endIndex, lineBreakIsUsed])
          startIndex = endIndex + 1;
        }
      }

      return splitIndexes
    }

    splitTextChunksBy(text, splitIndexBorders, completionEnded) {

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
        if (completionEnded && index === splitIndexBorders.length - 1) {
          splitFiller = ""
        } else {
          splitFiller = lineBreakIsUsed ? "" : "...";
        }

        textChunks.push(chunk + splitFiller);
        index++;
      }

      return textChunks;
    }

    repairBrokenMakrdowns(textChunks) {
      let repairedText = [];
      let prefix = "";
      for (const chunk of textChunks) {
        const brokenTags = otherFunctions.findBrokenTags(prefix + chunk);
        repairedText.push(prefix + chunk + brokenTags?.close)
        prefix = brokenTags?.open ?? ""; //it will be used for text in the next chunk
      }
      return repairedText;
    }

    convertMarkdownToLimitedHtml(repairedText, language_code) {
      return repairedText.map((text) => {
        const conversionResult = otherFunctions.convertMarkdownToLimitedHtml(text, language_code)
        return conversionResult.html
      })
    }

  async createTGMMessagesFrom(htmls, completionEnded, additionalMsgOptions, text, completionObject) {
      const messages = [];
      let index = 0;

      for (const html of htmls) {
        const isLastChunk = index === htmls.length - 1 && completionEnded;
        const reply_markup = isLastChunk ? await this.craftReplyMarkup(text) : null;
        if (reply_markup) {
          completionObject.telegramMsgBtns = true;
          completionObject.telegramMsgRegenerateBtns = true
          completionObject.telegramMsgReplyMarkup = reply_markup;
        }
        messages.push([html, reply_markup, "HTML", additionalMsgOptions]);
        index++
      }
      return messages;
    }

  async deleteOldMessages(sentMsgIds, messages) {
      const msgsToDelete = Array.from(sentMsgIds).filter((msg, index) => index > messages.length - 1);
      for (const message_id of msgsToDelete) {
        await this.#replyMsg.deleteMsgByID(message_id)
        sentMsgIds.delete(message_id)
      }
    }

  async updateMessages(sentMsgIds, messages, sentMsgsCharCount, replyMarkUpCount) {
      const msgsToUpdate = [];
      messages.forEach((msg, index) => {
        if (sentMsgsCharCount.length > index
          &&
          (msg[0].length != sentMsgsCharCount[index] || (msg[1] !== replyMarkUpCount[index]))

        ) {
          msgsToUpdate.push([...msg, Array.from(sentMsgIds)[index], index])
        }
      })

      for (const [html, reply_markup, parse_mode, add_options, message_id, original_index] of msgsToUpdate) {
        const result = await this.#replyMsg.updateMessageWithErrorHandling(html || "_", {
          message_id: message_id,
          reply_markup: reply_markup === null ? null : JSON.stringify(reply_markup),
          parse_mode,
          ...add_options,
        })

        sentMsgsCharCount[original_index] = html.length;
        replyMarkUpCount[original_index] = reply_markup;

        if (result.success === 0 && result.wait_time_ms != -1) {
          return result
        }
      }

      return { success: 1 }
    }

  async sendMessages(messages, sentMsgIds, sentMsgsCharCount, replyMarkUpCount) {

      const msgsToSend = messages.filter((msg, index) => index > sentMsgsCharCount.length - 1);
      for (const [html, reply_markup, parse_mode, add_options] of msgsToSend) {
        const result = await this.#replyMsg.sendMessageWithErrorHandling(html || "_", reply_markup, parse_mode, add_options)
        sentMsgIds.add(result.message_id)
        sentMsgsCharCount.push(html.length);
        replyMarkUpCount.push(reply_markup);
      }
    }

  async craftReplyMarkup(text = "") {
      let reply_markup = {
        one_time_keyboard: true,
        inline_keyboard: [],
      };

      /*
    const regenerateButtons = {
        text: "🔄",
        callback_data: JSON.stringify({e:"regenerate",d:this.#user.currentRegime}),
    };*/

      const callbackData = await otherFunctions.encodeJson({ text })

      const redaloudButtons = {
        text: "🔊",
        callback_data: JSON.stringify({ e: "readaloud", d: callbackData }),
      };

      const PDFButtons = {
        text: "PDF",
        callback_data: JSON.stringify({ e: "respToPDF", d: callbackData }),
      };

      const HTMLButtons = {
        text: "🌐",
        callback_data: JSON.stringify({ e: "respToHTML", d: callbackData }),
      };

      if (this.#completionCurrentVersionNumber > 1) {
        reply_markup = this.#replyMsg.generateVersionButtons(this.#completionCurrentVersionNumber, this.#completionCurrentVersionNumber, reply_markup)
      }

      const downRow = [redaloudButtons, HTMLButtons, PDFButtons]

      /*if(this.#completionCurrentVersionNumber<10){
        downRow.unshift(regenerateButtons)
      }*/

      reply_markup.inline_keyboard.push(downRow)

      return reply_markup;
    }
  };

module.exports = Completion;