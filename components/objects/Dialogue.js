const mongo = require("../mongo");
const EventEmitter = require('events');
const otherFunctions = require("../other_func");
const aws = require("../aws_func.js")
const msqTemplates = require("../../config/telegramMsgTemplates");


class Dialogue extends EventEmitter {

    //instances
    #user;
    #userid;
    #replyMsg;
    #requestMsg;
    #toolCallsInstance;
    #metaObject
    #defaultMetaObject = {userid:this.#userid,function_calls:{inProgress:false,failedRuns:{},mdjButtonsShown:[]}};

    #dialogueForRequest = [];
    #dialogueFull = [];

    //Как используются? Объединитьв currentMsg?
    #currentPrompt = {};

    #currentMsg = {};
    #previousMsg = {};

    #currentRole;
    #previousRole;

    #regenerateCompletionFlag;

    #tokensWoLastCompletion=0;
    #allDialogueTokens=0;

    constructor(obj) {
        super();
        this.#user = obj.userInstance;
        this.#userid = this.#user.userid;
        this.#replyMsg = obj.replyMsgInstance;
        this.#requestMsg = obj.requestMsgInstance;
        this.#toolCallsInstance = obj.toolCallsInstance
      };

    generateDialogueForRequest(dialogueFull){

        let dialogueForRequest =[];

        const msgsCount =  dialogueFull.length

        for (let i = 0; i < dialogueFull.length; i++){
            
            const document = dialogueFull[i]

            const isLastDoc = msgsCount===(i+1)

            if(isLastDoc){
                this.#previousRole = this.#currentRole;
                this.#currentRole = document.role
                this.#previousMsg = this.#currentMsg;
                this.#currentMsg = document;
                this.#tokensWoLastCompletion = this.#allDialogueTokens;
                this.#allDialogueTokens += (document.tokens || 0)
                if(document.role==="assistant"){
                    //do not include into dealogue if last msg is completion
                    continue
                }
            } else {
                this.#currentRole = document.role
                this.#currentMsg = document;
                this.#allDialogueTokens += (document.tokens || 0);
            }

            let object = {
                role:document.role
            };



            if(Array.isArray(document.content) && document.content.length >0 && document.role === "assistant"){
                object.content = document.content[document.completion_version-1]
            } else {
                object.content = document.content
            };

            if(document.tool_calls  &&  document.tool_calls.length > 0){
                object['tool_calls'] = document.tool_calls;
            };

            if(document.tool_reply){
                object['content'] = document.tool_reply.content  //Перезаписываем
                object['name'] = document.tool_reply.name;
                object['tool_call_id'] = document.tool_reply.tool_call_id;
            }

            dialogueForRequest.push(object)
        };

        return dialogueForRequest
    }

