class FunctionCall{

    #function_call;
    #argumentsText;
    #argumentsJson;
    #name;
    #tokensLimitPerCallvalue

    constructor(function_call) {
        this.#function_call = function_call;
        this.#argumentsText = function_call?.function?.arguments
        this.#name = function_call?.function?.name
        
      };

      isArgumentsFieldValid(){
        if(this.#argumentsText === "" || this.#argumentsText === null || this.#argumentsText === undefined){
            console.log("false arguments",this.#argumentsText)
            return false 
        } else {
            console.log("true arguments",this.#argumentsText)
            return true
        }
    }

       convertArgumentsToJSON(){
        try{
        this.#argumentsJson=JSON.parse(this.#argumentsText)
        } catch(err){
            throw new Error(`Received arguments object poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the arguments.`)
        }

        console.log(this.#argumentsJson)
    }

    set tokensLimitPerCall(value){
        this.#tokensLimitPerCallvalue = value;
    };

    get argumentsJSON(){
        return this.#argumentsJson
    }
    
};

module.exports = FunctionCall;