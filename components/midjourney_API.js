const func = require("./other_func.js");
const MdjClient = require("./midjourneyClient.js").mdjClient;

  async function executeImagine(prompt) {
    
        const progressFunction = function(uri,progress) {  // Use standard function syntax
            console.log("Progress",new Date(), progress);
            console.log("loading imagine",new Date(), uri);
        };
        
        const msg = await MdjClient.Imagine(prompt, progressFunction);
        
        //console.log("msg",msg)
        return msg
};


async function generateHandler(prompt){

    let mdjMsg;
    try {
        console.time("mdj generate")  
        mdjMsg = await executeImagine(prompt);
        console.timeEnd("mdj generate")  
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
    
    console.time("generate buffer")
    const imageBuffer = await func.getImageByUrl(mdjMsg.uri)
    console.timeEnd("generate buffer")
      
        return {
        imageBuffer:imageBuffer,
        mdjMsg:mdjMsg
        }
    }

    async function customHandler(obj){

      let mdjMsg;
    try {
        mdjMsg = await executeCustom(obj);
        console.log("customHandler mdjMsg",mdjMsg)
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

    const progressFunction = function(uri,progress) {  // Use standard function syntax
        console.log("Progress",new Date(), progress); 
        console.log("loading custom",new Date(), uri);
    }

  //  await MdjClient.init();

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
    const msg = await global.mdjClient.Info() 
    return msg
}



module.exports = {
    executeImagine,
    executeCustom,
    executeInfo,
    generateHandler,
    customHandler
}