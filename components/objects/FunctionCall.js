const UrlResource = require("./UrlResource.js");
const MdjApi = require("../midjourney_API.js");
const mongo = require("../mongo.js");
const func = require("../other_func.js");
const telegramErrorHandler = require("../telegramErrorHandler.js");
const otherFunctions = require("../other_func.js");
const toolsCollection = require("./toolsCollection.js");

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
        "generate_pdf_file": () => this.generatePDFFile(),
        "generate_text_file": () => this.generateTextFile(),
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
            result = await mongo.queryTockensLogsByAggPipeline(pipeline)
        } else if (table_name==="functions_log"){
            result = await mongo.functionsUsageByAggPipeline(pipeline)
        } else {
            return {success:0,error:`There is not handler for mongodb table ${table_name}. Consider modication of the server code`,instructions:"Report the error to the user"}
        }

        const actualTokens = func.countTokensProportion(JSON.stringify(result))
        
        if(actualTokens>this.#tokensLimitPerCall){
            return {success:0,error:`Result of the function exceeds ${this.#tokensLimitPerCall} characters.`,instructions: "Please adjust the query to reduce length of the result."}
        }
        let response = {success:1,result:result}

        //Post validation
        if(result.length===0){
            response["hint"]= "Empty result might be caused by two reasons. (1) Incorrect data type used in the query. Make sure you correctly apply the instructions regarding date format given in the function description. (2) You have misspelled the values used in the filters. To check spelling, retrieve a list of unique values of the columns on which filters should be applyed. Take into consideration both points and retry the request. Do not ask the user for an approval to retry."
            response["warning"] = "But do not undertake more than three attempts to retry the function."
        };

        return response
            
    } catch (err){
        return {success:0,error:`Error on applying the aggregation pipeline provided to the mongodb: ${err.message + "" + err.stack}`,instructions:"Adjust the pipeline provided and retry."}
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

        

        async generatePDFFile(){

            this.validateRequiredFieldsFor_generatePDFFile()

            const {filename,htmltext} = this.#argumentsJson
            
            const formatedHtml = func.formatHtml(htmltext,filename)

            const filebuffer = await func.htmlToPdfBuffer(formatedHtml)
            const mimetype = "application/pdf"
            
            const {sizeBytes,sizeString} = func.calculateFileSize(filebuffer)
            
            func.checkFileSizeToTgmLimit(sizeBytes,appsettings.telegram_options.file_size_limit)
            
            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

            await  this.#replyMsg.sendDocumentAsBinary(filebuffer,filename,mimetype)
            
            return {success:1,result:`The file ${filename} (${sizeString}) has been generated and successfully sent to the user.`}
        }

        async generateTextFile(){

            this.validateRequiredFieldsFor_generateTextFile()

            const {filename,filetext,mimetype} = this.#argumentsJson
            
            const filebuffer = func.generateTextBuffer(filetext)
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


    async extract_text_from_file(url,mine_type,index){

            try{

                const extractedObject = await func.extractTextFromFile(url,mine_type)

                if(extractedObject.success===1){
                    return {success:1,index:index,resource_url:url,resource_mine_type:mine_type,text:extractedObject.text,was_extracted:extractedObject.was_extracted}
                } else {
                    return {success:0,index:index,resource_url:url,resource_mine_type:mine_type, error:extractedObject.error}
                }
                
            } catch(err){
                console.log(err)
                return {success:0,index:index,resource_url:url,resource_mine_type:mine_type, error:`${err.message}\n ${err.stack}`}
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
           
                try{
                    this.validateRequiredFields()
                } catch (err){
                    return {success:0,error: err.message + "" + err.stack}
                }
                    
                const sourceid_list_array = this.getArrayFromParam(this.#argumentsJson.resources)
                const resources = await mongo.getUploadedFilesBySourceId(sourceid_list_array)

                if(resources.length===0){
                    return {success:0,error:"File is not found by id.",instructions:"You should use fileid from the previous system message."}
                }

                resources.sort((a, b) => {
                    return sourceid_list_array.indexOf(a.sourceid) - sourceid_list_array.indexOf(b.sourceid);
                });

                const extractFunctions = resources.map((resource,index) => this.extract_text_from_file(resource.fileUrl,resource.fileMimeType,index))
                
                let results = await Promise.all(extractFunctions)
                
                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

                results.sort((a, b) => a.index - b.index);

                for (const result of results){
                    if(result.success === 0){
                        return {success:0,resource_index:result.index,resource_url:result.resource_url,resource_mine_type:result.resource_mine_type,error: result.error,instructions:"Fix the error in the respective resource and re-call the entire function."}
                    }
                };

                const concatenatedText = results.map(obj => obj.text).join(' ');
                const wasExtracted = results.some(doc => doc.was_extracted);

                let extractedTextsent = false;
                let extractedTextsendError;

                if(wasExtracted){
                    
                    const filenameShort = resources.length === 1 ? func.filenameWoExtention(resources[0].fileName) : "text" ;
                    
                    const filebuffer = func.generateTextBuffer(concatenatedText)
                    const {sizeBytes,sizeString} = func.calculateFileSize(filebuffer)
                    
                    try{
                        func.checkFileSizeToTgmLimit(sizeBytes,appsettings.telegram_options.file_size_limit)                  
                        const date = new Date()
                         const filename = `${filenameShort}_extracted_${date.toISOString()}.txt`
                        await this.#replyMsg.sendDocumentAsBinary(filebuffer, filename,"text/plain")
                        extractedTextsent = true
                        
                    } catch(err){
                        console.log("err",err)
                        if(err.message.includes("File size exceeds the limit of")){
                            extractedTextsendError = `The file size with extracted text is ${sizeString} which exceeds the Telegram limit of ${appsettings.telegram_options.file_size_limit} bytes and therefore can not be sent to the user.`
                        } else {
                            err.place_in_code = "extract_text_from_file_router";
                            throw err;
                        }
                    }
                }
                
                const  numberOfTokens = await func.countTokensLambda(concatenatedText,this.#user.currentModel)
                console.log("numberOfTokens",numberOfTokens,"this.#tokensLimitPerCall",this.#tokensLimitPerCall)
                
                if(numberOfTokens > this.#tokensLimitPerCall){
                    return {success:0, content_token_count:numberOfTokens, token_limit_left:this.#tokensLimitPerCall, error: `volume of the file content is too big to fit into the dialogue. ${extractedTextsendError && "Also " + extractedTextsendError}`, instructions:`Inform the user that file size exeeds the dialog limits and therefore can not be included in the dialogue. ${extractedTextsent ? "But he can use a file with recognised text sent to the user." : ""}`}
                }
                            
                return {success:1,content_token_count:numberOfTokens, result:concatenatedText, instructions:`Inform the user that: ${extractedTextsendError ? extractedTextsendError : extractedTextsent ? `he can use a file with recognised text sent to him.` : "the text has been extracted successfully."}`}
                    
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


    async CreateMdjImageRouter(){
   
            this.imageMdjFieldsValidation()

            const prompt = this.craftPromptFromArguments()

            const generate_result = await MdjApi.generateHandler(prompt)

            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

            const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)
            
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
                        image_url:sent_result.aws_url,
                    }
                };
            };

            async CustomQueryMdjRouter() {

                const {buttonPushed,msgId,customId,content,flags} = this.#argumentsJson

                const generate_result = await MdjApi.customHandler({msgId,customId,content,flags})

                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
                
                const prompt = otherFunctions.extractTextBetweenDoubleAsterisks(content)

                const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)
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
                            image_url:sent_result.aws_url,
                        }
                    };
            }

            async ImagineMdjRouter(){
       
                const {prompt} = this.#argumentsJson
                
                const generate_result = await MdjApi.generateHandler(prompt)
                
                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
                
                const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)
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
                            image_url:sent_result.aws_url,
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

        if(!textprompt){
            let err = new Error("textprompt param contains no text.")
            err.instructions = "You should provide the text prompt."
            throw err;
        } else {
            if (textprompt.split(" ").length > 150){
                let err = new Error("textprompt length exceeds the limit of 150 words.")
                err.instructions = "You should reduce the prompt length."
                throw err;
            }

            const paramPattern = new RegExp(/--([a-zA-Z]{2,})/,'gi');

            const matches = textprompt.match(paramPattern);
            if (matches) {
                let err = new Error(`textprompt contains param ${matches}, but there should be no params in text prompt.`)
                err.instructions = "You should remove all params from the text prompt."
                throw err;
              }
        }
        
        if (aspectratio && aspectratio !== ""){
            const aspectratioClean = aspectratio.trim().toLowerCase();
            const pxPattern = /^\d+\s*px\s*[x×]\s*\d+\s*px$/;
            const ratioPattern = /^\d+\s*:\s*\d+$/;

            if(!(pxPattern.test(aspectratioClean) || ratioPattern.test(aspectratioClean))){
                let err = new Error(`aspectratio param ${aspectratio} is not valid.`)
                err.instructions = "You should provide the aspect ratio in the format 16px x 9px or 16:9."
                throw err;
            }
        }

        if (version && version !== ""){
            if(!["6.1","5.2","5.1","5.0","4a","4b","4c"].includes(version)){
                let err = new Error(`version param ${version} is not valid.`)
                err.instructions = "You should provide the version param in accordance with the following restricted list 6.1, 5.2, 5.1, 5.0, 4a, 4b or 4c."
                throw err;
            }
        }
        
        if (imageprompt && imageprompt !== ""){
            const imagepromptClean = imageprompt.trim().toLowerCase();
            const urls = imagepromptClean.split(",").map(url => url.trim());
            
            for (const url of urls) {
                if (!url.match(/^https?:\/\/.+/)) {
                    let err = new Error(`imageprompt param contains invalid URL: ${url}`)
                    err.instructions = "You should provide the image prompt as one or more valid URLs separated by commas."
                    throw err;
                }
            }
        };

        if (imageweight && imageweight !== ""){
            if (typeof imageweight !== "number"){
                let err = new Error("imageweight param is not a number.")
                err.instructions = "You should provide the imageweight param. A number between 0 and 3. E.g. 0.5, 1, 1.75, 2, 2.5."
                throw err;
            } else {
                if (imageweight < 0 || imageweight > 3){
                    let err = new Error("imageweight param is out of range.")
                    err.instructions = "You should provide the imageweight param in the range between 0 and 3. E.g. 0.5, 1, 1.75, 2, 2.5."
                    throw err;
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

        try{
            this.#argumentsJson.resources = JSON.parse(this.#argumentsJson.resources)
        } catch(err){
            throw new Error(`Received 'resources' object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`)
        }

    }

    validateRequiredFieldsFor_generatePDFFile(){    

        const {htmltext,filename} = this.#argumentsJson
        
        if(!filename || filename === ""){
            throw new Error(`'filename' parameter is missing. Provide the value for the agrument.`)
        }
        if(!htmltext || htmltext === ""){
            throw new Error(`'htmltext' parameter is missing. Provide the value for the agrument.`)
        }

    }

    validateRequiredFieldsFor_generateTextFile(){

        const {filename,filetext,mimetype} = this.#argumentsJson
        
        if(!filename || filename === ""){
            throw new Error(`'filename' parameter is missing. Provide the value for the agrument.`)
        }
        if(!filetext || filetext === ""){
            throw new Error(`'filetext' parameter is missing. Provide the value for the agrument.`)
        }
        if(!mimetype || mimetype === ""){
            throw new Error(`'mimetype' parameter is missing. Provide the value for the agrument.`)
        }

    }

    validateRequiredFields(){

        const resources = this.#argumentsJson.resources

        if(!resources){
            throw new Error(`'resources' parameter is missing. Provide the value for the agrument.`)
        }

        if(!Array.isArray(this.#argumentsJson.resources)){
            const regex = /^(\d+)(,\d+)*$/;

        const paramIsValid = regex.test(this.#argumentsJson.resources);
        if(!paramIsValid){
            throw new Error(`'resources' parameter is invalid. It must look like this: 3456,3456,12345`)
        }
        }
        
    }
    
};

module.exports = FunctionCall;