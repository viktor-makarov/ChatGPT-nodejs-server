const mongo = require("../mongo");


class User{

    #fullProfile
    #userid;
    #is_bot;
    #language_code;
    #user_first_name;
    #user_last_name;
    #user_username;
    #active;
    #plan;
    #groups;
    #currentRegime;
    #currentTemperature
    #currentModel
    #showSystemMsgs
    #isRegistered
    #hasReadInfo
    #isAdmin
    #currentVoice
    #settings
    #openAIToken

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
        this.#currentRegime = this.#settings?.current_regime
        this.#currentTemperature = this.#settings[this.#currentRegime]?.temperature
        this.#currentVoice = this.#settings["texttospeech"]?.voice
        this.#currentModel = this.#settings[this.#currentRegime]?.model
        this.#active = result[0]?.active
        this.#plan = result[0]?.plan
        this.#groups = result[0]?.permissions?.groups

        this.#showSystemMsgs = this.#settings[this.#currentRegime]?.sysmsg
        this.#isRegistered = result[0]?.permissions?.registered
        this.#hasReadInfo = result[0]?.permissions?.readInfo
        this.#isAdmin = this.#groups.includes("admin")

    } else {
        this.#active = false;
        this.#isRegistered = false;
        this.#hasReadInfo = false;
        this.#isAdmin = false;
    }
    return result
    };

    get userid(){
        return this.#userid
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
    

    get openAIToken(){

        return this.#openAIToken
    }

    get user_last_name(){
        return this.#user_last_name
    }

    get currentRegime(){

        return this.#currentRegime
    };
    get currentTemperature(){
        return this.#currentTemperature || 1
    };

    get currentVoice(){
        return this.#currentVoice
    };

    get currentModel(){
        return this.#currentModel 
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

    get settings(){
        return this.#settings
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
    set currentRegime(value){
        this.#currentTemperature = this.#settings[value]?.temperature
        this.#currentModel = this.#settings[value]?.model
        this.#currentVoice = this.#settings[value]?.voice
        this.#showSystemMsgs = this.#settings[value]?.sysmsg       
        this.#currentRegime = value
    };
};

module.exports = User;