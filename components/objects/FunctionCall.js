const UrlResource = require("./UrlResource.js");
const MdjMethods = require("../midjourneyMethods.js");
const mongo = require("../mongo.js");
const func = require("../other_func.js");
const telegramCmdHandler = require("../telegramCmdHandler.js")



class FunctionCall{

    #replyMsg;
    #dialogue
    #user;
    #other_functions

    #tokensLimitPerCall;

    #functionCall;
    #functionName;
    #functionResult="";
    #argumentsText;
    #argumentsJson;
    #timeout_ms;
    #isCanceled;
    #functionConfig;
   
constructor(obj) {
    this.#functionCall = obj.functionCall;
    this.#functionConfig = obj.functionConfig;
    this.#replyMsg = obj.replyMsgInstance;
    this.#dialogue = obj.dialogueInstance;
    this.#user = obj.userInstance;
    this.#tokensLimitPerCall = obj.tokensLimitPerCall
    this.#other_functions = require("../other_func.js");
    this.#timeout_ms = this.#functionConfig.timeout_ms ? this.#functionConfig.timeout_ms : 30000;
    this.#isCanceled = false;
    this.abortController = null;
};

async router(){

    const statusMessageId = await this.sendStatusMessage()
    this.triggerLongWaitNotes(statusMessageId)

    const callExecutionStart = new Date();

    const functionOutcome = await this.functionHandler()

    const duration = ((new Date() - callExecutionStart) / 1000).toFixed(2);

    const ultimateResult = { ...functionOutcome, statusMessageId,duration }
    
    await this.finalizeStatusMessage(ultimateResult)
    
    return ultimateResult;
}

async sendStatusMessage(){

    const MsgText = `${this.#functionConfig.friendly_name}. Выполняется.`
    const result = await this.#replyMsg.simpleSendNewMessage(MsgText,null,null,null)
    return result.message_id
}

triggerLongWaitNotes(tgmMsgId){

    const long_wait_notes = this.#functionConfig.long_wait_notes

    if(long_wait_notes && long_wait_notes.length >0){
        for (const note of long_wait_notes){

            let options = {
                chat_id:this.#replyMsg.chatId,
                message_id:tgmMsgId,
            }

            setTimeout(() => {
                if(this.#dialogue.functionInProgress){
                const MsgText = `${this.#functionConfig.friendly_name}. Выполняется.\n${note.comment}`
                this.#replyMsg.simpleMessageUpdate(MsgText,options)
            }
            }, note.time_ms);
        }
    }
};

async finalizeStatusMessage(functionResult){

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
        message_id:functionResult.statusMessageId,
        reply_markup:reply_markup
    })
}

