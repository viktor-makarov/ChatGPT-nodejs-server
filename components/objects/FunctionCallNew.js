const UrlResource = require("./UrlResource.js");
const MdjMethods = require("../midjourneyMethods.js");
const mongo = require("../mongo");
const func = require("../other_func.js");
const telegramCmdHandler = require("../telegramCmdHandler.js")

class FunctionCallNew{

    #replyMsg;
    #user; 

    #tokensLimitPerCall;

    #functionCall;
    #functionName;
    #systemMsgId;
    #functionResult="";
    #argumentsText;
    #argumentsJson;
    #imageSizeArray = ["1024x1024","1792x1024","1024x1792"]
    #imageSizeDefault = "1024x1024"
    #imageStyleArray = ["vivid","natural"]
    #imageStyleDefault = "vivid"
   
    constructor(obj) {
        this.#functionCall = obj.functionCall;
        this.#replyMsg = obj.replyMsgInstance;
        this.#systemMsgId = obj.systemMsgId;
        this.#user = obj.userInstance;
        this.#tokensLimitPerCall = obj.tokensLimitPerCall
      };


    async router(){

        const validationResult = this.validateFunctionCallObject(this.#functionCall)
        if(validationResult.valid){

            this.#functionName = this.#functionCall.function.name
            this.#argumentsText = this.#functionCall?.function?.arguments

            if(this.#functionName==="get_current_datetime"){this.#functionResult = this.get_current_datetime()} 
            else if(this.#functionName==="run_javasctipt_code"){this.#functionResult = await this.runJavascriptCode()}
            else if(this.#functionName==="fetch_url_content"){this.#functionResult = await this.fetchUrlContentRouter()}
            else if(this.#functionName==="create_midjourney_image"){this.#functionResult = await this.CreateMdjImageRouter()} 
            else if(this.#functionName==="get_users_activity"){this.#functionResult = await this.get_data_from_mongoDB_by_pipepine("tokens_logs")} 
            else if(this.#functionName==="get_chatbot_errors") {this.#functionResult = await this.get_data_from_mongoDB_by_pipepine("errors_log")}
            else if(this.#functionName==="get_knowledge_base_item") {this.#functionResult = await this.get_knowledge_base_item()} 
            else if(this.#functionName==="extract_text_from_file") {this.#functionResult = await this.extract_text_from_file()}    
            else {this.#functionName = {error:`Function ${this.#functionName} does not exist`,instructions:"Provide a valid function."}}

            return this.#functionResult
        }
            return {success:0,error:`Call is malformed. ${validationResult.error}`,instructions:"Fix the function and retry. But undertake no more than three attempts to recall the function."}
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

    get_current_datetime(){

            return {success:1,result: new Date().toString()}

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
    
            return {success:0,error:`Error on applying the aggregation pipeline provided to the mongodb: ${err.message}`,instructions:"Adjust the pipeline provided and retry."}
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
            } catch(err) {
                return {success:0,error: err.message + "" + err.stack}
            }
            
            return {success:1,result:result[0].content}
                
                } catch(err){
                    err.place_in_code = err.place_in_code || "get_knowledge_base_item";
                    throw err;
                }
            };
        async extract_text_from_file(){

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

            try{
                this.validateRequiredFields()
            } catch (err){
                return {success:0,error: err.message + "" + err.stack}
            }
            
            const url = this.#argumentsJson.file_url
            const mine_type = this.#argumentsJson.file_mime_type
            
                        
            return {success:1,result:"Данная функция еще не реализована"}
                
                } catch(err){
                    err.place_in_code = err.place_in_code || "extract_text_from_file";
                    throw err;
                }
            };

    runJavaScriptCodeAndCaptureLogAndErrors(code) {
        // Store the original console.log function
        const originalConsoleLog = console.log;
        // Create an array to hold all outputs (logs and errors)
        const outputs = [];
        
        // Override the console.log method to capture output
        console.log = (...args) => {
            outputs.push(args.join(' '));
        };
    
        function consoleText(text){
            console.log(text+"And this is additional text")
        }
        
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
            
        } catch(err){
            return {success:0,error:`${err.message} ${err.stack}`,instructions:"Inform the user about the error details in simple and understandable for ordinary users words."}
        }
        
        return {success:1, content_token_count:numberOfTokens, instructions:"(1) Explicitly inform the user if in you completion you use info from the url content and give relevant references (2) your should use urls from the content to browse futher if it is needed for the request",result:replyBody}
    
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
            result = await telegramCmdHandler.mdj_create_handler(this.#replyMsg,prompt)
            } catch(err){
                return {
                    success:0,
                    error: err.message + " " + err.stack
                }
            };

            const buttons = result.replymsg.options
            const btnsDescription = telegramCmdHandler.generateButtonDescription(buttons)

             const functionResult = {
                    success:1,
                    result:"The image has been generated and successfully sent to the user with several options to handle the image.",
                    buttonsDescription: btnsDescription
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



    convertArgumentsToJSON(){
        try{
        this.#argumentsJson=JSON.parse(this.#argumentsText)
        } catch(err){
            throw new Error(`Received arguments object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`)
        }
    }

    validateRequiredFields(){
        if(!this.#argumentsJson.file_mime_type){
            throw new Error(`file_mime_type parameter is missing. Provide the value for the agrument.`)
        }

        if(!appsettings.file_options.allowed_mime_types.includes(this.#argumentsJson.file_mime_type)){
            throw new Error(`file_mime_type ${this.#argumentsJson.file_mime_type} is not supported for extraction.`)
        }

        if(!this.#argumentsJson.file_url){
            throw new Error(`file_mime_type parameter is missing. Provide the value for the agrument.`)
        }
    }
    
};

module.exports = FunctionCallNew;