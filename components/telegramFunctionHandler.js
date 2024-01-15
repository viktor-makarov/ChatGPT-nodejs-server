const mongo = require("./mongo");
const scheemas = require("./mongo_Schemas.js");
const func = require("./other_func.js");




async function runFunctionRequest(msg,function_call){

const function_name = function_call?.name

let functionResult = ""

if (!function_name){

    functionResult = "No function name found"

} else if(function_name==="get_current_datetime"){

    functionResult = new Date().toString()

} else if(function_name==="get_users_activity"){

    const arguments = function_call?.arguments
    let pipeline = [];
    if(arguments === "" || arguments === null || arguments === undefined){

        functionResult = "No arguments provided. You should provide at least required arguments"

        return functionResult
    } else {

        try {
            const argumentsjson = JSON.parse(arguments)              
           pipeline =  func.replaceNewDate(argumentsjson.aggregate_pipeline)
            
        } catch (err){
            functionResult = `Received aggregate pipeline is poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the pipeline.`
            return functionResult
        }
    };

        try {
            const result = await mongo.queryTockensLogsByAggPipeline(pipeline)
            const strResult = JSON.stringify(result)
    
            if(strResult.length>appsettings.functions_options.max_characters_in_result){

                functionResult = `Result of the function exceeds ${appsettings.functions_options.max_characters_in_result} characters. Please adjust the query to reduce length of the result.`
                return functionResult

            } else{
                functionResult = strResult
          
                return functionResult
            }
          
            return functionResult
        } catch (err){

            functionResult = `Error on applying the aggregation pipeline provided to the mongodb: ${err.message}`
            return functionResult
        }

} else if(function_name==="get_chatbot_errors") {

    const arguments = function_call?.arguments
    let pipeline = [];
    if(arguments === "" || arguments === null || arguments === undefined){

        functionResult = "No arguments provided. You should provide at least required arguments"

        return functionResult
    } else {

        try {
            const argumentsjson = JSON.parse(arguments)      
           pipeline =  func.replaceNewDate(argumentsjson.aggregate_pipeline)
            
        } catch (err){
            functionResult = `Received aggregate pipeline is poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the pipeline.`
            return functionResult
        }
    };

        try {
            const result = await mongo.queryLogsErrorByAggPipeline(pipeline)
            functionResult = JSON.stringify(result)
          
            return functionResult
        } catch (err){

            functionResult = `Error on applying the aggregation pipeline provided to the mongodb: ${err.message}`
            return functionResult
        }


} else {

    functionResult = `Function ${function_name} does not exist`
}

return functionResult
}

async function functionsList(userid){

var functionList = []


if(global.allSettingsDict[userid].current_regime==="assistant"){

//Общедоступные функции
functionList.push({
    "name": "get_current_datetime",
    "description": "Use this function to answer user's questions which require current date and time. This function returns value of date and time at the moment of request.",
    "parameters": {
        "type": "object",
        "properties": {}
    }
}
);

if (adminArray.includes(userid)) {

//Функции для админа

functionList.push({
    "name": "get_users_activity",
    "description": `Use this function to report on this chatbot users' activity of users. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongo.mongooseVersion()}. One document represents one request of a user.`,
    "parameters": {
        "type": "object",
        "properties": {
            "aggregate_pipeline": {
                "type": "string",
                "description": `Mongodb aggregate pipeline extracting info about users' activity from a mongodb collection.\n The collection has the following schema: ${JSON.stringify(scheemas.TokensLogSheema.obj)}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
            }
        },
        "required": ["aggregate_pipeline"]
    }
})

functionList.push({
    "name": "get_chatbot_errors",
    "description": `Use this function to report on this chatbot errors. Input should be a fully formed mongodb pipeline for aggregate function sent by node.js library mongoose ${mongo.mongooseVersion()}. One document represents one error.`,
    "parameters": {
        "type": "object",
        "properties": {
            "aggregate_pipeline": {
                "type": "string",
                "description": `Mongodb aggregate pipeline extracting info about errors from a mongodb collection.\n The collection has the following schema: ${JSON.stringify(scheemas.LogsSheema.obj)}. You should limit result of function with maximum of 100 rows. You can use get_current_datetime function to get current date and time if needs be.`
            }
        },
        "required": ["aggregate_pipeline"]
    }
})

}

//Завершаем. Если ни одной функции нет, то передаем null
if (functionList.length===0){
    return null
} else {
    return functionList
}

} else {
    return null
}
};


module.exports = {
    functionsList,
    runFunctionRequest
}