    async getDialogueFromDB(){

        console.time('getDialogueFromDB');
        const messagesFromDb = await mongo.getDialogueByUserId(this.#user.userid,this.#user.currentRegime)
        
        this.#dialogueFull = await messagesFromDb.map(document => ({
            _id: document._id,
            sourceid: document.sourceid,
            createdAtSourceDT_UTC:document.createdAtSourceDT_UTC,
            role: document.role,
            telegramMsgId:document.telegramMsgId,
            telegramMsgBtns:document.telegramMsgBtns,
            completion_version:document.completion_version,
            content: document.content,
            content_latex_formula:document.content_latex_formula,
            tokens: document.tokens,
            tool_calls: document.tool_calls,
            tool_reply: document.tool_reply,
            fileName:document.fileName,
            fileUrl:document.fileUrl,
            fileCaption:document.fileCaption,
            fileAIDescription:document.fileAIDescription
          }));

        this.#dialogueForRequest = this.generateDialogueForRequest(this.#dialogueFull)

        console.timeEnd('getDialogueFromDB');
        return this.#dialogueForRequest
    };

    copyValue(object){
        const value = JSON.parse(JSON.stringify(object))
        return value
      }

    getPreviousCompletionsLastMsgIds(){

        let lastTgmMsgIdsFromCompletions = [];
        let dialogueList = this.copyValue(this.#dialogueFull)

        const lastDocumentInDialogue = dialogueList[dialogueList.length-1]
        if(lastDocumentInDialogue.role === "assistant"){
            dialogueList[dialogueList.length-1]
        }

        for (const doc of dialogueList){
 
            if(doc.telegramMsgBtns === true){
                lastTgmMsgIdsFromCompletions.push(doc.telegramMsgId[doc.telegramMsgId.length-1])
            }
        }

        return lastTgmMsgIdsFromCompletions
    }

    getCompletionsLastMsgIds(){

        let lastTgmMsgIdsFromCompletions = [];
        let dialogueList = this.copyValue(this.#dialogueFull)
        for (const doc of dialogueList){
 
            if(doc.telegramMsgBtns === true){
                lastTgmMsgIdsFromCompletions.push(doc.telegramMsgId[doc.telegramMsgId.length-1])
            }
        }
        return lastTgmMsgIdsFromCompletions
    }

    getLastCompletionTelegramMsgIds(){
        const lastDocumentInDialogue = this.#dialogueFull[this.#dialogueFull.length-1]
        if(lastDocumentInDialogue.role === "assistant"){
            return lastDocumentInDialogue.telegramMsgId
        } else {
            return null
        }
    };

    getLastCompletionDoc(){
        const lastDocumentInDialogue = this.#dialogueFull[this.#dialogueFull.length-1]
       // console.log("lastDocumentInDialogue",lastDocumentInDialogue)
        if(lastDocumentInDialogue.role === "assistant"){
            return lastDocumentInDialogue
        } else {
            return null
        }
    };

    get dialogueForRequest(){
        return this.#dialogueForRequest;
    };

    get dialogueFull(){
        return this.#dialogueFull;
    };

    get userInstance(){
        return this.#user
    }

    get tokensWoLastCompletion(){
        return this.#tokensWoLastCompletion
    }

    get allDialogueTokens(){
        return this.#allDialogueTokens
    }

    set regenerateCompletionFlag(value){
        this.#regenerateCompletionFlag =  value;
    }


    async resetDialogue(){

        await this.getDialogueFromDB()
        const completionMsIds = this.getCompletionsLastMsgIds() 
        await this.#replyMsg.deletePreviousRegenerateButtons(completionMsIds)
        await mongo.deleteDialogByUserPromise([this.#userid], "chat");
        await aws.deleteS3FilesByPefix(this.#userid,this.#user.currentRegime) //to delete later
        const deleteS3Results = await aws.deleteS3FilesByPefix(otherFunctions.valueToMD5(String(this.#userid)),this.#user.currentRegime)
        const deletedFiles = deleteS3Results.Deleted
        await this.commitDevPromptToDialogue(otherFunctions.startDeveloperPrompt(this.#user))

        await this.deleteMeta()
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
        await mongo.deleteDialogueMeta(this.#userid)
        this.#metaObject =  this.#defaultMetaObject
    }

    async createMeta(){
        this.#metaObject =  this.#defaultMetaObject
        this.#metaObject.userid = this.#userid
        await mongo.createDialogueMeta(this.#metaObject)
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
    
    async updateInputMsgTokenUsage(msgToUpdate){
        await mongo.updateInputMsgTokenUsage(msgToUpdate._id,msgToUpdate.tokens)
    }

    async commitPromptToDialogue(text,requestInstance){

        const currentRole = "user"

        let promptObj = {
            sourceid: requestInstance.msgId,
            createdAtSourceTS: requestInstance.msgTS,
            createdAtSourceDT_UTC: new Date(requestInstance.msgTS * 1000),
            telegramMsgId: requestInstance.msgIdsForDbCompletion,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            roleid: 1,
            content: [{type:"text",text:text}]
          }
                

        const savedPrompt = await mongo.upsertPrompt(promptObj); //записываем prompt в базу
        
        promptObj._id = savedPrompt.upserted[0]._id

        this.#dialogueForRequest.push({
            role:promptObj.role,
            content:promptObj.content,
            name:promptObj.name,
        });

        this.#dialogueFull.push({
            _id:promptObj._id,
            sourceid: promptObj.sourceid,
            createdAtSourceDT_UTC:promptObj.createdAtSourceDT_UTC,
            role: promptObj.role,
            content: promptObj.content,
            name:promptObj.name,
            tokens: promptObj.tokens,
            tool_calls: promptObj.tool_calls,
            tool_reply: promptObj.tool_reply
        });

        //update variables
        this.#previousRole = this.#currentRole;
        this.#currentRole = currentRole

        this.#previousMsg = this.#currentMsg;
        this.#currentMsg = promptObj;
        
        console.log("USER PROMPT")
    };

    async commitDevPromptToDialogue(text){

        let currentRole = "developer"
        
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
            role: currentRole,
            roleid: 0,
            content: text
          }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу
        systemObj._id = savedSystem.upserted[0]._id

        this.#dialogueForRequest.push({
            role:systemObj.role,
            content:systemObj.content,
        });

        this.#dialogueFull.push({
            _id:systemObj._id,
            sourceid: systemObj.sourceid,
            createdAtSourceDT_UTC:systemObj.createdAtSourceDT_UTC,
            role: systemObj.role,
            content: systemObj.content
        });

        //update variables
        this.#previousRole = this.#currentRole;
        this.#currentRole = currentRole

        this.#previousMsg = this.#currentMsg;
        this.#currentMsg = systemObj;
        
        console.log("DEVELOPER MESSAGE")
    };

    async  sendUnsuccessFileMsg(fileSystemObj){

        const MsgText = `❌ Файл <code>${fileSystemObj.fileName}</code> не может быть добавлен в наш диалог. К сожалению, файлы с расширением <code>${fileSystemObj.fileExtention}</code> не обрабатываются.`

        const resultTGM = await this.#replyMsg.simpleSendNewMessage(MsgText,null,"html",null)
    }

    async  sendSuccessFileMsg(fileSystemObj){

        const MsgText = `✅ Файл <code>${fileSystemObj.fileName}</code> добавлен в наш диалог.`
        
        let infoForUser = {
            fileId:fileSystemObj.fileId,
            fileName:`<code>${fileSystemObj.fileName}</code>`,
            fileUrl:`<code>${fileSystemObj.fileUrl}</code>`,
            fileExtention: fileSystemObj.fileExtention,
            fileMimeType:fileSystemObj.fileMimeType
           }
          
        const placeholders = [{key:"[fileInfo]",filler:JSON.stringify(infoForUser,null,4)}]
        const unfoldedTextHtml = otherFunctions.getLocalizedPhrase("file_upload_success_html",this.#user.language_code,placeholders)
        
        const infoForUserEncoded = await otherFunctions.encodeJson({unfolded_text:unfoldedTextHtml,folded_text:MsgText})
        
        const callback_data = {e:"un_f_up",d:infoForUserEncoded}

        const fold_button = {
        text: "Показать подробности",
        callback_data: JSON.stringify(callback_data),
        };

        const reply_markup = {
            one_time_keyboard: true,
            inline_keyboard: [[fold_button],],
          };
          
        const resultTGM = await this.#replyMsg.simpleSendNewMessage(MsgText,reply_markup,"html",null)
        await mongo.updateManyEntriesInDbById({
        filter: {"sourceid": fileSystemObj.sourceid},       
        updateBody:{ "telegramMsgId": resultTGM.message_id }
        })

    };

    async commitImageToDialogue(url,description){

        const currentRole = "user"
        const datetime = new Date();
        const sourceid = otherFunctions.valueToMD5(datetime.toISOString())+"_"+"image_url"
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        
        let content = [{type:"image_url",image_url: {url:url}}]
        if(description && description.length>0){
            content.push({type:"text",text:description})
        }

        let promptObj = {
            sourceid: sourceid,
            createdAtSourceTS: unixTimestamp,
            createdAtSourceDT_UTC: new Date(unixTimestamp * 1000),
            telegramMsgId: this.#requestMsg.msgIdsForDbCompletion,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            roleid: 1,
            content: content
          }

        const savedPrompt = await mongo.upsertPrompt(promptObj); //записываем prompt в базу
        promptObj._id = savedPrompt.upserted[0]._id

        this.#dialogueForRequest.push({
            role:promptObj.role,
            content:promptObj.content,
        });

        this.#dialogueFull.push({
            _id:promptObj._id,
            sourceid: promptObj.sourceid,
            createdAtSourceDT_UTC:promptObj.createdAtSourceDT_UTC,
            role: promptObj.role,
            content: promptObj.content,
            tokens: promptObj.tokens,
            tool_calls: promptObj.tool_calls,
            tool_reply: promptObj.tool_reply
        });

        //update variables
        this.#previousRole = this.#currentRole;
        this.#currentRole = currentRole

        this.#previousMsg = this.#currentMsg;
        this.#currentMsg = promptObj;
        
        console.log("USER IMAGE")
    }

    async commitFileToDialogue(url){

        const currentRole = "developer"
        const fileid = this.#requestMsg.msgId
        const sourceid = String(this.#requestMsg.msgId)+"_"+"file_uploaded"
        const obj = {
            fileid:fileid,
            filename:this.#requestMsg.fileName,
            download_url:url
        }

        const placeholders = [{key:"[fileInfo]",filler:JSON.stringify(obj, null, 4)}]
        const devPrompt = otherFunctions.getLocalizedPhrase("file_upload_success",this.#requestMsg.user.language_code,placeholders)

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
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            roleid: 0,
            content: [{type:"text",text:devPrompt}]
          }      
          

        const savedSystem = await mongo.upsertPrompt(fileSystemObj); //записываем prompt в базу
        fileSystemObj._id = savedSystem.upserted[0]._id

        this.#dialogueForRequest.push({
            role:fileSystemObj.role,
            content:fileSystemObj.content,
        });

        this.#dialogueFull.push({
            _id:fileSystemObj._id,
            sourceid: fileSystemObj.sourceid,
            createdAtSourceDT_UTC:fileSystemObj.createdAtSourceDT_UTC,
            role: fileSystemObj.role,
            content: fileSystemObj.content
        });

        //update variables
        this.#previousRole = this.#currentRole;
        this.#currentRole = currentRole

        this.#previousMsg = this.#currentMsg;
        this.#currentMsg = fileSystemObj;
        
        await this.sendSuccessFileMsg(fileSystemObj)
        
        console.log("FILE UPLOADED")
    };

    async commitToolCallResults(obj){

        const currentRole = "tool"

        const results = obj.results
        const userInstance = obj.userInstance

        for (const result of results){

        let toolObject = {
            sourceid:result.tool_call_id,
            userFirstName:userInstance.user_first_name,
            userLastName:userInstance.user_last_name,
            userid:userInstance.userid,
            regime:userInstance.currentRegime,
            tool_reply:{
                content:result.content,
                name:result.function_name,
                duration:result.duration,
                success:result.success,
                tool_call_id:result.tool_call_id,
                functionFriendlyName:result.functionFriendlyName,
            },
            createdAtSourceDT_UTC: new Date(),
            createdAtSourceTS:Math.ceil(Number(new Date())/1000),
            roleid:0,
            role:currentRole
        };

        const savedSys = await mongo.insertToolCallResult(toolObject)
        toolObject._id = savedSys._id;

        this.#dialogueForRequest.push({
            role:toolObject.role,
            content:toolObject.tool_reply.content,
            name:toolObject.tool_reply.name,
            tool_call_id:toolObject.tool_reply.tool_call_id
        });

        this.#dialogueFull.push({
            _id:toolObject._id,
            sourceid: toolObject.sourceid,
            createdAtSourceDT_UTC:toolObject.createdAtSourceDT_UTC,
            role: toolObject.role,
            content: toolObject.content,
            tool_calls: toolObject.tool_calls,
            tool_reply: toolObject.tool_reply
        });

        //update role status
        this.#previousRole = this.#currentRole;
        this.#currentRole = currentRole;

        this.#previousMsg = this.#currentMsg;
        this.#currentMsg = toolObject;

       // await toolCallsInstance.updateFinalMsg(replyMsgInstance.chatId,result)
    } 

        console.log("TOOL MESSAGE")
        this.emit('callCompletion')

    }

    async commitCompletionDialogue(completionObject,tokenUsage){

        const currentRole = "assistant"

        const updatedObj = await mongo.upsertCompletionPromise(completionObject);

        this.#dialogueFull.push(completionObject);

        this.#dialogueForRequest.push({
            role:completionObject.role,
            content:completionObject.content[completionObject.completion_version-1],
            tool_calls:completionObject.tool_calls
        });

        //update role status
        this.#previousRole = this.#currentRole;
        this.#currentRole = currentRole

        this.#previousMsg = this.#currentMsg;
        this.#currentMsg = completionObject;

        await this.finalizeTokenUsage(completionObject,tokenUsage)
        
        if(!this.#regenerateCompletionFlag){
        await this.#replyMsg.deletePreviousRegenerateButtons(this.getPreviousCompletionsLastMsgIds())
        }

        await this.triggerToolCalls(completionObject)

        console.log("COMPLETION MESSAGE COMMIT")
        this.emit('CompletionCommited', {completionObject:completionObject})
        this.#regenerateCompletionFlag = false
    }

    async finalizeTokenUsage(completionObject,tokenUsage){

        if(tokenUsage){

          if(this.#regenerateCompletionFlag){

            this.#allDialogueTokens = tokenUsage.prompt_tokens + tokenUsage.completion_tokens
          } else {

            this.#previousMsg.tokens = tokenUsage.prompt_tokens-this.#allDialogueTokens
  
            this.#tokensWoLastCompletion = tokenUsage.prompt_tokens
            this.#allDialogueTokens = tokenUsage.prompt_tokens + tokenUsage.completion_tokens
            
            await this.updateInputMsgTokenUsage(this.#previousMsg)
          }
            await mongo.insertTokenUsage({
              userInstance:this.#user,
              prompt_tokens:tokenUsage.prompt_tokens,
              completion_tokens:tokenUsage.completion_tokens,
              model:completionObject.model
              })
        }
        }

    async deleteTGMProgressMsg(progressMsgId){

        await this.#replyMsg.deleteMsgByID(progressMsgId)

        this.#replyMsg.msgIdsForDbCompletion = [];
        await mongo.updateCompletionInDb({
          filter: {telegramMsgId:progressMsgId},       
          updateBody:this.completionFieldsToUpdate
        })
    }

    async triggerToolCalls(completionObject){

        if(completionObject.tool_calls && completionObject.tool_calls.length>0){

            const contentTextLength = completionObject.content[completionObject.completion_version-1].length

            if(contentTextLength <5){
                await this.deleteTGMProgressMsg(this.#replyMsg.lastMsgSentId)
            }

            this.emit('triggerToolCall', {})      
      
          }
        }
};

module.exports = Dialogue;