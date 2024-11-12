const MdjClient = require("./midjourneyClient.js").MdjClient


  async function executeImagine(prompt) {
    
        const msg = await MdjClient.Imagine(prompt, function(uri) {  // Use standard function syntax
            console.log("loading imagine",new Date(), uri);
        });

        return msg
};

async function executeReroll(obj) {

    const progressFunction = function(uri) {  // Use standard function syntax
        console.log("loading reroll",new Date(), uri);
    }

    const msg = await MdjClient.Reroll({
        msgId:obj.msgId,
        hash:obj.hash,
        content:obj.content,
        flags:obj.flags,
        loading:progressFunction
    });

    return msg
};



module.exports = {
    executeImagine,
    executeReroll
}