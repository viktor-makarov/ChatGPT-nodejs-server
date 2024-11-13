const MdjClient = require("./midjourneyClient.js").MdjClient


  async function executeImagine(prompt) {
    
        const progressFunction = function(uri) {  // Use standard function syntax
            console.log("loading imagine",new Date(), uri);
        };
        const msg = await MdjClient.Imagine(prompt, progressFunction);

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

async function executeVariation(obj) {

    const progressFunction = function(uri) {  // Use standard function syntax
        console.log("loading variation",new Date(), uri);
    }

    const msg = await MdjClient.Variation({
        index:obj.index,
        msgId:obj.msgId,
        hash:obj.hash,
        content:obj.content,
        flags:obj.flags,
        loading:progressFunction
    });

    return msg
};

async function executeUpscale(obj) {

    const progressFunction = function(uri) {  // Use standard function syntax
        console.log("loading upscale",new Date(), uri);
    }

    const msg = await MdjClient.Upscale({
        index:obj.index,
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
    executeReroll,
    executeVariation,
    executeUpscale
}