
const mongo = require("../apis/mongo.js");
const func = require("../common_functions.js");
const telegramErrorHandler = require("../errorHandler.js");
const toolsCollection = require("./toolsCollection.js");
const awsApi = require("../apis/AWS_API.js")
const PIAPI = require("../apis/piapi.js");
const ExRateAPI = require("../apis/exchangerate_API.js");
const elevenLabsApi = require("../apis/elevenlabs_API.js");
const cbrAPI = require("../apis/cbr_API.js");
const openAIApi = require("../apis/openAI_API.js");
const devPrompts = require("../../config/developerPrompts.js");
const { error } = require("pdf-lib");

class FunctionCall {
    #replyMsg;
    #requestMsg;
    #dialogue
    #user;
    #inProgress = false;
    #tokensLimitPerCall;
    #functionCall;
    #functionName;
    #functionResult="";
    #argumentsJson;
    #timeout_ms;
    #isCanceled = false;
    #functionConfig;
    #long_wait_notes;
    #timeoutId
    #tool_call_id
    #statusMsg
    #statusMsgId
    
constructor(obj) {
    this.#functionCall = obj.functionCall;
    this.#functionName = this.#functionCall.function_name;
    this.#tool_call_id = this.#functionCall.tool_call_id;
    this.#functionConfig = obj.functionCall?.tool_config;
    this.#replyMsg = obj.replyMsgInstance;
    this.#dialogue = obj.dialogueInstance;
    this.#requestMsg = obj.requestMsgInstance;
    this.#user = obj.dialogueInstance.userInstance;
    this.#timeout_ms = this.#functionConfig.timeout_ms ? this.#functionConfig.timeout_ms : 30000;
    this.#statusMsg = obj?.statusMsg;
    this.#statusMsgId = this.#statusMsg.message_id;
};

async removeFunctionFromQueue(){
    this.#functionConfig.queue_name && await mongo.removeFunctionFromQueue(this.#functionCall.tool_call_id)
}

get functionName(){
    return this.#functionName;
}

get tool_call_id(){
    return this.#tool_call_id;
}

set function_arguments(value){
    this.#functionCall.function_arguments = value;
}

set tokensLimitPerCall(value){
    this.#tokensLimitPerCall = value;
}

get status(){
    return this.#functionCall?.status
}

get responseId(){
    return this.#functionCall?.responseId
}

get tool_call_type(){
    return this.#functionCall?.tool_call_type
}

get tool_config(){
    return this.#functionCall?.tool_config
}

async addFunctionToQueue(statusMessageId){

    const queue_name = this.#functionConfig.queue_name
   
    if(!queue_name){
        return
    }

    await func.delay(500*this.#functionCall.tool_call_index)

    const queueConfig = toolsCollection.queueConfig[queue_name] || {max_concurrent:3,timeout_ms:30000,interval_ms:3000}
    const {max_concurrent, timeout_ms, interval_ms} = queueConfig
    const startTime = Date.now();

    let statusMessage = 'execution';
    while (Date.now() - startTime < timeout_ms) {

        const result = await mongo.addFunctionToQueue(queue_name,this.#functionCall.tool_call_id,max_concurrent)
        
        if(result){
            
            if(statusMessage === `in queue`){
                await this.backExecutingStatusMessage(statusMessageId)
                statusMessage = `execution`
            }
            return true
        } else {

            if(statusMessage === `execution`){
              await this.inQueueStatusMessage(statusMessageId)
              statusMessage = `in queue`
            }
            await func.delay(interval_ms)
        }
    }

    let error = new Error(`Timeout in queue exceeded. The function spent in the queue ${timeout_ms / 1000} seconds and was revoked.`);
    error.user_instructions = "Retry after 5 minutes"
    error.code = "FUNC_QUEUE_TIMEOUT";
    error.queue_timeout = true;
    throw error;
}

async handleFailedFunctionsStatus(success,functionName,queue_timeout){
    
    if(!success && !queue_timeout){
        
        const failedRuns = await this.#dialogue.metaIncrementFailedFunctionRuns(functionName)
        if(failedRuns === this.#functionConfig.try_limit){
            return {success:0,error:`Limit of unsuccessful calls is reached. Stop sending toll calls on this function, report the problem to the user and try to find another solution. To clean the limit the dialog should be reset.`}
        }
    } else {
        
        await this.#dialogue.metaResetFailedFunctionRuns(functionName)
    }
}

async router(){

       let functionOutcome = {success:0,error:"No outcome from the function returned"}
       let err;
    try{

        
        this.validateFunctionCallObject(this.#functionCall)
        this.#argumentsJson = this.argumentsToJson(this.#functionCall?.function_arguments);
        await this.executionStatusMessage(this.#statusMsgId)
        await this.addFunctionToQueue(this.#statusMsgId)

        this.#long_wait_notes = this.triggerLongWaitNotes(this.#statusMsgId,this.#functionConfig.long_wait_notes)
       
     
        functionOutcome = await this.functionHandler();
        functionOutcome.tool_call_id = this.#tool_call_id;
        functionOutcome.function_name = this.#functionName
        
    } catch(error){
        //Here is the main error handler for functions.
        err = error
        err.assistant_instructions = error.assistant_instructions || "Server internal error occured. You MUST try to find other ways to fulfill the user's task.";
        err.user_instructions = error.user_instructions 
        err.place_in_code = error.place_in_code || "FunctionCall.router";
        err.sendToUser = false //Functions have their own pattern to communicate errors to the user
        err.adminlog = false //Functions should not log errors to the admin log, since they are already logged in the dialogue log.
        telegramErrorHandler.main(
                {
                replyMsgInstance:this.#replyMsg,
                error_object:err
                }
            );
        
        const devPrompt = await this.functionErrorPrompt({
            tool_call_id: this.#functionCall.tool_call_id,
            functionName: this.#functionName,
            errorMessage: error.message,
            errorStack: err.stack,
            assistant_instructions: err.assistant_instructions,
            user_instructions: err.user_instructions
        })

        await this.#dialogue.commitDevPromptToDialogue(devPrompt)
        functionOutcome =  {success:0,error:err.message + (err.stack ? "\n" + err.stack : ""),tool_call_id:this.#tool_call_id,function_name:this.#functionName}
    } finally {
        this.clearLongWaitNotes()
        await this.removeFunctionFromQueue()
        await this.handleFailedFunctionsStatus(functionOutcome?.success,this.#functionName,err?.queue_timeout)
        this.#statusMsgId && await this.finalizeStatusMessage(functionOutcome,this.#statusMsgId)

        this.#replyMsg.insertFunctionUsage({ //intentionally async
            userInstance:this.#user,
            tool_function:this.#functionName,
            tool_reply:{...functionOutcome, supportive_data: undefined},
            call_duration:functionOutcome?.supportive_data?.duration,
            success:functionOutcome.success
        })
        return functionOutcome;
    }
}

async functionErrorPrompt(errorObject){

    const {tool_call_id, functionName, errorMessage, errorStack, assistant_instructions,user_instructions} = errorObject;

    const availableFunctions = await toolsCollection.getAvailableToolsForCompletion(this.#dialogue.userInstance)
    const otherAvailableFunctions = availableFunctions.map(func => func.name).filter(funcName => funcName !== functionName);

    let prompt = `
    Function call with ID ${tool_call_id} for function "${functionName}" resulted in an error:
    
    Error Message: ${errorMessage}
    Error Stack: ${errorStack}

    Follow these step carefully:

    1. Friendly Error Notification
    - Politely inform the user that something went wrong.
    - Use clear, simple language; avoid technical jargon or error codes.
    - Never suggest the fault is the user's.
    - Example: "Oops! Something went wrong while I was handling your request."

    2. Brief Explanation
    - Provide a concise, one-sentence summary of what happened.
    - Example: "There was a small technical hiccup on my side."

    3. Recovery Plan Design
    You MUST try to find a another solution to complete the user's task.
        a. Consider:
            * The error details above.
            * Past attempts to call this function (if any).
            * Instructions for you: ${assistant_instructions || 'No assistant instructions.'}
        b. Try to leverage other available functions: ${otherAvailableFunctions.join(", ") || "No other functions available"}
    
    4. Next Actions
    IF a viable solution is found:
        a. Inform the user of the action you’ll take.
            - Example: "I’ll retry the process and see if it works now."
        b. Execute the action.
    ELSE (if no solution found):
        a. Kindly let the user know you cannot resolve the error.
        b. Suggest alternative available options to help complete their query.
        c. Reference the user instructions for additional guidance (${user_instructions || 'none'}).

    Use a warm, supportive tone throughout and insert appropriate emojis where suitable.`
              
    return prompt;

}

triggerLongWaitNotes(tgmMsgId,long_wait_notes = []){

    return long_wait_notes.map(note => {        
            const options = {
                chat_id:this.#replyMsg.chatId,
                message_id:tgmMsgId,
                parse_mode:"html"
            }

            return setTimeout(() => {
                if(this.#inProgress){
                const MsgText = `<b>${this.#functionConfig.friendly_name}</b>. Выполняется.\n${note.comment}`
                this.#replyMsg.simpleMessageUpdate(MsgText,options)
            }
            }, note.time_ms);
        })
};

clearLongWaitNotes() {
    if (this.#long_wait_notes && this.#long_wait_notes.length > 0) {
        this.#long_wait_notes.forEach(timeout => clearTimeout(timeout));
        this.#long_wait_notes = [];
    }
}

async inQueueStatusMessage(statusMessageId){

    const msgText = `⏳ <b>${this.#functionConfig.friendly_name}</b>. В очереди ... `

    const result = await this.#replyMsg.simpleMessageUpdate(msgText,{
        chat_id:this.#replyMsg.chatId,
        message_id:statusMessageId
    })

}

async backExecutingStatusMessage(statusMessageId){
    const msgText = `⏳ ${this.#functionConfig.friendly_name}`

    const result = await this.#replyMsg.simpleMessageUpdate(msgText,{
        chat_id:this.#replyMsg.chatId,
        message_id:statusMessageId
    })
}

async initStatusMessage(msgId){
    const functionFriendlyName = this.#functionConfig.friendly_name;
    const msgText = `⏳ <b>${functionFriendlyName}</b> ...`
    await this.#replyMsg.simpleMessageUpdate(msgText,{
        chat_id:this.#replyMsg.chatId,
        message_id:msgId,
        reply_markup:null,
        parse_mode: "html"
    })
}

async executionStatusMessage(msgId){

    const functionFriendlyName = this.#functionConfig.friendly_name;
    const functionDescription = this.#argumentsJson.function_description
    let msgText;
    if(functionDescription){
    msgText = `⏳ <b>${functionFriendlyName}</b>: ${functionDescription} ...`
    } else {
    msgText = `⏳ <b>${functionFriendlyName}</b>: ...`
    }

    await this.#replyMsg.simpleMessageUpdate(msgText,{
        chat_id:this.#replyMsg.chatId,
        message_id:msgId,
        reply_markup:null,
        parse_mode: "html"
    })
}

