const mongo = require("../mongo");
const EventEmitter = require('events');
const otherFunctions = require("../other_func");


class Dialogue extends EventEmitter {

    //instances
    #user;
    #replyMsg;
    #toolCallsInstance;

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
        this.#replyMsg = obj.replyMsgInstance;
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

        //  console.log("messagesFromDb",messagesFromDb)
      
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

    getToolsMsgIds(){

        let TgmMsgIdsFromTools = [];
        let dialogueList = this.copyValue(this.#dialogueFull)
        for (const doc of dialogueList){
 
            if(doc.role === 'tool'){
                TgmMsgIdsFromTools.push(doc.telegramMsgId)
            }
        }
        return TgmMsgIdsFromTools
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
        
        console.log("USER MESSAGE")
        this.emit('callCompletion')
    };

    async commitSystemToDialogue(text,requestInstance){


        let currentRole = "system"
        if(["o1-mini","o1-preview"].includes(requestInstance.user.currentModel)){
            currentRole = "developer"
        }

        const msdId = requestInstance.msgId ? requestInstance.msgId : requestInstance.callbackId
        const msgTS = requestInstance.msgTS ? requestInstance.msgTS : requestInstance.callback_msgTS
        let systemObj = {
            sourceid: msdId,
            createdAtSourceTS: msgTS,
            createdAtSourceDT_UTC: new Date(msgTS * 1000),
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
        
        console.log("SYSTEM MESSAGE")
    };

    async  sendUnsuccessFileMsg(fileSystemObj){

        const MsgText = `❌ Файл <code>${fileSystemObj.fileName}</code> не может быть добавлен в наш диалог. К сожалению, файлы с расширением <code>${fileSystemObj.fileExtention}</code> не обрабатываются.`

        const resultTGM = await this.#replyMsg.simpleSendNewMessage(MsgText,null,"html")
    }

    async  sendSuccessFileMsg(fileSystemObj){

        const MsgText = `✅ Файл <code>${fileSystemObj.fileName}</code> добавлен в наш диалог.`
        
        let infoForUser = {
            fileId:fileSystemObj.sourceid,
            fileName:`<code>${fileSystemObj.fileName}</code>`,
            fileUrl:`<code>${fileSystemObj.fileUrl}</code>`,
            fileExtention: fileSystemObj.fileExtention,
            fileMimeType:fileSystemObj.fileMimeType
           }
          
        if(fileSystemObj.fileCaption){
            infoForUser["fileCaption"] = fileSystemObj.fileCaption
        }
        
        const infoForUserEncoded = await otherFunctions.encodeJson({unfolded_text:infoForUser,unfolded_header:"Uploaded file info",folded_text:MsgText})
        
        const callback_data = {e:"un_f_up",d:infoForUserEncoded}

        const fold_button = {
        text: "Показать подробности",
        callback_data: JSON.stringify(callback_data),
        };

        const reply_markup = {
            one_time_keyboard: true,
            inline_keyboard: [[fold_button],],
          };
          
        const resultTGM = await this.#replyMsg.simpleSendNewMessage(MsgText,reply_markup,"html")
        await mongo.updateManyEntriesInDbById({
        filter: {"sourceid": fileSystemObj.sourceid},       
        updateBody:{ "telegramMsgId": resultTGM.message_id }
        })

    };

    async commitFileToDialogue(url,requestInstance){

        const currentRole = "user"
        const obj = {
            fileid:requestInstance.msgId,
            filename:requestInstance.fileName,
            download_url:url,
            fileDescription:requestInstance.fileCaption
        }

        const text = `User provided the following file\n${JSON.stringify(obj, null, 4)}`

        let content = [{type:"text",text:text}]

        if(requestInstance.fileType ==="image"){
            content.push({type:"image_url",image_url: {url:url}})
        }

        let fileSystemObj = {
            sourceid: requestInstance.msgId,
            createdAtSourceTS: requestInstance.msgTS,
            createdAtSourceDT_UTC: new Date(requestInstance.msgTS * 1000),
            fileName:requestInstance.fileName,
            fileUrl:url,
            fileCaption:requestInstance.fileCaption,
            fileExtention:requestInstance.fileExtention,
            fileMimeType:requestInstance.fileMimeType,
            userid: this.#user.userid,
            userFirstName: this.#user.user_first_name,
            userLastName: this.#user.user_last_name,
            regime: this.#user.currentRegime,
            role: currentRole,
            roleid: 0,
            content: content
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
        const replyMsgInstance = obj.replyMsgInstance
        const toolCallsInstance = obj.toolCallsInstance

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
            telegramMsgId:result.tgm_sys_msg_id,
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

        await toolCallsInstance.updateFinalMsg(replyMsgInstance.chatId,result)
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