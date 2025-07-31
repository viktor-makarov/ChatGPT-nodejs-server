const mongo = require("../apis/mongo.js");
const otherFunctions = require("../common_functions.js");
const awsApi = require("../apis/AWS_API.js")
const msqTemplates = require("../../config/telegramMsgTemplates");
const Completion = require("./Completion.js");
const devPrompts = require("../../config/developerPrompts.js");
const modelConfig = require("../../config/modelConfig.js");
const { error } = require("pdf-lib");

class Dialogue {

    //instances
    #user;
    #userid;
    #replyMsg;
    #requestMsg;
    #completionInstance;
    #metaObject
    #defaultMetaObject = {
        userid:this.#userid,
        total_tokens:0,
        image_input_bites:0,
        image_input_count:0,
        image_input_limit_exceeded:false,
        pdf_input_bites:0,
        pdf_input_pages:0,
        pdf_input_limit_exceeded:false,
        function_calls:{
            inProgress:false,
            failedRuns:{},
            mdjButtonsShown:[],
            mdjSeed: String(Math.floor(Math.random() * 100000000))
        }
    };

    #regenerateCompletionFlag;

    constructor(obj) {
        this.#user = obj.userInstance;
        this.#userid = this.#user.userid;
        this.#replyMsg = obj.replyMsgInstance;
        this.#requestMsg = obj.requestMsgInstance;
        
      };


    async triggerCallCompletion(){

        await this.getMetaFromDB()

        if(this.anyFunctionInProgress){

            const userMsgText = otherFunctions.getLocalizedPhrase(`function_in_progress`,this.#user.language)
            await this.#replyMsg.sendToNewMessage(userMsgText,null,null)
            return;
        }

        this.#completionInstance = new Completion({
            requestMsg:this.#requestMsg,
            replyMsg:this.#replyMsg,
            userClass:this.#user,
            dialogueClass:this
        })

        this.deleteRegenerateButton() //made async on purpose

        await this.#completionInstance.router()
    }

    async getLastCompletionDoc(){

        const lastCompletionDoc = await mongo.getLastCompletion(this.#user.userid,this.#user.currentRegime)
        return lastCompletionDoc
    };

    async getDialogueForRequest(model){

        const image_size_limit = modelConfig[model]?.image_input_limit_bites ?? 1024 * 1024
        const image_count_limit = modelConfig[model]?.image_input_limit_count ?? 5
        
        const dialogueFromDB = await mongo.getDialogueFromDB(this.#user.userid,this.#user.currentRegime) || []
        const dialogueFilteredByImageLimit = this.imageInputFilter(dialogueFromDB,image_size_limit,image_count_limit)
        return this.mapValuesToDialogue(dialogueFilteredByImageLimit);
    }

    async getDialogueForSearch(function_call_id,model){
        
        const search_model_max_input_tokens = modelConfig[model]?.search_length_limit_in_tokens || 100_000
        const image_size_limit = modelConfig[model]?.image_input_limit_bites ?? 1024 * 1024
        const image_count_limit = modelConfig[model]?.image_input_limit_count ?? 5

        const dialogueFromDB = await mongo.getDialogueFromDB(this.#user.userid,this.#user.currentRegime) || []
        const dialogueFiltereByFunctionCall = dialogueFromDB.filter(doc => !doc.tool_call_id || doc.tool_call_id !== function_call_id)
        const dialogueFiltereBySearchFlag = dialogueFiltereByFunctionCall.filter(doc => doc.includeInSearch)
        const dialogueFilteredByImageLimit = this.imageInputFilter(dialogueFiltereBySearchFlag,image_size_limit,image_count_limit)
        const dialogueFilteredByTokenLimit = this.tokenFilterForSearch(dialogueFilteredByImageLimit,search_model_max_input_tokens)
        return this.mapValuesToDialogue(dialogueFilteredByTokenLimit);
    }

    mapValuesToDialogue(dialogue){

        return dialogue.map(doc => {
            const {role,content,status,type,function_name,tool_call_id,function_arguments} = doc;

            if(type === "message"){
                return {role,status,type,content};
            } else if(type === "function_call_output"){
                return {type,
                    call_id: tool_call_id,
                    output: content
                }
            } else if (type === "function_call"){
                return {type,
                    call_id: tool_call_id,
                    name:function_name,
                    arguments:function_arguments
                }
            } else {
                return null
            }
        }).filter(doc => doc !== null);
    }


    imageInputFilter(dialogue,image_size_limit,image_count_limit){

        const filteredDialogue = [];
        let imageSize = 0;
        let imageCount = 0;
        let image_input_limit_exceeded = false;

        for (let i = dialogue.length - 1; i >= 0; i--) {

            const document = dialogue[i];
            const {image_size_bites,image_input} = document;
            if(image_input){
                if (!image_input_limit_exceeded) {
                    if(imageCount + 1  > image_count_limit || imageSize + image_size_bites > image_size_limit){
                        image_input_limit_exceeded = true
                        continue; // Skip if image input exceeds limit
                    } else {
                        filteredDialogue.unshift(document);
                        imageCount += 1;
                        imageSize += image_size_bites || 0;
                    }
                }
            } else {
                filteredDialogue.unshift(document);
            }
        }

        return filteredDialogue
    }

    tokenFilterForSearch(dialogue,token_limit){

        const filteredInput = [];
        let totalTokens = 0;

        for (let i = dialogue.length - 1; i >= 0; i--) {
                const document = dialogue[i];
                const documentTokens = document.tokens || 0;
                
                // Check if adding this document would exceed the limit
                if (totalTokens + documentTokens <= token_limit) {
                    filteredInput.unshift(document); // Add to beginning to maintain order
                    totalTokens += documentTokens;
                } else {
                    break; // Stop adding documents
                }
            }
        return filteredInput
    }

    get completionInstance(){
        return this.#completionInstance
    }

    get userInstance(){
        return this.#user
    }


    set regenerateCompletionFlag(value){
        this.#regenerateCompletionFlag =  value;
    }

    get regenerateCompletionFlag(){
        return this.#regenerateCompletionFlag;
    }

    async deleteAllInlineButtons() {

        const documentsWithBtns = await mongo.getDocByTgmBtnsFlag(this.#user.userid,this.#user.currentRegime)
        
        if(documentsWithBtns.length === 0){
            return
        }

        let lastTgmMsgIdsFromCompletions = new Set();
        
        documentsWithBtns.forEach(doc => {
            if (doc.telegramMsgId && Array.isArray(doc.telegramMsgId) && doc.telegramMsgId.length > 0) {
                lastTgmMsgIdsFromCompletions.add(doc.telegramMsgId.at(-1));
            }
        });
     
        if(lastTgmMsgIdsFromCompletions.size === 0){
            return
        }

        for (const msgId of lastTgmMsgIdsFromCompletions){
            try{
                const reply_markup = {one_time_keyboard: true,inline_keyboard: []};
                await this.#replyMsg.updateMessageReplyMarkup(msgId,reply_markup)
            } catch(err){
                console.log("Error in deleteAllInlineButtons",err.message)
            }
        }
        }


    async deleteRegenerateButton(){

        if(this.regenerateCompletionFlag){
            return
        }

        const documentsWithRegenerateBtns = await mongo.getDocByTgmRegenerateBtnFlag(this.#user.userid,this.#user.currentRegime)
        

        if(documentsWithRegenerateBtns.length === 0){
            return
        }

        for (const doc of documentsWithRegenerateBtns){

            const {sourceid,telegramMsgReplyMarkup,telegramMsgId} = doc;
            if (telegramMsgId && Array.isArray(telegramMsgId) && telegramMsgId.length > 0) {

                let newInlineKeyboard = [];
                telegramMsgReplyMarkup.inline_keyboard.forEach(row => {
                    const newRow = row.filter(button => button.text !== "🔄");
                    newInlineKeyboard.push(newRow);
                })
                telegramMsgReplyMarkup.inline_keyboard = newInlineKeyboard;

                try{
                    await Promise.all([
                this.#replyMsg.updateMessageReplyMarkup(telegramMsgId.at(-1),telegramMsgReplyMarkup),
                mongo.updateCompletionInDb({
                    filter: {sourceid:sourceid},
                    updateBody:{telegramMsgRegenerateBtns:false,telegramMsgReplyMarkup:telegramMsgReplyMarkup}
                })])
                } catch(err){
                    console.log("Error in deleteAllInlineButtons",err.message)
                }
            
            }
        };
    }
    
    async resetDialogue(){

        await this.deleteAllInlineButtons()
        await mongo.deleteDialogByUserPromise([this.#userid], "chat");
        await awsApi.deleteS3FilesByPefix(this.#userid,this.#user.currentRegime) //to delete later
        const deleteS3Results = await awsApi.deleteS3FilesByPefix(otherFunctions.valueToMD5(String(this.#userid)),this.#user.currentRegime)
        const deletedFiles = deleteS3Results.Deleted
        await this.deleteMeta()     
        await this.commitInitialSystemPromptToDialogue("chat")
        await this.createMeta()


        const buttons = {
            reply_markup: {
              keyboard: [['Перезапустить диалог']],
              resize_keyboard: true,
              one_time_keyboard: false
            }
        }

        if(deletedFiles){
            return { text: msqTemplates.dialogresetsuccessfully_extended.replace("[files]",deletedFiles.length),buttons:buttons};
        } else {
            return { text: msqTemplates.dialogresetsuccessfully,buttons:buttons};
        }
    }

    async getMetaFromDB(){
        this.#metaObject =  await mongo.readDialogueMeta(this.#userid)
        
        if(this.#metaObject === null){
            await this.createMeta()
        }
        return this.#metaObject
    }

    async deleteMeta(){
        const result = await mongo.deleteDialogueMeta(this.#userid)
        this.#metaObject =  this.#defaultMetaObject
    }

    async createMeta(){
        this.#metaObject =  this.#defaultMetaObject
        this.#metaObject.userid = this.#userid
        await mongo.createDialogueMeta(this.#metaObject)
    }

    async metaIncrementImageInput(size_bites=0, image_count=0){

        this.#metaObject.image_input_bites += size_bites;
        this.#metaObject.image_input_count += image_count;

        await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
        return {
            image_input_bites: this.#metaObject.image_input_bites, 
            image_input_count: this.#metaObject.image_input_count
        }
    }

    async metaIncrementPdfInput(size_bites=0, size_pages=0){

        this.#metaObject.pdf_input_bites += size_bites;
        this.#metaObject.pdf_input_pages += size_pages;

        await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
        return {
            pdf_input_bites: this.#metaObject.pdf_input_bites, 
            pdf_input_pages: this.#metaObject.pdf_input_pages
        }
        }

        async metaImageInputLimitExceeded(){
        this.#metaObject.image_input_limit_exceeded = true;
        await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
        return this.#metaObject.image_input_limit_exceeded
    }

    async metaPdfInputLimitExceeded(){
        this.#metaObject.pdf_input_limit_exceeded = true;
        await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
        return this.#metaObject.pdf_input_limit_exceeded
    }

    get image_input_limit_exceeded(){
        return this.#metaObject.image_input_limit_exceeded
    }

    async metaIncrementFailedFunctionRuns(functionName){

        if (this.#metaObject.function_calls?.failedRuns && this.#metaObject.function_calls.failedRuns[functionName] > 0) {
            this.#metaObject.function_calls.failedRuns[functionName] += 1;
        } else {
            if (!this.#metaObject.function_calls) {
                this.#metaObject.function_calls = {};
            }
            if (!this.#metaObject.function_calls.failedRuns) {
                this.#metaObject.function_calls.failedRuns = {}
            }
            this.#metaObject.function_calls.failedRuns[functionName] = 1;
        }
        await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
        return this.#metaObject.function_calls.failedRuns[functionName]
    }

    async metaResetFailedFunctionRuns(functionName){

        if(this.#metaObject.function_calls?.failedRuns && this.#metaObject.function_calls.failedRuns[functionName]>0){
        delete this.#metaObject.function_calls.failedRuns[functionName]
        await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
        }
    }

    async metaUpdateTotalTokens(tokens = 0){
        this.#metaObject.total_tokens = tokens
        await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
    }

    async metaGetTotalTokens(){
        const result = await mongo.readDialogueMeta(this.#userid)
        
        this.#metaObject.total_tokens = result.total_tokens || 0;
        return this.#metaObject.total_tokens
    }

    metaGetNumberOfFailedFunctionRuns(functionName){
        if(this.#metaObject.function_calls?.failedRuns && this.#metaObject.function_calls.failedRuns[functionName]>0){
            return this.#metaObject.function_calls.failedRuns[functionName]
        } else {
            return 0
        }
    }

    get metaGetMdjButtonsShown(){
        return this.#metaObject.function_calls.mdjButtonsShown
    }

    async metaSetMdjButtonsShown(mdjButtonsArray){
        let buttonsAdded = 0;
        mdjButtonsArray.forEach(value => {
            if (!this.#metaObject.function_calls.mdjButtonsShown.includes(value)) {
                this.#metaObject.function_calls.mdjButtonsShown.push(value);
                buttonsAdded +=1
            }
          });
        
        if(buttonsAdded>0){
            await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
        };
        return buttonsAdded
    }

    async metaSetAllFunctionsInProgressStatus(value){
        this.#metaObject.function_calls.inProgress = value;
        await mongo.updateDialogueMeta(this.#userid,this.#metaObject)
    }

    get anyFunctionInProgress(){
        return this.#metaObject?.function_calls?.inProgress || false
    }

    get mdjSeed(){
        return this.#metaObject.function_calls?.mdjSeed || 0
    }
    

    async commitPromptToDialogue(text,requestInstance){

        const currentRole = "user"

        let promptObj = {
            sourceid: requestInstance.msgId,
            createdAtSourceTS: requestInstance.msgTS,
            createdAtSourceDT_UTC: new Date(requestInstance.msgTS * 1000),
            telegramMsgId: requestInstance.msgIdsFromRequest,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            content: [{type:"input_text",text:text}],
            status:"completed",
            type:"message",
            includeInSearch:true
          }
                
        await mongo.upsertPrompt(promptObj); //записываем prompt в базу

        this.addTokensUsage(promptObj.sourceid,JSON.stringify(promptObj.content),this.#user.currentModel) //must be async
            
        console.log("USER PROMPT")
    };

    async addTokensUsage(sourceid,text,model){
        const numberOfTokens = otherFunctions.countTokensTiktokenJS(text,model);
        await mongo.addTokensUsage(sourceid,numberOfTokens)
    }

    async commitDateTimeSystemPromptToDialogue(regime){

        const sourceid = `date_time_dev_prompt_${regime}`
        const datetime = new Date();
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        const text = `Current date and time is: ${datetime.toISOString()} (UTC). Use it when applicable`

        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: regime,
            role: "developer",
            content: [{
                text:text,
                type:"input_text"
            }],
            status:"completed",
            type:"message",
            includeInSearch: true
          }
        
        await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid,JSON.stringify(systemObj.content),this.#user.currentModel)
        
        console.log("DATE TIME PROMPT COMMITED")
    }

    async commitInitialSystemPromptToDialogue(regime){

        let promptText = "";
        if(regime === "chat"){
            promptText = otherFunctions.startDeveloperPrompt(this.#user)
        } else if (regime === "translator") {
            promptText = devPrompts.translator_start_prompt()
        } else if (regime === "texteditor") {
            promptText = devPrompts.texteditor_start_prompt()
        }  else {
            promptText = ""
        }

        const datetime = new Date();
        const sourceid = `initial_dev_prompt_${regime}`
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)

        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: regime,
            role: "developer",
            content: [{
                text:promptText,
                type:"input_text"
            }],
            status:"completed",
            type:"message",
            includeInSearch: false
          }
        
        await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid,JSON.stringify(systemObj.content),this.#user.currentModel)
        
        console.log("INITIAL DEVELOPER PROMPT COMMITED")
    }

    async commitDevPromptToDialogue(text){

        const datetime = new Date();
        
        const sourceid = otherFunctions.valueToMD5(datetime.toISOString())
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let systemObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "developer",
            content: [{
                text:text,
                type:"input_text"
            }],
            status:"completed",
            type:"message",
            includeInSearch: false
          }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу

        this.addTokensUsage(systemObj.sourceid,JSON.stringify(systemObj.content),this.#user.currentModel)
        
        console.log("DEVELOPER MESSAGE")
    };

    async  sendUnsuccessFileMsg(fileSystemObj){

        const MsgText = `❌ Файл <code>${fileSystemObj.fileName}</code> не может быть добавлен в наш диалог. К сожалению, файлы с расширением <code>${fileSystemObj.fileExtention}</code> не обрабатываются.`

        const resultTGM = await this.#replyMsg.simpleSendNewMessage(MsgText,null,"html",null)
    }

  
    async checkPDFLimit(pdf_size_bites,pdf_pages){

        if(this.#metaObject.pdf_input_limit_exceeded){
            return false
        }

        const currentPdfSize = this.#metaObject.pdf_input_bites + pdf_size_bites;
        const currentPdfCount = this.#metaObject.pdf_input_pages + pdf_pages;

        const pdf_size_limit = modelConfig[this.#user.currentModel]?.pdf_input_limit_bites ?? 1024 * 1024
        const pdf_count_limit = modelConfig[this.#user.currentModel]?.pdf_input_limit_pages ?? 5

        if(currentPdfSize > pdf_size_limit || currentPdfCount > pdf_count_limit){
            await this.metaPdfInputLimitExceeded()
            return false
        } else {
            return true
        }
    }

    async checkImageLimitAndNotify(image_size_bites,image_count){

        const currentImageSize = this.#metaObject.image_input_bites + image_size_bites;
        const currentImageCount = this.#metaObject.image_input_count + image_count;

        const image_size_limit = modelConfig[this.#user.currentModel]?.image_input_limit_bites ?? 1024 * 1024
        const image_count_limit = modelConfig[this.#user.currentModel]?.image_input_limit_count ?? 5
        
        if(currentImageSize > image_size_limit || currentImageCount > image_count_limit){
            
            if(!this.#metaObject.image_input_limit_exceeded){
                await this.metaImageInputLimitExceeded()
                const msgText = otherFunctions.getLocalizedPhrase(`too_many_messages`,this.#user.language)
                this.#replyMsg.simpleSendNewMessage(msgText,null,"html",null)
            }
        }
    }

    async commitImageToDialogue(descriptionJson, image, index=1){
             
        const content = [];
        let image_input = null;
        let total_byte_size = 0;
        if(descriptionJson){
            content.push({type:"input_text",text:JSON.stringify(descriptionJson)});
        }

        const {url,base64,sizeBytes,mimetype,error} = image;
        
        if(base64){
            content.push({type:"input_image",image_url: `data:${mimetype};base64,${base64}`,detail:"auto"})
            image_input = true;
            total_byte_size += sizeBytes;
        } else if (url){
            content.push({type:"input_image",image_url: url,detail:"auto"})
            image_input = true;
            total_byte_size += sizeBytes;
        } else {
            content.push({type:"input_text",text: error || "Image data should be here, but it was not received."});
            image_input = false;
        }

        await this.checkImageLimitAndNotify(total_byte_size,1)

        const datetime = new Date();
        const sourceid = otherFunctions.valueToMD5(datetime.toISOString())+"_"+index+"_"+"image_url"
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
      
        let promptObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            fileId:this.#requestMsg.msgId,
            fileName:this.#requestMsg.fileName,
            fileUrl:url,
            fileCaption:this.#requestMsg.fileCaption,
            fileExtention:this.#requestMsg.fileExtention,
            fileMimeType:this.#requestMsg.fileMimeType,
            telegramMsgId: this.#requestMsg.msgIdsFromRequest,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: "user",
            content: content,
            status:"completed",
            type:"message",
            includeInSearch:true,
            image_size_bites: total_byte_size,
            image_input: image_input
          }
 
        await mongo.upsertPrompt(promptObj); //записываем prompt в базу

        image_input && await this.metaIncrementImageInput(total_byte_size,1)
        const text_content = content.filter(item => item.type === "input_text");
        this.addTokensUsage(promptObj.sourceid,JSON.stringify(text_content),this.#user.currentModel)
        console.log("USER IMAGE")
    }

    async commitFileToDialogue(url,base64,sizePages){

        const fileid = this.#requestMsg.msgId
        const sourceid = String(this.#requestMsg.msgId)+"_"+"file_uploaded"
        const obj = {
            fileid:fileid,
            filename:this.#requestMsg.fileName,
            download_url:url
        }

        const placeholders = [{key:"[fileInfo]",filler:JSON.stringify(obj, null, 4)}]
        const text = otherFunctions.getLocalizedPhrase("file_upload_success",this.#requestMsg.user.language_code,placeholders)

        const content = [{type:"input_text",text:text}]

        let pdf_input = false;
        if(base64 && await this.checkPDFLimit(this.#requestMsg.fileSize,sizePages)){

            content.push({type:"input_file",filename:this.#requestMsg.fileName,file_data: `data:application/pdf;base64,${base64}`})
            pdf_input = true;
        }
        
        let fileSystemObj = {
            sourceid: sourceid,
            createdAtSourceTS: this.#requestMsg.msgTS,
            createdAtSourceDT_UTC: new Date(this.#requestMsg.msgTS * 1000),
            fileId:fileid,
            fileName:this.#requestMsg.fileName,
            fileUrl:url,
            fileCaption:this.#requestMsg.fileCaption,
            fileExtention:this.#requestMsg.fileExtention,
            fileMimeType:this.#requestMsg.fileMimeType,
            fileSizeBytes: this.#requestMsg.fileSize,
            pdfSizePages: sizePages,
            pdf_input: pdf_input,
            fileDurationSeconds: this.#requestMsg.duration_seconds,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: 'user',
            content: content,
            status:"completed",
            type:"message",
            includeInSearch:true
          }      
          
        await mongo.upsertPrompt(fileSystemObj); //записываем prompt в базу
        pdf_input && await this.metaIncrementPdfInput(this.#requestMsg.fileSize,sizePages)

        this.addTokensUsage(fileSystemObj.sourceid,JSON.stringify(fileSystemObj.content),this.#user.currentModel)

        console.log("FILE UPLOAD added to dialogue")    
        return fileSystemObj

    };


    async commitFunctionCallToDialogue(functionCall){

        const userInstance = this.#user

        let functionObject = {
            sourceid:functionCall.sourceid,
            responseId:functionCall.responseId,
            output_item_index:functionCall.output_item_index,
            userFirstName:userInstance.user_first_name,
            userLastName:userInstance.user_last_name,
            userid:userInstance.userid,
            regime:userInstance.currentRegime,
            tool_call_id:functionCall.tool_call_id,
            function_name:functionCall.function_name,
            function_arguments:functionCall.function_arguments,
            status:functionCall.status,
            type:functionCall.type,
            functionFriendlyName:functionCall.tool_config.friendly_name,
            createdAtSourceDT_UTC: new Date(),
            createdAtSourceTS:Math.ceil(Number(new Date())/1000),
            includeInSearch: true
        };

        await mongo.insertFunctionObject(functionObject)

        this.addTokensUsage(functionObject.sourceid,JSON.stringify({
            type:functionObject.type,
            call_id:functionObject.tool_call_id,
            name:functionObject.function_name,
            arguments:functionObject.function_arguments
        }),this.#user.currentModel)

        console.log("FUNCTION CALL COMMITED")

    }


    async preCommitFunctionReply(functionReply){

        const userInstance = this.#user

        let functionObject = {
            sourceid:functionReply.sourceid,
            userFirstName:userInstance.user_first_name,
            userLastName:userInstance.user_last_name,
            userid:userInstance.userid,
            regime:userInstance.currentRegime,
            content:"result is pending ...",
            tool_call_id:functionReply.tool_call_id,
            function_name:functionReply.function_name,
            output_item_index:functionReply.output_item_index,
            status:functionReply.status,
            type:functionReply.type,
            duration: 0,
            success:0,
            functionFriendlyName:functionReply.tool_config.friendly_name,
            createdAtSourceDT_UTC: new Date(),
            createdAtSourceTS:Math.ceil(Number(new Date())/1000),
            includeInSearch: true
        };

        await mongo.insertFunctionObject(functionObject)

        console.log("TOOL REPLY PRECOMMITED")
    }

    async updateCommitToolReply(result){

  
       await mongo.updateToolCallResult(result)
   
       this.addTokensUsage(result.sourceid,JSON.stringify(result.content),this.#user.currentModel)
      
       console.log("TOOL REPLY UPDATED")
    }

    async commitCompletionDialogue(completionObject){
        await mongo.upsertCompletionPromise(completionObject);

        this.addTokensUsage(completionObject.sourceid,JSON.stringify(completionObject.content),this.#user.currentModel)

        console.log("COMPLETION MESSAGE COMMIT")
        return completionObject.output_item_index
    }

    async finalizeTokenUsage(model,tokenUsage){

        if(tokenUsage){
            
            this.metaUpdateTotalTokens(tokenUsage?.total_tokens)

            mongo.insertTokenUsage({
              userInstance:this.#user,
              prompt_tokens:tokenUsage.input_tokens,
              completion_tokens:tokenUsage.output_tokens,
              model:model
              })

            mongo.insertCreditUsage({
                userInstance: this.#user,
                creditType: "text_tokens",
                creditSubType: "input",
                usage: tokenUsage.input_tokens,
                details: {place_in_code:"finalizeTokenUsage"}
            })

            mongo.insertCreditUsage({
                userInstance: this.#user,
                creditType: "text_tokens",
                creditSubType: "output",
                usage: tokenUsage.output_tokens,
                details: {place_in_code:"finalizeTokenUsage"}
            })
        }
        }

};

module.exports = Dialogue;