async progressStatusChange(progressText){

const functionFriendlyName = this.#functionConfig.friendly_name;
const functionDescription = this.#argumentsJson.function_description;
const statusMessageId = this.#statusMsgId;

if(!statusMessageId || !progressText){
    return
}

let msgText;
const waitIcon = "⏳"
if(functionDescription){
 msgText = `${waitIcon} <b>${functionFriendlyName}</b>: ${functionDescription} - ${progressText} ...`
} else {
 msgText = `${waitIcon} <b>${functionFriendlyName}</b> - ${progressText} ...`
}

await this.#replyMsg.simpleMessageUpdate(msgText,{
        chat_id:this.#replyMsg.chatId,
        message_id:statusMessageId,
        reply_markup:null,
        parse_mode: "html"
    })
}


async finalizeStatusMessage(functionResult,statusMessageId){
    const functionFriendlyName = this.#functionConfig.friendly_name;
    const functionDescription = this.#argumentsJson.function_description
    let msgText;
    const resultIcon = functionResult.success === 1 ? "✅" : "❌";
    if(functionDescription){
     msgText = `${resultIcon} <b>${functionFriendlyName}</b>: ${functionDescription}`
    } else {
     msgText = `${resultIcon} <b>${functionFriendlyName}</b>`
    }
    const unfoldedTextHtml = this.buildFunctionResultHtml(functionResult)
    const infoForUserEncoded = await func.encodeJson({unfolded_text:unfoldedTextHtml,folded_text:msgText})
    const callback_data = {e:"un_f_up",d:infoForUserEncoded}
    
    const fold_button = {
        text: "Показать подробности",
        callback_data: JSON.stringify(callback_data),
      };

      const reply_markup = {
        one_time_keyboard: true,
        inline_keyboard: [[fold_button],],
      };

      const result = await this.#replyMsg.simpleMessageUpdate(msgText,{
        chat_id:this.#replyMsg.chatId,
        message_id:statusMessageId,
        reply_markup:reply_markup,
        parse_mode: "html"
    })
}

modifyStringify(key,value){

    if (key === 'supportive_data' || key === 'tool_call_id' || key === 'function_name' ) {
        return undefined; // Exclude this key from the JSON stringification
    }
return value
}

