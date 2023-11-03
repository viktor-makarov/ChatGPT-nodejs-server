const { deleteDialogByUserPromise } = require("./mongo");





async function runFunctionRequest(msg,function_call){

const function_name = function_call?.name

let functionResult = ""

if (!function_name){

    functionResult = "No function name found"

} else if(function_name==="get_current_datetime"){

    functionResult = new Date().toString()

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
    "description": "Use this function to get current value of date and time.",
    "parameters": {
        "type": "object",
        "properties": {}
    }
}
)

if (adminArray.includes(userid)) {
//Функции для админа


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