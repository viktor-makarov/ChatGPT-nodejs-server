const mongo = require("../apis/mongo.js");
const EventEmitter = require('events');
const otherFunctions = require("../common_functions.js");
const awsApi = require("../apis/AWS_API.js")
const msqTemplates = require("../../config/telegramMsgTemplates");
const ToolCalls  = require("./ToolCalls.js");
const Completion = require("./Completion.js");

class Dialogue extends EventEmitter {

    //instances
    #user;
    #userid;
    #replyMsg;
    #requestMsg;
    #completionInstance;
    #toolCallsInstance;
    #metaObject
    #defaultMetaObject = {
        userid:this.#userid,
        total_tokens:0,
        function_calls:{
            inProgress:false,
            failedRuns:{},
            mdjButtonsShown:[],
            mdjSeed: String(Math.floor(Math.random() * 100000000))
        }
    };

    #regenerateCompletionFlag;

    constructor(obj) {
        super();
        this.#user = obj.userInstance;
        this.#userid = this.#user.userid;
        this.#replyMsg = obj.replyMsgInstance;
        this.#requestMsg = obj.requestMsgInstance;
        
        this.#toolCallsInstance = new ToolCalls({
            replyMsgInstance:this.#replyMsg,
            userInstance:this.#user,
            requestMsgInstance:this.#requestMsg,
            dialogueInstance:this
          })

        this.on('triggerToolCall', (toolCallsArr) => this.#toolCallsInstance.router(toolCallsArr))

        this.on('callCompletion', () => this.triggerCallCompletion())
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

        this.deletePreviousRegenerateButtons() //made async on purpose

        await this.#completionInstance.router()
    }

    async getLastCompletionDoc(){

        const lastCompletionDoc = await mongo.getLastCompletion(this.#user.userid,this.#user.currentRegime)
        return lastCompletionDoc
    };

    async getDialogueForRequest(){
        
        const dialogueFromDB = await mongo.getDialogueForCompletion(this.#user.userid,this.#user.currentRegime) || []
        return dialogueFromDB.map(doc =>{

            let newDoc = {
                role:doc.role
            };

            if(doc.content && Array.isArray(doc.content) && doc.content.length >0 && doc.role === "assistant"){
                const contentIndex = doc.completion_version ? doc.completion_version - 1 : 0
                if(contentIndex > doc.content.length-1 || contentIndex < 0){
                    newDoc.content = doc.content.at(-1)
                } else {
                    newDoc.content = doc.content[contentIndex]
                }
            } else {
                newDoc.content = doc.content
            };

            if(doc?.tool_calls  &&  doc.tool_calls.length > 0){
                newDoc['tool_calls'] = doc.tool_calls;
            } else if (doc?.tool_reply){
                newDoc['content'] = doc.tool_reply?.content;  //Перезаписываем
                newDoc['name'] = doc.tool_reply?.name;
                newDoc['tool_call_id'] = doc.tool_reply?.tool_call_id;
            }

            return newDoc;

         })
    }

    get toolCallsInstance(){
        return this.#toolCallsInstance
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

    async deletePreviousRegenerateButtons() {

        if(this.regenerateCompletionFlag){
            return
        }

        const documentsWithBtns = await mongo.getDocByTgmBtnsFlag(this.#user.userid,this.#user.currentRegime,true)
        
        if(documentsWithBtns.length === 0){
            return
        }

        let lastTgmMsgIdsFromCompletions = new Set();
        
        documentsWithBtns.forEach(doc => {
            if (doc.telegramMsgId && Array.isArray(doc.telegramMsgId) && doc.telegramMsgId.length > 0) {
                lastTgmMsgIdsFromCompletions.add(doc.telegramMsgId.at(-1));
            }
        });
     
        //console.log("documentsWithBtns",documentsWithBtns.length,lastTgmMsgIdsFromCompletions)
        if(lastTgmMsgIdsFromCompletions.size === 0){
            return
        }

        for (const msgId of lastTgmMsgIdsFromCompletions){
            try{
                const reply_markup = {one_time_keyboard: true,inline_keyboard: []};
                await this.#replyMsg.updateMessageReplyMarkup(msgId,reply_markup)
            } catch(err){
                console.log("Error in deletePreviousRegenerateButtons",err.message)
            }
        }
            await mongo.updateCompletionInDb({
                filter: {telegramMsgId:{"$in":Array.from(lastTgmMsgIdsFromCompletions)}},
                updateBody:{telegramMsgBtns:false}
        })
        }
    
    async resetDialogue(){

        await this.deletePreviousRegenerateButtons()
        await mongo.deleteDialogByUserPromise([this.#userid], "chat");
        await awsApi.deleteS3FilesByPefix(this.#userid,this.#user.currentRegime) //to delete later
        const deleteS3Results = await awsApi.deleteS3FilesByPefix(otherFunctions.valueToMD5(String(this.#userid)),this.#user.currentRegime)
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

        const datetimeStr = new Date().toISOString();

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
            content: [{type:"text",text:text + `\n\n${datetimeStr} (UTC)`}]
          }
                
        await mongo.upsertPrompt(promptObj); //записываем prompt в базу
            
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
            content: text + `\n\n${datetime.toISOString()} (UTC)`
          }

        const savedSystem = await mongo.upsertPrompt(systemObj); //записываем prompt в базу
        
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

    async commitImageToDialogue(url,base64,descriptionJson){
        
        const currentRole = "user"
        const datetime = new Date();
        const sourceid = otherFunctions.valueToMD5(datetime.toISOString())+"_"+"image_url"
        const unixTimestamp = Math.floor(datetime.getTime() / 1000)
        let content = [];
        let text_content ={};

        if(base64){
            content.push({type:"image_url",image_url: {url:`data:image/jpeg;base64,${base64}`}})
        } else if (url){
            content.push({type:"image_url",image_url: {url:url}})
        } else {
            text_content.error = "Здесь должно было быть изображение, но с ним какие-то проблемы"
        };

        if(descriptionJson && typeof descriptionJson === 'object' && descriptionJson !== null){
            text_content = {...text_content,...descriptionJson}
        }
        
        content.push({type:"text",text:JSON.stringify(text_content)})

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
            telegramMsgId: this.#requestMsg.msgIdsForDbCompletion,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            roleid: 1,
            content: content
          }


        await mongo.upsertPrompt(promptObj); //записываем prompt в базу

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
            fileSizeBytes: this.#requestMsg.fileSize,
            fileDurationSeconds: this.#requestMsg.duration_seconds,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            roleid: 0,
            content: [{type:"text",text:devPrompt}]
          }      
          

        const savedSystem = await mongo.upsertPrompt(fileSystemObj); //записываем prompt в базу

        console.log("FILE UPLOAD added to dialogue")    
        return fileSystemObj

    };


    async preCommitToolReply(toolCall){

        const currentRole = "tool"
        const userInstance = this.#user

        let toolObject = {
            sourceid:toolCall.tool_call_id,
            userFirstName:userInstance.user_first_name,
            userLastName:userInstance.user_last_name,
            userid:userInstance.userid,
            regime:userInstance.currentRegime,
            tool_reply:{
                content:"result is pending ...",
                name:toolCall.function_name,
                duration: 0,
                success:0,
                tool_call_id:toolCall.tool_call_id,
                functionFriendlyName:toolCall.tool_config.friendly_name,
            },
            createdAtSourceDT_UTC: new Date(),
            createdAtSourceTS:Math.ceil(Number(new Date())/1000),
            roleid:0,
            role:currentRole
        };

        const savedDoc = await mongo.insertToolCallResult(toolObject)

        console.log("TOOL MESSAGE PRECOMMITED")
    }

    async updateCommitToolReply(result){

       await mongo.updateToolCallResult(result)

       console.log("TOOL MESSAGE UPDATED")
    }

    async commitFunctionErrorToDialogue(errorObject){


    }

    async commitCompletionDialogue(completionObject){

        const currentRole = "assistant"

        await mongo.upsertCompletionPromise(completionObject);
        
        const contentTextLength = completionObject.content[completionObject.completion_version-1].length
        
        if(contentTextLength < 5){
            await this.deleteTGMProgressMsg(this.#replyMsg.lastMsgSentId)
        }

        console.log("COMPLETION MESSAGE COMMIT")
        
    }

    async finalizeTokenUsage(completionObject,tokenUsage){

        if(tokenUsage){
            
            this.metaUpdateTotalTokens(tokenUsage?.total_tokens)

            mongo.insertTokenUsage({
              userInstance:this.#user,
              prompt_tokens:tokenUsage.prompt_tokens,
              completion_tokens:tokenUsage.completion_tokens,
              model:completionObject.model
              })

            mongo.insertCreditUsage({
                userInstance: this.#user,
                creditType: "text_tokens",
                creditSubType: "prompt",
                usage: tokenUsage.prompt_tokens,
                details: {place_in_code:"finalizeTokenUsage"}
            })

            mongo.insertCreditUsage({
                userInstance: this.#user,
                creditType: "text_tokens",
                creditSubType: "completion",
                usage: tokenUsage.completion_tokens,
                details: {place_in_code:"finalizeTokenUsage"}
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
};

module.exports = Dialogue;