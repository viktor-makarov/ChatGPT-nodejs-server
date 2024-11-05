const UrlResource = require("./UrlResource.js");
const mongo = require("../mongo");
const func = require("../other_func.js");

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
            else if(this.#functionName==="create_image"){this.#functionResult = await this.CreateImageRouter()} 
            else if(this.#functionName==="get_users_activity"){this.#functionResult = await this.get_data_from_mongoDB_by_pipepine("tokens_logs")} 
            else if(this.#functionName==="get_chatbot_errors") {this.#functionResult = await this.get_data_from_mongoDB_by_pipepine("errors_log")
            } else {this.#functionName = {error:`Function ${this.#functionName} does not exist`,instructions:"Provide a valid function."}}

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

    async CreateImageRouter(){
   
        const argFieldValidationResult = this.argumentsFieldValidation()
        if(argFieldValidationResult.success===0){
            return argFieldValidationResult
        }

        try{
            this.convertArgumentsToJSON()
        } catch (err){
            return {success:0,error: err.message + "" + err.stack}
        } 

        const valuadationResult = imageFieldsValidation()
        if(valuadationResult.success ===0 ){
            return valuadationResult
        }
  
            const resp = await CreateImage({
                prompt:this.#argumentsJson.prompt,
                model:"dall-e-3",
                size:this.#argumentsJson.size,
                style:this.#argumentsJson.style
            });
    
            functionResult = {
                success:1,
                result:"The image has been generated and successfully sent to the user.", 
                instructions:`Translate the following description of the image in the language of the user's prompt:`+JSON.stringify(resp)
            };
            return functionResult
        };
        
    async CreateImage(obj){
       
            const options = {
            url: "https://api.openai.com/v1/images/generations",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.#user.openAIToken}`,
            },
            validateStatus: function (status) {
                return status == appsettings.http_options.SUCCESS_CODE;
            },
            data: {
                model:obj,model,
                prompt:obj.prompt,
                size:obj.size,
                style:obj.style,
                n: 1,
            //     response_format:"b64_json" 
            }};
            
            this.#replyMsg.simpleMessageUpdate("\n"&"Создаю изображение ...",
                {
                    chat_id:this.#replyMsg.chatId,
                    message_id: this.#systemMsgId
                }
            )
            const openai_resp = await axios(options);
            let resultList = []; 
            const photoList = openai_resp.data.data
            
            this.#replyMsg.simpleMessageUpdate("\n"&"Сжимаю изображение ...",
                {
                    chat_id:this.#replyMsg.chatId,
                    message_id: this.#systemMsgId
                }
            )
            if (!(photoList&&photoList.length>0)){
                throw new Error("No image was provided by OpenAI service. Please retry.");
            }
    
            for (let i = 0; i < photoList.length; i++) {
            const photo = photoList[i]
            // console.log(photo)
            //   const filePath = './img/img-resided_600_600.png';
            //   const readableStream = fs.createReadStream(filePath);
            resultList.push(photo.revised_prompt)
    
            const response = await axios({
                method: 'get',
                url: photo.url,
                responseType: "arraybuffer"
                });
            const fileData = Buffer.from(response.data, "binary");
    
            const image = await Jimp.read(fileData)
            const inputWidth = image.bitmap.width
            const inputHeight = image.bitmap.height
    
            const outputWidth = 240
            const outputHeight = outputWidth*(inputHeight/inputWidth)
            const resizedImage = image.resize(outputWidth, outputHeight);
            const outputBuffer = await resizedImage.getBufferAsync(Jimp.MIME_JPEG);
    
            await this.#replyMsg.botInstance.sendPhoto(this.#replyMsg.chatId, outputBuffer,
                {filename: model+'.jpg',
                contentType: 'image/jpeg',
                caption:"Revised_prompt: "+ photo.revised_prompt,
                reply_markup: JSON.stringify({ 
                    inline_keyboard: [
                        [{ text: 'Открыть в оригинальном размере', url: photo.url}]
                    ]
                    })
                }
                )
    
            }
            
            return resultList

        }
    
    argumentsFieldValidation(){

        if(this.#argumentsText === "" || this.#argumentsText === null || this.#argumentsText === undefined){
            return {success:0,error: "No arguments provided.",instructions: "You should provide at least required arguments"}
        } else {
            return {success:1}
        }
    }

    imageFieldsValidation(){

        if (this.#argumentsJson.prompt === "" || this.#argumentsJson.prompt === null || this.#argumentsJson.prompt === undefined){
            return {success:0, error:"Prompt param contains no text. You should provide the text."};
        } 
        
        if (this.#argumentsJson.prompt.length > 4000){
            return {success:0, error:`Prompt length exceeds limit of 4000 characters. Please reduce the prompt length.`};
        }

        const size = this.#argumentsJson?.size || this.#imageSizeDefault

        if(!sizeArray.includes(size)){
            return {success:0, error:`Size param can not have other value than 1024x1024, 1792x1024 or 1024x1792. Please choose one of the three.`};
        }

        const style = this.#argumentsJson?.style || this.#imageStyleDefault

        if(!styleArray.includes(style)){
            return {success:0, error:`Style param can not have other value than vivid or natural. Please choose one of the two.`};
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
    
};

module.exports = FunctionCallNew;