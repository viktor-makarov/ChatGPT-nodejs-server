const MdjClient = require("./midjourneyClient.js").MdjClient


  async function executeImagine(prompt) {
    
        const progressFunction = function(uri) {  // Use standard function syntax
            console.log("loading imagine",new Date(), uri);
        };
        const msg = await MdjClient.Imagine(prompt, progressFunction);

        return msg
};

async function executeCustom(obj) {

    const progressFunction = function(uri) {  // Use standard function syntax
        console.log("loading custom",new Date(), uri);
    }

    const msg = await MdjClient.Custom({
        msgId:obj.msgId,
        customId:obj.customId,
        content:obj.content,
        flags:obj.flags,
        loading:progressFunction
    });

    return msg
};

async function executeInfo(){
    const msg = await MdjClient.Info() 
    return msg
}



module.exports = {
    executeImagine,
    executeCustom,
    executeInfo
}