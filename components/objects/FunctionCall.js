const UrlResource = require("./UrlResource.js");
const MdjMethods = require("../midjourneyMethods.js");
const mongo = require("../mongo.js");
const func = require("../other_func.js");
const telegramErrorHandler = require("../telegramErrorHandler.js");

class FunctionCall{

    #replyMsg;
    #requestMsg;
    #dialogue
    #user;
    #other_functions
    #inProgress;
    #tokensLimitPerCall;

    #functionCall;
    #functionName;
    #functionResult="";
    #argumentsText;
    #argumentsJson;
    #timeout_ms;
    #isCanceled;
    #functionConfig;
    #long_wait_notes;
    #telegramCmdHandler;
   
constructor(obj) {
    this.#functionCall = obj.functionCall;
    this.#functionName = this.#functionCall.function_name;
    this.#functionConfig = obj.functionCall?.tool_config;
    this.#replyMsg = obj.replyMsgInstance;
    this.#dialogue = obj.dialogueInstance;
    this.#requestMsg = obj.requestMsgInstance;
    this.#user = obj.userInstance;
    this.#tokensLimitPerCall = obj.tokensLimitPerCall
    this.#other_functions = require("../other_func.js");
    this.#timeout_ms = this.#functionConfig.timeout_ms ? this.#functionConfig.timeout_ms : 30000;
    this.#isCanceled = false;
    this.abortController = null;
    this.#inProgress = false;
    this.#telegramCmdHandler = require("../telegramCmdHandler.js");
};

async router(){

    let functionOutcome = {success:0,error:"No outcome from the function returned"}
    const statusMessageId = await this.sendStatusMessage()
    this.#long_wait_notes = this.triggerLongWaitNotes(statusMessageId)

    const callExecutionStart = new Date();
    const failedRunsBeforeFunctionRun = this.#dialogue.metaGetNumberOfFailedFunctionRuns(this.#functionName)
    
    if(this.#functionConfig.try_limit <= failedRunsBeforeFunctionRun){
        functionOutcome = {success:0, error: `function call was blocked since the limit of unsuccessful calls for the function ${this.#functionName} is exceeded.`,instructions:"Try to find another solution."}
    } else {
        functionOutcome = await this.functionHandler()
    }

    if(functionOutcome?.success === 1 ){
        if(failedRunsBeforeFunctionRun>0){
        await this.#dialogue.metaResetFailedFunctionRuns(this.#functionName)
        }
    } else {
        const failedRunsAfterFunctionRun = await this.#dialogue.metaIncrementFailedFunctionRuns(this.#functionName)
        if(failedRunsAfterFunctionRun === this.#functionConfig.try_limit){
            functionOutcome.stop_calls = "Limit of unsuccessful calls is reached. Stop sending toll calls on this function, report the problem to the user and try to find another solution. To clean the limit the dialog should be reset."
        }
    }

    const duration = ((new Date() - callExecutionStart) / 1000).toFixed(2);

    const ultimateResult = { ...functionOutcome, duration }
    
    this.clearLongWaitNotes()

    await this.finalizeStatusMessage(ultimateResult,statusMessageId)
    
    return ultimateResult;
}

async sendStatusMessage(){

    const MsgText = `${this.#functionConfig.friendly_name}. Выполняется.`
    const result = await this.#replyMsg.simpleSendNewMessage(MsgText,null,null,null)
    return result.message_id
}

triggerLongWaitNotes(tgmMsgId){

    const long_wait_notes = this.#functionConfig.long_wait_notes
    let timeouts =[];
    if(long_wait_notes && long_wait_notes.length >0){
        
        for (const note of long_wait_notes){
           
            let options = {
                chat_id:this.#replyMsg.chatId,
                message_id:tgmMsgId,
            }

            const timeoutInstance = setTimeout(() => {
                if(this.#inProgress){
                const MsgText = `${this.#functionConfig.friendly_name}. Выполняется.\n${note.comment}`
                this.#replyMsg.simpleMessageUpdate(MsgText,options)
            }
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

async finalizeStatusMessage(functionResult,statusMessageId){

    const resultImage = functionResult.success === 1 ? "✅" : "❌";
    const msgText = `${this.#functionConfig.friendly_name}. ${resultImage}`

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

buildFunctionResultHtml(functionResult){
    const argsJson = JSON.parse(this.#functionCall?.function_arguments);
    const argsText = func.formatObjectToText(argsJson)

    const request = `<pre>${func.wireHtml(argsText)}</pre>`

    const resultText = func.formatObjectToText(functionResult)
    const reply = `<pre><code class="json">${func.wireHtml(resultText)}</code></pre>`

    const htmlToSend = `<b>name: ${this.#functionConfig?.function?.name}</b>\nid: ${this.#functionCall?.tool_call_id}\ntype: ${this.#functionConfig?.type}\nduration: ${functionResult.duration} sec.\nsuccess: ${functionResult.success}\n\n<b>request arguments:</b>\n${request}\n\n<b>reply:</b>\n${reply}`

    return htmlToSend
}

async functionWraper(){

    let targetFunction;

    this.handleInputArguments()
                
    if(this.#functionName==="get_current_datetime"){targetFunction = this.get_current_datetime()} 
    else if(this.#functionName==="get_user_guide"){targetFunction = this.get_user_guide()} 
    else if(this.#functionName==="run_javasctipt_code"){targetFunction = this.runJavascriptCode()}
    else if(this.#functionName==="run_python_code"){targetFunction = this.runPythonCode()}
    else if(this.#functionName==="generate_text_file"){targetFunction = this.generateTextFile()}
    else if(this.#functionName==="generate_pdf_file"){targetFunction = this.generatePDFFile()}
    else if(this.#functionName==="fetch_url_content"){targetFunction = this.fetchUrlContentRouter()}
    else if(this.#functionName==="create_midjourney_image"){targetFunction = this.CreateMdjImageRouter()} 
    else if(this.#functionName==="get_users_activity"){targetFunction = this.get_data_from_mongoDB_by_pipepine("tokens_logs")} 
    else if(this.#functionName==="get_functions_usage"){targetFunction = this.get_data_from_mongoDB_by_pipepine("functions_log")} 
    else if(this.#functionName==="get_chatbot_errors") {targetFunction = this.get_data_from_mongoDB_by_pipepine("errors_log")}
    else if(this.#functionName==="get_knowledge_base_item") {targetFunction = this.get_knowledge_base_item()} 
    else if(this.#functionName==="extract_text_from_file") {targetFunction = this.extract_text_from_file_router()}    
    else {
        let err = new Error(`Function ${this.#functionName} does not exist`)
        err.instructions = "Provide a valid function."
        throw err;
    }
    return targetFunction
}

async functionHandler(){
    //This function in any case should return a JSON object with success field.
        try{
            const validationResult = this.validateFunctionCallObject(this.#functionCall)
            if(validationResult.valid){
                this.#argumentsText = this.#functionCall?.function_arguments

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => {
                        this.#isCanceled = true
                        let error = new Error(`Timeout exceeded. The function is allowed ${this.#timeout_ms / 1000} seconds.`)
                        error.code = "FUNC_TIMEOUT"
                        reject(error)
                    }, this.#timeout_ms)
                );

                    try{
                        this.#inProgress = true
                        this.#functionResult = await Promise.race([this.functionWraper(), timeoutPromise]);
                        
                        if(this.#isCanceled){
                            return {success:0,error: "Function is canceled by timeout."}
                        }
                    } finally{
                        this.#inProgress = false
                    }

                    return this.#functionResult;

            } else {
                let err = new Error(`Call is malformed. ${validationResult.error}`)
                err.instructions = "Fix the function and retry. But undertake no more than three attempts to recall the function."
                throw err;
            }
        } catch(err){
            //Here is the main error handler for functions.
            err.instructions = err.instructions || "Server internal error occured. Try to find other ways to fulfill the user's task.";
            err.place_in_code = err.place_in_code || "FunctionCall.functionHandler";
            err.user_message = null //Functions have their own pattern to communicate errors to the user
            telegramErrorHandler.main(
                    {
                      replyMsgInstance:this.#replyMsg,
                      error_object:err
                    }
                  );
            
            return {success:0,error:err.message + (err.stack ? "\n" + err.stack : ""),instructions:err.instructions}
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
        return { valid: false, error: `Missing fields: ${missingFields.join(', ')}` };
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
            result = await this.#other_functions.executePythonCode(codeToExecute)

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
                    return {success:1,index:index,resource_url:url,resource_mine_type:mine_type,text:extractedObject.text}
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
            
            results.sort((a, b) => a.index - b.index);

            for (const result of results){
                if(result.success === 0){
                    return {success:0,resource_index:result.index,resource_url:result.resource_url,resource_mine_type:result.resource_mine_type,error: result.error,instructions:"Fix the error in the respective resource and re-call the entire function."}
                }
            };

            const concatenatedText = results.map(obj => obj.text).join(' ');
            
            const  numberOfTokens = await func.countTokensLambda(concatenatedText,this.#user.currentModel)

            console.log("numberOfTokens",numberOfTokens)
            console.log("this.#tokensLimitPerCall",this.#tokensLimitPerCall)    
            if(numberOfTokens >this.#tokensLimitPerCall){
                return {success:0, content_token_count:numberOfTokens, token_limit_left:this.#tokensLimitPerCall, error: "volume of the file content is too big to fit into the dialogue", instructions:"Inform the user that file size exeeds dialog limits and therefore can not be downloaded."}
            }
                        
            return {success:1,content_token_count:numberOfTokens, result:concatenatedText}
                
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

            const generate_result = await MdjMethods.generateHandler(prompt)

            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

            const sent_result = await  this.#replyMsg.sendMdjImage(generate_result,prompt)

            const buttons = generate_result.mdjMsg.options
            const labels = buttons.map(button => button.label)
            const buttonsShownBefore = this.#dialogue.metaGetMdjButtonsShown
            
            const btnsDescription = this.#telegramCmdHandler.generateButtonDescription(labels,buttonsShownBefore)
            await this.#dialogue.metaSetMdjButtonsShown(labels)

            return {
                    success:1,
                    result:"The image has been generated and successfully sent to the user with several options to handle the image.",
                    buttonsDescription: btnsDescription,
                    image_url:generate_result.mdjMsg.uri,
                    midjourney_prompt:prompt,
                    instructions:"Show buttons description to the user only once."
                };
            };
    

    

    handleInputArguments(){

        if(this.#argumentsText === "" || this.#argumentsText === null || this.#argumentsText === undefined){
            let err = new Error("No arguments provided.")
            err.instructions = "You should provide at least required arguments"
            err.place_in_code = "handleInputArguments"
            throw err;
        } else {
            try{
                this.#argumentsJson=JSON.parse(this.#argumentsText)
                } catch(err){
                    try{
                        this.#argumentsText = this.escapeJSONString(this.#argumentsText)
                        this.#argumentsJson=JSON.parse(this.#argumentsText)
                    } catch(err){
                        let error =  new Error(`Received arguments object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`)
                        error.instructions = "Inform the user about the error details in simple and understandable for ordinary users words."
                        throw error
                    }
                }
        }
    }


    imageMdjFieldsValidation(){

        const {textprompt,seed,aspectratio,version,imageprompt,imageweight} = this.#argumentsJson

        if(textprompt === "" || textprompt === null || textprompt === undefined){
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