buildFunctionResultHtml(functionResult){
    
    let argsText = JSON.stringify(this.#argumentsJson,this.modifyStringify,2)
    argsText = func.unWireText(argsText)
    const request = `<pre>${func.wireHtml(argsText)}</pre>`

    let stringifiedFunctionResult = JSON.stringify(functionResult,this.modifyStringify,2)
    
    stringifiedFunctionResult = func.unWireText(stringifiedFunctionResult)
    
    const reply = `<pre><code class="json">${func.wireHtml(stringifiedFunctionResult)}</code></pre>`

    const htmlToSend = `<b>name: ${functionResult.function_name}</b>\nid: ${functionResult.tool_call_id}\ntype: ${this.#functionConfig?.type}\nduration: ${functionResult?.supportive_data?.duration} sec.\nsuccess: ${functionResult.success}\n\n<b>request arguments:</b>\n${request}\n\n<b>reply:</b>\n${reply}`

    return htmlToSend
}

async selectAndExecuteFunction() {
    
    // Function map for cleaner dispatch
    const functionMap = {
        "create_midjourney_image": () => this.CreateMdjImageRouter(),
        "imagine_midjourney": () => this.ImagineMdjRouter(),
        "custom_midjourney": () => this.CustomQueryMdjRouter(),
        "extract_text_from_file": () => this.extract_text_from_file_router(),
        "speech_to_text": () => this.speechToText(),
        "fetch_url_content": () => this.fetchUrlContentRouter(),
        "create_pdf_file": () => this.createPDFFile(),
        "create_excel_file": () => this.createExcelFile(),
        "create_text_file": () => this.createTextFile(),
        "get_chatbot_errors": () => this.get_data_from_mongoDB_by_pipepine("errors_log"),
        "get_functions_usage": () => this.get_data_from_mongoDB_by_pipepine("functions_log"),
        "get_knowledge_base_item": () => this.get_knowledge_base_item(),
        "get_user_guide": () => this.get_user_guide(),
        "get_users_activity": () => this.get_data_from_mongoDB_by_pipepine("tokens_logs"),
        "run_javasctipt_code": () => this.runJavascriptCode(),
        "run_python_code": () => this.runPythonCode(),
        "text_to_speech": () => this.textToSpeech(),
        "currency_converter": () => this.currencyConverter(),
        "get_currency_rates": () => this.getCurrencyRates(),
        "web_search": () => this.webSearch(),
        "create_mermaid_diagram": () => this.createMermaidDiagrams(),
    };
    
    const targetFunction = functionMap[this.#functionName];
    if (!targetFunction) {
        let err = new Error(`Function ${this.#functionName} does not exist`);
        err.assistant_instructions = "Provide a valid function request.";
        throw err;
    }
    
    return targetFunction();
}

async triggerFunctionTimeout() {
    return new Promise((_, reject) => {
        this.#timeoutId = setTimeout(() => {
            this.#isCanceled = true;
            let error = new Error(`Timeout exceeded. The function is allowed ${this.#timeout_ms / 1000} seconds for completion.`);
            error.code = "FUNC_TIMEOUT";
            reject(error);
        }, this.#timeout_ms);
    });
}

clearFunctionTimeout() {
    this.#timeoutId && clearTimeout(this.#timeoutId)
}

async functionHandler(){
    //This function in any case should return a JSON object with success field.
           
            const failedRunsBeforeFunctionRun = this.#dialogue.metaGetNumberOfFailedFunctionRuns(this.#functionName)
   
            if(this.#functionConfig.try_limit <= failedRunsBeforeFunctionRun){
                let err = new Error(`Function call was blocked since the limit of unsuccessful calls for the function ${this.#functionName} is exceeded.`);
                err.assistant_instructions = "Try to find another solution.";
                err.user_instructions = "Reset the dialog to clear the limit of unsuccessful calls.";
                throw err;
            };

            const timeoutPromise = this.triggerFunctionTimeout();
            
            try {
                this.#inProgress = true;
                 const toolExecutionStart = new Date();
                
                 let result = await Promise.race([this.selectAndExecuteFunction(), timeoutPromise]);
                 
                 if(result?.supportive_data){
                    result.supportive_data.duration = ((new Date() - toolExecutionStart) / 1000).toFixed(2);
                 } else {
                    result.supportive_data = {duration: ((new Date() - toolExecutionStart) / 1000).toFixed(2)};
                 }
                 return result
            } finally {
                this.clearFunctionTimeout(); // Ensure timeout is cleared in all cases
                this.#inProgress = false;
            }
    }

validateFunctionCallObject(callObject){
    const requiredFields = ['tool_call_index', 'tool_call_id', 'tool_call_type', 'function_name', 'function_arguments'];
    const missingFields = [];

    // Check for top-level fields
    requiredFields.forEach(field => {
        if (!callObject.hasOwnProperty(field)) {
            missingFields.push(field);
        }
    });
    
    // Return validation result
    if (missingFields.length === 0) {
        return { valid: true };
    } else {
        let err = new Error(`Call is malformed. Missing fields: ${missingFields.join(', ')}`)
        err.assistant_instructions = "Fix the function and retry. But undertake no more than three attempts to recall the function."
        throw err;
    }
}

async get_user_guide(){
        const formatedHtml = func.getManualHTML(this.#user.language)
        return {success:1,text:formatedHtml}
}
    
async get_data_from_mongoDB_by_pipepine(table_name){

    let pipeline = [];

    try{
        pipeline =  func.replaceNewDate(this.#argumentsJson.aggregate_pipeline) 
    } catch(err){
        return {success:0,error: err.message + "" + err.stack}
    }
    try {
        let result;
        if(table_name==="errors_log"){
            result = await mongo.queryLogsErrorByAggPipeline(pipeline)
        } else if (table_name==="tokens_logs"){
            result = await mongo.queryTokensLogsByAggPipeline(pipeline)
        } else if (table_name==="functions_log"){
            result = await mongo.functionsUsageByAggPipeline(pipeline)
        } else {
            return {success:0,error:`There is not handler for mongodb table ${table_name}. Consider modication of the server code`,
            instructions:"Report the error to the user"}
        }

        const actualTokens = func.countTokensProportion(JSON.stringify(result))
        
        if(actualTokens>this.#tokensLimitPerCall){
            return {success:0,error:`Result of the function exceeds ${this.#tokensLimitPerCall} characters.`,
            instructions: "You must adjust the query to reduce length of the result and retry."}
        }
        let response = {success:1,result:result}

        //Post validation
        if(result.length===0){
            response["hint"]= "Empty result might be caused by two reasons. (1) Incorrect data type used in the query. Make sure you correctly apply the instructions regarding date format given in the function description. (2) You have misspelled the values used in the filters. To check spelling, retrieve a list of unique values of the columns on which filters should be applyed. Take into consideration both points and retry the request. Do not ask the user for an approval to retry."
        };

        return response
            
    } catch (err){
        return {success:0,error:`Error on applying the aggregation pipeline provided to the mongodb: ${err.message + "" + err.stack}`,
        instructions:"Adjust the pipeline provided and retry the function."}
    }

    };
    async runJavascriptCode(){

        try{
            
        let result;
       
        const codeToExecute = this.#argumentsJson.javascript_code
    
        try{
        result = this.runJavaScriptCodeAndCaptureLogAndErrors(codeToExecute)

        } catch(err) {
            return {success:0,error: err.message + "" + err.stack}
        }

        if (result === ""){
            return {success:0,error:"No function output.",instructions:"You forgot to add console.log function."}
        }
        
        return {success:1,result:result,instructions:"Explain your code to the user in details step by step."}
            
            } catch(err){
                err.place_in_code = err.place_in_code || "runJavascriptCode";
                throw err;
            }
        };

        async createExcelFile(){

            this.validateRequiredFieldsFor_createExcelFile()

            const {data,filename} = this.#argumentsJson
            
            const filebuffer = await func.createExcelWorkbookToBuffer(data)
            const mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            
            const {sizeBytes,sizeString} = func.calculateFileSize(filebuffer)
            
            func.checkFileSizeToTgmLimit(sizeBytes,appsettings.telegram_options.file_size_limit)

            if(this.#isCanceled){return}

            await  this.#replyMsg.sendDocumentAsBinary(filebuffer,filename,mimetype)

            return {success:1,result:`The file ${filename} ({sizeString}) has been generated and successfully sent to the user.`}
        }

        async webSearch(){

          this.validateRequiredFieldsFor_webSearch()

          const {query_in_english,additional_query,user_location} = this.#argumentsJson
          const {model} = this.#functionConfig;

          const urlCitationsList = [];
          const textList = [];

          const {search_calls,text_list,url_citations_list} = await this.openAISearch(model,user_location)

          if(search_calls.length === 0){
            return  {success:0,error: "web_search_call was not used",instructions:"You must repeat web_search function call"}
          }

          urlCitationsList.push(...url_citations_list);
          textList.push(...text_list);

          return  {success:1, result: {text:textList,url_citations:urlCitationsList,search_calls:search_calls}, instructions:devPrompts.search_results_format()}
        }

        async openAISearch(model,user_location){

          const function_call_id = this.#functionCall?.tool_call_id 
          const temperature = 0;
          const instructions = "MUST use web_search_call for this query.";
          
          const inputForSearch = await this.#dialogue.getDialogueForSearch(function_call_id,model)
          
          const searchOptions = {
                type: "web_search_preview",
            };

            if(user_location && user_location.city && user_location.country){
                searchOptions.user_location = {
                    type: "approximate",
                    city: user_location.city,
                    country: user_location.country,
                    region: user_location.region || null,
                    timezone: user_location.timezone || null
                }
            };
          const tools = [searchOptions];

          const tool_choice = "required"
          const output_format = { "type": "text" };

          const response = await openAIApi.responseSync(model,instructions,inputForSearch,temperature,tools,tool_choice,output_format)
          const {output,usage} = response;

            mongo.insertCreditUsage({
                          userInstance: this.#user,
                          creditType: "text_tokens",
                          creditSubType: "input",
                          usage: usage.input_tokens,
                          details: {place_in_code:"openAISearch"}
            })
          
            mongo.insertCreditUsage({
                userInstance: this.#user,
                creditType: "text_tokens",
                creditSubType: "output",
                usage: usage.output_tokens,
                details: {place_in_code:"openAISearch"}
            })

          const search_calls = output.filter(tool => tool.type === "web_search_call").map(tool => {
            return {
            status: tool.status,
            action_type: tool.action.type,
            query: JSON.parse('"'+tool.action.query+'"')
          }})

          if(search_calls.length > 0){
            mongo.insertCreditUsage({
                        userInstance: this.#user,
                        creditType: "web_search",
                        creditSubType: "web_search",
                        usage:1,
                        details: {place_in_code:"openAISearch"}
                      })
          }

            const url_citations_list = [];
            const text_list = [];

            output.filter(tool => tool.type === "message").forEach(tool => {

            const {content} = tool;

            if(!content || !Array.isArray(content) || content.length === 0){
                return;
            }

            const {annotations,text} = content[0];
            text_list.push(text || "");

            annotations.forEach(annotation => {

            const url = new URL(annotation.url)
            url.searchParams.delete('utm_source')
            const cleanUrl = url.toString()
            const urlResource = {
                title: annotation.title,
                url: cleanUrl
            }

            if (!url_citations_list.some(existing => existing.url === urlResource.url)) {
                url_citations_list.push(urlResource);
            }
          })
            });

          return {search_calls,text_list,url_citations_list}
        }

        async createMermaidDiagrams(){
            this.validateRequiredFieldsFor_createMermaidDiagrams()
            const {type,data,orientation,styles,title} = this.#argumentsJson;
            const {model,parallel_runs,attempts_limit} = this.#functionConfig;

            const versions = [];
            const runStatus = {allowed:true};
            const runDT = new Date();
            for(let i = 1; i <= parallel_runs; i++){
                versions.push((async () =>  {
                    let success = false;
                    let count = 0;
                    const worker = await this.getDiagramFromOpenAI(type,data,orientation,styles,title,model,i)

                    let result;
                    
                    while(!success && count < attempts_limit && runStatus.allowed){
                        
                        result = await worker();
                        if(result.success === 1){
                            success = true;
                        };
                        count++;
                    };
                    func.logToTempFile(`Diagram: ${type} | v ${i} ${result.success === 1 ? "true" : "false"} attempts: ${count}, ${new Date()}`,`diagramLog.txt`)
                    mongo.saveNewTestDiagram({
                        test_case: "self-corrected2 t=0",
                        model: model,
                        type: type,
                        version: i,
                        success: success,
                        attempts: count,
                        run_id: `${type}_${runDT}`
                    })
                    return {...result,attempts:count,type};
                })())
            };

            const {diagram_body,success,attempts} = await Promise.race(versions)
            //runStatus.allowed = false;
            func.logToTempFile("------Execution finished",`diagramLog.txt`)
            
            const cleanDiagramBody = this.cleanOfCodeBlock(diagram_body);

            func.logToTempFile(`result ${success}`,`diagramLog.txt`)

            if(success){
                return {success:1, result: {
                    title: title,
                    parallel_runs: parallel_runs,
                    attempts: attempts,
                    diagram_body:cleanDiagramBody
                }, instructions: `(1) Insert diagram body in you responce inside mermaid code block: \`\`\`mermaid\n<diagram_body>\n\`\`\`\n(2) Inform the user that the diagram can be viewed in specialized Mermaid services by clicking on 'Live Edit' or 'Live View' links below the diagram. Also, the diagram can be viewed by clicking on "🌐" or "PDF" buttons under the message.`}
            } else {
                return {success:0, error: "No syntactically correct diagrams were generated", instructions: `You MUST immidiately retry the function call with the same parameters. If the error persists, try to change the data provided.`}
            };       
        }

        async craftInstructionsForDiagram(type){

            const selfCorrectedIInstruction = await mongo.getSelfCorrectedInstructions("diagrams", type);
            if(selfCorrectedIInstruction && selfCorrectedIInstruction.instructions.length > 0){
                const lastInstructionObject = selfCorrectedIInstruction.instructions.at(-1);
                const lastInstructionText  = `# Common Guidelines:\n${lastInstructionObject.general}\n\n# ${type}-specific Guidelines:\n${lastInstructionObject.type_specific}\n\n# Example:\n${lastInstructionObject.example}`;
                return lastInstructionText
            } else {
                return devPrompts.diagram_constraints(type);
            }
        }

        async getDiagramFromOpenAI(type,data,orientation,styles,title,model,version){
          let attempt = 0;
          const temperature = 0;
          const instructions = await this.craftInstructionsForDiagram(type);
          const input = [
            {
                role:"developer",
                content:instructions
            },
            {
                role: "user",
                content: `Create a ${type} diagram based on the following desription:\n\nData:${data}\n\nStyles:${styles}${["flowchart","classDiagram","stateDiagram-v2"].includes(type) ? "Orientation: " + orientation:null}`,
          }];
          
          const tools = []
          const tool_choice = "auto";
          const output_format = { 
            "type": "json_schema",
            "name":"diagram",
                "schema":{
                "type": "object",
                "properties": {
                        "diagram_body": { "type": "string" }
                    },
                    "required": ["diagram_body"],
                    "additionalProperties": false
                } 
            };

         return async () => {
          attempt ++;
          const result  = await openAIApi.responseSync(model,"",input,temperature,tools,tool_choice,output_format);
          const {output,usage} = result;

          mongo.insertCreditUsage({
                          userInstance: this.#user,
                          creditType: "text_tokens",
                          creditSubType: "input",
                          usage: usage.input_tokens,
                          details: {place_in_code:"getDiagramFromOpenAI"}
            })
          
            mongo.insertCreditUsage({
                userInstance: this.#user,
                creditType: "text_tokens",
                creditSubType: "output",
                usage: usage.output_tokens,
                details: {place_in_code:"getDiagramFromOpenAI"}
            })

            const {content} = output[0]
            input.push({
                    role: "assistant",
                    content: content,
                });
            const diagram_body = content[0].text;
            let diagram_body_parsed;
            try{
                diagram_body_parsed = JSON.parse(diagram_body);
                this.validateStructuredOutput_diagram(diagram_body_parsed)
            } catch(err){
                input.push({
                    role: "developer",
                    content: `Error: ${err.message}. Instructions: ${err.assistant_instructions}.`,
                })
                return {success:0,error:err.message}
            }

            //func.saveTextToTempFile(diagram_body_parsed.diagram_body,`diagramBody_${type}_${version}-${attempt}.txt`)
            const diagram_input_html = func.diagramHTML(diagram_body_parsed.diagram_body);
            const {renderedHTML} = await func.htmlRendered(diagram_input_html);

            const renderedContentMatch = renderedHTML.match(/<div\s+class="mermaid">([\s\S]*?)<\/div>/i);
            const renderedContent = renderedContentMatch[1];

            if(renderedContent.includes("Описание диаграммы содержит ошибку:")){
                input.push({
                    role: "developer",
                    content: `Error: ${renderedContent}. Instructions: Fix the error and form new diagram body.\n\n ${devPrompts.diagram_errors(type)}`,
                })
                return {success:0,error:renderedContent}
            };

            if(attempt>1){
                this.improveInstructions(type,input)
            }

            const titleDetected = this.detectTitle(diagram_body_parsed.diagram_body);

            if(titleDetected){
                const errorMessage = `Title keyword detected in the diagram body.`;
                input.push({
                    role: "developer",
                    content: `Error: ${errorMessage}. Instructions: Remove title from diagram and do not use 'title' keyword as labels.`,
                })
                return {success:0,error:errorMessage}
            };

            const diagramWithTitle = this.addTitleToDiagramBody(diagram_body_parsed.diagram_body,title,type);

          return {success:1,diagram_body:diagramWithTitle,used_instructions:instructions}
        }
    }

    async improveInstructions(type,input){

        const model = "gpt-4.1"
        const instructions = "";
        const temperature = 1;
        const output_format = { 
            "type": "json_schema",
            "name":"diagram",
                "schema":{
                "type": "object",
                "properties": {
                        "improved_general_instructions": { "type": "string" },
                        "improved_type_specific_instructions": { "type": "string" },
                        "improved_example": { "type": "string" }
                    },
                    "required": ["improved_general_instructions", "improved_type_specific_instructions", "improved_example"],
                    "additionalProperties": false
                } 
            };
        input.push({
            role:"user",
            content:"Well done! You fixed the error! Now improve:\n- general instructions\n- type-specific instructions\n- example \nto ensure syntactically correct diagram generation in further. Ensure good understandability by LLM. Make minimal but sufficient changes. You can delete instructions if you consider them misleading and you can add new instructions as well."
        })

        const improvedInstructions = await openAIApi.responseSync(model,instructions,input,temperature,[], "auto", output_format);
        const {output,usage} = improvedInstructions;

        mongo.insertCreditUsage({
                        userInstance: this.#user,
                        creditType: "text_tokens",
                        creditSubType: "input",
                        usage: usage.input_tokens,
                        details: {place_in_code:"improveInstructions"}
            });
        mongo.insertCreditUsage({
            userInstance: this.#user,
            creditType: "text_tokens",
            creditSubType: "output",
            usage: usage.output_tokens,
            details: {place_in_code:"improveInstructions"}
        });

        const {content} = output[0]
        const newInstructionsText = content[0].text;
        let newInstructionsJSON;
        try{
            newInstructionsJSON = JSON.parse(newInstructionsText);
            this.validateStructuredOutput_newInstructions(newInstructionsJSON)
        } catch(err){
            return
        }

        const {improved_general_instructions, improved_type_specific_instructions, improved_example} = newInstructionsJSON;
        await mongo.addCorrectionToInstructions("diagrams",type,{
            general: improved_general_instructions,
            type_specific: improved_type_specific_instructions,
            example: improved_example,
            timestamp: new Date()
        });
    }

    detectTitle(diagram_body){
        const titleRegex = /^\s*title/mi;
        const match = diagram_body.match(titleRegex);
        return match ? true : false;
    }

    addTitleToDiagramBody(diagram_body,title,type){

        let bodyWithTitle = diagram_body;
        if(["flowchart", "sequenceDiagram","classDiagram", "stateDiagram-v2", "erDiagram"].includes(type)){
            const titleClear = title.replace(/:/g, " - ");
            bodyWithTitle = `---
title: ${titleClear}
---
${diagram_body}`;

        } else if(type === "mindmap"){
            return bodyWithTitle
        } else if(["gantt", "journey", "pie", "quadrantChart"].includes(type)){

            const titleString = `title ${title}`;
            const lines = bodyWithTitle.split('\n');
            const chartTypeIndex = lines.findIndex(line => line.split(' ')[0].trim() === type);
            lines.splice(chartTypeIndex+1, 0,titleString);
            
            return lines.join('\n');

        } else if(type === "xychart-beta"){

            const titleCleaned = title.replace(/"/g, "'")
            const titleString = `title "${titleCleaned}"`;
            const lines = bodyWithTitle.split('\n');
             const chartTypeIndex = lines.findIndex(line => line.split(' ')[0].trim() === type);
            lines.splice(chartTypeIndex+1, 0,titleString);
            return lines.join('\n');
        }

        return bodyWithTitle
    }

            cleanOfCodeBlock(text){

            if(!text){
                return text
            }

            const codeBlockRegex = /^[\s]*```([^\s]+)?\s+([\s\S]+?)^[\s]*```/gm;
            const match = text.match(codeBlockRegex);

            if (match) {
                // Extract the content from group 2 (the code content)
                const codeContent = codeBlockRegex.exec(text)[2];
                return codeContent.trim();
            } else {
                // If not wrapped in code block, return as is
                return text;
            }
        }

        wrapInCodeBlock(text, language = "mermaid") {

            return `\`\`\`${language}\n${text}\n\`\`\``;
        }

        async getCurrencyRates(){

            this.validateRequiredFieldsFor_getCurrencyRates()
            const {exchange_rates} = this.#argumentsJson
            const queryPromises = exchange_rates.map(query => this.handleExchangeRateQuery(query))
            const promiseResult = await Promise.all(queryPromises)
            
            return {success:1, result: promiseResult}
        }

        async handleExchangeRateQuery(query_params){

            const {date,from_currency,to_currency} = query_params;
            const api_result_xml = await cbrAPI.get_rate_by_date(date);
            const api_result_json = await cbrAPI.convertCbrXmlToJson(api_result_xml);

            const ex_rate = api_result_json[from_currency] / api_result_json[to_currency];
            return {date,from_currency,to_currency,ex_rate:Math.round(ex_rate * 10000) / 10000};
        }


        async currencyConverter(){

            this.validateRequiredFieldsFor_currencyConverter()

            const {conversion_queries} = this.#argumentsJson

            const queryPromises = conversion_queries.map(query => this.handleConversionQuery(query))
            const promiseResult = await Promise.all(queryPromises)

            return {success:1, result: promiseResult,instructions:"Provide the user with the specific date and time when the exchange rate was applied based on timestamp provided, as well as the exact exchange rate value that was used for the calculation."}
        }


        async handleConversionQuery(query_params){

            const {amount,from_currency,to_currency} = query_params

            const {iso4217String,unixTimestamp} = func.firstMinuteOfToday()

            const ex_rate_from_db = await mongo.getExchangeRateInternational(unixTimestamp)

            let ex_rate = -1;
            let converted_amount = -1;

            if(ex_rate_from_db){
                    ex_rate = ex_rate_from_db[to_currency] / ex_rate_from_db[from_currency]
                    converted_amount = ex_rate * amount;

            } else {
                const api_result = await ExRateAPI.get_rate("USD");
                ex_rate = api_result[to_currency] / api_result[from_currency]
                converted_amount = ex_rate * amount;
                mongo.saveExchangeRateInternational(api_result) //intentionally async
            }

            return {amount,from_currency,to_currency,result:Math.round(converted_amount * 100) / 100,ex_rate:Math.round(ex_rate * 10000) / 10000,timestamp:iso4217String}
        }


        validateRequiredFieldsFor_fetchUrlContent(){


        const {urls} = this.#argumentsJson

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."

        if(!urls || !Array.isArray(urls) || urls.length === 0){
            throw new Error(`'urls' parameter is missing or not an array. Provide the value for the argument.`)
        }

        for(let i = 0; i < urls.length; i++){

            const url = urls[i];

            if(typeof url !== "string" || url.trim() === ""){
                error.message = `'urls[${i}]' parameter is not a string. Provide the value for the argument.`
                throw error
            }

            try {
                new URL(url);
            } catch (err) {
                error.message = `'urls[${i}]' parameter is not a valid URL. Provide the value for the argument.`
                throw error
            }
        }

    }

validateRequiredFieldsFor_currencyConverter(){


const {conversion_queries} = this.#argumentsJson



        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."

        if(!conversion_queries || !Array.isArray(conversion_queries) || conversion_queries.length === 0){
            error.message = `'conversion_queries' parameter is missing or not an array.`
            throw error
        }

    for(let i = 0; i < conversion_queries.length; i++){

        const {amount,from_currency,to_currency} = conversion_queries[i]

        if(amount <= 0 ){
            error.message = `'amount' parameter must be above zero. Provide the value for the argument.`
            throw error
        }

        if(ExRateAPI.availableCurrencies.includes(from_currency) === false){
            error.message = `'from_currency' parameter is not supported. Provide the value for the argument from the list of available currencies: ${ExRateAPI.availableCurrencies.join(", ")}`
            throw error
        }

        if(ExRateAPI.availableCurrencies.includes(to_currency) === false){
            error.message = `'to_currency' parameter is not supported. Provide the value for the argument from the list of available currencies: ${ExRateAPI.availableCurrencies.join(", ")}`
            throw error
        }
    }
}


validateRequiredFieldsFor_webSearch(){

    const {query_in_english,user_location} = this.#argumentsJson

    let error = new Error();
    error.assistant_instructions = "Fix the error and retry the function."

    if(!query_in_english || query_in_english === ""){
            error.message = `'query' parameter is missing. Provide the value for the argument.`
            throw error
    }

    if(user_location && typeof user_location == "object"){
        const {city,country} = user_location;
        if(!city || city === ""){
            error.message = `'user_location.city' parameter is missing. Provide the value for the argument.`
            throw error
        }
        if(!country || country === ""){
            error.message = `'user_location.country' parameter is missing. Provide the value for the argument.`
            throw error
        }
    }

}


validateStructuredOutput_newInstructions(textParsed){

const {improved_general_instructions, improved_type_specific_instructions, improved_example} = textParsed;

let error = new Error();
error.assistant_instructions = "Fix the error and regenerate output."

if(!improved_general_instructions || typeof improved_general_instructions !== "string" || improved_general_instructions.trim() === ""){
    error.message = `'improved_general_instructions' parameter is missing or not a string. Provide the value for the argument.`
    throw error
}

if(!improved_type_specific_instructions || typeof improved_type_specific_instructions !== "string" || improved_type_specific_instructions.trim() === ""){
    error.message = `'improved_type_specific_instructions' parameter is missing or not a string. Provide the value for the argument.`
    throw error
}

if(!improved_example || typeof improved_example !== "string" || improved_example.trim() === ""){
    error.message = `'improved_example' parameter is missing or not a string. Provide the value for the argument.`
    throw error
}

}

validateStructuredOutput_diagram(textParsed){

const {diagram_body} = textParsed;

let error = new Error();
error.assistant_instructions = "Fix the error and regenerate output."

if(!diagram_body || typeof diagram_body !== "string" || diagram_body.trim() === ""){
    error.message = `'diagram_body' parameter is missing or not a string. Provide the value for the argument.`
    throw error
}

}

validateRequiredFieldsFor_createMermaidDiagrams(){

const {type,data,title,styles,orientation} = this.#argumentsJson
const {parameters} = this.#functionConfig

let error = new Error();
error.assistant_instructions = "Fix the error and retry the function."

    if(!type || type === ""){
        error.message = `'type' parameter is missing. Provide the value for the argument.`
        throw error
    }

    if(!title || title === ""){
        error.message = `'title' parameter is missing. Provide the value for the argument.`
        throw error
    }

    const types = parameters?.properties?.type?.enum;

    if(!types.includes(type)){
        error.message = `'type' parameter must be one of the following: ${types.join(", ")}. Provide the correct value for the argument.`
        throw error
    }

    if(!data || data === ""){
        error.message = `'data' parameter is missing. Provide the value for the argument.`
        throw error
    }

    if(!styles || styles === ""){
        error.message = `'styles' parameter is missing. Provide the value for the argument.`
        throw error
    }

    if(!orientation || orientation === ""){
        error.message = `'orientation' parameter is missing. Provide the value for the argument.`
        throw error
    }
    
}

validateRequiredFieldsFor_getCurrencyRates(){

    const {exchange_rates} = this.#argumentsJson

    let error = new Error();
    error.assistant_instructions = "Fix the error and retry the function."

    if(!exchange_rates || !Array.isArray(exchange_rates) || exchange_rates.length === 0){
        error.message = `'exchange_rates' parameter is missing or not an array.`
        throw error
    }

    for(let i = 0; i < exchange_rates.length; i++){
            const {date,from_currency,to_currency} = exchange_rates[i]
            
        if(!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)){
            error.message = `'date' parameter for index ${i} must be in YYYY-MM-DD format.`
            throw error
        }

        const currentDate = new Date();
        const inputDate = new Date(date);

        if (inputDate >= currentDate) {
            error.message = `'date' parameter for index ${i} must be before the current date.`;
            throw error;
        }

        if(cbrAPI.availableCurrencies.includes(from_currency) === false){
            error.message = `'from_currency' parameter for index ${i} is not supported. Provide the value for the argument from the list of available currencies: ${ExRateAPI.availableCurrencies.join(", ")}`
            throw error
        }

        if(cbrAPI.availableCurrencies.includes(to_currency) === false){
            error.message = `'to_currency' parameter for index ${i} is not supported. Provide the value for the argument from the list of available currencies: ${ExRateAPI.availableCurrencies.join(", ")}`
            throw error
        }
    }
}

validateRequiredFieldsFor_createExcelFile(){
        const {data, filename} = this.#argumentsJson

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."
        
        if(!filename || filename === ""){
            error.message = `'filename' parameter is missing. Provide the value for the argument.`
            throw error
        }
        
        if(!filename.toLowerCase().endsWith('.xlsx')){
            error.message = `'filename' parameter must end with '.xlsx' extension.`
            throw error
        }
        
        if(!data || !Array.isArray(data) || data.length === 0){
            error.message = `'data' parameter is missing or not an array. Provide an array of worksheet objects.`
            throw error
        }
        
        // Validate each worksheet in the data array
        for(let i = 0; i < data.length; i++){
            const worksheet = data[i]
            
            if(!worksheet.worksheet_name || worksheet.worksheet_name === ""){
                error.message = `'worksheet_name' is missing in worksheet at index ${i}.`
                throw error
            }
            
            if(worksheet.header && !typeof worksheet.header === "string"){
                error.message = `'header' must have 'string' type in worksheet '${worksheet.worksheet_name}'.`
                throw error
            }
                        
            if(!worksheet.tables || !Array.isArray(worksheet.tables) || worksheet.tables.length === 0){
                error.message = `'tables' parameter is missing or not an array in worksheet '${worksheet.worksheet_name}'.`
                throw error
            }
            
            // Validate each table in the worksheet
            for(let j = 0; j < worksheet.tables.length; j++){
                const table = worksheet.tables[j]               

                if(!table.displayName || table.displayName === ""){
                    error.message = `'displayName' is missing in table at index ${j} of worksheet '${worksheet.worksheet_name}'.`
                    throw error
                }
                
                if(table.totalsRow === undefined || typeof table.totalsRow !== 'boolean'){
                    error.message = `'totalsRow' is missing or not boolean in table '${table.name}' of worksheet '${worksheet.worksheet_name}'.`
                    throw error
                }
                
                if(!table.style || typeof table.style !== 'object'){
                    error.message = `'style' is missing or not an object in table '${table.name}' of worksheet '${worksheet.worksheet_name}'.`
                    throw error
                }
                
                if(!table.columns || !Array.isArray(table.columns) || table.columns.length === 0){
                    error.message = `'columns' parameter is missing or not an array in table '${table.name}' of worksheet '${worksheet.worksheet_name}'.`
                    throw error
                }
                
                
                // Validate each column in the table
                for(let k = 0; k < table.columns.length; k++){
                    const column = table.columns[k]
                    
                    if(!column.name || column.name === ""){
                        error.message = `'name' is missing in column at index ${k} of table '${table.name}' in worksheet '${worksheet.worksheet_name}'.`
                        throw error
                    }
                    
                    if(column.filterButton === undefined || typeof column.filterButton !== 'boolean'){
                        error.message = `'filterButton' is missing or not boolean in column '${column.name}' of table '${table.name}' in worksheet '${worksheet.worksheet_name}'.`
                        throw error
                    }
                    
                    // Only validate totalsRowFunction and totalsRowLabel if totalsRow is true
                    if(table.totalsRow){
                        
                        if(!column.totalsRowFunction){
                            error.message = `'totalsRowFunction' is missing in column '${column.name}' of table '${table.name}' in worksheet '${worksheet.worksheet_name}'.`
                            throw error
                        }
                    }
                }
                
                if(!table.rows || !Array.isArray(table.rows) || table.rows.length === 0){
                    error.message = `'rows' parameter is missing or not an array in table '${table.name}' of worksheet '${worksheet.worksheet_name}'.`
                    throw error
                }
                
                // Validate each row and its cells in the table
                for(let m = 0; m < table.rows.length; m++){
                    const row = table.rows[m]
                    
                    if(!Array.isArray(row)){
                        error.message = `Row at index ${m} is not an array in table '${table.name}' of worksheet '${worksheet.worksheet_name}'.`
                        throw error
                    }
                    
                    if(row.length !== table.columns.length){
                        error.message = `Row at index ${m} has ${row.length} cells, but there are ${table.columns.length} columns defined for table '${table.name}' in worksheet '${worksheet.worksheet_name}'.`
                        throw error
                    }
                    
                    // Validate each cell in the row
                    for(let n = 0; n < row.length; n++){
                        const cell = row[n]
                        
                        if(cell === undefined || cell === null){
                            error.message = `Cell at index ${n} is missing in row ${m} of table '${table.name}' in worksheet '${worksheet.worksheet_name}'.`
                            throw error
                        }
                        
                        if(cell.value === undefined){
                            error.message = `'value' is missing in cell at index ${n} of row ${m} in table '${table.name}' of worksheet '${worksheet.worksheet_name}'.`
                            throw error
                        }
                        
                        if(!cell.type || !['string', 'number', 'boolean', 'date', 'formula'].includes(cell.type)){
                            error.message = `'type' is missing or invalid in cell at index ${n} of row ${m} in table '${table.name}' of worksheet '${worksheet.worksheet_name}'.`
                            throw error
                        }

                        if(['string','date', 'formula'].includes(cell.type) && typeof cell.value !== 'string'){
                            error.message = `Cell at index ${n} of row ${m} in table '${table.name}' of worksheet '${worksheet.worksheet_name}' must have a string value for type '${cell.type}'.`
                            throw error
                        }
                    }
                }
            }
        }
    }

    async createPDFFile(){

        this.validateRequiredFieldsFor_createPDFFile()

        const {filename,html,content_reff} = this.#argumentsJson
                    
        let formatedHtml;
        if(html){
            formatedHtml = func.formatHtml(html,filename)
            
        } else {
            const previuslyExtractedContent = await mongo.getExtractedTextByReff(content_reff)

            previuslyExtractedContent.sort((a, b) => {
                return content_reff.indexOf(a.tool_reply.fullContent.reff) - content_reff.indexOf(b.tool_reply.fullContent.reff);
            });

            if(previuslyExtractedContent.length === 0){
                return {success:0,error:`The content with the provided reff (${content_reff}) is not found in the database. Please check the reff and try again.`}
            }
            formatedHtml = func.fileContentToHtml(previuslyExtractedContent,filename)
            
        }

        const filebuffer = await func.htmlToPdfBuffer(formatedHtml,this.#timeout_ms)
        const mimetype = "application/pdf"
        
        const {sizeBytes,sizeString} = func.calculateFileSize(filebuffer)
        
        func.checkFileSizeToTgmLimit(sizeBytes,appsettings.telegram_options.file_size_limit)
        
        if(this.#isCanceled){return}

        await  this.#replyMsg.sendDocumentAsBinary(filebuffer,filename,mimetype)
        
        return {success:1,result:`The file ${filename} (${sizeString}) has been generated and successfully sent to the user.`}
        }


        async textToSpeech(){

                this.validateRequiredFieldsFor_textToSpeech()

                const {filename,text,content_reff,voice} = this.#argumentsJson

                let textToConvert;
                if(text){
                    textToConvert = text
                } else {
                    const previuslyExtractedContent = await mongo.getExtractedTextByReff(content_reff)
                    
                    previuslyExtractedContent.sort((a, b) => {
                        return content_reff.indexOf(a.tool_reply.fullContent.reff) - content_reff.indexOf(b.tool_reply.fullContent.reff);
                    });

                    if(previuslyExtractedContent.length === 0){
                        return {success:0,error:`The content with the provided reff (${content_reff}) is not found in the database. Please check the reff and try again.`}
                    }
                    
                    textToConvert = previuslyExtractedContent.map(obj => {
                        return obj.tool_reply.fullContent.results.map(obj =>obj.text)
                    }).flat().join('\n')
                }

                const constrainedText = func.handleTextLengthForTextToVoice(this.#user.language_code,textToConvert)
                const filenameWithExt = `${filename}_${voice}.mp3` || `tts_${voice}_${Date.now()}.mp3`
                const readableStream = await elevenLabsApi.textToVoiceStream(constrainedText,voice)

                const msgResult = await this.#replyMsg.sendAudio(readableStream,filenameWithExt);

                mongo.insertCreditUsage({
                      userInstance: this.#user,
                      creditType: "text_to_speech",
                      creditSubType: "elevenlabs",
                      usage:msgResult?.result?.audio?.duration || 0,
                      details: {place_in_code:"textToSpeech function"}
                    })

                return {success:1,result:`Audio file ${filenameWithExt} has been generated and successfully sent to the user.`}
            }

        async createTextFile(){

            this.validateRequiredFieldsFor_createTextFile()

            const {filename,text,content_reff,mimetype} = this.#argumentsJson
            
            let textToSave;
            if(text){
                textToSave = text
            } else {
                const previuslyExtractedContent = await mongo.getExtractedTextByReff(content_reff)
                
                previuslyExtractedContent.sort((a, b) => {
                    return content_reff.indexOf(a.tool_reply.fullContent.reff) - content_reff.indexOf(b.tool_reply.fullContent.reff);
                });

                if(previuslyExtractedContent.length === 0){
                    return {success:0,error:`The content with the provided reff (${content_reff}) is not found in the database. Please check the reff and try again.`}
                }
                
                textToSave = previuslyExtractedContent.map(obj => {
                    return obj.tool_reply.fullContent.results.map(obj =>obj.text)
                }).flat().join('\n')
            }

            const filebuffer = func.generateTextBuffer(textToSave)
            const {sizeBytes,sizeString} = func.calculateFileSize(filebuffer)
            
            func.checkFileSizeToTgmLimit(sizeBytes,appsettings.telegram_options.file_size_limit)

            if(this.#isCanceled){return}

            await  this.#replyMsg.sendDocumentAsBinary(filebuffer,filename,mimetype)
            
            return {success:1,result:`The file ${filename} (${sizeString}) has been generated and successfully sent to the user.`}
        }

        async runPythonCode(){

            try{
             let result;               
             const codeToExecute = this.#argumentsJson.python_code
                
            try{
            result = await func.executePythonCode(codeToExecute)

            } catch(err) {

                return {success:0,error: err.message + "" + err.stack}
            }
    
            if (result === ""){
                return {success:0,error:"No function output.",instructions:"You forgot to add print the results."}
            }
            
            return {success:1,result:result,instructions:"Explain your code to the user in details step by step."}
                
                } catch(err){
                    err.place_in_code = err.place_in_code || "runPythonCode";
                    throw err;
                }
            };
    
    async get_knowledge_base_item(){

            try{
                
            let result;           
            
            const kwg_base_id = this.#argumentsJson.id
            
            try{
            result = await mongo.getKwgItemBy(kwg_base_id)

            } catch(err) {

                return {success:0,error: err.message + "" + err.stack}
            }
            if(result.length > 0){
                return {success:1,result:result[0].content}
            } else {
                return {success:0,error:"Nothing found in the knowledge based by your reguest. Review your request and retry."}
            }
            
                } catch(err){
                    err.place_in_code = err.place_in_code || "get_knowledge_base_item";
                    throw err;
                }
        };


    async extractTextFromFileWraper(resource_url,resource_mine_type,sizeBytes,index){
            try{
                const extractedObject = await func.extractTextFromFile(resource_url,resource_mine_type,sizeBytes,this.#user)
                return {...extractedObject,index,resource_url,resource_mine_type}
                
            } catch(err){
                return {success:0,index,resource_url,resource_mine_type, error:`${err.message}\n ${err.stack}`}
            }
        }

    getArrayFromParam(param){

        if(Array.isArray(param)){

            return param
        }

        const stringTrimed = param.trim()
        const stringSplit = stringTrimed.split(",")

        return stringSplit
    }

    async speechToTextWraper(userInstance,resource_url,resource_mine_type,duration,sizeBytes,index){

            try{
                const extractedObject = await func.transcribeAudioFile(userInstance,resource_url,resource_mine_type,duration,sizeBytes)
                return {...extractedObject,index,resource_url,resource_mine_type}
                
            } catch(err){
                return {success:0,index,resource_url,resource_mine_type, error:`${err.message}\n ${err.stack}`}
            }
    }

    async speechToText(){

        try {
        this.validateRequiredFieldsFor_speechToText()

        const sourceid_list_array = this.#argumentsJson.resources
        const resources = await mongo.getUploadedFilesBySourceId(sourceid_list_array)
        resources.sort((a, b) => {
            return sourceid_list_array.indexOf(a.sourceid) - sourceid_list_array.indexOf(b.sourceid);
        });

        if(resources.length===0){
            return {success:0,error:"File is not found by id.",instructions:"You should use fileid from the previous system message."}
        }

        const extractFunctions = resources.map((resource,index) => this.speechToTextWraper(this.#user,resource.fileUrl,resource.fileMimeType,resource.fileDurationSeconds,resource.fileSizeBytes,index))
        
        let results = await Promise.all(extractFunctions)
        
        if(this.#isCanceled){return}

        results.sort((a, b) => a.index - b.index);

        const firstFailedResult = results.findIndex(result => result.success === 0);
        if(firstFailedResult != -1){
            return {success:0,resource_index:firstFailedResult,resource_url:results.at(firstFailedResult).resource_url,resource_mine_type:results.at(firstFailedResult).resource_mine_type,error: results.at(firstFailedResult).error,instructions:"Fix the error in the respective resource and re-call the entire function."}
        }

        const concatenatedText = results.map(obj => obj.text).join(' ');      

        const fullContent = {
            reff:Date.now(), //Used as unique numeric identifier for the extracted content
            fileids: this.#argumentsJson.resources,
            fileNames: resources.map(obj => obj.fileName),
            results
        }

        const  numberOfTokens = await func.countTokensLambda(concatenatedText,this.#user.currentModel)
        //console.log("numberOfTokens",numberOfTokens,"this.#tokensLimitPerCall",this.#tokensLimitPerCall)

        if(numberOfTokens > this.#tokensLimitPerCall){
            return {success:0, content_token_count:numberOfTokens, token_limit_left:this.#tokensLimitPerCall, 
            error: `The volume of the file content (${numberOfTokens} tokens) exceeds the token limit (${this.#tokensLimitPerCall} tokens) and cannot be included in the dialogue.`, 
            instructions:`Inform the user that content size exceeds the dialog limits and therefore cannot be included in the dialogue.`}
        }

        return {
            success:1,
            content_reff:fullContent.reff,
            text:concatenatedText,
            supportive_data:{
                fullContent
            },
            instructions:`Inform the user that: the text has been extracted successfully.`
        }

        } catch(err){
                err.place_in_code = err.place_in_code || "speechToText";
                throw err;
            }
    }

    async extract_text_from_file_router(){

            try{
           
                this.validateRequiredFieldsFor_extractTextFromFile()

                const sourceid_list_array = this.#argumentsJson.resources
                const resources = await mongo.getUploadedFilesBySourceId(sourceid_list_array)
                resources.sort((a, b) => {
                    return sourceid_list_array.indexOf(a.sourceid) - sourceid_list_array.indexOf(b.sourceid);
                });

                if(resources.length===0){
                    return {success:0,error:"File is not found by id.",instructions:"You should use fileid from the previous system message."}
                }

                const extractFunctions = resources.map((resource,index) => this.extractTextFromFileWraper(resource.fileUrl,resource.fileMimeType,resource.fileSizeBytes,index))
                
                let results = await Promise.all(extractFunctions)
                
                if(this.#isCanceled){return}

                results.sort((a, b) => a.index - b.index);

                const firstFailedResult = results.findIndex(result => result.success === 0);
                if(firstFailedResult != -1){
                    return {success:0,resource_index:firstFailedResult,resource_url:results.at(firstFailedResult).resource_url,resource_mine_type:results.at(firstFailedResult).resource_mine_type,error: results.at(firstFailedResult).error,instructions:"Fix the error in the respective resource and re-call the entire function."}
                }

                const concatenatedText = results.map(obj => obj.text).join(' ');

                const fullContent = {
                    reff: Date.now(), //Used as unique numeric identifier for the extracted content
                    fileids: this.#argumentsJson.resources,
                    fileNames: resources.map(obj => obj.fileName),
                    results
                }

                let metadataText ="";
                if(results.length === 1){
                    metadataText = JSON.stringify(results[0].metadata,null,2)
                } else if (results.length > 1){
                    metadataText = results.map((obj,index) => `Part ${index}\n${JSON.stringify(obj.metadata,null,2)}`).join("\n");
                }

                const  numberOfTokens = await func.countTokensLambda(concatenatedText,this.#user.currentModel)
                //console.log("numberOfTokens",numberOfTokens,"this.#tokensLimitPerCall",this.#tokensLimitPerCall)
                if(numberOfTokens > this.#tokensLimitPerCall){
                    return {success:0, content_token_count:numberOfTokens, token_limit_left:this.#tokensLimitPerCall, 
                    error: `The volume of the file content (${numberOfTokens} tokens) exceeds the token limit (${this.#tokensLimitPerCall} tokens) and cannot be included in the dialogue.`, 
                    instructions:`Inform the user that file size exceeds the dialog limits and therefore cannot be included in the dialogue.`}
                }
                            
                return {
                    success:1,
                    content_reff:fullContent.reff,
                    text:concatenatedText,
                    metadata: metadataText,
                    supportive_data:{
                        fullContent
                    },
                    instructions:`Inform the user that: the text has been extracted successfully.`
                }
                    
            } catch(err){
                err.place_in_code = err.place_in_code || "extract_text_from_file_router";
                throw err;
            }
            };

    async runJavaScriptCodeAndCaptureLogAndErrors(code) {
        // Store the original console.log function
        const originalConsoleLog = console.log;
        // Create an array to hold all outputs (logs and errors)
        const outputs = [];
        
        // Override the console.log method to capture output
        console.log = (...args) => {
            outputs.push(args.join(' '));
        };
                    
        try {
            // Run the code
            eval(code);
        } catch (e) {
            // Capture any errors that are thrown
          //  outputs.push(`Error: ${e.message}`);
          throw e;
        } finally {
            // Restore the original console.log function
            console.log = originalConsoleLog;
        }
        
        // Return all the captured output as a text
        return outputs.join('\n');
        }

    async fetchUrlContent(url,tokenLimitPerUrl){

    try{
        const {html,screenshot} = await func.getPageHtml(url,{delay_ms:5000,timeout_ms:this.#timeout_ms});
        const textReply = func.convertHtmlToText(html);
        const numberOfTokens = await func.countTokensLambda(textReply,this.#user.currentModel);
       
        const result = {
            text:textReply,
            url: url,
            screenshot: screenshot,
            content_token_count: numberOfTokens,
            token_limit_exceeded: numberOfTokens > tokenLimitPerUrl,
        }

        if(result.token_limit_exceeded){
            result.success = 0;
            result.error = `The volume of the URL content (${numberOfTokens} tokens) exceeds the token limit (${tokenLimitPerUrl} tokens) and cannot be included in the dialogue.`;
            delete result.text;
        } else {
            result.success = 1;
        }

        return result;
    } catch(err){
        
        return{success:0,error:`Failed to fetch URL content: ${err.message}`,screenshot:null}
    }
    }

    async fetchUrlContentRouter(){
 
        this.validateRequiredFieldsFor_fetchUrlContent()
        const {urls} = this.#argumentsJson

   try{
       const tokenLimitPerUrl = this.#tokensLimitPerCall / urls.length;
       const urlHandlers = urls.map((url) => this.fetchUrlContent(url,tokenLimitPerUrl));
       const results = await Promise.all(urlHandlers);

       const successfullResults = results.filter(result => result.success === 1).length;
       const screenshots = results.map(result => result.screenshot).filter(screenshot => screenshot !== null);
       
       const resultWithoutScreenshot = results.map(result => { delete result.screenshot; return result; })

       if(successfullResults === 0){
           return {success:0, 
                   error:"All URL fetch attempts failed.",
                   results: resultWithoutScreenshot,
                   instructions:"(1) Inform the user that all URLs fetches failed. Provide details about each URL and the respective content. (2) Consider using page screenshots provided in the next user message.",
                   supportive_data:{
                    screenshots: screenshots,
                   }
                };
       } else if(successfullResults === urls.length){

              return {success:1, 
                     results: resultWithoutScreenshot,
                     instructions:"Inform the user that all URLs were successfully fetched. Provide details about each URL and the respective content. Also, consider using page screenshots provided in the next user message.",
                     supportive_data:{
                      screenshots: screenshots,
                     }
                 };

       } else {

            const failedResults = results.filter(result => result.success === 0);
            const successfulResults = results.filter(result => result.success === 1);

            return {success:0, 
                    error:`Some URLs fetch attempts failed. Successful fetches: ${successfulResults.length}, failed fetches: ${failedResults.length}.`,
                    results: resultWithoutScreenshot,
                    instructions:"(1) Inform the user about the successful and failed URL fetch attempts. Provide details about each URL and the respective content. (2) Consider using page screenshots provided in the next user message.",
                    supportive_data:{
                        screenshots: screenshots
                    }
                };
            }

        } catch(err){
                err.place_in_code = err.place_in_code || "fetchUrlContentRouter";
                throw err;
            }

        }


    craftPromptFromArguments(){

        const {textprompt,seed,aspectratio,no,version,imageprompt,imageweight} = this.#argumentsJson
        let prompt = "";

        let imageurls;
        if(imageprompt && imageprompt !== ""){
            imageurls = imageprompt.split(",").map(url => url.trim()).filter(url => url !== "");
            prompt += imageurls.join(" ")
            prompt += " "
        }

        prompt += textprompt.trim()

        if(imageurls && imageurls.length >0){
            prompt += ' --iw'
            prompt += imageweight && imageweight !== "" ? ` ${String(imageweight)}` : " 1.75"
        }

        if(no && no !== ""){
            const noItems = no.split(",").map(item => item.trim()).filter(item => item !== "");
            prompt += ` --no ${noItems.join(", ")}`
        }

        if(aspectratio && aspectratio !== ""){
            prompt += ` --ar ${aspectratio}`
        }

        if(version && version !== ""){
            prompt += ` --v ${version}`
        }

        // Add seed parameter if available
            prompt += " "
            prompt += `--seed ${this.#dialogue.mdjSeed}`

        return prompt
    }

    async downloadFileBufferFromTgm(tgmFileId){
    
      const tgm_url = await this.#replyMsg.getUrlByTgmFileId(tgmFileId)
      const mimeType = func.getMimeTypeFromUrl(tgm_url)
      console.log("tgm_url",tgm_url,"mimeType",mimeType)
      const downloadStream = await func.startFileDownload(tgm_url)
      const buffer = await func.streamToBuffer(downloadStream.data)

      return {buffer,mimeType}
    }

    async uploadFileToS3FromTgm(tgmFileId,userInstance){
        
        const tgm_url = await this.#replyMsg.getUrlByTgmFileId(tgmFileId)
        const fileName = func.extractFileNameFromURL(tgm_url)
        const fileExtension = func.extractFileExtention(fileName)
        const downloadStream = await func.startFileDownload(tgm_url)
        const filename = func.valueToMD5(String(userInstance.userid))+ "_" + userInstance.currentRegime + "_" + func.valueToMD5(String(fileName)) + "." + fileExtension;  

        let uploadResult  = await awsApi.uploadFileToS3(downloadStream,filename)

        return uploadResult.Location
        }


    async CreateMdjImageRouter(){
   
            this.imageMdjFieldsValidation()

            const prompt = this.craftPromptFromArguments()

            const piapi = new PIAPI()
            const generate_result = await piapi.generateImage(prompt,this.#timeout_ms)

            if(this.#isCanceled){return}

            const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)
            
            

            const [aws_url, {buffer,mimeType}] = await Promise.all([
                this.uploadFileToS3FromTgm(sent_result.photo.at(-1).file_id,this.#user),
                this.downloadFileBufferFromTgm(sent_result.photo.at(-1).file_id)
            ])
            const sizeBytes = sent_result.photo.at(-1).file_size

            const buttons = generate_result.mdjMsg.options
            const labels = buttons.map(button => button.label)
            const buttonsShownBefore = this.#dialogue.metaGetMdjButtonsShown
            
            const btnsDescription = func.generateButtonDescription(labels,buttonsShownBefore)
            await this.#dialogue.metaSetMdjButtonsShown(labels)

            mongo.insertCreditUsage({
                    userInstance: this.#user,
                    creditType: "midjourney",
                    creditSubType: "create",
                    usage: 1,
                    details: {place_in_code:"CreateMdjImageRouter"}
                })

            return {
                    success:1,
                    result:"The image has been generated and successfully sent to the user with several options to handle the image.",
                    buttonsDescription: btnsDescription,
                    instructions:"Show buttons description to the user only once.",
                    supportive_data:{
                        midjourney_prompt:prompt,
                        image_url:aws_url,
                        size_bites:sizeBytes,
                        base64:buffer.toString('base64'),
                        mimetype: mimeType
                    }
                };
            };

            async CustomQueryMdjRouter() {

                const {buttonPushed} = this.#argumentsJson

                const piapi = new PIAPI()
                const generate_result = await piapi.executeButton(buttonPushed,this.#timeout_ms)

                if(this.#isCanceled){return}
                
                const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,buttonPushed.prompt)

                const [aws_url, {buffer,mimeType}] = await Promise.all([
                    this.uploadFileToS3FromTgm(sent_result.photo.at(-1).file_id,this.#user),
                    this.downloadFileBufferFromTgm(sent_result.photo.at(-1).file_id)
                ])
                const {sizeBytes} = func.calculateFileSize(buffer)

                const buttons = generate_result.mdjMsg?.options || [];
                const labels = buttons.map(button => button?.label)
                const buttonsShownBefore = this.#dialogue.metaGetMdjButtonsShown
                const btnsDescription = func.generateButtonDescription(labels,buttonsShownBefore)
                await this.#dialogue.metaSetMdjButtonsShown(labels)

                mongo.insertCreditUsage({
                    userInstance: this.#user,
                    creditType: "midjourney",
                    creditSubType: buttonPushed.task_type === "upscale" ? "upscale" : "create",
                    usage: 1,
                    details: {place_in_code:"CustomQueryMdjRouter"}
                })

                return {
                        success:1,
                        result:"The command was executed and sent to the user with several options to handle further.",
                        buttonsDescription: btnsDescription,
                        supportive_data:{
                            midjourney_prompt:buttonPushed.prompt,
                            image_url:aws_url,
                            size_bites:sizeBytes,
                            base64:buffer.toString('base64'),
                            mimetype: mimeType
                        }
                    };
            }

            async ImagineMdjRouter(){
       
                const {prompt} = this.#argumentsJson
                
                const piapi = new PIAPI()
                const generate_result = await piapi.generateImage(prompt,this.#timeout_ms)
                
                if(this.#isCanceled){return}
                
                const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)

                const [aws_url, {buffer,mimeType}] = await Promise.all([
                    this.uploadFileToS3FromTgm(sent_result.photo.at(-1).file_id,this.#user),
                    this.downloadFileBufferFromTgm(sent_result.photo.at(-1).file_id)
                ])
                const {sizeBytes} = func.calculateFileSize(buffer)
                
                const buttons = generate_result.mdjMsg.options
                const labels = buttons.map(button => button.label)
                const buttonsShownBefore = this.#dialogue.metaGetMdjButtonsShown
                const btnsDescription = func.generateButtonDescription(labels,buttonsShownBefore)

                mongo.insertCreditUsage({
                    userInstance: this.#user,
                    creditType: "midjourney",
                    creditSubType: "create",
                    usage: 1,
                    details: {place_in_code:"ImagineMdjRouter"}
                })

                return {
                        success:1,
                        result:"The image has been generated and successfully sent to the user with several options to handle the image.",
                        buttonsDescription: btnsDescription,
                        supportive_data:{
                            midjourney_prompt:prompt,
                            image_url:aws_url,
                            size_bites:sizeBytes,
                            base64:buffer.toString('base64'),
                            mimetype: mimeType
                        }
                    };
                };

    argumentsToJson(argumentsText){

        if(argumentsText === "" || argumentsText === null || argumentsText === undefined){
            let err = new Error("No arguments provided.")
            err.assistant_instructions = "You should provide at least required arguments"
            err.place_in_code = "argumentsToJson"
            throw err;
        }
        
        try{
            const argumentsJson=JSON.parse(argumentsText)
            return argumentsJson
            } catch(err){
                try{
                    const escapedArgumentsText = this.escapeJSONString(argumentsText)
                    const argumentsJson=JSON.parse(escapedArgumentsText)
                    return argumentsJson
                } catch(err){
                    let error =  new Error(`Received arguments object poorly formed which caused the following error on conversion to JSON: ${err.message}.`)
                    error.assistant_instructions = "Fix the error with arguments and retry the function."
                    throw error
                }
            }
    }


    imageMdjFieldsValidation(){

        const {textprompt,seed,aspectratio,version,imageprompt,imageweight} = this.#argumentsJson

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."

        if(!textprompt){
            error.message = "textprompt param contains no text."
            throw error;
        } else {
            if (textprompt.split(" ").length > 150){
                error.message = "textprompt length exceeds the limit of 150 words."
                throw error;
            }

            const paramPattern = new RegExp(/--([a-zA-Z]{2,})/,'gi');

            const matches = textprompt.match(paramPattern);
            if (matches) {
                error.message = `textprompt contains param ${matches}, but there should be no params in text prompt.`
                throw error;
              }
        }
        
        if (aspectratio && aspectratio !== ""){
            const aspectratioClean = aspectratio.trim().toLowerCase();
            const pxPattern = /^\d+\s*px\s*[x×]\s*\d+\s*px$/;
            const ratioPattern = /^\d+\s*:\s*\d+$/;

            if(!(pxPattern.test(aspectratioClean) || ratioPattern.test(aspectratioClean))){
                error.message = `aspectratio param ${aspectratio} is not valid. Allowed aspect ratio format^ 16px x 9px or 16:9.`
                throw error;
            }
        }

        if (version && version !== ""){
            if(!["6.1","5.2","5.1","5.0","4a","4b","4c"].includes(version)){
                error.message = `version param ${version} is not valid. Allowed versions are restricted to the following list 6.1, 5.2, 5.1, 5.0, 4a, 4b or 4c.`
                throw error;
            }
        }
        
        if (imageprompt && imageprompt !== ""){
            const imagepromptClean = imageprompt.trim().toLowerCase();
            const urls = imagepromptClean.split(",").map(url => url.trim());
            
            for (const url of urls) {
                if (!url.match(/^https?:\/\/.+/)) {
                    error.message = `imageprompt param contains invalid URL: ${url} `
                    throw error;
                }
            }
        };

        if (imageweight && imageweight !== ""){
            if (typeof imageweight !== "number"){
                error.message = `imageweight param is not a number. Allowed values are between 0 and 3. E.g. 0.5, 1, 1.75, 2, 2.5.`
                throw error;
            } else {
                if (imageweight < 0 || imageweight > 3){
                    error.message = `imageweight param is out of range. Allowed range is between 0 and 3. E.g. 0.5, 1, 1.75, 2, 2.5.`
                    throw error;
                }
            }
        }
    }

    escapeJSONString(str) {
        return str.replace(/[\\"\u0000-\u001F\u007F-\u009F]/g, function(character) {
          // JSON safe escape sequences
          switch (character) {
            case '\\': return '\\\\';
            case '"': return '\\"';
            case '\b': return '\\b';
            case '\f': return '\\f';
            case '\n': return '\\n';
            case '\r': return '\\r';
            case '\t': return '\\t';
            default:
              // Encode any non-printable characters in hex
              return '\\u' + ('0000' + character.charCodeAt(0).toString(16)).slice(-4);
          }
        });
      }

   

    convertResourcesParamToJSON(){

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."

        try{
            this.#argumentsJson.resources = JSON.parse(this.#argumentsJson.resources)
        } catch(err){
            error.message = `Received 'resources' object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`
            throw error;
        }
    }


    validateRequiredFieldsFor_createPDFFile(){    

        const {html,filename,content_reff} = this.#argumentsJson

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."
        
        if(!filename || filename === ""){
            error.message = `'filename' parameter is missing. Provide the value for the agrument.`
            throw error;
        }

        if(!html && !content_reff){
            error.message = `Either 'html' or 'content_reff' parameter must be present. Provide at least one of them.`
            throw error;
        }

        if(html && content_reff){
            error.message = `'html' or 'content_reff' parameters cannot be present at the same time. Use only one of them.`
            throw error;
        }
        
        if(html && html === ""){
            error.message = `'html' parameter must not be blank.`
            throw error;
        }

        if(content_reff && !Array.isArray(content_reff)){
            error.message = `'content_reff' parameter must be an array.`
            throw error;
        }

        if(content_reff && Array.isArray(content_reff) && content_reff.length === 0){
            error.message = `'content_reff' array is empty.`
            throw error;
        }

    }

    validateRequiredFieldsFor_textToSpeech(){

        const {filename,text,content_reff,voice} = this.#argumentsJson

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."

        if(!filename || filename === ""){
            error.message = `'filename' parameter is missing. Provide the value for the agrument.`
            throw error;
        }

        if(!voice || voice === ""){
            error.message = `'voice' parameter is missing. Provide the value for the agrument.`
            throw error;
        }

        if(!text && !content_reff){
            error.message = `Either 'text' or 'content_reff' parameter must be present. Provide at least one of them.`
            throw error;
        }

        if(text && content_reff){
            error.message = `'text' or 'content_reff' parameters cannot be present at the same time. Use only one of them.`
            throw error;
        }
        
        if(text && text === ""){
            error.message = `'text' parameter must contain text.`
            throw error;
        }

        if(content_reff && !Array.isArray(content_reff)){
            error.message = `'content_reff' parameter must be an array.`
            throw error;
        }

        if(content_reff && Array.isArray(content_reff) && content_reff.length === 0){
            error.message = `'content_reff' array is empty.`
            throw error;
        }
    }

    validateRequiredFieldsFor_createTextFile(){

        const {filename,text,content_reff,mimetype} = this.#argumentsJson

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."
        
        if(!filename || filename === ""){
            error.message = `'filename' parameter is missing. Provide the value for the agrument.`
            throw error;
        }

        if(!mimetype || mimetype === ""){
            error.message = `'mimetype' parameter is missing. Provide the value for the agrument.`
            throw error;
        }

        if(!text && !content_reff){
            error.message = `Either 'text' or 'content_reff' parameter must be present. Provide at least one of them.`
            throw error;
        }

        if(text && content_reff){
            error.message = `'text' or 'content_reff' parameters cannot be present at the same time. Use only one of them.`
            throw error;
        }
        
        if(text && text === ""){
            error.message = `'text' parameter must contain text.`
            throw error;
        }

        if(content_reff && !Array.isArray(content_reff)){
            error.message = `'content_reff' parameter must be an array.`
            throw error;
        }

        if(content_reff && Array.isArray(content_reff) && content_reff.length === 0){
            error.message = `'content_reff' array is empty.`
            throw error;
        }
    }


    validateRequiredFieldsFor_speechToText(){

        const resources = this.#argumentsJson.resources

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."

        if(!resources){
            error.message = `'resources' parameter is missing.`
            throw error;
        }

        if(!Array.isArray(resources)){
            error.message = `'resources' parameter is not an array.`
            throw error;
        }

        if(resources.length === 0){
            error.message = `'resources' array is empty.`
            throw error;
        }

    }

    validateRequiredFieldsFor_extractTextFromFile(){

        const resources = this.#argumentsJson.resources

        let error = new Error();
        error.assistant_instructions = "Fix the error and retry the function."

        if(!resources){
            error.message = `'resources' parameter is missing.`
            throw error;
        }

        if(!Array.isArray(resources)){
            error.message = `'resources' parameter is not an array.`
            throw error;
        }

        if(resources.length === 0){
            error.message = `'resources' array is empty.`
            throw error;
        }
        
    }
    
};

module.exports = FunctionCall;