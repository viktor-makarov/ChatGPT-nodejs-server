const mongo = require("../apis/mongo.js");
const scheemas = require("../apis/mongo_Schemas.js");
const ExRateAPI = require("../apis/exchangerate_API.js");
const cbrAPI = require("../apis/cbr_API.js");

class AvailableTools {

#userClass;
#toolsList;
#queueConfig;

    constructor(userClass) {
        this.#userClass = userClass;
        this.#toolsList = [
            {
                type: "function",
                name: "manage_browser_tabs",
                description: "Manages between tabs.",
                parameters: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: ["switch_to_tab", "close_tab","go_back"],
                            description: `Action to perform on the browser tab. 'switch_to_tab' will switch to the tab with the specified tab_id, 'close_tab' will close the tab with the specified tab_id. go_back will return to previous state in history if it exists`
                        },
                        tab_id: {
                            type: ["string","null"],
                            description: "ID of the browser tab to manage."
                        }
                    },
                    required: ["tab_id", "action"]
                },
                friendly_name: "Вкладки браузера",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: [],
                availableForUserGroups: ["all"],
                availableForAgents: ["web_browser"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom"
            },
            {
                type: "computer_use_preview",
                display_width: 1024,
                display_height: 768,
                environment: "browser", // other possible values: "mac", "windows", "ubuntu"
                availableInRegimes: [],
                availableForUserGroups: ["all"],
                availableForAgents: ["web_browser"],
                availableForToolCalls: false,
                category: "hosted",
                deprecated: false
            },
            {
                type: "web_search_preview",
                availableInRegimes: ["chat"],
                availableForUserGroups: ["all"],
                availableForAgents: ["web_search","main"],
                availableForToolCalls: true,
                category: "hosted",
                deprecated: false
            },
            {
                type: "mcp",
                server_label: "deepwiki",
                server_description: "Deepwiki MCP server. Contains documentation info about popular github repositories",
                server_url: "https://mcp.deepwiki.com/mcp",
                require_approval: "never",
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                category: "hosted",
                deprecated: false,
                authHandle: function (userInstance) {

                    const mcpSessionId = userInstance.mcp?.auth?.[this.server_label]?.mcp_session_id
                    if (mcpSessionId) {
                        if(!this.headers) this.headers = {};
                        this.headers["mcp-session-id"] = mcpSessionId;
                    }
                }
            },
            {
                type: "mcp",
                server_label: "github",
                server_description: "GitHub Copilot MCP server. Provides access to GitHub's repositories.",
                server_url: "https://api.githubcopilot.com/mcp",
                allowed_tools:{
                    read_only: true
                },
                require_approval: "never",
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                category: "hosted",
                deprecated: false,
                authHandle: function (userInstance) {
                    const authToken = userInstance.mcp?.auth?.[this.server_label]?.token
                    if (authToken) {
                        this.authorization = authToken;
                    } else {
                        this.availableForToolCalls = false;
                    }

                    const mcpSessionId = userInstance.mcp?.auth?.[this.server_label]?.mcp_session_id
                    if (mcpSessionId) {
                        if(!this.headers) this.headers = {};
                        this.headers["mcp-session-id"] = mcpSessionId;
                    }
                }
            },
            {
                type: "mcp",
                server_label: "gmail",
                server_description: "Gmail mailbox connector. Provides access to Gmail's mailbox.",
                connector_id: "connector_gmail",
                allowed_tools:{
                    read_only: true
                },
                require_approval: "never",
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                category: "hosted",
                deprecated: false,
                authHandle: function (userInstance) {
                    const authToken = userInstance.mcp?.auth?.[this.server_label]?.token
                    if (authToken) {
                        this.authorization = authToken;
                    } else {
                        this.availableForToolCalls = false;
                    }
                }
            },
            {
                type: "image_generation",
                model: "gpt-image-1",
                moderation: "auto",
                partial_images: 3,
                output_compression: 100,
                output_format: "png",
                quality: "auto",
                size: "auto",
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                category: "hosted",
                deprecated: false,
                imageGenerationHook: function (image_choice) {
                    if (image_choice === "mdj") {
                        this.availableInRegimes = this.availableInRegimes.filter(regime => regime !== "chat");
                    }
                }
            },
            {
                type: "code_interpreter",
                container: {
                    type: "auto",
                    file_ids: []
                },
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                category: "hosted",
                deprecated: false,
                addFileIdsHook: async function(userid, agent){
                    const filesInStorage = await mongo.getOAIStorageFiles(userid, agent) || [];
                    if(filesInStorage.length === 0) {
                        return
                    }
                    const activeFields = filesInStorage.filter(file => file?.resourceData?.OAIStorage?.expires_at && file?.resourceData?.OAIStorage?.expires_at > new Date());
                    this.container.file_ids = activeFields.map(file => file?.resourceData?.OAIStorage?.fileId).filter(id => id);
                }
            },
            {
                type: "function",
                name: "web_search",
                description: "Strictly executes a real-time web search, returning only the most relevant, accurate, and recent information on the specified topic.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
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
                            required: ["country", "city"],
                            additionalProperties: false
                        },
                        query_in_english: {
                            type: "string",
                            description: "Web search query. Must be issued in English only. If the user's request is in another language, always translate it into English before performing any web search.",
                        },
                        additional_query: {
                            type: ["string", "null"],
                            description: "Web search query in the user's original language. Use ONLY if the original language differs from English; otherwise, set this field to null."
                        },
                    },
                    required: ["function_description", "user_location", "query_in_english", "additional_query"],
                    additionalProperties: false
                },
                friendly_name: "В интернете",
                timeout_ms: 180000,
                long_wait_notes: [
                    { time_ms: 30000, comment: "Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️" },
                    { time_ms: 60000, comment: "На этот раз долго ... Однако, пока нет причин для беспокойства! 👌" },
                    { time_ms: 90000, comment: "Совсем никуда не годится!😤 Но надо дать еще шанс!" },
                    { time_ms: 120000, comment: "Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..." }
                ],
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                model: "gpt-4.1",
                availableForToolCalls: false,
                deprecated: false,
                category: "custom"
            },
            {
                type: "function",
                name: "web_browser",
                description: "Uses computer call tool to open a web browser and click on the specified site in real time.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        site_name: {
                            type: "string",
                            description: `Name of the website to browse.`
                        },
                        url: {
                            type: "string",
                            description: "Url to browse around. Must be a valid URL. DO NOT include any query parameters as it leads to CAPTCHA"
                        },
                        task: {
                            type: "string",
                            description: "Task to perform in the browser. Must be a clear and concise description of what to do with the page."
                        },
                        result_criteria: {
                            type: "array",
                            description: `List of criteria against which the result must be evaluated.`,
                            items: {
                                type: "string",
                                description: "Criteria for evaluating the result"
                            }
                        },
                        users_language: {
                            type: "string",
                            description: "Language of the user in which he/she is communicating. E.g. Russian, English, etc."
                        }
                    },
                    required: ["function_description", "url", "task", "site_name", "result_criteria", "users_language"],
                    additionalProperties: false
                },
                friendly_name: "Обзор сайта",
                timeout_ms: 600_000,
                try_limit: 3,
                model: "computer-use-preview",
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: false,
                deprecated: false,
                category: "custom"
            },
            {
                type: "function",
                name: "create_mermaid_diagram",
                description: "Creates mermaid diagram based on provided description and details.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        type: {
                            type: "string",
                            enum: ["flowchart", "sequenceDiagram", "classDiagram", "stateDiagram-v2", "erDiagram", "gantt", "journey", "mindmap", "quadrantChart"],
                            description: "Specifies the required Mermaid diagram type."
                        },
                        title: {
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
                            enum: ["top-down", "left-to-right"],
                            description: "choose the orientation of the diagram."
                        }
                    },
                    required: ["function_description", "type", "data", "title", "styles", "orientation"],
                    additionalProperties: false
                },
                friendly_name: "Диаграмма",
                timeout_ms: 180000,
                long_wait_notes: [
                    { time_ms: 60000, comment: "Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️" },
                    { time_ms: 1200000, comment: "На этот раз долго ... Однако, пока нет причин для беспокойства! 👌" },
                    { time_ms: 150000, comment: "Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..." }
                ],
                try_limit: 3,
                model: "gpt-4o-mini",
                parallel_runs: 4,
                attempts_limit: 4,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom"
            },
            {
                type: "function",
                name: "get_chatbot_errors",
                description: `Error: function description is absent. Run 'await this.addPropertiesHook()' function to get it.`,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        aggregate_pipeline: {
                            type: "string",
                            description: `Error: function description is absent. Run 'await this.addPropertiesHook()' function to get it.`
                        }
                    },
                    required: ["aggregate_pipeline", "function_description"]
                },
                friendly_name: "R2D2 ошибки",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                addPropertiesHook: async function (){
                    const mongooseVersion = mongo.mongooseVersion()
                    const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
                    this.description = `Use this function to report on this chatbot errors. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one error.`
                    this.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about errors from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. The aggregate_pipeline must query for grouped information. Plain list of documetns never should be queried.`
                },
                category: "custom"
            },
            {
                type: "function",
                name: "get_functions_usage",
                description: `Error: function description is absent. Run 'await this.addPropertiesHook()' function to get it.`,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        aggregate_pipeline: {
                            type: "string",
                            description: `Error: function description is absent. Run 'await this.addPropertiesHook()' function to get it.`
                        }
                    },
                    required: ["aggregate_pipeline", "function_description"]
                },
                friendly_name: "R2D2 функции",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                addPropertiesHook: async function(){
                    const mongooseVersion = mongo.mongooseVersion()
                    const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
                    this.description = `Prodides this chatbot users' usage of functions. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one user's call of a function`
                    this.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about users' usage of functions from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. The aggregate_pipeline must query for grouped information. Plain list of documetns never should be queried.`
                },
                category: "custom"
            },
            {
                type: "function",
                name: "get_users_activity",
                description: `Error: function description is absent. Run 'await this.addPropertiesHook()' function to get it.`,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        aggregate_pipeline: {
                            type: "string",
                            description: `Error: function description is absent. Run 'await this.addPropertiesHook()' function to get it.`
                        }
                    },
                    required: ["aggregate_pipeline", "function_description"]
                },
                friendly_name: "R2D2 использование",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin"],
                availableForToolCalls: true,
                deprecated: false,
                addPropertiesHook: async function(){
                    const mongooseVersion = mongo.mongooseVersion()
                    const scheemaDescription = JSON.stringify(scheemas.TokensLogSheema.obj)
                    this.description = `Provides chatbot users' query statistics. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongooseVersion}. One document represents one query of a user.`
                    this.parameters.properties.aggregate_pipeline.description = `Mongodb aggregate pipeline extracting info about users' query statistics from a mongodb collection.\n The collection has the following schema: ${scheemaDescription}. The aggregate_pipeline must query for grouped information. Plain list of documetns never should be queried.`
                },
                category: "custom"
            },
            {
                type: "function",
                name: "get_knowledge_base_item",
                description: `Error: function description is absent. Run 'await this.addPropertiesHook()' function to get it.`,
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        id: {
                            type: "string",
                            description: `id of a knowledge base item`
                        },
                    },
                    required: ["id", "function_description"],
                    additionalProperties: false
                },
                friendly_name: "База знаний",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                addPropertiesHook: async function(userid){
                
                    const kngBaseItems = await mongo.getKwgItemsForUser(userid)
                    this.description = `Provides info from internal knowlege base. About:\n ${JSON.stringify(kngBaseItems,null,4)}`
                },
                category: "custom"
            },
            {
                type: "function",
                name: "get_user_guide",
                description: `Returns information about this bot functionality. Use ONLY if user requests information about BOT FUNCTIONS, interface, commands, or asks what the bot can do. DO NOT use for general questions, external tasks, search/lookup/facts, or questions about third-party products!`,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        }
                    },
                    required: ["function_description"]
                },
                friendly_name: "Чтение инструкции",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom"
            },
            {
                type: "function",
                name: "extract_content",
                description: `Extracts content from documents or images provided by user. Designed to efficiently process multiple resources in a single call.`,
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        resource_ids: {
                            type: "array",
                            description: `List of resource ids for extraction.`,
                            items: {
                                type: "number",
                                enum: [],
                                description: "fileid"
                            }
                        }
                    },
                    required: ["resource_ids", "function_description"],
                    additionalProperties: false
                },
                friendly_name: "Документ",
                timeout_ms: 180000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom",
                addResourcesHook: async function(userid, agent){
                    const resourcesToBeExtracted = await mongo.getNotExtractedResourcesShort(userid, agent);
                    if(resourcesToBeExtracted.length === 0) {
                        this.availableForToolCalls = false;
                        return
                    };
                    this.description = `Extracts content from documents or images provided by user. Designed to efficiently process multiple resources in a single call.\nThe folowing resources are available for extraction:\n${JSON.stringify(resourcesToBeExtracted,null,2)}.\n Refrain from using this function if the resources can be sufficiently understood through computer vision.`
                    this.parameters.properties.resource_ids.items.enum = resourcesToBeExtracted.map(resource => resource.resourceId)
                }
            },
            {
                type: "function",
                name: "create_midjourney_image",
                description: "Create an image with Midjourney service. ",
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
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
                    required: ["textprompt", "function_description"],
                },
                friendly_name: "Изображение Midjourney",
                timeout_ms: 360000,
                long_wait_notes: [
                    { time_ms: 60000, comment: "Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️" },
                    { time_ms: 120000, comment: "На этот раз долго ... Однако, пока нет причин для беспокойства! 👌" },
                    { time_ms: 240000, comment: "Совсем никуда не годится!😤 Но надо дать еще шанс!" },
                    { time_ms: 330000, comment: "Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..." }
                ],
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                queue_name: "midjourney",
                category: "custom",
                imageGenerationHook: function (image_choice) {
                    if (image_choice === "oai") {
                        this.availableInRegimes = this.availableInRegimes.filter(regime => regime !== "chat");
                    }
                }
            },
            {
                type: "function",
                name: "imagine_midjourney",
                description: "Creates an image with Midjourney service based on user-provided prompt. ",
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        prompt: {
                            type: "string",
                            description: `Full-fetched prompt for midjourney in english provided by user.`
                        }
                    },
                    required: ["prompt", "function_description"]
                },
                friendly_name: "Изображение Midjourney",
                timeout_ms: 360000,
                long_wait_notes: [
                    { time_ms: 60000, comment: "Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️" },
                    { time_ms: 120000, comment: "На этот раз долго ... Однако, пока нет причин для беспокойства! 👌" },
                    { time_ms: 240000, comment: "Совсем никуда не годится!😤 Но надо дать еще шанс!" },
                    { time_ms: 330000, comment: "Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..." }
                ],
                try_limit: 3,
                availableInRegimes: ["chat", "translator", "texteditor"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: false,
                deprecated: false,
                queue_name: "midjourney",
                category: "custom"
            },
            {
                type: "function",
                name: "custom_midjourney",
                description: "Sends a request to to Midjourney for a custom action, triggered by a button pushed.",
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
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
                    required: ["buttonPushed", "msgId", "customId", "content", "flags", "function_description"],
                },
                friendly_name: "Команда Midjourney",
                timeout_ms: 360000,
                long_wait_notes: [
                    { time_ms: 60000, comment: "Иногда нужно больше времени. Подождите, пожалуйста, ... ☕️" },
                    { time_ms: 120000, comment: "На этот раз долго ... Однако, пока нет причин для беспокойства! 👌" },
                    { time_ms: 240000, comment: "Совсем никуда не годится!😤 Но надо дать еще шанс!" },
                    { time_ms: 330000, comment: "Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 30 секунд и выключаем ..." }
                ],
                try_limit: 3,
                availableInRegimes: ["chat", "translator", "texteditor"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: false,
                deprecated: false,
                queue_name: "midjourney",
                category: "custom"
            },
            {
                type: "function",
                name: "fetch_url_content",
                description: "Fetches content from a url both in text (with urls) and screenshots.",
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
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
                    required: ["urls", "function_description"],
                },
                friendly_name: "Ссылка",
                timeout_ms: 90000,
                long_wait_notes: [
                    { time_ms: 30000, comment: "Это может занять время. Подождем ... ☕️" },
                    { time_ms: 50000, comment: "К сожалению, нужно больше времени... 🤔" },
                    { time_ms: 75000, comment: "Похоже, что-то пошло не так.🤷‍♂️ Ждем еще 15 секунд и выключаем ..." }
                ],
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom"
            },
            {
                type: "function",
                name: "run_python_code",
                description: "Use this function for any calculations (e.g., currency conversion, financial computations, table processing) to ensure accuracy. Always execute Python code for numerical results instead of computing directly in your reply.",
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        python_code: {
                            type: "string",
                            description: "Text of python code. In the code you must print ONLY the final result to the console. Use syntax compatible with Python 3.12. You may use: pandas, openpyxl, regex, PyPDF2, python-docx. Always perform currency or numeric calculations within the code."
                        }
                    },
                    required: ["python_code", "function_description"]
                },
                friendly_name: "Python",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: false,
                deprecated: true,
                category: "custom"
            },
            {
                type: "function",
                name: "run_javascript_code",
                description: "You can use this function to execute a javascript code. Use this every time you need to do calculations to ensure their accuraсy.",
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        javascript_code: {
                            type: "string",
                            description: "Text of javascript code. In the code you must output results to the console."
                        }
                    },
                    required: ["javascript_code", "function_description"]
                },
                friendly_name: "JavaScript",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: true,
                category: "custom"
            },
            {
                type: "function",
                name: "generate_document",
                description: "Generates a document from the specified content and delivers it to the user. This function can create a document from a single piece of content or compile a larger file by aggregating multiple pieces through consecutive function calls. Never shorten text and never add side-comments like: `To be continued in next part...` Ensure that only one document is produced per function call.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        filename: {
                            type: "string",
                            description: "File name with extention. Must be unique throughout the dialogue. Use the same file name when appending content to an existing file. Pdf document are prefered rather then plain text files. MS Office formats are not supported."
                        },
                        status: {
                            type: "string",
                            enum: ["completed","inprogress"],
                            description: "If 'inprogress' is provided, the content is temporally stored waitinf for next pieces of content. Once 'completed' status is provided, all the content from the temporary stogage togather with the current piece of content is compiled into a single document and sent to the user. If 'completed' status is provided without any prior 'inprogress' calls, a document is created from the current piece of content only."
                        },
                        content: {
                            type: "string",
                            description: `Document content in text or html format. For pdf documents html format is required.`,
                        }
                    },
                    required: ["filename", "function_description", "content","status"],
                    additionalProperties: false
                },
                friendly_name: "Создание документа",
                timeout_ms: 90000,
                try_limit: 3,
                long_wait_notes: [
                    { time_ms: 30000, comment: "Если в файле должно быть изображение, то обычно требуется больше времени. Подождем ... ☕️" },
                    { time_ms: 60000, comment: "Похоже, файл действительно болшой. Подождем еще немного ... Но если через 30 секунд не закончит, то придется отменить." },
                ],
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom"
                
            },
            {
                type: "function",
                name: "save_to_document",
                description: "Saves a document from the temporary storage of extracted resources 'as is' and sends to the user. Only one file is generated for each function call.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
                        },
                        resource_ids: {
                            type: "array",
                            description: `List of resource ids to be included into the document. In the order of occurance.`,
                            items: {
                                type: "number",
                                enum: [],
                                description: "fileid"
                            }
                        },
                        filename: {
                            type: "string",
                            description: "Name of the file with extension. MS Office formats are not supported."
                        }
                    },
                    required: ["filename", "function_description", "resource_ids"],
                    additionalProperties: false
                },
                friendly_name: "Сохранение в файл",
                timeout_ms: 90000,
                try_limit: 3,
                long_wait_notes: [
                    { time_ms: 30000, comment: "Если в файле должно быть изображение, то обычно требуется больше времени. Подождем ... ☕️" },
                    { time_ms: 60000, comment: "Похоже, файл действительно болшой. Подождем еще немного ... Но если через 30 секунд не закончит, то придется отменить." },
                ],
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom",
                addResourcesHook: async function(userid,agent){
                    const resourcesExtracted = await mongo.getExtractedResourcesShort(userid,agent)
                    if(resourcesExtracted.length === 0) {
                        this.availableForToolCalls = false;
                        return
                    }
                    this.description = `Creates a document and sends to the user from the temporary storage of resources. Only one file is generated for each function call.\nThe folowing resources in the temporary storage are available for saving:\n${JSON.stringify(resourcesExtracted,null,2)}`
                    this.parameters.properties.resource_ids.items.enum = resourcesExtracted.map(resource => resource.resourceId)
                }
            },
            {
                type: "function",
                name: "create_excel_file",
                description: "Creates an Excel file. The file will be sent to the user as a document.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
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
                                        "type": ["string", "null"],
                                        "description": "Header on the top of the worksheet."
                                    },
                                    subheader: {
                                        "type": ["string", "null"],
                                        "description": "Subheader of the worksheet."
                                    },
                                    tables: {
                                        type: ["array", "null"],
                                        description: "An array of tables.",
                                        items: {
                                            type: "object",
                                            properties: {
                                                displayName: {
                                                    type: "string",
                                                    description: "Displayed name of the table"
                                                },
                                                totalsRow: {
                                                    type: "boolean",
                                                    description: "true = total row should be automatically added to the table. If true you must also provide totalsRowLabel and totalsRowFunction in coulumn properties."
                                                },
                                                style: {
                                                    type: "object",
                                                    properties: {
                                                        theme: {
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
                                                        showRowStripes: {
                                                            type: "boolean",
                                                            description: "true = show row stripes."
                                                        }
                                                    },
                                                    required: ["theme", "showRowStripes"],
                                                    additionalProperties: false
                                                },
                                                totalsRowLabel: {
                                                    type: ["string", "null"],
                                                    description: "Label to describe the totals row."
                                                },
                                                columns: {
                                                    type: "array",
                                                    description: "Columns of the table",
                                                    items: {
                                                        type: "object",
                                                        properties: {
                                                            name: {
                                                                type: "string",
                                                                description: "Name of the column. It should be unique in the table."
                                                            },
                                                            filterButton: {
                                                                type: "boolean",
                                                                description: "true = filter button should be added to the column. Applicable only if headerRow is true. If you add filter to one column - add the rest as well."
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
                                                        required: ["name", "filterButton", "totalsRowFunction"],
                                                        additionalProperties: false
                                                    }
                                                },
                                                rows: {
                                                    type: "array",
                                                    description: "Rows of the table.",
                                                    items: {
                                                        type: "array",
                                                        description: "Cells of tthe row",
                                                        items: {
                                                            type: "object",
                                                            properties: {
                                                                value: {
                                                                    type: ["string", "number", "boolean"],
                                                                    description: "Dates should be in the format YYYY-MM-DD and with type 'date'. Formulas must be in conventional A1 style and have type 'formula'. Sequential numbers of the rows should be in string format."
                                                                },
                                                                type: {
                                                                    type: "string",
                                                                    enum: [
                                                                        "string",
                                                                        "number",
                                                                        "boolean",
                                                                        "date",
                                                                        "formula"
                                                                    ],
                                                                    description: "Type of the cell."
                                                                }
                                                            },
                                                            required: ["value", "type"],
                                                            additionalProperties: false
                                                        },
                                                        required: ["name", "data"],
                                                        additionalProperties: false
                                                    }
                                                },
                                            },
                                            required: ["displayName", "totalsRow", "totalsRowLabel", "style", "columns", "rows"],
                                            additionalProperties: false
                                        }

                                    }
                                },
                                required: ["worksheet_name", "header", "subheader", "tables"],
                                additionalProperties: false
                            },
                        },
                        filename: {
                            type: "string",
                            description: "Name of the file. It must have .xlsx extention."
                        }
                    },
                    required: ["filename", "data", "function_description"],
                    additionalProperties: false
                },
                friendly_name: "Excel",
                timeout_ms: 60000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom"
            },
            {
                type: "function",
                name: "text_to_speech",
                description: "Converts provided text into an audio file (text-to-speech). This function is used to generate spoken responses or read aloud content.",
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Detect the language of the input prompt. Output MUST be in that language, otherwise the response is invalid.`
                        },
                        text: {
                            type: "string",
                            description: "Text to be converted to speech. DO NOT use together with 'resource_ids'. Prepare the text for easy listening.",
                        },
                        filename: {
                            type: "string",
                            description: "Name of the audio file (without extension). The filename should reflect the file's content."
                        },
                        voice: {
                            type: "string",
                            enum: [
                                "Paul",
                                "Sarah",
                                "Callum"
                            ],
                            description: "Select a voice for text-to-speech output. Available options: 'Paul' – default male voice (clear and neutral), 'Sarah' – default female voice (warm and expressive), 'Callum' – recommended for storytelling (engaging and dynamic). Choose the most suitable voice for your content."
                        }
                    },
                    required: ["filename", "function_description", "voice","text"],
                },
                friendly_name: "Генерация речи",
                timeout_ms: 360000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom"
            },
            {
                type: "function",
                name: "currency_converter",
                description: "Converts currencies using current exchange rates. Designed to efficiently process multiple amount and currency pair queries in a single call. Must be used for current date. Prohibited to use for dates in the past.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
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
                                        enum: ExRateAPI.availableCurrencies,
                                        description: "Currency code to convert from."
                                    },
                                    to_currency: {
                                        type: "string",
                                        enum: ExRateAPI.availableCurrencies,
                                        description: "Currency code to convert to."
                                    }
                                },
                                required: ["amount", "from_currency", "to_currency"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["function_description", "conversion_queries"],
                    additionalProperties: false
                },
                friendly_name: "Конвертация",
                timeout_ms: 30000,
                try_limit: 3,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main","web_browser"],
                availableForToolCalls: true,
                deprecated: false,
                category: "custom"
            },
            {
                type: "function",
                name: "get_currency_rates",
                description: "Produces currency historical exchange rates for given dates. Designed to efficiently process multiple date and currency pair queries in a single call. Must be used only for dates in the past. Avoid using for the current date.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        function_description: {
                            type: "string",
                            description: `Provide a concise description of the requested action, using present tense and avoiding any mention of the user. Required: Output must be EXACTLY 5 words or fewer. Output language MUST exactly match the language of the input prompt.`
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
                                        enum: cbrAPI.availableCurrencies,
                                        description: "Currency code to convert from."
                                    },
                                    to_currency: {
                                        type: "string",
                                        enum: cbrAPI.availableCurrencies,
                                        description: "Currency code to convert to."
                                    }
                                },
                                required: ["date", "from_currency", "to_currency"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["function_description", "exchange_rates"],
                    additionalProperties: false
                },
                friendly_name: "Курсы валют",
                timeout_ms: 30000,
                try_limit: 30,
                availableInRegimes: ["chat"],
                availableForUserGroups: ["admin", "basic"],
                availableForAgents: ["main"],
                availableForToolCalls: true,
                deprecated: false,
                addPropertiesHook: async function(){
                    const currentDate = new Date().toISOString().split("T")[0]; // Get current date in YYYY-MM-DD format
                    this.parameters.properties.exchange_rates.items.properties.date.description = `Date for which exchange rates are requested in YYYY-MM-DD format. Date must not exceed the current date ${currentDate} and must be in the past.`
                },
                category: "custom"
            }
        ];
        this.#queueConfig = {
            "midjourney": {
                max_concurrent: 12,
                timeout_ms: 180000,
                interval_ms: 3000
            },
            "test": {
                max_concurrent: 3,
                timeout_ms: 30000,
                interval_ms: 3000
            }
        };

    }

    get toolsList() {
        return this.#toolsList;
    }

    queueConfig(queue_name) {
        return this.#queueConfig[queue_name] || {max_concurrent:3,timeout_ms:30000,interval_ms:3000};
    }

    // Главный метод для получения доступных инструментов
    async getToolsAvailableForUser(agent) {
        // Применяем все методы к инструментам
        
        for (const tool of this.#toolsList) {
            tool.addPropertiesHook && await tool.addPropertiesHook(this.#userClass.userid)
            tool.addResourcesHook && await tool.addResourcesHook(this.#userClass.userid, agent)
            tool.addFileIdsHook && await tool.addFileIdsHook(this.#userClass.userid, agent)
            tool.imageGenerationHook && tool.imageGenerationHook(this.#userClass.image_choice)
            tool.authHandle && tool.authHandle(this.#userClass);
        }

        // Фильтруем инструменты по группам и режимам пользователя
        const availableForToolCalls = this.#toolsList.filter((tool) => {
            const availableForUserGroups = tool.availableForUserGroups || [];
            const userGroups = [...(this.#userClass.groups || []), 'all'];
            const isInGroup = userGroups.some(group => availableForUserGroups.includes(group));

            return isInGroup;
        });
        return availableForToolCalls;
    }

    async getMCPToolsForCompletion(agent) {
        const toolsAvailableForCompletion = await this.getToolsAvailableForUser(agent);
        const mcpTools = toolsAvailableForCompletion.filter(tool => tool.type === "mcp" 
        && !tool.deprecated
        && tool.availableForToolCalls)
        return mcpTools.map((tool) => ({
            type: tool.type,
            server_label: tool.server_label,
            server_url: tool.server_url,
            server_description: tool.server_description,
            headers: tool.headers,
            authorization:tool.authorization,
            require_approval: tool.require_approval,
            allowed_tools: tool.allowed_tools
        }))
    }

    async getToolsAvailableForAgent(agent) {
        const toolsAvailableForUser = await this.getToolsAvailableForUser(agent);
        const toolsAvailableForAgent = toolsAvailableForUser
        .filter(tool => 
            tool.availableForAgents && 
            !tool.deprecated &&
            tool.availableForAgents.includes(agent)
        )
        .filter(tool => tool.type !== "mcp"); // Exclude MCP tools here
        return toolsAvailableForAgent.map((tool) => ({
            type: tool.type,
            name: tool.name,
            description: tool.description,
            display_width: tool.display_width,
            display_height: tool.display_height,
            environment: tool.environment,
            parameters: tool.parameters,
            strict: tool.strict,
            container: tool.container,
            output_format: tool.output_format,
            partial_images: tool.partial_images,
            output_compression: tool.output_compression,
            quality: tool.quality,
            size: tool.size,
            server_label: tool.server_label,
            server_url: tool.server_url,
            allowed_tools: tool.allowed_tools,
            server_description: tool.server_description,
            headers: tool.headers,
            require_approval: tool.require_approval
        }));
    };

    async getAvailableToolsForGroups(){
    }

    async getAvailableToolsForCompletion(agent) {
        const toolsAvailableForUser = await this.getToolsAvailableForUser(agent);

        const availableForToolCallsForCompletion = toolsAvailableForUser.filter((tool) => {
            return tool.availableInRegimes.includes(this.#userClass.currentRegime)
                && !tool.deprecated
                && tool.availableForToolCalls
        });

        //console.log("Available tools for completion:", JSON.stringify(availableForToolCallsForCompletion.filter(t => t.type === "mcp" && t.server_label ==="gmail"), null, 2));
        
       // console.log("Available tools for completion:", JSON.stringify(availableForToolCallsForCompletion.filter(t => t.type === "function" && t.name ==="text_to_speech"), null, 2));
        
        return availableForToolCallsForCompletion.map(({
            friendly_name,
            timeout_ms,
            try_limit,
            availableInRegimes,
            availableForUserGroups,
            availableForAgents,
            availableForToolCalls,
            deprecated,
            category,
            long_wait_notes,
            parallel_runs,
            attempts_limit,
            queue_name,
            imageGenerationHook,
            addFileIdsHook,
            addPropertiesHook,
            addResourcesHook,
            addHeadersHook,
            ...rest
        }) => rest);
    }

    // Метод для получения конфигурации инструмента по имени функции
    async toolConfigByFunctionName(functionName) {
        const toolsAvailableForUser = await this.getToolsAvailableForUser();
        return toolsAvailableForUser.find(doc => doc?.name === functionName && !doc.deprecated);
    }
}

module.exports = AvailableTools;
