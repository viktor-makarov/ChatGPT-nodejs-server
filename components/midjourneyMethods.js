const MdjClient = require("./midjourneyClient.js").MdjClient
const func = require("./other_func.js");

  async function executeImagine(prompt) {
    
        const progressFunction = function(uri) {  // Use standard function syntax
            console.log("loading imagine",new Date(), uri);
        };
        const msg = await MdjClient.Imagine(prompt, progressFunction);

        return msg
};


async function generateHandler(prompt){

    let mdjMsg;
    try{
        mdjMsg = await executeImagine(prompt);
    } catch(err){
      err.code = "MDJ_ERR"
      if(err.message.includes("429")){
        err.message ="The image failed to generate due to the limit of concurrent generations. Try again later."
        err.instructions = "Communicate the reason of the failure to the user."
      } else {
        err.user_message = err.message
      }
      throw err;
    }
    
    const imageBuffer = await func.getImageByUrl(mdjMsg.uri)
      
        return {
        imageBuffer:imageBuffer,
        mdjMsg:mdjMsg
        }
    }

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
    executeInfo,
    generateHandler
}