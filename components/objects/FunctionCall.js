const UrlResource = require("./UrlResource.js");
const MdjApi = require("../midjourney_API.js");
const mongo = require("../mongo.js");
const func = require("../other_func.js");
const telegramErrorHandler = require("../telegramErrorHandler.js");
const otherFunctions = require("../other_func.js");
const toolsCollection = require("./toolsCollection.js");
const awsApi = require("../AWS_API.js")

class FunctionCall{
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
    
constructor(obj) {
    this.#functionCall = obj.functionCall;
    this.#functionName = this.#functionCall.function_name;
    this.#functionConfig = obj.functionCall?.tool_config;
    this.#replyMsg = obj.replyMsgInstance;
    this.#dialogue = obj.dialogueInstance;
    this.#requestMsg = obj.requestMsgInstance;
    this.#user = obj.dialogueInstance.userInstance;
    this.#tokensLimitPerCall = obj.tokensLimitPerCall
    this.#timeout_ms = this.#functionConfig.timeout_ms ? this.#functionConfig.timeout_ms : 30000;
    
};

async removeFunctionFromQueue(){
    
    this.#functionConfig.queue_name && await mongo.removeFunctionFromQueue(this.#functionCall.tool_call_id)
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
    error.instructions = "Tell the user that the attempt should be repeated later."
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
       let statusMessageId;
       let err;
    try{

        statusMessageId = await this.sendStatusMessage()

        await this.addFunctionToQueue(statusMessageId)

        this.#long_wait_notes = this.triggerLongWaitNotes(statusMessageId,this.#functionConfig.long_wait_notes)
       
        functionOutcome = await this.functionHandler()
        
    } catch(error){
        //Here is the main error handler for functions.
        err = error
        err.instructions = err.instructions || "Server internal error occured. Try to find other ways to fulfill the user's task.";
        err.place_in_code = err.place_in_code || "FunctionCall.router";
        err.user_message = null //Functions have their own pattern to communicate errors to the user
        telegramErrorHandler.main(
                {
                replyMsgInstance:this.#replyMsg,
                error_object:err
                }
            );
        
        functionOutcome =  {success:0,error:err.message + (err.stack ? "\n" + err.stack : ""),instructions:err.instructions}
    } finally {
        this.clearLongWaitNotes()
        await this.removeFunctionFromQueue()
        await this.handleFailedFunctionsStatus(functionOutcome?.success,this.#functionName,err?.queue_timeout)
        statusMessageId && await this.finalizeStatusMessage(functionOutcome,statusMessageId)
        return functionOutcome;
    }
}

async sendStatusMessage(){

    const MsgText = `${this.#functionConfig.friendly_name}. Выполняется.`
    const result = await this.#replyMsg.simpleSendNewMessage(MsgText,null,null,null)
    return result.message_id
}

triggerLongWaitNotes(tgmMsgId,long_wait_notes = []){

    return long_wait_notes.map(note => {        
            const options = {
                chat_id:this.#replyMsg.chatId,
                message_id:tgmMsgId,
            }

            return setTimeout(() => {
                if(this.#inProgress){
                const MsgText = `${this.#functionConfig.friendly_name}. Выполняется.\n${note.comment}`
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

    const msgText = `${this.#functionConfig.friendly_name}. В очереди ... ⏳`

    const result = await this.#replyMsg.simpleMessageUpdate(msgText,{
        chat_id:this.#replyMsg.chatId,
        message_id:statusMessageId
    })

}

async backExecutingStatusMessage(statusMessageId){
    const msgText = `${this.#functionConfig.friendly_name}. Выполняется.`

    const result = await this.#replyMsg.simpleMessageUpdate(msgText,{
        chat_id:this.#replyMsg.chatId,
        message_id:statusMessageId
    })
}

async finalizeStatusMessage(functionResult,statusMessageId){



    const resultIcon = functionResult.success === 1 ? "✅" : "❌";
    const msgText = `${this.#functionConfig.friendly_name}. ${resultIcon}`

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
        reply_markup:reply_markup
    })
}

modifyStringify(key,value){

    if (key === 'supportive_data') {
        return undefined; // Exclude this key from the JSON stringification
    }
return value
}

unWireText(text =''){

const newText = text.replace(/\\r\\n/g, '\n')
.replace(/\\n/g, '\n')
.replace(/\\t/g, '\t')
.replace(/\\'/g, "'")
.replace(/\\"/g, '"')
.replace(/\\\\/g, '\\')
.replace(/\\\//g, '/')

 return newText
}


buildFunctionResultHtml(functionResult){

    let argsText = JSON.stringify(this.#argumentsJson,this.modifyStringify,2)
    argsText = this.unWireText(argsText)
    const request = `<pre>${func.wireHtml(argsText)}</pre>`

    let stringifiedFunctionResult = JSON.stringify(functionResult,this.modifyStringify,2)
    stringifiedFunctionResult = this.unWireText(stringifiedFunctionResult)
    
    const reply = `<pre><code class="json">${func.wireHtml(stringifiedFunctionResult)}</code></pre>`

    const htmlToSend = `<b>name: ${this.#functionConfig?.function?.name}</b>\nid: ${this.#functionCall?.tool_call_id}\ntype: ${this.#functionConfig?.type}\nduration: ${functionResult?.supportive_data?.duration} sec.\nsuccess: ${functionResult.success}\n\n<b>request arguments:</b>\n${request}\n\n<b>reply:</b>\n${reply}`

    return htmlToSend
}

async selectAndExecuteFunction() {
    
    // Function map for cleaner dispatch
    const functionMap = {
        "create_midjourney_image": () => this.CreateMdjImageRouter(),
        "imagine_midjourney": () => this.ImagineMdjRouter(),
        "custom_midjourney": () => this.CustomQueryMdjRouter(),
        "extract_text_from_file": () => this.extract_text_from_file_router(),
        "fetch_url_content": () => this.fetchUrlContentRouter(),
        "create_pdf_file": () => this.createPDFFile(),
        "create_excel_file": () => this.createExcelFile(),
        "create_text_file": () => this.createTextFile(),
        "get_chatbot_errors": () => this.get_data_from_mongoDB_by_pipepine("errors_log"),
        "get_current_datetime": () => this.get_current_datetime(),
        "get_functions_usage": () => this.get_data_from_mongoDB_by_pipepine("functions_log"),
        "get_knowledge_base_item": () => this.get_knowledge_base_item(),
        "get_user_guide": () => this.get_user_guide(),
        "get_users_activity": () => this.get_data_from_mongoDB_by_pipepine("tokens_logs"),
        "run_javasctipt_code": () => this.runJavascriptCode(),
        "run_python_code": () => this.runPythonCode()
    };
    
    const targetFunction = functionMap[this.#functionName];
    
    if (!targetFunction) {
        let err = new Error(`Function ${this.#functionName} does not exist`);
        err.instructions = "Provide a valid function.";
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
                return {success:0, error: `function call was blocked since the limit of unsuccessful calls for the function ${this.#functionName} is exceeded.`,instructions:"Try to find another solution."}
            };
            
            this.validateFunctionCallObject(this.#functionCall)
            this.#argumentsJson = this.argumentsToJson(this.#functionCall?.function_arguments);

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
        err.instructions = "Fix the function and retry. But undertake no more than three attempts to recall the function."
        throw err;
    }
}

async get_current_datetime(){
    
    return {success:1,result: new Date().toString()}

}

async get_user_guide(){

        const url = appsettings.other_options.pdf_guide_url

        const extractedObject = await func.extractTextFromFile(url,"application/pdf")
        if(extractedObject.success===1){
            return {success:1,resource_url:url,text:extractedObject.text}
        } else {
            return {success:0,resource_url:url,error:extractedObject.error}
        }
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

            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

            await  this.#replyMsg.sendDocumentAsBinary(filebuffer,filename,mimetype)

            return {success:1,result:`The file ${filename} ({sizeString}) has been generated and successfully sent to the user.`}

        }
        
validateRequiredFieldsFor_createExcelFile(){
        const {data, filename} = this.#argumentsJson

        let error = new Error();
        error.instructions = "You must fix the error and retry the function."
        
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

        const filebuffer = await func.htmlToPdfBuffer(formatedHtml)
        const mimetype = "application/pdf"
        
        const {sizeBytes,sizeString} = func.calculateFileSize(filebuffer)
        
        func.checkFileSizeToTgmLimit(sizeBytes,appsettings.telegram_options.file_size_limit)
        
        if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

        await  this.#replyMsg.sendDocumentAsBinary(filebuffer,filename,mimetype)
        
        return {success:1,result:`The file ${filename} (${sizeString}) has been generated and successfully sent to the user.`}
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

            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

            await  this.#replyMsg.sendDocumentAsBinary(filebuffer,filename,mimetype)
            
            return {success:1,result:`The file ${filename} (${sizeString}) has been generated and successfully sent to the user.`}
        }

        async runPythonCode(){

            try{
                
            let result;           
            
            const codeToExecute = this.#argumentsJson.python_code
        
            
            try{
            result = await otherFunctions.executePythonCode(codeToExecute)

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


    async extractTextFromFileWraper(resource_url,resource_mine_type,index){
            try{
                const extractedObject = await func.extractTextFromFile(resource_url,resource_mine_type)
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

                const extractFunctions = resources.map((resource,index) => this.extractTextFromFileWraper(resource.fileUrl,resource.fileMimeType,index))
                
                let results = await Promise.all(extractFunctions)
                
                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

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

                let metadataText ="";
                if(results.length === 1){
                    metadataText = JSON.stringify(results[0].metadata,null,2)
                } else if (results.length > 1){
                    metadataText = results.map((obj,index) => `Part ${index}\n${JSON.stringify(obj.metadata,null,2)}`).join("\n");
                }
                
                const  numberOfTokens = await func.countTokensLambda(concatenatedText,this.#user.currentModel)
                console.log("numberOfTokens",numberOfTokens,"this.#tokensLimitPerCall",this.#tokensLimitPerCall)
                
                if(numberOfTokens > this.#tokensLimitPerCall){
                    return {success:0, content_token_count:numberOfTokens, token_limit_left:this.#tokensLimitPerCall, 
                    error: `The volume of the file content (${numberOfTokens} tokens) exceeds the token limit (${this.#tokensLimitPerCall} tokens) and cannot be included in the dialogue.`, 
                    instructions:`Inform the user that file size exceeds the dialog limits and therefore cannot be included in the dialogue.`}
                }
                            
                return {
                    success:1,
                    content_reff:fullContent.reff,
                    constent_reff:fullContent.reff,
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

    async fetchUrlContentRouter(){

        try{
    
        const url = this.#argumentsJson.url
        const myUrlResource = new UrlResource(url)
    
        let replyBody;
        let numberOfTokens;
   
        try{
            replyBody = await myUrlResource.getUrlBody()
            numberOfTokens = await func.countTokensLambda(replyBody,this.#user.currentModel)
            console.log("numberOfTokens",numberOfTokens)
            console.log("this.#tokensLimitPerCall",this.#tokensLimitPerCall)
            if(numberOfTokens >this.#tokensLimitPerCall){
                return {success:0, content_token_count:numberOfTokens, token_limit_left:this.#tokensLimitPerCall, error: "volume of the url content is too big to fit into the dialogue", instructions:"Inform the user about the error details"}
            }

        } catch(err){

            return {success:0,error:`${err.message} ${err.stack}`,instructions:"Inform the user about the error details in simple and understandable for ordinary users words."}
        }
        
        return {success:1, content_token_count:numberOfTokens, instructions:"(1) Explicitly inform the user if in you completion you use info from the url content and give relevant references (2) your should use urls from the content to browse further if it is needed for the request",result:replyBody}
    
            } catch(err){
                err.place_in_code = err.place_in_code || "fetchUrlContentRouter";
                throw err;
            }
        };


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
      const downloadStream = await otherFunctions.startFileDownload(tgm_url)
      const buffer = await otherFunctions.streamToBuffer(downloadStream.data)
      
      return buffer
    }

    async uploadFileToS3FromTgm(tgmFileId,userInstance){

        const tgm_url = await this.#replyMsg.getUrlByTgmFileId(tgmFileId)
        const fileName = otherFunctions.extractFileNameFromURL(tgm_url)
        const fileExtension = otherFunctions.extractFileExtention(fileName)
        const downloadStream = await otherFunctions.startFileDownload(tgm_url)
        const filename = otherFunctions.valueToMD5(String(userInstance.userid))+ "_" + userInstance.currentRegime + "_" + otherFunctions.valueToMD5(String(fileName)) + "." + fileExtension;  

        let uploadResult  = await awsApi.uploadFileToS3(downloadStream,filename)

        return uploadResult.Location
        }


    async CreateMdjImageRouter(){
   
            this.imageMdjFieldsValidation()

            const prompt = this.craftPromptFromArguments()

            const generate_result = await MdjApi.generateHandler(prompt)

            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

            const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)
            
            const fileHandlerPromises = [
                this.uploadFileToS3FromTgm(sent_result.photo.at(-1).file_id,this.#user),
                this.downloadFileBufferFromTgm(sent_result.photo.at(-1).file_id)
            ]

            const [aws_url, buffer] = await Promise.all(fileHandlerPromises)


            const buttons = generate_result.mdjMsg.options
            const labels = buttons.map(button => button.label)
            const buttonsShownBefore = this.#dialogue.metaGetMdjButtonsShown
            
            const btnsDescription = otherFunctions.generateButtonDescription(labels,buttonsShownBefore)
            await this.#dialogue.metaSetMdjButtonsShown(labels)

            return {
                    success:1,
                    result:"The image has been generated and successfully sent to the user with several options to handle the image.",
                    buttonsDescription: btnsDescription,
                    instructions:"Show buttons description to the user only once.",
                    supportive_data:{
                        midjourney_prompt:prompt,
                        image_url:aws_url,
                        base64:buffer.toString('base64'),
                    }
                };
            };

            async CustomQueryMdjRouter() {

                const {buttonPushed,msgId,customId,content,flags} = this.#argumentsJson

                const generate_result = await MdjApi.customHandler({msgId,customId,content,flags})

                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
                
                const prompt = otherFunctions.extractTextBetweenDoubleAsterisks(content)

                const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)

                const fileHandlerPromises = [
                    this.uploadFileToS3FromTgm(sent_result.photo.at(-1).file_id,this.#user),
                    this.downloadFileBufferFromTgm(sent_result.photo.at(-1).file_id)
                ]

                const [aws_url, buffer] = await Promise.all(fileHandlerPromises)

                const buttons = generate_result.mdjMsg?.options || [];
                const labels = buttons.map(button => button?.label)
                const buttonsShownBefore = this.#dialogue.metaGetMdjButtonsShown
                const btnsDescription = otherFunctions.generateButtonDescription(labels,buttonsShownBefore)
                await this.#dialogue.metaSetMdjButtonsShown(labels)

                return {
                        success:1,
                        result:"The command was executed and sent to the user with several options to handle further.",
                        buttonsDescription: btnsDescription,
                        supportive_data:{
                            midjourney_prompt:content,
                            image_url:aws_url,
                            base64:buffer.toString('base64')
                        }
                    };
            }

            async ImagineMdjRouter(){
       
                const {prompt} = this.#argumentsJson
                
                const generate_result = await MdjApi.generateHandler(prompt)
                
                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
                
                const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)

                const fileHandlerPromises = [
                    this.uploadFileToS3FromTgm(sent_result.photo.at(-1).file_id,this.#user),
                    this.downloadFileBufferFromTgm(sent_result.photo.at(-1).file_id)
                ]

                const [aws_url, buffer] = await Promise.all(fileHandlerPromises)

                const buttons = generate_result.mdjMsg.options
                const labels = buttons.map(button => button.label)
                const buttonsShownBefore = this.#dialogue.metaGetMdjButtonsShown
                const btnsDescription = otherFunctions.generateButtonDescription(labels,buttonsShownBefore)

                return {
                        success:1,
                        result:"The image has been generated and successfully sent to the user with several options to handle the image.",
                        buttonsDescription: btnsDescription,
                        supportive_data:{
                            midjourney_prompt:prompt,
                            image_url:aws_url,
                            base64:buffer.toString('base64')
                        }
                    };
                };

    argumentsToJson(argumentsText){

        if(argumentsText === "" || argumentsText === null || argumentsText === undefined){
            let err = new Error("No arguments provided.")
            err.instructions = "You should provide at least required arguments"
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
                    let error =  new Error(`Received arguments object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`)
                    error.instructions = "Inform the user about the error details in simple and understandable for ordinary users words."
                    throw error
                }
            }
    }


    imageMdjFieldsValidation(){

        const {textprompt,seed,aspectratio,version,imageprompt,imageweight} = this.#argumentsJson

        let error = new Error();
        error.instructions = "You must fix the error and retry the function."

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
        error.instructions = "You must fix the error and retry the function."

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
        error.instructions = "You must fix the error and retry the function."
        
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

    validateRequiredFieldsFor_createTextFile(){

        const {filename,text,content_reff,mimetype} = this.#argumentsJson

        let error = new Error();
        error.instructions = "You must fix the error and retry the function."
        
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

    validateRequiredFieldsFor_extractTextFromFile(){

        const resources = this.#argumentsJson.resources

        let error = new Error();
        error.instructions = "You must fix the error and retry the function."

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