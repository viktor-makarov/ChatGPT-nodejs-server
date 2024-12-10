const modelConfig = require("../../config/modelConfig");
const mongo = require("../mongo");
const scheemas = require("../mongo_Schemas.js");

const FunctionCallNew  = require("./FunctionCallNew.js");

class ToolCalls{

    #toolCalls;
    #replyMsg;
    #requestMsg;
    #user;
    #dialogue;
    #available_tools;
    #tool_choice = "auto"
    #callExecutionStart;
    #callExecutionEnd;
    #functionTimeTakenRounded;
    #tokenFetchLimitPcs;
    #overalTokenLimit;
    #functionCallUnsuccessfullCounts ={};

    constructor(obj) {
     this.#replyMsg = obj.replyMsgInstance;
     this.#user = obj.userInstance;
     this.#requestMsg = obj.requestMsgInstance;
     this.#dialogue = obj.dialogueInstance
     
     this.#tokenFetchLimitPcs = (appsettings?.functions_options?.fetch_text_limit_pcs ? appsettings?.functions_options?.fetch_text_limit_pcs : 80)/100
     this.#overalTokenLimit = this.#user?.currentModel ? modelConfig[this.#user.currentModel]?.request_length_limit_in_tokens : null
    
    }



countUnsuccessfullFunctionCalls(functionName,functionOutcome){
    if(functionOutcome.success===0){

        if(this.#functionCallUnsuccessfullCounts[functionName]){
            this.#functionCallUnsuccessfullCounts[functionName].failedAttempts += 1;
        } else {
            const toolConfig = this.toolConfigByFunctionName(functionName)
            this.#functionCallUnsuccessfullCounts[functionName] = {failedAttempts:1,limit:toolConfig.try_limit}
        }
    } else if (functionOutcome.success===1){
        if(this.#functionCallUnsuccessfullCounts[functionName]){
            this.#functionCallUnsuccessfullCounts[functionName].failedAttempts = 0;
        }
    }
};

limitOfUnsuccessFullExceeded(functionName){

    const functionStatistics = this.#functionCallUnsuccessfullCounts[functionName];
    if(functionStatistics && functionStatistics.failedAttempts > functionStatistics.limit){
        return true
    } else {
        return false
    }
}

set tool_calls(value){
    this.#toolCalls = value
}

get tool_choice(){
    return this.#tool_choice
}

toolConfigByFunctionName(functionName){
    return this.#available_tools.find(doc => doc.function?.name === functionName);
}

availableToolsForCompetion(){
    if(this.#available_tools){
        return this.#available_tools.map((doc) => ({ type:doc.type, function:doc.function}));
    } else {
        return null
    }
}

async router(){

    const curentTokenLimit = (this.#overalTokenLimit-this.#dialogue.allDialogueTokens)*this.#tokenFetchLimitPcs;

    const tokensLimitPerCall = curentTokenLimit/this.#toolCalls.length

    const toolCallsPromiseList =  this.#toolCalls.map(async (toolCall, index) =>  {

        const toolConfig = this.toolConfigByFunctionName(toolCall?.function?.name)
        const systemMsgId = await this.preCommitToolCall(toolCall,toolConfig)
       
        let toolCallResult = {
            tool_call_id:toolCall.id,
            tool_call_type:toolCall.type,
            tgm_sys_msg_id:systemMsgId,
            function_name:toolCall?.function?.name,
            functionFriendlyName: toolConfig.friendly_name
        };
        const callExecutionStart = new Date();
        if(toolCall.type = "function"){
 
            const functionCall = new FunctionCallNew({
                functionCall:toolCall,
                replyMsgInstance:this.#replyMsg,
                userInstance:this.#user,
                systemMsgId:systemMsgId,
                tokensLimitPerCall:tokensLimitPerCall
            });

            let outcome = await functionCall.router()
            this.countUnsuccessfullFunctionCalls(toolCallResult.function_name,outcome)
            const limitIsExceeded = this.limitOfUnsuccessFullExceeded(toolCallResult.function_name)
            if(limitIsExceeded){
                outcome.instructions = "Limit of unsuccessful calls exceeded. Stop sending toll calls and report the problem to the user"
            }
            toolCallResult.content = JSON.stringify(outcome)
            toolCallResult.success = outcome.success
                           
        } else {
            const outcome = {success:0,error:"Non-function types cannot be processed for now.",instructions:"Rework into a function"}
            toolCallResult.content = JSON.stringify(outcome)
            toolCallResult.success = outcome.success
        }
        
        const callExecutionEnd = new Date();
        const timeTaken = (callExecutionEnd - callExecutionStart) / 1000; // Time difference in seconds
        toolCallResult.duration = timeTaken.toFixed(2);
        

        await mongo.insertFunctionUsagePromise({
            userInstance:this.#user,
            tool_function:toolCallResult.function_name,
            tool_reply:toolCallResult,
            call_duration:toolCallResult.duration,
            call_number:`${index}/${toolCallsPromiseList.length}`
        })

        return toolCallResult
    })

        const results = await Promise.all(toolCallsPromiseList)

        await this.#dialogue.commitToolCallResults({
            userInstance:this.#user,
            replyMsgInstance:this.#replyMsg,
            toolCallsInstance:this,
            results:results
        });

        this.#toolCalls =[];
};

async addMsgIdToToolCall(toolCallId,systemMsgId){

    await mongo.updateCompletionInDb({
        filter: {"tool_calls.id":toolCallId},       
        updateBody:{ "tool_calls.$.telegramMsgId": systemMsgId }
      })
}

