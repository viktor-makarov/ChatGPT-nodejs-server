const { deleteDialogByUserPromise } = require("./mongo");


async function registerNotifyUser(botInstance,completionJson){


    console.log("request",JSON.stringify(completionJson))

}


async function runFunctionRequest(msg,request){


console.log("request",request)


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
    runFunctionRequest,
    registerNotifyUser
}