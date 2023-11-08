const mongo = require("./mongo");
const scheemas = require("./mongo_Schemas.js");




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
            pipeline = JSON.parse(argumentsjson.aggregate_pipeline)
            console.log(JSON.stringify(pipeline))
        } catch (err){
            functionResult = `Received aggregate pipeline is poorly formed which caused the following error on conversion to JSON: ${err.message}. Correct the pipeline.`
            return functionResult
        }
    };

        try {
            const result = await mongo.queryTockensLogsByAggPipeline(pipeline)
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
)

if (adminArray.includes(userid)) {

//Функции для админа

functionList.push({
    "name": "get_users_activity",
    "description": "Use this function to report on this chatbot users' activity of users. Input should be a fully formed mongodb  pipeline for aggregate function. One document represents one request of a user.",
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
},
)
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