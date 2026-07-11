const mongo = require("../apis/mongo");


class User{

    #fullProfile
    #userid;
    #is_bot;
    #language_code;
    #user_first_name;
    #user_last_name;
    #user_username;
    #active;
    #prefered_name;
    #response_style;
    #image_choice;
    #plan;
    #groups;
    #currentAgent
    #currentAgentProperties
    #agents = []
    #currentTemperature
    #currentModel
    #currentReasoningEffort
    #currentModelMode
    #showSystemMsgs
    #isRegistered
    #hasReadInfo
    #isAdmin
    #currentVoice
    #settings
    #openAIToken
    #pinnedHeaderAllowed
    #showDetails

    constructor(userInfo) {
        this.#userid = userInfo.id;
        this.#is_bot = userInfo.is_bot;
        this.#language_code = userInfo.language_code;
        this.#user_first_name = userInfo.first_name;
        this.#user_last_name = userInfo.last_name;
        this.#user_username = userInfo.username;
        this.#openAIToken = process.env.OPENAI_API_KEY;
      };
      
    async getUserProfileFromDB(){

    const result = await mongo.getUserProfileByid(this.#userid)
    if (result.length>0){
        this.#fullProfile = result[0]
        this.#settings = result[0]?.settings

        this.#currentAgent = result[0].current_agent
        this.#agents = result[0]?.agents || [];
        this.updateAgentProperties()
        this.#currentVoice = this.#settings["texttospeech"]?.voice
        this.#active = result[0]?.active
        this.#plan = result[0]?.plan
        this.#pinnedHeaderAllowed = this.#settings?.pinnedHeaderAllowed
        this.#groups = result[0]?.permissions?.groups
        this.#isRegistered = result[0]?.permissions?.registered
        this.#hasReadInfo = result[0]?.permissions?.readInfo
        this.#isAdmin = this.#groups?.includes("admin")

        this.#showDetails = this.#settings?.showDetails ?? false;

    } else {
        this.#active = false;
        this.#isRegistered = false;
        this.#hasReadInfo = false;
        this.#isAdmin = false;
    }
    return result
    };

    updateAgentProperties(){

        const {model_mode} = this.getAgentProperties(this.#currentAgent, this.#agents)
        
        const {model_modes}  = this.getAgentSettings(this.#currentAgent, this.#agents);
        const modelModeProperties = model_modes?.find(mode => mode.id === model_mode || mode.id === "default") || {};
        this.#currentModel = modelModeProperties?.model || null
        this.#currentModelMode = this.#language_code === "ru" ? modelModeProperties?.ru_name : modelModeProperties?.en_name
        this.#currentReasoningEffort = modelModeProperties?.reasoning?.effort || null
    }

    getAgentProperties(agent_id,agents){
        if(!agent_id || agents.length === 0) return null;
        const agent = agents.find(a => a.id === agent_id);
        if(!agent) return null;
        return agent?.properties || {};
    };

    getAgentSettings(agent_id,agents){
        if(!agent_id || agents.length === 0) return null;
        const agent = agents.find(a => a.id === agent_id);
        if(!agent) return null;
        return agent;
    };

    //depricated
    async updateUserProperties(pathString, value){
        const pathArray = pathString.split(".")
        const parameter = pathArray.pop()

        switch (parameter) {
            case "model":
                if(pathArray.includes(this.#currentAgent)){
                    this.#currentModel = value;
                    this.#settings[this.#currentAgent].model = value;
                }
                break;
            case "temperature":
                if(pathArray.includes(this.#currentAgent)){
                    this.#currentTemperature = value;
                    this.#settings[this.#currentAgent].temperature = value;
                }
                break;
            case "response_style":
                if(pathArray.includes(this.#currentAgent)){
                this.#response_style = value;
                this.#settings[this.#currentAgent].response_style = value;
                }
                break;

            case "pinnedHeaderAllowed":
                this.#pinnedHeaderAllowed = Boolean(value);
                this.#settings[this.#currentAgent].response_style
                break;

        }
    }

    get userid(){
        return this.#userid
    }

    get mcp(){
        return this.#fullProfile?.mcp || { auth: {}, tools: {} }
    }

    get is_bot(){
        return this.#is_bot
    }

    get language_code(){
        return this.#language_code
    }

    get user_first_name(){
        return this.#user_first_name
    }

    get user_username(){
        return this.#user_username
    }

    get prefered_name(){
        return this.#prefered_name
    }

    get response_style(){
        return this.#response_style
    }

    get image_choice(){
        return this.#image_choice
    }

    get showDetails(){
        return this.#showDetails
    }

    get openAIToken(){

        return this.#openAIToken
    }

    get user_last_name(){
        return this.#user_last_name
    }

    get currentAgent(){
        return this.#currentAgent
    };

    set currentAgent(value){
        this.#currentAgent = value
    }

    get currentAgentSettings(){
        return this.getAgentSettings(this.#currentAgent, this.#agents)
    }

    get currentAgentProperties(){
        return this.getAgentProperties(this.#currentAgent, this.#agents)
    }

    get availableAgentsForUser(){
        return this.#agents.filter(agent => {
            return agent.availableForUserGroups?.some(group => group === "all" || this.#groups.includes(group)) || false;
        });
    }

    get unavailableAgentsForUser(){

        return this.#agents.filter(agent => {
            return !agent.availableForUserGroups?.some(group => group === "all" || this.#groups.includes(group));
        });
    }

    agentWelcomeMsg(tokensCount,tokensLimit){

        const {
            name_ru, 
            name_en,
            general_instructions_ru,
            general_instructions_en,
            resetchat_instructions_ru,
            resetchat_instructions_en
        } = this.currentAgentSettings;

        const agentName = this.language_code === "ru" ? name_ru : name_en || "Агент"
        
        if(tokensCount>0){
            const statisticsMsg = this.language_code === "ru" ?
            `Использовано токенов: ${tokensCount}/${tokensLimit}` :
            `Tokens used: ${tokensCount}/${tokensLimit}`
            const resetInstructions = this.language_code === "ru" ? resetchat_instructions_ru : resetchat_instructions_en;
            return `<b>${agentName}</b>\n${statisticsMsg}\n${resetInstructions}`

        } else {
            const generalInstructions = this.language_code === "ru" ? general_instructions_ru : general_instructions_en;
            return `<b>${agentName}</b>\n${generalInstructions}`
        }

    }

    get currentTemperature(){
        return this.#currentTemperature || 1
    };

    get currentVoice(){
        return this.#currentVoice
    };


    set currentModel(value){
        this.#currentModel = value
    }

    get currentModel(){
        return this.#currentModel 
    };

    get currentModelMode(){
        return this.#currentModelMode
    }

    set currentReasoningEffort(value){
        this.#currentReasoningEffort = value
    }

    get currentReasoningEffort(){
        return this.#currentReasoningEffort
    };

    get showSystemMsgs(){
        return this.#showSystemMsgs
    }

    get isRegistered(){
        return this.#isRegistered
    }

    get active(){
        return this.#active
    }

    get hasReadInfo(){
        return this.#hasReadInfo
    }
    get isAdmin(){
        return this.#isAdmin
    }

    get groups(){
        return this.#groups
    }

    get settings(){
        return this.#settings
    }

    get pinnedHeaderAllowed(){
        return this.#pinnedHeaderAllowed
    }

    set pinnedHeaderAllowed(value){
        this.#pinnedHeaderAllowed = value
    }

    get pinnedHeaderTemplate(){

        const agentSettings = this.getAgentSettings(this.#currentAgent, this.#agents);
        
        if (agentSettings) {
            const pinnedMsgParts = [];
            const {name_ru,name_en,properties:{response_style}} = agentSettings;

            if(name_ru && name_en){
                pinnedMsgParts.push(this.language_code === "ru" ? name_ru : name_en);
            }

            pinnedMsgParts.push(this.#currentModelMode || "N/A");

            if (response_style) {
                pinnedMsgParts.push(response_style);
            }
            const text = pinnedMsgParts.join(" | ");
            return text;

        } else {
            return "Агент не найден"
        }
    
    }

    set isRegistered(value){
        this.#isRegistered = value
    }

    set isAdmin(value){
        this.#isAdmin = value
    }

    set hasReadInfo(value){
        this.#hasReadInfo = value
    }

    
};

module.exports = User;