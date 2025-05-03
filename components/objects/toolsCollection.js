
const { timeout } = require("puppeteer");
const mongo = require("../mongo.js");
const scheemas = require("../mongo_Schemas.js");
const { queue } = require("sharp");

const list = [
    {
        type:"function",
        function:{
            name: "get_chatbot_errors",
            description: `Error: function description is absent. Run 'await this.addDescriptions()' function to get it.`,
            parameters: {
                type: "object",
                properties: {
                    aggregate_pipeline: {
                        type: "string",
                        description: `Error: function description is absent. Run 'await this.addDescriptions()' function to get it.`
                    }
                },
                required: ["aggregate_pipeline"]
            }
        },
        friendly_name: "Cистемные ошибки R2D2",
        timeout_ms:30000,
        try_limit: 3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin"],
        availableForToolCalls: true,
        depricated:false,
        
        addDescriptions: async function (){
            const mongooseVersion = mongo.mongooseVersion()
            const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
            this.function.description = `Use this function to report on this chatbot errors. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one error.`
            this.function.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about errors from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
        }
    },
    {
        type:"function",
        function:{
            name: "get_functions_usage",
            description: `Error: function description is absent. Run 'await this.addDescriptions()' function to get it.`,
            parameters: {
                type: "object",
                properties: {
                    aggregate_pipeline: {
                        type: "string",
                        description: `Error: function description is absent. Run 'await this.addDescriptions()' function to get it.`
                    }
                },
                required: ["aggregate_pipeline"]
            }
        },
        friendly_name: "Статистика вызова функций R2D2",
        timeout_ms:30000,
        try_limit: 3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin"],
        availableForToolCalls: true,
        depricated:false,
        addDescriptions: async function(){
            const mongooseVersion = mongo.mongooseVersion()
            const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
            this.function.description = `Use this function to report on this chatbot users' usage of functions. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one user's call of a function`
            this.function.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about users' usage of functions from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
        }
    },
    {
        type:"function",
        function:{
            name: "get_users_activity",
            description: `Error: function description is absent. Run 'await this.addDescriptions()' function to get it.`,
            parameters: {
                type: "object",
                properties: {
                    aggregate_pipeline: {
                        type: "string",
                        description: `Error: function description is absent. Run 'await this.addDescriptions()' function to get it.`
                    }
                },
                required: ["aggregate_pipeline"]
            }
        },
        friendly_name: "Статистика использования R2D2",
        timeout_ms:30000,
        try_limit: 3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin"],
        availableForToolCalls: true,
        depricated:false,
        addDescriptions: async function(){
            const mongooseVersion = mongo.mongooseVersion()
            const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
            this.function.description = `Use this function to report on this chatbot users' activity. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one request of a user.`
            this.function.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about users' activity from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
        }
    },
    {
        type:"function",
        function:{
            name: "get_knowledge_base_item",
            description: `Error: function description is absent. Run 'await this.addDescriptions()' function to get it.`,
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
        try_limit: 3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        addUserID: function(userid){
           return this.userid = userid
        },
        addDescriptions: async function(){
           
            const kngBaseItems = await mongo.getKwgItemsForUser(this.userid)
            this.function.description = `Use this function when you need to get instructions to better perform on user's tasks on the following topics:\n ${JSON.stringify(kngBaseItems,null,4)}`
        }
        },
        {
            type:"function",
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
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin"],
            availableForToolCalls: true,
            depricated:false
        },
        {
            type:"function",
            function:{
                name: "extract_text_from_file",
                description: `Extracts text from documents or images provided by user. This function usage is restricted to the following mime types: ${appsettings.file_options.allowed_mime_types.join(', ')}.`,
                parameters: {
                    type: "object",
                    properties: {
                        resources:{
                            type: "string",
                            description: `List of fileid numbers for extraction separated by commas. Images that represent the same document should be included in one tool call. Example: 3356,4567,4567. Documents are processd in the order they are provided in the list.`
                        }
                    },
                    required: ["resources"]
                }
            },
            friendly_name: "Чтение документа",
            timeout_ms:60000,
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: true,
            depricated:false
        },
        {
            type:"function",
            function:{
                name: "create_midjourney_image",
                description: "Create an image with Midjourney service. ",
                parameters: {
                    type: "object",
                    properties: {
                        textprompt: {
                            type: "string",
                            description: `A text prompt for midjourney in english. You must use get_knowledge_base_item function for instructions and examples. If you are given a midjourney text prompt - you must use it exactly AS IS. To embed text into the image it should be put into double quotes`
                        },
                        aspectratio: {
                            type: "string",
                            description: `Defines the width-to-height ratio of the generated image and can be expressed both in pixels (e.g., 1500px × 2400px) or in abstract values (e.g., 5:4). Prioritise the presentation asked by the user. Use ratio to align with the style and purpose of the image.`
                        },
                        no: {
                            type: "string",
                            description: `You must use this param when you are asked to exclude particular elements from the image. Accepts both one and multiple words. Multiple words should be separated with commas. Example: flowers, tooth, river`
                        },
                        version: {
                            type: "string", 
                            description: `Version of Midjourney to be used. Restrictred to the list of: 6.1, 5.2, 5.1, 5.0, 4a, 4b, 4c.`
                        },
                        imageprompt: {
                            type: "string",
                            description: `Influence the composition, style, and color of the generated image. Images should have full public url. Urls may include parameters. More then one image url can be user separated by commas. If you are asked to modify an image, you must use its url as a reference image for a new generation.`
                        },
                        imageweight: {
                            type: "number",
                            description: `Weight of the imageprompt vs. textprompt. Value can be from 0 to 3. For example: 0.5, 1.75, 2, 2.5. Higher value means the image prompt will have more impact on the generated image. Imageweight must be used only along with imageprompt parameter. Default value is 1.`
                        }
                    },
                    required: ["textprompt"]
                }
            },
            friendly_name: "Генерация изображения",
            timeout_ms:180000,
            long_wait_notes: [
                {time_ms:60000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
                {time_ms:90000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
                {time_ms:120000,comment:"Совсем никуда не годится!😤 Но надо дать еще шанс!"},
                {time_ms:150000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
            ],
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: true,
            depricated:false,
            queue_name:"midjourney"

        },
        {
            type:"function",
            function:{
                name: "imagine_midjourney",
                description: "Creates an image with Midjourney service based on user-provided prompt. ",
                parameters: {
                    type: "object",
                    properties: {
                        prompt: {
                            type: "string",
                            description: `Full-fetched prompt for midjourney in english provided by user.`
                        }
                    },
                    required: ["prompt"]
                }
            },
            friendly_name: "Генерация изображения",
            timeout_ms:180000,
            long_wait_notes: [
                {time_ms:60000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
                {time_ms:90000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
                {time_ms:120000,comment:"Совсем никуда не годится!😤 Но надо дать еще шанс!"},
                {time_ms:150000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
            ],
            try_limit: 3,
            availableInRegimes: ["chat","translator","texteditor"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: false,
            depricated:false,
            queue_name:"midjourney"
            
        },
        {
            type:"function",
            function:{
                name: "custom_midjourney",
                description: "Sends a request to to Midjourney for a custom action, triggered by a button pushed.",
                parameters: {
                    type: "object",
                    properties: {
                        buttonPushed: {
                            type: "string",
                            description: `Label of the button pushed by user.`
                        },
                        msgId: {
                            type: "string",
                            description: `Discord message id.`
                        },
                        customId: {
                            type: "string",
                            description: `Midjourney id of the request.`
                        },
                        content: {
                            type: "string",
                            description: `Prompt of the request.`
                        },
                        flags: {
                            type: "number",
                            description: `Midjourney flags.`
                        },
                    },
                    required: ["buttonPushed","msgId","customId","content","flags"]
                }
            },
            friendly_name: "Команда Midjourney",
            timeout_ms:180000,
            long_wait_notes: [
                {time_ms:30000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
                {time_ms:60000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
                {time_ms:90000,comment:"Хм ... 🤔 А вот это уже звоночек ... "},
                {time_ms:120000,comment:"Совсем никуда не годится!😤 Но надо дать еще шанс!"},
                {time_ms:150000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
            ],
            try_limit: 3,
            availableInRegimes: ["chat","translator","texteditor"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: false,
            depricated:false,
            queue_name:"midjourney"
        },
        {
            type:"function",
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
                {time_ms:20000,comment:"Хм ... 🤔 А вот это уже звоночек ... "},
                {time_ms:30000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 15 секунд и выключаем ..."}
            ],
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: true,
            depricated:false
    },
    {
        type:"function",
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
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false 
    },
    {
        type:"function",
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
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:true
    },
    {
        type:"function",
        function:{
            name: "generate_pdf_file",
            description: "Generates a PDF file. The file will be sent to the user as a document.",
            parameters: {
                type: "object",
                properties: {
                    htmltext: {
                        type: "string",
                        description: "Content for the file in html format. Table borders should be single. Images should have full public url. Urls to images should be in the format: <img src='https://example.com/image.png'/>. Urls may include parameters. Inline css sluses should be in the format: <div style='color:red;'>text</div>.",
                    },
                    filename:{
                        type:"string",
                        description:"Name of the file. Must align with the content of the file. For example, if the file contains a peace of python code, file name should have extention '.py'."
                    }
                },
                required: ["filename","htmltext"]
            }

        },
        friendly_name:"Создание PDF",
        timeout_ms:45000,
        try_limit:3,
        long_wait_notes: [
            {time_ms:15000,comment:"Если в файле должно быть изобраюение, то обычно требуется больше времени. Подождем ... ☕️"},
            {time_ms:30000,comment:"Похоже, файл действительно болшой. Подождем еще немного ... Но если через 15 секунд не закончит, то придется отменить."},
        ],
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false
    },
    {type:"function",
        function:{
            name: "generate_text_file",
            description: "Generates a text file. The file will be sent to the user as a document.",
            parameters: {
                type: "object",
                properties: {
                    filetext: {
                        type: "string",
                        description: "Text to be saved in the file."
                    },
                    filename:{
                        type:"string",
                        description:"Name of the file. Must align with the content of the file. For example, if the file contains a peace of python code, file name should have extention '.py'."
                    },
                    mimetype:{
                        type:"string",
                        description:"Mimetype of the file. For example, 'text/plain' or text/x-python."
                    },
                },
                required: ["filename","mimetype","text"]
            }

        },
        friendly_name:"Создание текстового файла",
        timeout_ms:15000,
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false
    },
    {
        type:"function",
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
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        queue_name:"test"
    }
]

const queueConfig = {
    "midjourney":{
        max_concurrent: 2,
        timeout_ms: 180000,
        interval_ms: 3000
    },
    "test":{
        max_concurrent: 3,
        timeout_ms: 30000,
        interval_ms: 3000
    }
};

async function getAvailableTools(userClass){

    const toolsList = list || [];

    let availableForToolCalls =  toolsList.filter((tool) => { 

        const availableForGroups = tool.availableForGroups || [];
        const userGroups = userClass.groups || [];
        const isInGroup = userGroups.some(group => availableForGroups.includes(group))

        return tool.availableInRegimes.includes(userClass.currentRegime) 
            && !tool.depricated
            && isInGroup
    })
    
    for (const tool of availableForToolCalls) {
        tool.addUserID  &&  tool.addUserID(userClass.userid)
        tool.addDescriptions && await tool.addDescriptions()
    }

    return availableForToolCalls;
}

async function getAvailableToolsForCompletion(userClass){
    const availableForToolCalls = await getAvailableTools(userClass)
    return availableForToolCalls.filter((tool) => tool.availableForToolCalls).map((tool) => ({ type:tool.type, function:tool.function}));
}

async function toolConfigByFunctionName(functionName,userClass){
    const availableForToolCalls = await getAvailableTools(userClass)
    return availableForToolCalls.find(doc => doc.function?.name === functionName);
}

module.exports = {
    getAvailableToolsForCompletion,
    toolConfigByFunctionName,
    queueConfig
}