async preCommitToolCall(toolCall,toolConfig){

    //send msg to TGM
    const MsgText = `${toolConfig.friendly_name}. Выполняется.`
    const result = await this.#replyMsg.simpleSendNewMessage(MsgText,null)
    
    //save msg_id to tool_call in completion
    await mongo.updateCompletionInDb({
        filter: {"tool_calls.id":toolCall.id},       
        updateBody:{ "tool_calls.$.telegramMsgId": result.message_id }
      })

    return result.message_id
}

async sendInitialMsg(obj){
    const result = await this.#replyMsg.simpleSendNewMessage(obj.text,obj.reply_markup)
    return result.message_id
}

async updateFinalMsg(chat_id,callResult){
    
    let resultImage;
    if(callResult.success === 1) {
        resultImage = "✅"
    } else {
        resultImage = "❌"
    }
    const text = `${callResult.functionFriendlyName}. ${resultImage}`


    const callback_data = {e:"unfold_sysmsg",d:callResult.tgm_sys_msg_id}

    const fold_button = {
        text: "Показать подробности",
        callback_data: JSON.stringify(callback_data),
      };

      const reply_markup = {
        one_time_keyboard: true,
        inline_keyboard: [[fold_button],],
      };

    const result = await this.#replyMsg.simpleMessageUpdate(text,{
        chat_id:chat_id,
        message_id:callResult.tgm_sys_msg_id,
        reply_markup:reply_markup
    })
    return result.message_id
}


async generateAvailableTools(userClass){

        var functionList = []
        
        
        if(userClass.currentRegime==="chat"){
        
        //Общедоступные функции
        functionList.push(
        {type:"function",
        function:{
            name: "get_current_datetime",
            description: "Use this function to answer user's questions which require current date and time. This function returns value of date and time at the moment of request.",
            parameters: {
                type: "object",
                properties: {}
            }
        },
        friendly_name:"Тек. дата и время",
        try_limit:3
    }
        );
        
        functionList.push(
            {type:"function",
            function:{
                name: "run_javasctipt_code",
                description: "You can use this function to execute a javascript code. Use It any time you need to do calculations to ensure their accuraсy.",
                parameters: {
                    type: "object",
                    properties: {
                        javascript_code: {
                            type: "string",
                            description: "Text of javascript code. You code should output results to the console. Add console in the end."
                        }
                    },
                    required: ["javascript_code"]
                }
            },
            friendly_name:"Вычисления JS",
            try_limit:3      
        }
    );
        
        
        functionList.push(
            {type:"function",
            function:{
            name: "fetch_url_content",
            description: "Use this function to fetch content from a url.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                    type: "string",
                        description: `A single url as a string to fetch content from`
                    }
                },
            required: ["url"]
            }
        },
        friendly_name: "Прочитать гиперссылку",
        try_limit: 3 }
        );
        
        functionList.push(
            {type:"function",
            function:{
                name: "create_midjourney_image",
                description: "Use this function to create, modify or compile an image. If you are given a midjourney text prompt - you must use it exactly as is, otherwise generate your own text prompt from the user's request considering the context of the dialogue.",
                parameters: {
                    type: "object",
                    properties: {
                        midjourney_query: {
                            type: "string",
                            description: `A prompt for midjourney in english. You must use get_knowledge_base_item function for instructions and examples. Maximum length of the text prompt is 150 words. By default use model --v 6.1`
                        },
                    },
                    required: ["midjourney_query"]
                }
            },
            friendly_name: "Генерация изображения",
            try_limit: 3 }
            );

            const kngBaseItems = await mongo.getKwgItemsForUser(userClass.userid)
            functionList.push(
                {type:"function",
                function:{
                    name: "get_knowledge_base_item",
                    description: `Use this function when you need to get instructions to better perform on user's tasks on the following topics:\n ${JSON.stringify(kngBaseItems,null,4)}`,
                    parameters: {
                        type: "object",
                        properties: {
                            id: {
                                type: "string",
                                description: `id of a knowledge base item`
                            },
                        },
                        required: ["id"]
                    }
                },
                friendly_name: "Запрос в базу знаний",
                try_limit: 3 }
                );
        
        
        if (userClass.isAdmin) {
        
        //Функции для админа
        
        functionList.push(
            {type:"function",
            function:{
            name: "get_users_activity",
            description: `Use this function to report on this chatbot users' activity. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongo.mongooseVersion()}. One document represents one request of a user.`,
            parameters: {
                type: "object",
                properties: {
                    aggregate_pipeline: {
                        type: "string",
                        description: `Mongodb aggregate pipeline extracting info about users' activity from a mongodb collection.\n The collection has the following schema: ${JSON.stringify(scheemas.TokensLogSheema.obj)}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
                    }
                },
                required: ["aggregate_pipeline"]
            }
        },
        friendly_name: "Активность пользователей",
        try_limit: 3
        })
        
        functionList.push(
            {type:"function",
            function:{
            name: "get_chatbot_errors",
            description: `Use this function to report on this chatbot errors. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongo.mongooseVersion()}. One document represents one error.`,
            parameters: {
                type: "object",
                properties: {
                    aggregate_pipeline: {
                        type: "string",
                        description: `Mongodb aggregate pipeline extracting info about errors from a mongodb collection.\n The collection has the following schema: ${JSON.stringify(scheemas.LogsSheema.obj)}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
                    }
                },
                required: ["aggregate_pipeline"]
            }},
        friendly_name: "Cистемные ошибки R2D2",
        try_limit: 3})
        };
        
        
        //Завершаем. Если ни одной функции нет, то передаем null
        if (functionList.length===0){
            this.#available_tools = null;
            return null
        } else {
            this.#available_tools = functionList;
            return functionList
        }
        
        } else {
            this.#available_tools = null
            return null
        }
        };


};
    
module.exports = ToolCalls;