buildFunctionResultHtml(functionResult){
    const argsJson = JSON.parse(this.#functionCall?.function?.arguments);
    const argsText = func.formatObjectToText(argsJson)

    const request = `<pre>${argsText}</pre>`

    const resultText = func.formatObjectToText(functionResult)
    const reply = `<pre><code class="json">${resultText}</code></pre>`

    const htmlToSend = `<b>name: ${this.#functionConfig?.function?.name}</b>\nid: ${this.#functionCall?.id}\ntype: ${this.#functionConfig?.type}\nduration: ${functionResult.duration} sec.\nsuccess: ${functionResult.success}\n\n<b>request arguments:</b>\n${request}\n\n<b>reply:</b>\n${reply}`

    return htmlToSend
}

async functionWraper(){


    let targetFunction;
                
    if(this.#functionName==="get_current_datetime"){targetFunction = this.get_current_datetime()} 
    else if(this.#functionName==="get_user_guide"){targetFunction = this.get_user_guide()} 
    else if(this.#functionName==="run_javasctipt_code"){targetFunction = this.runJavascriptCode()}
    else if(this.#functionName==="run_python_code"){targetFunction = this.runPythonCode()}
    else if(this.#functionName==="fetch_url_content"){targetFunction = this.fetchUrlContentRouter()}
    else if(this.#functionName==="create_midjourney_image"){targetFunction = this.CreateMdjImageRouter()} 
    else if(this.#functionName==="get_users_activity"){targetFunction = this.get_data_from_mongoDB_by_pipepine("tokens_logs")} 
    else if(this.#functionName==="get_functions_usage"){targetFunction = this.get_data_from_mongoDB_by_pipepine("functions_log")} 
    else if(this.#functionName==="get_chatbot_errors") {targetFunction = this.get_data_from_mongoDB_by_pipepine("errors_log")}
    else if(this.#functionName==="get_knowledge_base_item") {targetFunction = this.get_knowledge_base_item()} 
    else if(this.#functionName==="extract_text_from_file") {targetFunction = this.extract_text_from_file_router()}    
    else {
        return {success: 0, error:`Function ${this.#functionName} does not exist`, instructions:"Provide a valid function."}
    }
    return targetFunction
}

async functionHandler(){
        try{
            const validationResult = this.validateFunctionCallObject(this.#functionCall)
            if(validationResult.valid){

                this.#functionName = this.#functionCall.function.name
                this.#argumentsText = this.#functionCall?.function?.arguments

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => {
                        this.#isCanceled = true
                        reject({ success: 0, error: `Timeout exceeded. The function is allowed ${this.#timeout_ms} seconds.`})
                    }, this.#timeout_ms)
                );

                try {
                    this.#functionResult = await Promise.race([this.functionWraper(), timeoutPromise]);
                    return this.#functionResult;
                } catch (error) {

                    if(error.success){
                        return error;
                    } else {
                        return {success:0,error:error.message};
                    }
                }
            }
                return {success:0,error:`Call is malformed. ${validationResult.error}`,instructions:"Fix the function and retry. But undertake no more than three attempts to recall the function."}
        } catch(err){
            return {success:0,error:err.message,instructions:"Server internal error occured. Try to find other ways to fulfill the user's task."}
        }
}

validateFunctionCallObject(callObject){
    const requiredFields = ['index', 'id', 'type', 'function'];
    const missingFields = [];

    // Check for top-level fields
    requiredFields.forEach(field => {
        if (!callObject.hasOwnProperty(field)) {
            missingFields.push(field);
        }
    });

    // Check for nested 'function' field
    if (callObject.hasOwnProperty('function')) {
        const nestedRequiredFields = ['name', 'arguments'];
        nestedRequiredFields.forEach(field => {
            if (!callObject['function'].hasOwnProperty(field)) {
                missingFields.push(`function.${field}`);
            }
        });
    } else {
        // If 'function' field is missing, add the nested fields as missing too
        missingFields.push('function.name', 'function.arguments');
    }
    
    // Return validation result
    if (missingFields.length === 0) {
        return { valid: true };
    } else {
        return { valid: false, error: `Missing fields: ${missingFields.join(', ')}` };
    }

}

async get_current_datetime(){

    if(this.#isCanceled){
        return {success:0,error: "Function is canceled by timeout."}
    }
    return {success:1,result: new Date().toString()}

}

async get_user_guide(){

        const url = appsettings.other_options.pdf_guide_url


        const extractedObject = await func.extractTextFromFile(url,"application/pdf")

        if(this.#isCanceled){
            return {success:0,error: "Function is canceled by timeout."}
        }

        if(extractedObject.success===1){
            return {success:1,resource_url:url,text:extractedObject.text}
        } else {
            return {success:0,resource_url:url,error:extractedObject.error}
        }
}
    
async get_data_from_mongoDB_by_pipepine(table_name){

    let pipeline = [];

    const argFieldValidationResult = this.argumentsFieldValidation()
    if(argFieldValidationResult.success===0){
        return argFieldValidationResult
    }
    try{
        this.convertArgumentsToJSON()
    } catch (err){
        return {success:0,error: err.message + "" + err.stack}
    } 

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

        if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

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
        if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
        return {success:0,error:`Error on applying the aggregation pipeline provided to the mongodb: ${err.message + "" + err.stack}`,instructions:"Adjust the pipeline provided and retry."}
    }

    };
    async runJavascriptCode(){

        try{
            
        let result;
        const argFieldValidationResult = this.argumentsFieldValidation()
        if(argFieldValidationResult.success===0){
            return argFieldValidationResult
        }
        
        try{
            this.convertArgumentsToJSON()
        } catch (err){
            return {success:0,error: err.message + "" + err.stack}
        }   
        
        const codeToExecute = this.#argumentsJson.javascript_code
    
        
        try{
        result = this.runJavaScriptCodeAndCaptureLogAndErrors(codeToExecute)
        if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

        } catch(err) {
            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
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


        async runPythonCode(){

            try{
                
            let result;
            const argFieldValidationResult = this.argumentsFieldValidation()
            if(argFieldValidationResult.success===0){
                return argFieldValidationResult
            }
            
            try{
                this.convertArgumentsToJSON()
            } catch (err){
                return {success:0,error: err.message + "" + err.stack}
            }   
            
            const codeToExecute = this.#argumentsJson.python_code
        
            
            try{
            result = await this.#other_functions.executePythonCode(codeToExecute)
            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
            } catch(err) {
                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
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
            const argFieldValidationResult = this.argumentsFieldValidation()
            if(argFieldValidationResult.success===0){
                return argFieldValidationResult
            }
            
            try{
                this.convertArgumentsToJSON()
            } catch (err){
                return {success:0,error: err.message + "" + err.stack}
            }   
            
            const kwg_base_id = this.#argumentsJson.id
            
            try{
            result = await mongo.getKwgItemBy(kwg_base_id)
            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
            } catch(err) {
                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
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
                
            const argFieldValidationResult = this.argumentsFieldValidation()
            if(argFieldValidationResult.success===0){
                return argFieldValidationResult
            }

            try {
                this.convertArgumentsToJSON()
            } catch (err){
                return {success:0,error: err.message + "" + err.stack}
            }
           
            try{
                this.validateRequiredFields()
            } catch (err){
                return {success:0,error: err.message + "" + err.stack}
            }

            const sourceid_list_array = this.getArrayFromParam(this.#argumentsJson.resources)

            const resources = await mongo.getUploadedFilesBySourceId(sourceid_list_array)
     
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
            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
            console.log("numberOfTokens",numberOfTokens)
            console.log("this.#tokensLimitPerCall",this.#tokensLimitPerCall)    
            if(numberOfTokens >this.#tokensLimitPerCall){
                return {success:0, content_token_count:numberOfTokens, token_limit_left:this.#tokensLimitPerCall, error: "volume of the file content is too big to fit into the dialogue", instructions:"Inform the user that file size exeeds dialog limits and therefore can not be downloaded."}
            }
                        
            return {success:1,content_token_count:numberOfTokens, result:concatenatedText}
                
                } catch(err){
                    if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}

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
    
        const argFieldValidationResult = this.argumentsFieldValidation()
        if(argFieldValidationResult.success===0){
            return argFieldValidationResult
        }
    
        try{
            this.convertArgumentsToJSON()
        } catch (err){
            return {success:0,error: err.message + "" + err.stack,instructions:"Inform the user about the error details in simple and understandable for ordinary users words."}
        } 
    
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
            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
        } catch(err){
            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
            return {success:0,error:`${err.message} ${err.stack}`,instructions:"Inform the user about the error details in simple and understandable for ordinary users words."}
        }
        
        return {success:1, content_token_count:numberOfTokens, instructions:"(1) Explicitly inform the user if in you completion you use info from the url content and give relevant references (2) your should use urls from the content to browse further if it is needed for the request",result:replyBody}
    
            } catch(err){
                err.place_in_code = err.place_in_code || "fetchUrlContentRouter";
                throw err;
            }
        };

    async CreateMdjImageRouter(){
   
            const argFieldValidationResult = this.argumentsFieldValidation()
            if(argFieldValidationResult.success===0){
                return argFieldValidationResult
            }
    
            try{
                this.convertArgumentsToJSON()
            } catch (err){
                return {success:0,error: err.message + "" + err.stack}
            } 
    
            const valuadationResult = this.imageMdjFieldsValidation()
            if(valuadationResult.success ===0 ){
                return valuadationResult
            }

            const prompt = this.#argumentsJson.midjourney_query;


            let result;
            try{
            result = await telegramCmdHandler.mdj_create_handler(prompt)

            if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
            
            let reply_markup = {
                one_time_keyboard: true,
                inline_keyboard: []
              };

            reply_markup = await this.#replyMsg.generateMdjButtons(result.replymsg,reply_markup);
  
            const msgResult = await this.#replyMsg.simpleSendNewImage({
                caption:prompt,
                reply_markup:reply_markup,
                contentType:"image/jpeg",
                fileName:`mdj_imagine_${result.replymsg.id}.jpeg`,
                imageBuffer:result.imageBuffer
              });
        
            } catch(err){
                if(this.#isCanceled){return {success:0,error: "Function is canceled by timeout."}}
                return {
                    success:0,
                    error: err.message + " " + err.stack
                }
            };

          
            const buttons = result.replymsg.options
            const labels = buttons.map(button => button.label)
            const buttonsShownBefore = this.#dialogue.metaGetMdjButtonsShown
            
            const btnsDescription = telegramCmdHandler.generateButtonDescription(labels,buttonsShownBefore)
            await this.#dialogue.metaSetMdjButtonsShown(labels)

          
             const functionResult = {
                    success:1,
                    result:"The image has been generated and successfully sent to the user with several options to handle the image.",
                    buttonsDescription: btnsDescription,
                    instructions:"Show buttons description to the user only once."
                };

                return functionResult
            };
  
    argumentsFieldValidation(){

        if(this.#argumentsText === "" || this.#argumentsText === null || this.#argumentsText === undefined){
            return {success:0,error: "No arguments provided.",instructions: "You should provide at least required arguments"}
        } else {
            return {success:1}
        }
    }

    imageMdjFieldsValidation(){

        if (this.#argumentsJson.midjourney_query === "" || this.#argumentsJson.midjourney_query === null || this.#argumentsJson.midjourney_query === undefined){
            return {success:0, error:"midjourney_query param contains no text. You should provide the text."};
        } 

        if (this.#argumentsJson.midjourney_query.split(" ").length > 150){
            return {success:0, error:`midjourney_query length exceeds limit of 60 words. Please reduce the prompt length.`};
        }

        return {success:1}
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

    convertArgumentsToJSON(){
        try{
        this.#argumentsJson=JSON.parse(this.#argumentsText)
        } catch(err){

            try{
                this.#argumentsText = this.escapeJSONString(this.#argumentsText)
                this.#argumentsJson=JSON.parse(this.#argumentsText)
            } catch(err){
                throw new Error(`Received arguments object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`)
            }
        }
    }

    convertResourcesParamToJSON(){

        try{
            this.#argumentsJson.resources = JSON.parse(this.#argumentsJson.resources)
        } catch(err){
            throw new Error(`Received 'resources' object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`)
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