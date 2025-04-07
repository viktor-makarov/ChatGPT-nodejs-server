const modelConfig = require("../../config/modelConfig");
const mongo = require("../mongo");
const scheemas = require("../mongo_Schemas.js");

const FunctionCall  = require("./FunctionCall.js");

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


    constructor(obj) {
     this.#replyMsg = obj.replyMsgInstance;
     this.#user = obj.userInstance;
     this.#requestMsg = obj.requestMsgInstance;
     this.#dialogue = obj.dialogueInstance
     
     this.#tokenFetchLimitPcs = (appsettings?.functions_options?.fetch_text_limit_pcs ? appsettings?.functions_options?.fetch_text_limit_pcs : 80)/100
     this.#overalTokenLimit = this.#user?.currentModel ? modelConfig[this.#user.currentModel]?.request_length_limit_in_tokens : null
    
    }

toolConfigByFunctionName(functionName){
        return this.#available_tools.find(doc => doc.function?.name === functionName);
    }



set tool_calls(value){
    this.#toolCalls = value
}

get tool_choice(){
    return this.#tool_choice
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
        
        let toolCallResult = {
            tool_call_id:toolCall.id,
            tool_call_type:toolCall.type,
            function_name:toolCall?.function?.name,
            functionFriendlyName: toolConfig.friendly_name
        };

        if(toolCall.type = "function"){
 
            const functionCall = new FunctionCall({
                functionCall:toolCall,
                replyMsgInstance:this.#replyMsg,
                dialogueInstance:this.#dialogue,
                userInstance:this.#user,
                functionConfig:toolConfig,
                tokensLimitPerCall:tokensLimitPerCall
            });

            let outcome = await functionCall.router()

   
            toolCallResult.content = JSON.stringify(outcome)
            toolCallResult.success = outcome.success
            toolCallResult.duration = outcome.duration;
                           
        } else {
            const outcome = {success:0,error:"Non-function types cannot be processed for now.",instructions:"Rework into a function"}
            toolCallResult.content = JSON.stringify(outcome)
            toolCallResult.success = outcome.success
        }
               
        
        await mongo.insertFunctionUsagePromise({
            userInstance:this.#user,
            tool_function:toolCallResult.function_name,
            tool_reply:toolCallResult,
            call_duration:toolCallResult.duration,
            call_number:`${index}/${toolCallsPromiseList.length}`,
            success:toolCallResult.success
        })

        return toolCallResult
    })

        
        const results = await Promise.all(toolCallsPromiseList)
        
        await this.#dialogue.commitToolCallResults({
            userInstance:this.#user,
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
        friendly_name:"Дата и время",
        timeout_ms:15000,
        try_limit:3
    }
        );
      /*  
        functionList.push(
            {type:"function",
            function:{
                name: "run_javasctipt_code",
                description: "You can use this function to execute a javascript code. Use this every time you need to do calculations to ensure their accuraсy.",
                parameters: {
                    type: "object",
                    properties: {
                        javascript_code: {
                            type: "string",
                            description: "Text of javascript code. In the code you must output results to the console."
                        }
                    },
                    required: ["javascript_code"]
                }
            },
            friendly_name:"Вычисления JavaScript",
            timeout_ms:30000,
            try_limit:3      
        }
    );*/

    functionList.push(
        {type:"function",
        function:{
            name: "run_python_code",
            description: "You can use this function to execute a python code. Use this every time you need to do calculations to ensure their accuraсy.",
            parameters: {
                type: "object",
                properties: {
                    python_code: {
                        type: "string",
                        description: "Text of python code. In the code you must print the results to the console. Use syntax compatible with python 3.12. But you can use oly the following additional modules pandas, openpyxl, regex, PyPDF2 and python-docx."
                    }
                },
                required: ["python_code"]
            }
        },
        friendly_name:"Вычисления Python",
        timeout_ms:30000,
        try_limit:3      
    }
);
        
        
        functionList.push(
            {type:"function",
            function:{
            name: "fetch_url_content",
            description: "Use this function to fetch content from a url. Returns html.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                    type: "string",
                        description: `A single url as a string to fetch content from.`
                    }
                },
            required: ["url"]
            }
        },
        friendly_name: "Чтение гиперссылки",
        timeout_ms:45000,
        long_wait_notes: [
            {time_ms:10000,comment:"Иногда нужно больше времени. Подождем ... ☕️"},
            {time_ms:20000,comment:"Хм ... 🤔 А вот это уже звоночек ... ",cancel_button:true},
            {time_ms:30000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 15 секунд и выключаем ...",cancel_button:true}
        ],
        try_limit: 3 }
        );
        
        functionList.push(
            {type:"function",
            function:{
                name: "create_midjourney_image",
                description: "Use this function to create, modify or compile an image with Midjourney service. If you are given a midjourney text prompt - you must use it exactly AS IS, otherwise generate your own text prompt from the user's request considering the context of the dialogue.",
                parameters: {
                    type: "object",
                    properties: {
                        midjourney_query: {
                            type: "string",
                            description: `A prompt for midjourney in english. You must use get_knowledge_base_item function for instructions and examples. Maximum length of the text prompt is 150 words.`
                        },
                    },
                    required: ["midjourney_query"]
                }
            },
            friendly_name: "Генерация изображения",
            timeout_ms:180000,
            long_wait_notes: [
                {time_ms:30000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
                {time_ms:60000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
                {time_ms:90000,comment:"Хм ... 🤔 А вот это уже звоночек ... "},
                {time_ms:120000,comment:"Совсем никуда не годится!😤 Но надо дать еще шанс!"},
                {time_ms:150000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
            ],
            try_limit: 3 }
            );

        functionList.push(
            {type:"function",
            function:{
                name: "extract_text_from_file",
                description: `Use this function to extract text from documents or images provided by user. The list of file mine types for which this function can be used is as follows: ${appsettings.file_options.allowed_mime_types.join(', ')}. Text extracted from the resources array is added to the output text in the order resources occur in the parameter. `,
                parameters: {
                    type: "object",
                    properties: {
                        resources:{
                            type: "string",
                            description: `Fileids for extraction separated by commas. Example: 3356,4567,4567"`
                        }
                    },
                    required: ["resources"]
                }
            },
            friendly_name: "Чтение текстового документа",
            timeout_ms:60000,
            try_limit: 3 }
            );

        functionList.push(
            {type:"function",
            function:{
                name: "get_user_guide",
                description: `Use this function when you are asked about functionality of the R2D2 bot.`,
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            friendly_name: "Чтение инструкции",
            timeout_ms:30000,
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
            timeout_ms:30000,
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
        friendly_name: "Статистика использования R2D2",
        timeout_ms:30000,
        try_limit: 3
        })


        functionList.push(
            {type:"function",
            function:{
            name: "get_functions_usage",
            description: `Use this function to report on this chatbot users' usage of functions. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongo.mongooseVersion()}. One document represents one user's call of a function`,
            parameters: {
                type: "object",
                properties: {
                    aggregate_pipeline: {
                        type: "string",
                        description: `Mongodb aggregate pipeline extracting info about users' usage of functions from a mongodb collection.\n The collection has the following schema: ${JSON.stringify(scheemas.FunctionUsageLogSheema.obj)}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
                    }
                },
                required: ["aggregate_pipeline"]
            }
        },
        friendly_name: "Статистика вызова функций R2D2",
        timeout_ms:30000,
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
        timeout_ms:30000,
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