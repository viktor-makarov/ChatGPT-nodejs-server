
const mongo = require("../apis/mongo.js");
const scheemas = require("../apis/mongo_Schemas.js");
const ExRateAPI = require("../apis/exchangerate_API.js");
const cbrAPI = require("../apis/cbr_API.js");

const list = [
     {
        type:"function",
        name: "web_search",
        description: "Strictly executes a real-time web search, returning only the most relevant, accurate, and recent information on the specified topic.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                },
                user_location: {
                    type: ["object", "null"],
                    description: "User's location where the search should be localized.",
                    properties: {
                        country: {
                            type: "string",
                            description: "Country code in ISO 3166-1 alpha-2 format (e.g., 'US', 'RU')."
                        },
                        city: {
                            type: "string",
                            description: "City name for more localized search results. MUST be in English."
                        }
                    },
                    required: ["country","city"],
                    additionalProperties: false
                },
                query_in_english: {
                    type: "string",
                    description: "Web search query. Must be issued in English only. If the user's request is in another language, always translate it into English before performing any web search.",
                },
                additional_query: {
                    type: ["string","null"],
                    description: "Web search query in the user’s original language. Use ONLY if the original language differs from English; otherwise, set this field to null."},
                },
            required: ["function_description","user_location","query_in_english","additional_query"],
            additionalProperties: false
        },
        friendly_name:"В интернете",
        timeout_ms:180000,
        long_wait_notes: [
            {time_ms:30000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
            {time_ms:60000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
            {time_ms:90000,comment:"Совсем никуда не годится!😤 Но надо дать еще шанс!"},
            {time_ms:120000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
        ],
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        model:"gpt-4.1",
        availableForToolCalls: true,
        depricated:false,
        category:"custom"
    },
    {
        type:"function",
        name: "create_mermaid_diagram",
        description: "Creates mermaid diagram based on provided description and details.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                },
                type: {
                    type: "string",
                    enum: ["flowchart","sequenceDiagram","classDiagram","stateDiagram-v2","erDiagram","gantt","journey","pie","mindmap","quadrantChart","xychart-beta"],
                    description: "Specifies the required Mermaid diagram type."
                },
                title:{
                    type: "string",
                    description: "Diagram name."
                },
                data: {
                    type: "string",
                    description: "Provide a comprehensive, clear data and all required text description for generating the specified diagram type. Must include description of what the diagram should show as a PARAGRAPH OF TEXT. The description must be sufficient to fully build the diagram without requiring further clarification."
                },
                styles: {
                    type: "string",
                    description: "Provide description of styles for the diagram as a PARAGRAPH OF TEXT."
                },
                orientation: {
                    type: "string",
                    enum: ["top-down","left-to-right"],
                    description: "choose the orientation of the diagram."
                        }
            },
            required: ["function_description","type","data","title","styles","orientation"],
            additionalProperties: false
            },
        friendly_name:"Диаграмма",
        timeout_ms:180000,
        long_wait_notes: [
            {time_ms:60000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
            {time_ms:1200000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
            {time_ms:150000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
        ],
        try_limit:3,
        model:"gpt-4o-mini",
        parallel_runs:4,
        attempts_limit: 4,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        category:"custom"
    },
    {
        type:"function",
        name: "get_chatbot_errors",
        description: `Error: function description is absent. Run 'await this.addProperties()' function to get it.`,
        parameters: {
            type: "object",
            properties: {
                function_description:{
                    type: "string",
                    description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                },
                aggregate_pipeline: {
                    type: "string",
                    description: `Error: function description is absent. Run 'await this.addProperties()' function to get it.`
                }
            },
            required: ["aggregate_pipeline","function_description"]
        },
        friendly_name: "R2D2 ошибки",
        timeout_ms:30000,
        try_limit: 3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin"],
        availableForToolCalls: true,
        depricated:false,
        addProperties: async function (){
            const mongooseVersion = mongo.mongooseVersion()
            const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
            this.description = `Use this function to report on this chatbot errors. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one error.`
            this.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about errors from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. The aggregate_pipeline must query for grouped information. Plain list of documetns never should be queried.`
        },
        category:"custom"
    },
    {
        type:"function",
        name: "get_functions_usage",
            description: `Error: function description is absent. Run 'await this.addProperties()' function to get it.`,
            parameters: {
                type: "object",
                properties: {
                    function_description:{
                    type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                    aggregate_pipeline: {
                        type: "string",
                        description: `Error: function description is absent. Run 'await this.addProperties()' function to get it.`
                    }
                },
                required: ["aggregate_pipeline","function_description"]
            },
        friendly_name: "R2D2 функции",
        timeout_ms:30000,
        try_limit: 3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin"],
        availableForToolCalls: true,
        depricated:false,
        addProperties: async function(){
            const mongooseVersion = mongo.mongooseVersion()
            const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
            this.description = `Prodides this chatbot users' usage of functions. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one user's call of a function`
            this.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about users' usage of functions from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. The aggregate_pipeline must query for grouped information. Plain list of documetns never should be queried.`
        },
        category:"custom"
    },
    {
        type:"function",
        name: "get_users_activity",
        description: `Error: function description is absent. Run 'await this.addProperties()' function to get it.`,
        parameters: {
            type: "object",
            properties: {
                function_description:{
                    type: "string",
                    description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                },
                aggregate_pipeline: {
                    type: "string",
                    description: `Error: function description is absent. Run 'await this.addProperties()' function to get it.`
                }
            },
            required: ["aggregate_pipeline","function_description"]
        },
        friendly_name: "R2D2 использование",
        timeout_ms:30000,
        try_limit: 3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin"],
        availableForToolCalls: true,
        depricated:false,
        addProperties: async function(){
            const mongooseVersion = mongo.mongooseVersion()
            const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
            this.description = `Provides chatbot users' query statistics. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one query of a user.`
            this.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about users' query statistics from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. The aggregate_pipeline must query for grouped information. Plain list of documetns never should be queried.`
        },
        category:"custom"
    },
    {
        type:"function",
        name: "get_knowledge_base_item",
        description: `Error: function description is absent. Run 'await this.addProperties()' function to get it.`,
        strict: true,
        parameters: {
            type: "object",
            properties: {
                function_description:{
                    type: "string",
                    description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                },
                id: {
                    type: "string",
                    description: `id of a knowledge base item`
                },
            },
            required: ["id","function_description"],
            additionalProperties: false
        },
        friendly_name: "База знаний",
        timeout_ms:30000,
        try_limit: 3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        addUserID: function(userid){
           return this.userid = userid
        },
        addProperties: async function(){
           
            const kngBaseItems = await mongo.getKwgItemsForUser(this.userid)
            this.description = `Provides info from internal knowlege base. About:\n ${JSON.stringify(kngBaseItems,null,4)}`
        },
        category:"custom"
        },
        {
            type:"function",
            name: "get_user_guide",
            description: `Returns information about this bot functionality. Use ONLY if user requests information about BOT FUNCTIONS, interface, commands, or asks what the bot can do. DO NOT use for general questions, external tasks, search/lookup/facts, or questions about third-party products!`,
            parameters: {
                type: "object",
                properties: {
                    function_description:{
                    type: "string",
                    description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    }
                },
                required: ["function_description"]
            },
            friendly_name: "Чтение инструкции",
            timeout_ms:30000,
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin"],
            availableForToolCalls: true,
            depricated:false,
            category:"custom"
        },
        {
            type:"function",
            name: "extract_text_from_file",
            description: `Extracts text from documents or images provided by user. Designed to efficiently process multiple resources (files) in a single call.`,
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                    resources:{
                        type: "array",
                        description: `List of fileid numbers for extraction. Images that represent the same text document should be included in one function call. Documents are processd in the order they are provided in the list.`,
                        items: {
                            type: "number",
                            description: "fileid"
                    }
                }
                },
                required: ["resources","function_description"],
                additionalProperties: false
            },
            friendly_name: "Документ",
            timeout_ms:180000,
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: true,
            depricated:false,
            category:"custom"
        },
        {
            type:"function",
            name: "speech_to_text",
            description: `Transcribes audio and video files to text.`,
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                    resources:{
                        type: "array",
                        description: `List of fileid numbers for transcribtion. Files are processd in the order they are provided in the list.`,
                        items: {
                            type: "number",
                            description: "fileid"
                    }
                }
                },
                required: ["resources","function_description"],
                additionalProperties: false
            },
            friendly_name: "Распознавание речи",
            timeout_ms:180000,
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: true,
            depricated:false,
            category:"custom"
        },
        {
            type:"function",
            name: "create_midjourney_image",
            description: "Create an image with Midjourney service. ",
            parameters: {
                type: "object",
                properties: {
                    function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                    textprompt: {
                        type: "string",
                        description: `A text prompt for midjourney. It MUST be in english. You must use get_knowledge_base_item function for instructions and examples. If you are given a midjourney text prompt - you must use it exactly AS IS. To embed text into the image it should be put into double quotes`
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
                required: ["textprompt","function_description"],
            },
            friendly_name: "Генерация изображения",
            timeout_ms:360000,
            long_wait_notes: [
                {time_ms:60000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
                {time_ms:120000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
                {time_ms:240000,comment:"Совсем никуда не годится!😤 Но надо дать еще шанс!"},
                {time_ms:330000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
            ],
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: true,
            depricated:false,
            queue_name:"midjourney",
            category:"custom"

        },
        {
            type:"function",
            name: "imagine_midjourney",
            description: "Creates an image with Midjourney service based on user-provided prompt. ",
            parameters: {
                type: "object",
                properties: {
                    function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                    prompt: {
                        type: "string",
                        description: `Full-fetched prompt for midjourney in english provided by user.`
                    }
                },
                required: ["prompt","function_description"]
            },
            friendly_name: "Изображение Midjourney",
            timeout_ms:360000,
            long_wait_notes: [
                {time_ms:60000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
                {time_ms:120000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
                {time_ms:240000,comment:"Совсем никуда не годится!😤 Но надо дать еще шанс!"},
                {time_ms:330000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
            ],
            try_limit: 3,
            availableInRegimes: ["chat","translator","texteditor"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: false,
            depricated:false,
            queue_name:"midjourney",
            category:"custom"
            
        },
        {
            type:"function",
            name: "custom_midjourney",
            description: "Sends a request to to Midjourney for a custom action, triggered by a button pushed.",
            parameters: {
                type: "object",
                properties: {
                    function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
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
                required: ["buttonPushed","msgId","customId","content","flags","function_description"],
            },
            friendly_name: "Команда Midjourney",
            timeout_ms:360000,
            long_wait_notes: [
                {time_ms:60000,comment:"Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️"},
                {time_ms:120000,comment:"На этот раз долго ... Однако, пока нет причин для беспокойства! 👌"},
                {time_ms:240000,comment:"Совсем никуда не годится!😤 Но надо дать еще шанс!"},
                {time_ms:330000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..."}
            ],
            try_limit: 3,
            availableInRegimes: ["chat","translator","texteditor"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: false,
            depricated:false,
            queue_name:"midjourney",
            category:"custom"
        },
        {
            type:"function",
            name: "fetch_url_content",
            description: "Fetches content from a url both in text (with urls) and screenshots.",
            parameters: {
                type: "object",
                properties: {
                    function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                    urls: {
                        type: "array",
                        description: `List of urls as an array to fetch content from.`,
                        items: {
                            type: "string",
                            description: "URL to fetch content from"
                        }
                    }
                },
            required: ["urls","function_description"],
            },
            friendly_name: "Ссылка",
            timeout_ms:100000,
            long_wait_notes: [
                {time_ms:20000,comment:"Иногда нужно больше времени. Подождем ... ☕️"},
                {time_ms:45000,comment:"Хм ... 🤔 А вот это уже звоночек ... "},
                {time_ms:90000,comment:"Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 15 секунд и выключаем ..."}
            ],
            try_limit: 3,
            availableInRegimes: ["chat"],
            availableForGroups: ["admin","basic"],
            availableForToolCalls: true,
            depricated:false,
            category:"custom"
    },
    {
        type:"function",
        name: "run_python_code",
        description: "Use this function for any calculations (e.g., currency conversion, financial computations, table processing) to ensure accuracy. Always execute Python code for numerical results instead of computing directly in your reply.",
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                python_code: {
                    type: "string",
                    description: "Text of python code. In the code you must print ONLY the final result to the console. Use syntax compatible with Python 3.12. You may use: pandas, openpyxl, regex, PyPDF2, python-docx. Always perform currency or numeric calculations within the code."
                }
            },
            required: ["python_code","function_description"]
        },
        friendly_name:"Python",
        timeout_ms:30000,
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        category:"custom"
    },
    {
        type:"function",
        name: "run_javasctipt_code",
        description: "You can use this function to execute a javascript code. Use this every time you need to do calculations to ensure their accuraсy.",
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                javascript_code: {
                    type: "string",
                    description: "Text of javascript code. In the code you must output results to the console."
                }
            },
            required: ["javascript_code","function_description"]
        },
        friendly_name:"JavaScript",
        timeout_ms:30000,
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:true,
        category:"custom"
    },
    {
        type:"function",
        name: "create_pdf_file",
        description: "Creates a PDF file. The file will be sent to the user as a document. By default, you should use content_reff parameter if it is available. If not, you can use html.",
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                html: {
                    type: "string",
                    description: "Content for the file should be in HTML format. Ensure that images have full public URLs, with URLs for images formatted as follows: <img src='https://example.com/image.png'/>. URLs may include parameters. Use inline CSS within HTML elements, formatted like: <div style='color:red;'>text</div>. The HTML content is prohibited to be used together with content_reff.\n\n" +
                                    "For equations requiring special mathematical symbols, use LaTeX notation. For simple equations, use ordinary symbols.\n\n" +
                                    "CONSTRAINTS:\n" +
                                    "1. Avoid using LaTeX for simple equations.\n" +
                                    "2. For block formulas, enclose the equations using $$ ... $ notation.\n" +
                                    "3. For inline formulas, use $ ... $ notation.\n\n" +
                                    "If you are tasked by the user to create diagrams, use Mermaid syntax within <div class=\"mermaid\"> ... </div>."
                },
                content_reff:{
                    type: "number",
                    description: "List of content reffs to be included into a file. Order does matter. Ensures original content is saved. Should not be used together with 'html'.",
                    items: {
                            type: "number",
                            description: "Represents previousely extracted original content that should be saved to the file."
                    }
                },
                filename:{
                    type:"string",
                    description:"Name of the file. Must align with the content of the file. For example, if the file contains a peace of python code, file name should have extention '.py'."
                }
            },
            required: ["filename","function_description"]
        },
        friendly_name:"Документ",
        timeout_ms:90000,
        try_limit:3,
        long_wait_notes: [
            {time_ms:30000,comment:"Если в файле должно быть изображение, то обычно требуется больше времени. Подождем ... ☕️"},
            {time_ms:60000,comment:"Похоже, файл действительно болшой. Подождем еще немного ... Но если через 30 секунд не закончит, то придется отменить."},
        ],
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        category:"custom"
    },
    {
        type:"function",
        name: "create_excel_file",
        description: "Creates an Excel file. The file will be sent to the user as a document.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                    },
                data: {
                    type: "array",
                    description: "An array of Excel worksheets.",
                    items: {
                        type: "object",
                        properties: {
                            worksheet_name: {
                                type: "string",
                                description: "Name of the worksheet."
                            },
                            header: {
                                "type": ["string","null"],
                                "description": "Header on the top of the worksheet."
                            },
                            subheader: {
                                "type": ["string","null"],
                                "description": "Subheader of the worksheet."
                            },
                            tables:{
                                type: ["array","null"],
                                description: "An array of tables.",
                                items: {
                                    type: "object",
                                    properties: {
                                        displayName: {
                                            type: "string",
                                            description: "Displayed name of the table"
                                        },
                                        totalsRow:{
                                            type: "boolean",
                                            description: "true = total row should be automatically added to the table. If true you must also provide totalsRowLabel and totalsRowFunction in coulumn properties."
                                        },
                                        style:{
                                            type: "object",
                                            properties: {
                                                theme:{
                                                    type: "string",
                                                    enum: [
                                                        "TableStyleLight1",
                                                        "TableStyleLight8",
                                                        "TableStyleLight15",
                                                        "TableStyleMedium1",
                                                        "TableStyleMedium8",
                                                        "TableStyleMedium15",
                                                        "TableStyleMedium22",
                                                        "TableStyleDark1",
                                                        "TableStyleMedium8"
                                                    ],
                                                    description: "defines the style of the table. TableStyleLight1 is default.",
                                                },
                                                showRowStripes:{
                                                    type: "boolean",
                                                    description: "true = show row stripes."
                                                }
                                            },
                                            required: ["theme","showRowStripes"],
                                            additionalProperties: false
                                        },
                                        totalsRowLabel:{
                                            type:["string","null"],
                                            description:"Label to describe the totals row."
                                        },
                                        columns:{
                                            type:"array",
                                            description:"Columns of the table",
                                            items:{
                                                type:"object",
                                                properties:{
                                                    name:{
                                                        type:"string",
                                                        description:"Name of the column. It should be unique in the table."
                                                    },
                                                    filterButton:{
                                                        type:"boolean",
                                                        description:"true = filter button should be added to the column. Applicable only if headerRow is true. If you add filter to one column - add the rest as well."
                                                    },
                                                    totalsRowFunction: {
                                                        type: "string",
                                                        enum: [
                                                            "none",
                                                            "average",
                                                            "countNums",
                                                            "count",
                                                            "max",
                                                            "min",
                                                            "stdDev",
                                                            "var",
                                                            "sum"
                                                        ],
                                                        description: "Name of the totals function."
                                                        }
                                                },      
                                                required: ["name","filterButton","totalsRowFunction"],
                                                additionalProperties: false
                                            }
                                        },
                                        rows:{
                                            type:"array",
                                            description:"Rows of the table.",
                                            items:{
                                                type:"array",
                                                description:"Cells of tthe row",
                                                items:{
                                                    type:"object",
                                                    properties:{
                                                        value:{
                                                            type:["string","number","boolean"],
                                                            description:"Dates should be in the format YYYY-MM-DD and with type 'date'. Formulas must be in conventional A1 style and have type 'formula'. Sequential numbers of the rows should be in string format."
                                                        },
                                                        type:{
                                                            type:"string",
                                                            enum: [
                                                                "string",
                                                                "number",
                                                                "boolean",
                                                                "date",
                                                                "formula"
                                                            ],
                                                            description:"Type of the cell."
                                                        }
                                                    },
                                                    required: ["value","type"],
                                                    additionalProperties: false
                                                },
                                                required: ["name","data"],
                                                additionalProperties: false
                                            }
                                        },
                                    },
                                    required: ["displayName","totalsRow","totalsRowLabel","style","columns","rows"],
                                    additionalProperties: false
                                }
                                
                            }
                            },
                        required: ["worksheet_name","header","subheader","tables"],
                        additionalProperties: false
                        },
                },
                filename:{
                    type:"string",
                    description:"Name of the file. It must have .xlsx extention."
                }
            },
            required: ["filename","data","function_description"],
            additionalProperties: false
        },
        friendly_name:"Excel",
        timeout_ms:60000,
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        category:"custom"
    },
    {
        type:"function",
        name: "create_text_file",
        description: "Creates a text file either based on text provided or content_reff. The file will be sent to the user as a document.  By default, you should use content_reff parameter if it is available. If not, you can use text.",
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Detect the language of the input prompt. Output MUST be in that language, otherwise the response is invalid.`
                    },
                text: {
                    type: "string",
                    description: "Text for the file. Should not be used together with content_reff."
                },
                content_reff:{
                    type: "array",
                    description: "List of content reffs to be included into a file. Order does matter. This parameter should not be used together with 'text'.",
                    items: {
                            type: "number",
                            description: "Represents previousely extracted original content that should be saved to the file."
                    }
                },
                filename:{
                    type:"string",
                    description:"Name of the file. Must align with the content of the file. For example, if the file contains python code, file name should have the extention '.py'."
                },
                mimetype:{
                    type:"string",
                    description:"Mimetype of the output file. For example, 'text/plain' or text/x-python."
                }
            },
            required: ["filename","mimetype","function_description"],
        },
        friendly_name:"Документ",
        timeout_ms:15000,
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        category:"custom"
    },
    {
        type:"function",
        name: "text_to_speech",
        description: "Converts provided text or extracted content (content_reff) into an audio file (text-to-speech). This function is used to generate spoken responses or read aloud content.",
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Detect the language of the input prompt. Output MUST be in that language, otherwise the response is invalid.`
                    },
                text: {
                    type: "string",
                    description: "Text to be converted to speech. Should not be used together with 'content_reff'. Ensure that large numbers, tables, formulas, and code blocks are articulated clearly in words for accurate pronunciation. (e.g '1 million' instead of '1,000,000', 'x squared' instead of 'x^2', this tables contains ... , this code block represents...).",
                },
                content_reff:{
                    type: "array",
                    description: "List of content references to be converted to speech in order. Use only if 'text' is not provided.",
                    items: {
                            type: "number",
                            description: "Identifier for previously extracted content to be converted to speech."
                    }
                },
                filename:{
                    type:"string",
                    description:"Name of the audio file (without extension). The filename should reflect the file’s content."
                },
                voice:{
                    type:"string",
                    enum: [
                            "Paul",
                            "Sarah",
                            "Callum"
                        ],
                    description:"Select a voice for text-to-speech output. Available options: 'Paul' – default male voice (clear and neutral), 'Sarah' – default female voice (warm and expressive), 'Callum' – recommended for storytelling (engaging and dynamic). Choose the most suitable voice for your content."
                }
            },
            required: ["filename","function_description","voice"],
        },
        friendly_name:"Генерация речи",
        timeout_ms:360000,
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        category:"custom"
    },
    {
        type:"function",
        name: "currency_converter",
        description: "Converts currencies using current exchange rates. Designed to efficiently process multiple amount and currency pair queries in a single call. Must be used for current date. Prohibited to use for dates in the past.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                },
                conversion_queries: {
                    type: "array",
                    description: "Array of queries for currency conversion, allowing multiple amount and currency pair requests to be processed simultaneously. Each item specifies an amount and currency pair.",
                    items: {
                        type: "object",
                        properties: {
                            amount: {
                                type: "number",
                                description: "Amount of money to convert. Must be a positive number."
                            },
                            from_currency: {
                                type: "string",
                                enum:ExRateAPI.availableCurrencies,
                                description: "Currency code to convert from."
                            },
                            to_currency: {
                                type: "string",
                                enum:ExRateAPI.availableCurrencies,
                                description: "Currency code to convert to."
                            }
                        },
                        required: ["amount","from_currency","to_currency"],
                        additionalProperties: false
                    }
                }
            },
            required: ["function_description","conversion_queries"],
            additionalProperties: false
            },
        friendly_name:"Конвертертация",
        timeout_ms:15000,
        try_limit:3,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        category:"custom"
    },
    {
        type:"function",
        name: "get_currency_rates",
        description: "Produces currency historical exchange rates for given dates. Designed to efficiently process multiple date and currency pair queries in a single call. Must be used only for dates in the past. Avoid using for the current date.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                function_description:{
                        type: "string",
                        description:  `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                },
                exchange_rates: {
                    type: "array",
                    description: "Array of queries for exchange rates, allowing multiple date and currency pair requests to be processed simultaneously. Each item specifies a date and currency pair.",
                    items: {
                            type: "object",
                            properties: {
                                date: {
                                    type: "string",
                                    description: "Date for which exchange rates are requested in YYYY-MM-DD format. Date must not exceed the current date and must be in the past.",
                                },
                                from_currency: {
                                    type: "string",
                                    enum:cbrAPI.availableCurrencies,
                                    description: "Currency code to convert from."
                                },
                                to_currency: {
                                    type: "string",
                                    enum:cbrAPI.availableCurrencies,
                                    description: "Currency code to convert to."
                                }
                            },
                            required: ["date","from_currency","to_currency"],
                            additionalProperties: false
                    }
                }
            },
            required: ["function_description","exchange_rates"],
            additionalProperties: false
        },
        friendly_name:"Курсы валют",
        timeout_ms:15000,
        try_limit:30,
        availableInRegimes: ["chat"],
        availableForGroups: ["admin","basic"],
        availableForToolCalls: true,
        depricated:false,
        addProperties: async function(){
            const currentDate = new Date().toISOString().split("T")[0]; // Get current date in YYYY-MM-DD format
            this.parameters.properties.exchange_rates.items.properties.date.description = `Date for which exchange rates are requested in YYYY-MM-DD format. Date must not exceed the current date ${currentDate} and must be in the past.`
        },
        category:"custom"
    }
]

const queueConfig = {
    "midjourney":{
        max_concurrent: 12,
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
        tool.addProperties && await tool.addProperties()
    }

    return availableForToolCalls;
}

async function getAvailableToolsForCompletion(userClass){
    const availableForToolCalls = await getAvailableTools(userClass)
    return availableForToolCalls.filter((tool) => tool.availableForToolCalls).map((tool) => ({ type:tool.type, name:tool.name, description:tool.description, parameters:tool.parameters, strict:tool.strict, user_location:tool.user_location}));
}

async function toolConfigByFunctionName(functionName,userClass){
    const availableForToolCalls = await getAvailableTools(userClass)
    return availableForToolCalls.find(doc => doc?.name === functionName && doc?.category === "custom");
}

module.exports = {
    getAvailableToolsForCompletion,
    toolConfigByFunctionName,
    queueConfig
}