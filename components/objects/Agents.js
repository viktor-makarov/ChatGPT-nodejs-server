const { model } = require("mongoose");
const devPrompts = require("../../config/developerPrompts.js");


class Agents {

    #buildInAgents;

    constructor() {
        this.#buildInAgents = [
            {
                id: "main",
                name_ru: "Основной диалог",
                name_en: "Main Dialogue",
                description: "Default agent",
                general_instructions_ru: "Напишите сообщение, чтобы начать новый диалог.",
                resetchat_instructions_ru: "Чтобы начать новый диалог, используйте /resetchat.",
                general_instructions_en: "Type a message to start a new dialogue.",
                resetchat_instructions_en: "To start a new dialogue, use /resetchat.",
                type: "built-in",
                model_modes: [
                    {
                        id: "fast",
                        ru_name: "Быстрый",
                        en_name: "Fast",
                        model: "gpt-5.1",
                        reasoning: {
                            effort: "none"
                        }
                    },
                    {
                        id: "clever",
                        ru_name: "Умный",
                        en_name: "Clever",
                        model: "gpt-5.1",
                        reasoning: {
                            effort: "high"
                        }
                    }
                ],
                tools: [
                    "hosted_web_search_preview",
                    "fn_web_search",
                    "hosted_mcp_deepwiki",
                    "hosted_mcp_github",
                    "hosted_mcp_gmail",
                    "hosted_image_generation",
                    "hosted_code_interpreter",
                    "fn_web_browser",
                    "fn_create_mermaid_diagram",
                    "fn_get_chatbot_errors",
                    "fn_get_functions_usage",
                    "fn_get_users_activity",
                    "fn_get_knowledge_base_item",
                    "fn_get_user_guide",
                    "fn_extract_content",
                    "fn_create_midjourney_image",
                    "fn_fetch_url_content",
                    "fn_run_python_code",
                    "fn_run_javascript_code",
                    "fn_generate_document",
                    "fn_save_to_document",
                    "fn_create_excel_file",
                    "fn_text_to_speech",
                    "fn_currency_converter",
                    "fn_get_currency_rates",
                ],
                memory: [],
                system_prompt: devPrompts.main_chat_start(),
                include_current_time: true,
                availableForUserGroups: ["admin", "basic"],
                properties: {
                    model_mode: "clever",
                    temperature: 1,
                    response_style: "friendly",
                    image_choice: "auto",
                    include_agent_memory: true
                }
            },
            {
                id: "translator",
                name_ru: "Переводчик",
                name_en: "Translator",
                description: "Specialized in language translation",
                general_instructions_ru: "Достаточно прислать текст. Русский текст будет переведен на английский. Текст на любом другом языке будет переведен на русский.",
                resetchat_instructions_ru: "Чтобы начать новый диалог, используйте /resetchat.",
                general_instructions_en: "Just send the text. Russian text will be translated into English. Text in any other language will be translated into Russian.",
                resetchat_instructions_en: "To start a new dialogue, use /resetchat.",
                type: "built-in",
                tools: [],
                memory: [],
                system_prompt: devPrompts.translator_start_prompt(),
                include_current_time: true,
                availableForUserGroups: ["admin", "basic"],
                model_modes: [
                    {
                        id: "fast",
                        ru_name: "Быстрый",
                        en_name: "Fast",
                        model: "gpt-5.1",
                        reasoning: {
                            effort: "none"
                        }
                    }
                ],
                properties: {
                    model_mode: "fast",
                    temperature: 1,
                    include_agent_memory: true
                }
            },
            {
                id: "texteditor",
                name_ru: "Редактор",
                name_en: "Editor",
                description: "Text editing and refinement",
                general_instructions_ru: "Просто пришлите Ваш текст и я помогу его отредактировать.",
                resetchat_instructions_ru: "Чтобы начать новый диалог, используйте /resetchat.",
                general_instructions_en: "Just send your text and I will help to edit it.",
                resetchat_instructions_en: "To start a new dialogue, use /resetchat.",
                type: "built-in",
                tools: [],
                memory: [],
                system_prompt: devPrompts.texteditor_start_prompt(),
                include_current_time: true,
                availableForUserGroups: ["admin", "basic"],
                model_modes: [
                    {
                        id: "fast",
                        ru_name: "Быстрый",
                        en_name: "Fast",
                        model: "gpt-5.1",
                        reasoning: {
                            effort: "none"
                        }
                    }
                ],
                properties: {
                    model_mode: "fast",
                    temperature: 1,
                    include_agent_memory: true
                }
            },
            {
                id: "web_browser",
                name_ru: "Веб-браузер",
                name_en: "Web Browser",
                description: "Agent with web browsing capabilities",
                general_instructions_ru: "Напишите интернет ссылку и задание для агента.",
                resetchat_instructions_ru: "Чтобы начать новый диалог, используйте /resetchat.",
                general_instructions_en: "Type an internet link and a task for the agent.",
                resetchat_instructions_en: "To start a new dialogue, use /resetchat.",
                type: "built-in",
                tools: [
                    "fn_manage_browser_tabs",
                    "hosted_computer_use_preview",
                    "fn_currency_converter"
                ],
                memory: [],
                model_modes: [
                    {
                        id: "default",
                        ru_name: "По умолчанию",
                        en_name: "Default",
                        model: "computer-use-preview"
                    }
                ],
                system_prompt: devPrompts.web_browser_start_prompt(),
                include_current_time: true,
                availableForUserGroups: ["admin"],
                properties: {
                    model_mode: "default",
                    temperature: 1,
                    include_agent_memory: true
                }
            },
            {
                id: "researcher",
                name_ru: "Исследователь",
                name_en: "Researcher",
                description: "Agent with web research capabilities",
                general_instructions_ru: "Дайте задание агенту и он изучит инормацию в интернете",
                resetchat_instructions_ru: "Чтобы начать новый диалог, используйте /resetchat.",
                general_instructions_en: "Give a task to the agent and it will research information on the internet",
                resetchat_instructions_en: "To start a new dialogue, use /resetchat.",
                type: "built-in",
                tools: ["hosted_web_search_preview"],
                memory: [],
                system_prompt: devPrompts.web_browser_start_prompt(),
                include_current_time: true,
                availableForUserGroups: ["admin", "basic"],
                model_modes: [
                    {
                        id: "fast",
                        ru_name: "Быстрый",
                        en_name: "Fast",
                        model: "gpt-5.1",
                        reasoning: {
                            effort: "none"
                        }
                    },
                    {
                        id: "clever",
                        ru_name: "Умный",
                        en_name: "Clever",
                        model: "gpt-5.1",
                        reasoning: {
                            effort: "high"
                        }
                    }
                ],
                properties: {
                    model_mode: "clever",
                    temperature: 1,
                    include_agent_memory: true
                }
            },
            {
                id: "receipts_parser",
                name_ru: "Парсер чеков",
                name_en: "Receipts Parser",
                description: "Agent for parsing receipts",
                general_instructions_ru: "Загрузите чек, чтобы агент его разобрал.",
                resetchat_instructions_ru: "Чтобы начать новый разбор, используйте /resetchat.",
                general_instructions_en: "Upload a receipt for the agent to parse.",
                resetchat_instructions_en: "To start a new dialogue, use /resetchat.",
                type: "built-in",
                model_modes: [
                    {
                        id: "clever",
                        ru_name: "Умный",
                        en_name: "Clever",
                        model: "gpt-5.1",
                        temperature: 0,
                        reasoning: {
                            effort: "high"
                        }
                    }
                ],
                tools: [
                    "hosted_web_search_preview",
                    "fn_web_search",
                    "hosted_mcp_gmail",
                    "hosted_code_interpreter",
                    "fn_get_knowledge_base_item",
                    "fn_extract_content",
                    "fn_fetch_url_content",
                    "fn_generate_document",
                    "fn_save_to_document",
                    "fn_currency_converter",
                    "fn_get_currency_rates",
                ],
                memory: [],
                system_prompt: devPrompts.receipts_parser_start(),
                include_current_time: true,
                availableForUserGroups: ["admin", "basic"],
                properties: {
                    model_mode: "clever",
                    temperature: 1,
                    response_style: "friendly",
                    image_choice: "auto",
                    include_agent_memory: true
                }
            },
        ];
    };

    get defaultBuiltIn() {
        return this.#buildInAgents;
    }
}

module.exports = Agents;
