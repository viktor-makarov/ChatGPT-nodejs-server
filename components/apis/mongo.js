const mongoose = require("mongoose");
const scheemas = require("./mongo_Schemas.js");
const moment = require("moment-timezone");
const { error } = require("console");
const fs = require("fs").promises;

//Models
const details_log_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_details,scheemas.DetailsSheema);
const error_log_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_errors_log,scheemas.LogsSheema);
const reg_log_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_reg_log,scheemas.RegistrationLogSheema);
const token_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_tokens_log,scheemas.TokensLogSheema);
const function_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_functions_log,scheemas.FunctionUsageLogSheema);
const feature_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_feature_log,scheemas.FeatureUsageLogSheema);
const dialog_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_dialogs,scheemas.TelegramDialogSheema);
const dialog_meta_collection = global.mongoConnection.model(global.appsettings.mongodb_names.col_dialogue_meta,scheemas.DialogMetaSheema);
const function_queue_collection = global.mongoConnection.model(global.appsettings.mongodb_names.col_function_queue,scheemas.FunctionQueueSheema);
const telegram_profile_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_profiles,scheemas.ProfileSheema);
const telegram_model_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_models,scheemas.ModelsSheema);
const mdj_image_msg = global.mongoConnection.model(global.appsettings.mongodb_names.coll_mdj_image,scheemas.MdjImages);
const hash_storage = global.mongoConnection.model(global.appsettings.mongodb_names.coll_hash_storage,scheemas.HashStorage);
const knowledge_base_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_knowledge_base,scheemas.KnowledgeBaseSheema);
const credits_usage_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_creadits_usage,scheemas.CreditsUsageLogSheema);

const elevenlabs_voices_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_elevenlabs_voices,scheemas.VoicesElevenLabsSheema);
const elevenlabs_models_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_elevenlabs_models,scheemas.ModelsElevenLabsSheema);

const exchange_rates_international_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_exchange_rates_international,scheemas.ExchangeRates);
const response_events_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_response_events,scheemas.ResponseEventsSheema);
const test_diagram_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_test_diagram_log,scheemas.TestDiagramSheema);
const self_corrected_instructions_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_self_corrected_instructions,scheemas.SelfCorrectedInstructionsSheema);
const temp_reply_markup_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_temp_reply_markup,scheemas.TempReplyMarkupSheema);

const temp_resource_storage_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_temp_resource_storage,scheemas.tempResourceStorageSheema);
const output_document_collection = global.mongoConnection.model(global.appsettings.mongodb_names.coll_output_documents,scheemas.outputDocumentSheema);

async function dropOutputDocumentCollection() {
  try {
    const collName = output_document_collection.collection.name;
    const nativeDb = output_document_collection.db.db; // native MongoDB Db
    const collections = await nativeDb.listCollections({ name: collName }).toArray();
    const exists = collections.length > 0;
    if (!exists) {
      return { dropped: false, reason: "Collection does not exist", collection: collName };
    }
    await output_document_collection.collection.drop();
    return { dropped: true, collection: collName };
  } catch (err) {
    // Handle "NamespaceNotFound" gracefully if thrown by Mongo
    if (err?.codeName === "NamespaceNotFound" || /ns not found/i.test(err?.message || "")) {
      return { dropped: false, reason: "Collection not found" };
    }
    err.code = "MONGO_ERR";
    err.place_in_code = "dropOutputDocumentCollection";
    throw err;
  }
}

async function deleteOutputStorageByUserId(user_id){

  try {
    return await output_document_collection.deleteMany({ userid: user_id });
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteOutputStorageByUserId";
    throw err;
  }
}

async function deleteOutputStorageByUserIdAndAgent(user_id, agent){

  try {
    return await output_document_collection.deleteMany({ userid: user_id, agent: agent });
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteOutputStorageByUserIdAndAgent";
    throw err;
  }
}

async function insertContentToOutputStorage(filename,user_id,agent,content){

  try {

    const result = await output_document_collection.updateOne(
      { filename: filename, userid: user_id, agent: agent },
      { $push: { content } },  // Adds content to the content array
      { upsert: true, new: true }
    )

    return result;

  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "insertContentToOutputStorage";
      throw err;
  }
};


async function getContentByFilename(filename,user_id){

  try {
    const result = await output_document_collection
    .find({ userid: user_id, filename: filename}, { _id: 0})
    .lean()
    return result;
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "getContentByFilename";
      throw err;
  }
}

async function dropTempResourceStorageCollection() {
  try {
    const collName = temp_resource_storage_collection.collection.name;
    const nativeDb = temp_resource_storage_collection.db.db; // native MongoDB Db
    const collections = await nativeDb.listCollections({ name: collName }).toArray();
    const exists = collections.length > 0;
    if (!exists) {
      return { dropped: false, reason: "Collection does not exist", collection: collName };
    }
    await temp_resource_storage_collection.collection.drop();
    return { dropped: true, collection: collName };
  } catch (err) {
    // Handle "NamespaceNotFound" gracefully if thrown by Mongo
    if (err?.codeName === "NamespaceNotFound" || /ns not found/i.test(err?.message || "")) {
      return { dropped: false, reason: "Collection not found" };
    }
    err.code = "MONGO_ERR";
    err.place_in_code = "dropTempResourceStorageCollection";
    throw err;
  }
}

async function getNotExtractedResourcesShort(user_id,agent){

  try {
    const result = await temp_resource_storage_collection
    .find({ 
      userid: user_id, 
      agent: agent, 
      extracted: false,
      error: { $exists: false}
    }, { _id: 0, resourceId: 1, "resourceData.fileName": 1,"resourceData.url": 1, "resourceData.fileSize": 1})
    .lean()
    return result;
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "getNotExtractedResourcesShort";
      throw err;
  }
}

async function getExtractedResourcesShort(user_id,agent){

  try {
    const result = await temp_resource_storage_collection
    .find({ 
      userid: user_id, 
      agent: agent, 
      extracted: true,
      error: { $exists: false} 
    }, { _id: 0, resourceId: 1, "resourceData.fileName": 1,"resourceData.url": 1, "resourceData.fileSize": 1})
    .lean()
    return result;
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "getExtractedResourcesShort";
      throw err;
  }
}


async function getOAIStorageFiles(user_id,agent){

  console.log("Fetching OAI storage files for user:", user_id, "and agent:", agent);
  try {
    const result = await temp_resource_storage_collection
    .find(
      { 
      userid: user_id, 
      agent: agent,
      "resourceData.OAIStorage.fileId": { $exists: true, $ne: null } 
      }, 
      { _id: 0, resourceId: 1, "resourceData.OAIStorage.fileId": 1, "resourceData.OAIStorage.expires_at": 1 }
    )
    .lean()
    return result;
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "getOAIStorageFiles";
      throw err;
  }
}





async function getResourcesById(resource_ids){
  try {
    const result = await temp_resource_storage_collection
    .find({ resourceId: { $in: resource_ids } }, { _id: 0})
    .lean()
    return result;
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "getResourceById";
      throw err;
  }
}

async function saveResourceToTempStorage(userid, agent,resourceId, resourceType, extracted, embeddedInDialogue, createdAt, resourceData){

  try {
    return await temp_resource_storage_collection.updateOne(
      { userid: userid, resourceId: resourceId },
      { 
        userid,
        agent,
        resourceId,
        resourceType,
        extracted,
        embeddedInDialogue,
        createdAt,
        resourceData
      },
      { upsert: true }
    );

  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "saveResourceToTempStorage";
      throw err;
  }
};



async function removeOAIDataInTempStorage(user_id, fileids, dataDotNotation){

  try {
    const filter = { userid: user_id, "resourceData.OAIStorage.fileId": { $in: fileids }};
    const $unset = dataDotNotation;
    return await temp_resource_storage_collection.updateMany(
      filter,
      { $unset },
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateDataInTempStorage";
    throw err;
  }
}

async function updateDataInTempStorage(user_id, resourceId, dataDotNotation){

  try {
    const $set = dataDotNotation;
    return await temp_resource_storage_collection.updateOne(
      { userid: user_id, resourceId: resourceId },
      { $set },
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateDataInTempStorage";
    throw err;
  }
}

async function deleteTempStorageByUserId(user_id){

  try {
    return await temp_resource_storage_collection.deleteMany({ userid: user_id });
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteTempStorageByUserId";
    throw err;
  }
}

async function deleteTempStorageByUserIdAndAgent(user_id, agent){

  try {
    return await temp_resource_storage_collection.deleteMany({ userid: user_id, agent: agent });
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteTempStorageByUserIdAndAgent";
    throw err;
  }
}



async function saveTempReplyMarkup(user_id, message_id, reply_markup){

  try {
    const object = {userid:user_id,messageId:message_id,replyMarkup:reply_markup};
    const newReplyMarkup = new temp_reply_markup_collection(object);
    return await newReplyMarkup.save();

  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "saveTempReplyMarkup";
      throw err;
  }
};

async function getTempReplyMarkup(user_id) {

  try {
    const result = await temp_reply_markup_collection.find({ user_id: user_id }, { _id: 0, __v: 0 }).lean()
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getTempReplyMarkup";
    throw err;
  }
}

async function deleteTempReplyMarkup(user_id){

  try {
    return await temp_reply_markup_collection.deleteMany({ userid: user_id });
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteTempReplyMarkup";
    throw err;
  }
}

async function getSelfCorrectedInstructions(domain, type) {
  try {
    const result = await self_corrected_instructions_collection.findOne(
      { domain: domain, type: type },
      { _id: 0, __v: 0 }
    ).lean();
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getSelfCorrectedInstructions";
    throw err;
  }
}

async function addCorrectionToInstructions(domain, type, newInstruction){
  try {
    const result = await self_corrected_instructions_collection.updateOne(
      { domain: domain, type: type },
      { $push: { instructions: newInstruction } },
      { upsert: true }
    );
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "addCorrectionToInstructions";
    throw err;
  }
}

async function saveNewTestDiagram(object){

  if(process.env.DEPLOYMENT !== "dev") return;

  try {
    const newTestDiagram = new test_diagram_collection(object);
    return await newTestDiagram.save();

  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "saveNewTestDiagram";
      throw err;
  }
}



async function getEventsList() {

  try {
    const result = await response_events_collection.distinct('eventType');
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getEventsList";
    throw err;
  }
}

async function saveNewEvent(event){
  try {
    const result = await response_events_collection.updateOne(
      { eventType: event.type },
      { $setOnInsert: { event: event } },
      { upsert: true }
    );
    
    // Return null if document already existed (no insertion happened)
    if (result.upsertedCount === 0) {
      return null;
    }
    
    return result;
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "saveNewEvent";
      throw err;
  }
}

async function getExchangeRateInternational(time_last_update_unix){

  try {
    return await exchange_rates_international_collection.findOne({ time_last_update_unix: time_last_update_unix }, { _id: 0, __v: 0 }).lean()
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getExchangeRateInternational";
    throw err;
  }
}


async function saveExchangeRateInternational(object){
  try {
    const result = await exchange_rates_international_collection.updateOne(
      { time_last_update_unix: object.time_last_update_unix },
      { $setOnInsert: object },
      { upsert: true }
    );
    
    // Return null if document already existed (no insertion happened)
    if (result.upsertedCount === 0) {
      return null;
    }
    
    return result;
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "saveExchangeRateInternational";
      throw err;
  }
}



async function getFunctionQueueByName(queue_name){

  try {
    return await function_queue_collection.findOne({ name: queue_name }, { _id: 0, __v: 0 }).lean()
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getFunctionQueueByName";
    throw err;
  }
}

async function removeFunctionFromQueue(function_id){

  try {
    return await function_queue_collection.deleteOne({ function_id: function_id });
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "removeFunctionFromQueue";
    throw err;
  }

}


async function addFunctionToQueue(queue_name,function_id,max_concurrent){

  const session = await mongoose.startSession();

  let result  = null;
  try {
    await session.withTransaction(async () => {
      const count = await function_queue_collection.countDocuments({ name: queue_name }).session(session);
    
      if (count < max_concurrent) {
        result = await function_queue_collection.create([{
          name: queue_name,
          function_id: function_id, // замените на нужный id
        }], { session });
      }
    });
    return result

  } catch(err){
    err.code = "MONGO_ERR";
    err.place_in_code = "addFunctionToQueue";
    throw err;
  } finally {
    session.endSession();
  }

}

async function dropDialogueMetaCollection() {
  try {
    const collName = dialog_meta_collection.collection.name;
    const nativeDb = dialog_meta_collection.db.db; // native MongoDB Db
    const collections = await nativeDb.listCollections({ name: collName }).toArray();
    const exists = collections.length > 0;
    if (!exists) {
      return { dropped: false, reason: "Collection does not exist", collection: collName };
    }
    await dialog_meta_collection.collection.drop();
    return { dropped: true, collection: collName };
  } catch (err) {
    // Handle "NamespaceNotFound" gracefully if thrown by Mongo
    if (err?.codeName === "NamespaceNotFound" || /ns not found/i.test(err?.message || "")) {
      return { dropped: false, reason: "Collection not found" };
    }
    err.code = "MONGO_ERR";
    err.place_in_code = "dropDialogueMetaCollection";
    throw err;
  }
}


async function createDialogueMeta(object){
  try {
    const newDialogieMetaObject = new dialog_meta_collection(object);
    return await newDialogieMetaObject.save();
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "createDialogueMeta";
      throw err;
  }
}

async function deleteDialogueMeta(userid){
  try {
    return await dialog_meta_collection.deleteMany({ userid: userid });
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteDialogueMeta";
    throw err;
  }
}

async function updateDialogueMeta(userid,object){
  try {
    return await dialog_meta_collection.updateOne(
      { userid: userid },
      object,
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateDialogueMeta";
    throw err;
  }
}

async function updateDotNotationDialogueMeta(userid,object){
  try {
    return await dialog_meta_collection.updateOne(
      { userid: userid },
      { $set: object },
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateDialogueMeta";
    throw err;
  }
}


async function resetAllInProgressDialogueMeta(){
  try {
    const result = await dialog_meta_collection.updateMany(
      { "function_calls.inProgress": true },
      { $set: { "function_calls.inProgress": false } }
    );
    return result.modifiedCount || 0
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "resetAllInProgressDialogueMeta";
    throw err;
  }
}

async function readDialogueMeta(userid){
  try {
    return  await dialog_meta_collection.findOne({ userid: userid },{ _id: 0,__v:0}).lean()
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "readDialogueMeta";
    throw err;
  }
};

async function getKwgItemBy(id){
  try {

     const filter = { id: id }
     const result =  await knowledge_base_collection.find(
       filter
     ).lean();

     return result
    
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getKwgItemBy";
    throw err;
  }
};

async function getKwgItemsForUser(user){
  try {

    let filter = {"$or":[{"access":user},{"access":"all"}]};

     const result =  await knowledge_base_collection.find(
      filter,
      { _id: 0, id: 1, name: 1,description:1,instructions:1}
     ).lean();
     
     return result
    
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getKwgItemsForUser";
    throw err;
  }
};



async function saveHash(hash,json){
  try {
    
    return await hash_storage.updateOne(
      { hash: hash },
      {hash:hash,
        json:json
      },
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "saveHash";
    throw err;
  }
};


async function getJsonBy(hash){
  try {

     const filter = { hash: hash }
     const result =  await hash_storage.find(
       filter
     ).lean();

     if(result.length===0){
      return null
     } else {
      return result[0].json
     }

    
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getJsonBy";
    throw err;
  }
};

//Functions
function mongooseVersion(){
  return mongoose.version
}



async function insert_mdj_msg(msg,userInstance){
  try {
  const mdj_msg = new mdj_image_msg({
    userid: userInstance.userid,
    content: msg.content,
    id:msg.id,
    url:msg.url,
    prompt:msg.prompt,
    buttonTriggered:msg.buttonTriggered,
    proxy_url:msg.proxy_url,
    flags:msg.flags,
    hash:msg.hash,
    progress:msg.progress,
    options: msg.options,
    width:msg.width,
    height:msg.height
  })

  return await mdj_msg.save();

} catch (err) {
  err.code = "MONGO_ERR";
  err.place_in_code = "insert_mdj_msg";
  throw err;
}
};

async function get_mdj_msg_byId(msgId){
  try {

    const filter = { id: msgId }
    return await mdj_image_msg.find(
      filter
    ).lean();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "get_mdj_msg_byId";
    throw err;
  }
};

async function insert_details_logPromise(object,place_in_code) {
  try {

    const newLog = new details_log_collection({
      object: object,
      place_in_code:place_in_code
    });
    return await newLog.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insert_details_logPromise";
    throw err;
  }
}



async function insert_error_logPromise(errorJSON) {
  try {
    const newLog = new error_log_collection(errorJSON);
    return await newLog.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insert_error_logPromise";
    throw err;
  }
}

async function insert_reg_eventPromise(
  id,
  id_chat,
  is_bot,
  first_name,
  last_name,
  username,
  language_code,
  event,
  reason
) {

  try {

    const newRegEvent = new reg_log_collection({
      id: id,
      id_chat: id_chat,
      is_bot: is_bot,
      first_name: first_name,
      last_name: last_name,
      username: username,
      language_code: language_code,
      event: event,
      reason: reason,
    });
    return await newRegEvent.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insert_reg_eventPromise";
    throw err;
  }
}


async function insertFunctionUsagePromise(obj){
  try {

    const newFunctionUsage = new function_collection({
      userid: obj.userInstance.userid,
      userFirstName: obj.userInstance.user_first_name,
      userLastName: obj.userInstance.user_last_name,
      username: obj.userInstance.user_username,
      model:obj.userInstance.currentModel,
      tool_function:obj.tool_function,
      tool_call: obj.tool_call,
      tool_reply:obj.tool_reply,
      call_duration:obj.call_duration,
      success:obj.success
    });

    return await newFunctionUsage.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insertFunctionUsagePromise";

  }
};

async function insertFeatureUsage(obj){
  try {

    const newFeatureUsage = new feature_collection({
      userid: obj.userInstance.userid,
      userFirstName: obj.userInstance.user_first_name,
      userLastName: obj.userInstance.user_last_name,
      username: obj.userInstance.user_username,
      feature:obj.feature,
      regime:obj?.regime,
      featureType:obj.featureType
    });

    return await newFeatureUsage.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insertFeatureUsage";
    throw err;
  }
};

async function insertCreditUsage(obj){
  try {

    const newCreditUsage = new credits_usage_collection({
      userid: obj.userInstance.userid,
      userFirstName: obj.userInstance.user_first_name,
      userLastName: obj.userInstance.user_last_name,
      username: obj.userInstance.user_username,
      creditType:obj.creditType,
      creditSubType:obj.creditSubType,
      usage:obj.usage,
      details:obj.details,
    });

    return await newCreditUsage.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insertCreditUsage";
    throw err;
  }
};




const queryTokensLogsByAggPipeline = async (agg_pipeline) => {
  try {

    return await token_collection.aggregate(agg_pipeline)
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "queryTokensLogsByAggPipeline";
    throw err;
  }
};


const queryLogsErrorByAggPipeline = async (agg_pipeline) => {
  try {
    return await error_log_collection.aggregate(agg_pipeline)
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "queryLogsErrorByAggPipeline";
    throw err;
  }
};

const functionsUsageByAggPipeline = async (agg_pipeline) => {
  try {
    return await function_collection.aggregate(agg_pipeline)
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "functionsUsageByAggPipeline";
    throw err;
  }
};

async function insertTokenUsage(obj){
  try {
    const newTokenUsage = new token_collection({
      userid: obj.userInstance.userid,
      userFirstName: obj.userInstance.user_first_name,
      userLastName: obj.userInstance.user_last_name,
      username: obj.userInstance.user_username,
      model:obj.model,
      prompt_tokens: obj.prompt_tokens,
      completion_tokens: obj.completion_tokens,
      total_tokens: obj.completion_tokens + obj.prompt_tokens
    });

    return await newTokenUsage.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insertTokenUsage";
    throw err;
  }
};


async function dropDialogCollection() {
  const collName = dialog_collection.collection.name;
  const nativeDb = dialog_collection.db.db; // native MongoDB Db
  try {
    const collections = await nativeDb.listCollections({ name: collName }).toArray();
    const exists = collections.length > 0;
    if (!exists) {
      return { dropped: false, reason: "Collection does not exist", collection: collName };
    }
    await dialog_collection.collection.drop();
    return { dropped: true, collection: collName };
  } catch (err) {
    // Handle "NamespaceNotFound" gracefully if thrown by Mongo
    if (err?.codeName === "NamespaceNotFound" || /ns not found/i.test(err?.message || "")) {
      return { dropped: false, reason: "Collection not found", collection: collName };
    }
    err.code = "MONGO_ERR";
    err.place_in_code = "dropDialogCollection";
    throw err;
  }
}

async function updateCompletionInDb(obj){
  try {
    const filter = obj.filter
    const updateBody = obj.updateBody

    return await dialog_collection.findOneAndUpdate(
      filter,
      updateBody
    );

  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateCompletionInDb";
    throw err;
  }
};

async function addTokensUsage(sourceid,numberOfTokens){

  try {
    const filter = { sourceid: sourceid }
    const updateBody = {tokens:numberOfTokens}

    return await dialog_collection.findOneAndUpdate(
      filter,
      updateBody
    );

  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "addTokensUsage";
    throw err;
  }
}


async function updateManyEntriesInDbById(obj){
  try {
    const filter = obj.filter
    const updateBody = obj.updateBody

    return await dialog_collection.updateMany(
      filter,
      updateBody
    );

  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateManyEntriesInDbById";
    throw err;
  }
};

async function addMsgIdToToolCall(obj){
  try {
    const filter = obj.filter
    const updateBody = obj.updateBody

    return await dialog_collection.updateOne(
      filter,
      { 
        $set: updateBody
      }
    );

  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "addMsgIdToToolCall";
    throw err;
  }
};


async function getExtractedTextByReff(content_reff){
  try {

    const filter = { "fullContent.reff": { $in: content_reff}}
    
    return await dialog_collection.find(
      filter
      ,{"fullContent": 1}
    ).lean();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getExtractedTextByReff";
    throw err;
  }
}

async function getUploadedFilesBySourceId(sourceid_list){
  try {

    const filter = { "fileId": { $in: sourceid_list}}
    
    return await dialog_collection.find(
      filter
      ,{sourceid: 1,fileUrl: 1,fileMimeType: 1,fileName:1,fileSizeBytes:1,fileDurationSeconds:1,_id:0}
    ).lean();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getUploadedFilesBySourceId";
    throw err;
  }
}

async function upsertPrompt(promptObj){
  try {
    return await dialog_collection.updateOne(
      { sourceid: promptObj.sourceid, role: promptObj.role },
      promptObj,
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "upsertPrompt";
    throw err;
  }

};

async function updateInputMsgTokenUsage(documentId,tokens){
  try {

    return await dialog_collection.findByIdAndUpdate(
      documentId, 
      { $set: { tokens: tokens } }, 
      { new: true, useFindAndModify: false }
    );
    
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateInputMsgTokenUsage";
    throw err;
  }
};

const updatePromptTokens = async (promptObject) => {

  await dialog_collection.updateOne(
    { sourceid: promptObject.sourceid, role: promptObject.role },
    {
      tokens: promptObject.tokens,
    }
  );
};


async function insertFunctionObject(obj){
  try {
    const newMessage = new dialog_collection(obj);

    const result = await newMessage.save();

    return result
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insertFunctionObject";
    throw err;
  }
};


const upsertCompletionPromise = async (CompletionObject) => {
  try {
    return await dialog_collection.updateOne(
      { sourceid: CompletionObject.sourceid },
      CompletionObject,
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "upsertCompletionPromise";
    throw err;
  }
};


async function getUniqueUserIdsFromDialogs(){
  try {
    const uniqueUserIds = await dialog_collection.distinct("userid");
    return uniqueUserIds;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getUniqueUserIdsFromDialogs";
    throw err;
  }
}

async function  updateToolCallResult(result){
  try {
    const  {content, status,duration, success, fullContent,sourceid} = result

    return await dialog_collection.updateOne(
      { sourceid: sourceid },
      { 
        $set: {
          "content": content,
          "duration": duration,
          "success": success,
          "status": status,
          "fullContent": fullContent
        }
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateToolCallResult";
    throw err;
  }
};

const upsertProfilePromise = async (msg) => {
  try {
    const newProfile = {
      id: msg.from.id,
      id_chat: msg.chat.id,
      is_bot: msg.from.is_bot,
      first_name: msg.from.first_name,
      last_name: msg.from.last_name,
      username: msg.from.username,
      language_code: msg.from.language_code,
    };

    return await telegram_profile_collection.updateOne(
      { id: msg.from.id },
      newProfile,
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "upsertProfilePromise";
    throw err;
  }
};

async function updateProfile(user_id, dataDotNotation){

  try {
    const $set = dataDotNotation;
    return await telegram_profile_collection.updateOne(
      { id: user_id},
      { $set },
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateProfile";
    throw err;
  }
}

async function registerUser(requestMsgInstance,token) {
  try {
 
    return await telegram_profile_collection.findOneAndUpdate(
      { token: token },
      {
        id: requestMsgInstance.user.userid,
        id_chat: requestMsgInstance.chatId,
        is_bot: requestMsgInstance.user.is_bot,
        first_name: requestMsgInstance.user.user_first_name,
        last_name: requestMsgInstance.user.user_last_name,
        username: requestMsgInstance.user.user_username,
        language_code: requestMsgInstance.user.language_code,
        "permissions.registered": true,
        "permissions.registeredDTUTC": Date.now()
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "registerUser";
    throw err;
  }
}

async function registerBotUser(botInfo){
  try {
    const newProfile = {
      $set: {
        id: botInfo.id,
        id_chat: botInfo.id,
        is_bot: botInfo.is_bot,
        first_name: botInfo.first_name,
        last_name: botInfo.last_name,
        username: botInfo.username,
        language_code: botInfo.language_code,
        "permissions.registered": true,
        "permissions.readInfo": true,
        plan: "free",
        token: "00000000000000000000000000",
        active: true
      },
      // Only set these fields if they don't already exist
      $setOnInsert: {
        "permissions.registeredDTUTC": Date.now(),
        "permissions.readInfoDTUTC": Date.now()
      }
    };

    return await telegram_profile_collection.updateOne(
      { id: botInfo.id },
      newProfile,
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "registerBotUser";
    throw err;
  }
}

async function insert_blank_profile(newToken){

  try {

    const newBlankProfile = new telegram_profile_collection({
      token:newToken,
      plan: "free",
      permissions: {groups:["basic"]},
      active: true
    });
    return await newBlankProfile.save();
  } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "insert_blank_profile";
      throw err;
  }
}

const insert_profilePromise = async (msg) => {
  try {

    const newProfile = new telegram_profile_collection({
      id: msg.from.id,
      id_chat: msg.chat.id,
      is_bot: msg.from.is_bot,
      first_name: msg.from.first_name,
      last_name: msg.from.last_name,
      username: msg.from.username,
      language_code: msg.from.language_code,
    });

    return await newProfile.save();
  } catch (err) {
    if (err.code === 11000) {
      return err.keyValue;
    } else {
      err.code = "MONGO_ERR";
      err.place_in_code = "insert_profilePromise";
      throw err;
    }
  }
};

const updateOnePromise = async (model, filter, update, options) => {
  try {
    return await model.updateOne(filter, update, options);
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "updateOnePromise";
    throw err;
  }
};

const getDocByTgmBtnsFlag = async (userid, regime) => {

  try {
    const filter = { userid: userid, regime: regime,telegramMsgBtns: true };
    const result = await dialog_collection
      .find(
        filter,
        { telegramMsgId: 1}
      )
      .lean()
   //   .sort({ _id: "asc" }) сортировка по id начала сбоить. Берем сообщения в том порядке, как они в базе.
      .exec();
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getDocByTgmBtnsFlag";
    throw err;
  }
};


const getDocByTgmRegenerateBtnFlag = async (userid, regime) => {
  
  try {
    const filter = { userid: userid, regime: regime,telegramMsgRegenerateBtns: true };
    const result = await dialog_collection
      .find(
        filter,
        { telegramMsgId: 1,sourceid:1,telegramMsgReplyMarkup:1}
      )
      .lean()
   //   .sort({ _id: "asc" }) сортировка по id начала сбоить. Берем сообщения в том порядке, как они в базе.
      .exec();
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getDocByTgmRegenerateBtnFlag";
    throw err;
  }
};


async function getLastCompletion(userid, regime) {
  try {
    const filter = { userid: userid, regime: regime, role: "assistant" };
    const result = await dialog_collection
      .findOne(
        filter
      )
      .sort({ _id: -1 }) // Sort by _id in descending order to get the most recent document
      .lean()
      .exec();
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getLastCompletion";
    throw err;
  }
};

const getDialogueFromDB = async (userid, regime) => {

  try {
    const filter = { userid: userid, regime: regime };
    const result = await dialog_collection
      .find(
        filter,
        { role: 1, 
          content: 1, 
          status: 1, 
          type: 1, 
          function_name: 1, 
          respoonseId: 1,
          tool_call_id:1,
          function_arguments:1,
          tokens:1,
          image_size_bites:1,
          image_input:1,
          includeInSearch:1,
          mcp_tool_call_id:1,
          mcp_tools:1,
          mcp_server_label:1,
          mcp_error:1,
          mcp_approval_request_id:1,
          mcp_call_name:1,
          mcp_call_arguments:1,
          mcp_approval_response_id:1,
          mcp_call_approve:1,
          mcp_call_user_response_reason:1,
          mcp_call_id:1,
          mcp_call_error:1,
          mcp_call_output:1,
          image_id:1,
          image_result_base64: 1,
          reasoning_id:1,
          reasoning_encrypted_content:1,
          reasoning_summary: 1,
          code_id: 1,
          code_container_id: 1,
          code: 1,
          outputs: 1,
          expires_at: 1
        }
      )
      .lean()
   //   .sort({ _id: "asc" }) сортировка по id начала сбоить. Берем сообщения в том порядке, как они в базе.
      .exec();
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getDialogueFromDB";
    throw err;
  }
};


async function update_models_listPromise(model_list) {
  if (model_list.length === 0) {
    const error = new Error("Model list is empty");
    throw error;
  }
  
  const operations = model_list.map(model => ({
    updateOne: {
      filter: { id: model.id },
      update: model,
      upsert: true
    }
  }));
  
  await telegram_model_collection.bulkWrite(operations);
  
  return model_list.length;
}


async function update_elevenlabs_models_list(model_list) {
  if (model_list.length === 0) {
    const error = new Error("ElevenLabs model list is empty");
    throw error;
  }
  
  const operations = model_list.map(model => ({
    updateOne: {
      filter: { model_id: model.model_id },
      update: model,
      upsert: true
    }
  }));
  
  await elevenlabs_models_collection.bulkWrite(operations);
  return model_list.length;
}

async function update_elevenlabs_voices_list(voices_list) {
  if (voices_list.length === 0) {
    const error = new Error("ElevenLabs voices list is empty");
    throw error;
  }
  
  const operations = voices_list.map(voice => ({
    updateOne: {
      filter: { voice_id: voice.voice_id },
      update: voice,
      upsert: true
    }
  }));
  
  await elevenlabs_voices_collection.bulkWrite(operations);
  return voices_list.length;
}


async function insert_permissions_migrationPromise(msg) {
  try {

    return await telegram_profile_collection.findOneAndUpdate(
      { id: msg.from.id },
      {
        "permissions.registered": true,
        "permissions.registeredDTUTC": msg.permissions.registeredDTUTC
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insert_permissions_migrationPromise";
    throw err;
  }
}

async function insert_adminRolePromise(requestMsgInstance) {
  try {

    return await telegram_profile_collection.findOneAndUpdate(
      { id: requestMsgInstance.user.userid},
      {
        "permissions.admin": true,
        "permissions.adminDTUTC": Date.now(),
        "permissions.adminCode": process.env.ADMIN_KEY,
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insert_adminRolePromise";
    throw err;
  }
}

async function insert_read_sectionPromise(requestMsgInstance) {
  try {

    return await telegram_profile_collection.findOneAndUpdate(
      { id: requestMsgInstance.user.userid },
      {
        "permissions.readInfo": true,
        "permissions.readInfoDTUTC": Date.now(),
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insert_read_sectionPromise";
    throw err;
  }
}

async function insert_read_section_migrationPromise(msg) {
  try {

    return await telegram_profile_collection.findOneAndUpdate(
      { id: msg.from.id },
      {
        "permissions.readInfo": true,
        "permissions.readInfoDTUTC": msg.permissions.readInfoDTUTC["$date"],
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "insert_read_section_migrationPromise";
    throw err;
  }
}

const setDefaultVauesForNonExiting = async () => {
  try {
    const profiles = await telegram_profile_collection.find({}).lean();
    const BATCH_SIZE = 100; // Process in smaller batches to avoid hitting limits
    let processedCount = 0;
    let totalModified = 0;
    let totalMatched = 0;
    
    const newProfile = new telegram_profile_collection().toObject();
 
    // Process profiles in batches
    for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
      const batch = profiles.slice(i, i + BATCH_SIZE);
      const bulkOps = [];
      
      for (const profile of batch) {
        // Create a new profile document with default values
        
        // Remove _id from new profile to avoid conflicts
        delete newProfile._id;
        
        // Merge the existing profile data with default values
        // This preserves existing data while adding any missing default fields
        const mergedProfile = { ...newProfile, ...profile };
        // Add to bulk operations
        bulkOps.push({
          replaceOne: {
            filter: { id: profile.id },
            replacement: mergedProfile,
            upsert: true
          }
        });
      }
      
      // Execute operations for this batch
      if (bulkOps.length > 0) {
        const result = await telegram_profile_collection.bulkWrite(bulkOps);
        totalModified += result.modifiedCount || 0;
        totalMatched += result.matchedCount || 0;
      }
      
      processedCount += batch.length;
    }
    
    return { modifiedCount: totalModified, matchedCount: totalMatched, processedCount };
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "setDefaultVauesForNonExiting";
    throw err;
  }
};

async function replaceProfileValues(dry_run = true) {

  const replacemant_lists = require("../../config/replacement_lists.js");
  const func = require("../common_functions.js")

  const replacementList = replacemant_lists.profile

  try {
    // Get all profiles
    const profiles = await telegram_profile_collection.find({}).lean();
    const BATCH_SIZE = 100; // Process in smaller batches to avoid hitting limits
    let processedCount = 0;
    let totalModified = 0;
    let totalMatched = 0;
    let changesRequired = [];
    
    // Create a dot notation path getter utility
    const getValueByPath = (obj, path) => {
      return path.split('.').reduce((prev, curr) => {
        return prev && prev[curr] !== undefined ? prev[curr] : undefined;
      }, obj);
    };
    
    // Set value at path utility
    const setValueByPath = (obj, path, value) => {
      const parts = path.split('.');
      let current = obj;
      
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      
      current[parts[parts.length - 1]] = value;
      return obj;
    };
    
    // Process profiles in batches
    for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
      const batch = profiles.slice(i, i + BATCH_SIZE);
      const bulkOps = [];
      
      for (const profile of batch) {
        let needsUpdate = false;
        let updatedProfile = { ...profile };
        let profileChanges = { userId: profile.id, datetime:new Date(),changes: [] };
        
        // Check each replacement path
        for (const replacement of replacementList) {
          const currentValue = getValueByPath(profile, replacement.path);
          
          // If the current value matches what we want to replace
          if (currentValue === replacement.asis) {
            // Record this change
            profileChanges.changes.push({
              path: replacement.path, 
              from: currentValue, 
              to: replacement.tobe
            });
            
            // Update the value if not in dry run mode
            if (!dry_run) {
              updatedProfile = setValueByPath(updatedProfile, replacement.path, replacement.tobe);
              needsUpdate = true;
            }
          }
        }
        
        // Add to changes log if any changes planned
        if (profileChanges.changes.length > 0) {
          changesRequired.push(profileChanges);
        }
        
        // Add to bulk operations if there are changes and not in dry run
        if (needsUpdate && !dry_run) {
          bulkOps.push({
            replaceOne: {
              filter: { id: profile.id },
              replacement: updatedProfile
            }
          });
        }
      }
      
      // Execute operations for this batch if not in dry run mode
      if (bulkOps.length > 0 && !dry_run) {
        const result = await telegram_profile_collection.bulkWrite(bulkOps);
        totalModified += result.modifiedCount || 0;
        totalMatched += result.matchedCount || 0;
      }
      
      processedCount += batch.length;
    }
    
    let filePath = null;
    if(changesRequired.length>0){
    filePath = func.saveTextToTempFile(JSON.stringify(changesRequired,null,4),"prifiles_replacement_details.json")
    }
    
    return { 
      dryRun: dry_run,
      profilesProcessed: processedCount,
      changesRequired: dry_run ? changesRequired.length : totalMatched, 
      modifiedInDB: totalModified,
      changesRequiredDetails: filePath 
    };
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "replaceProfileValues";
    throw err;
  }
}

const get_tokenUsageByRegimes = () => {

  return new Promise(async (resolve, reject) => {
    try {
      token_collection
        .aggregate(
          [
            {
              $group: {
                _id: {
                  regime: "$regime",
                },
                requests: { $sum: 1 },
                tokens: { $sum: "$total_tokens" },
              },
            },
          ],
          function (err, res) {
            if (err) {
              err.code = "MONGO_ERR";
              reject(err);
            } else {
              resolve(res);
            }
          }
        )
        .sort({ requests: "desc" });
    } catch (err) {
      reject(err);
    }
  });
};

async function profileMigrationScript(path) {
  
  try {
    const profileArray = JSON.parse(await fs.readFile(path, "utf8"));

    for (const item of profileArray) {
      let msg = {
        from: {
          id: item.id,
          is_bot: item.is_bot,
          first_name: item?.first_name,
          last_name: item?.last_name,
          username: item?.username,
          language_code: item?.language_code,
        },
        chat: { id: item.id_chat },
        permissions: {
          registeredDTUTC: item.permissions.registeredDTUTC?.$date,
          readInfoDTUTC: item.permissions?.readInfoDTUTC?.$date,
        },
      };

      await insert_profilePromise(msg); //Пробуем вставить профиль
      const res = await insert_permissions_migrationPromise(msg);
      console.log(res);

      const result = await insert_read_section_migrationPromise(msg);
      console.log(result);
    }
  } catch (err) {
    err.place_in_code = "profileMigrationScript";
    throw err;
  }
}

const get_tokenUsageByDates = () => {
  const func_name = "get_tokenUsageByDates";
  return new Promise(async (resolve, reject) => {
    try {
      const tenDaysAgo = moment().subtract(10, "days").startOf("day").toDate();    
      token_collection
        .aggregate(
          [
            {
              $match: {
                datetimeUTC: { $gte: tenDaysAgo },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%d-%m-%Y",
                    date: "$datetimeUTC",
                    timezone: "Europe/Moscow",
                  },
                },
                date: { $max: "$datetimeUTC" },
                requests: { $sum: 1 },
                tokens: { $sum: "$total_tokens" },
                uniqueUsers: { $addToSet: "$userid" },
              },
            },
            {
              $project: {
                _id: 1,
                requests: 1,
                uniqueUsers: { $size: "$uniqueUsers" },
                tokens: 1,
              },
            },
          ],
          function (err, res) {
            if (err) {
              err.code = "MONGO_ERR";
              err.place_in_code = func_name;
              reject(err);
            } else {
              resolve(res);
            }
          }
        )
        .sort({ date: "desc" });
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const get_errorsByMessages = () => {
  const func_name = "get_errorsByMessages";
  return new Promise(async (resolve, reject) => {
    try {

      error_log_collection
        .aggregate(
          [
            {
              $group: {
                _id: "$error.message",
                count: { $sum: 1 },
              },
            },
          ],
          function (err, res) {
            if (err) {
              err.code = "MONGO_ERR";
              err.place_in_code = func_name;
              reject(err);
            } else {
              resolve(res);
            }
          }
        )
        .sort({ count: "desc" });
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const get_tokenUsageByUsers = () => {
  return new Promise(async (resolve, reject) => {
    try {
      token_collection
        .aggregate(
          [
            {
              $group: {
                _id: {
                  userid: "$userid",
                },
                userFirstName: { $max: "$userFirstName" },
                userLastName: { $max: "$userLastName" },
                username: { $max: "$username" },
                requests: { $sum: 1 },
                tokens: { $sum: "$total_tokens" },
                last_request: { $max: "$datetimeUTC" },
              },
            },
          ],
          function (err, res) {
            if (err) {
              err.code = "MONGO_ERR";
              reject(err);
            } else {
              resolve(res);
            }
          }
        )
        .sort({ requests: "desc" });
    } catch (err) {
      reject(err);
    }
  });
};


const getCompletionById = async (sourceid, regime) => {

  try {
    const result = await dialog_collection
      .find({ sourceid: sourceid, regime: regime })
      .lean()
      .exec(); // Use exec() to return a promise
    return result;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "getCompletionById";
    throw err;
  }
};




async function getUserProfileByid(userid){
  try{

    return await telegram_profile_collection
      .find({ id: userid })
      .lean();

  } catch(err){
    throw err
  }
}

async function getUserProfileByToken(token){
  try{

    return await telegram_profile_collection
      .find({ token: token })
      .lean();

  } catch(err){
    throw err
  }
}


async function UpdateSettingPromise(requestMsgInstance, pathString, value){
  try {

    const res = await telegram_profile_collection.updateOne(
      { id: requestMsgInstance.user.userid },
      { $set: { [pathString]: value } }
    );
    return res;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "UpdateSettingPromise";
    throw err;
  }
};



async function updateCurrentRegimeSetting(requestMsgInstance){
  try {

      const result = await telegram_profile_collection.updateOne(
          { id: requestMsgInstance.user.userid }, 
          { $set: { "settings.current_regime": requestMsgInstance.user.currentRegime} }
      );
      return result;
  } catch (err) {
      if (!err.code) { // Only override code if it's not already set
          err.code = "MONGO_ERR";
      }
      err.place_in_code = "updateCurrentRegimeSetting";
      throw err;
  }
};


async function get_all_profiles(){

    const docs = await telegram_profile_collection
    .find({})
    .sort({ datetimeUTC: "asc" })
    .lean()
    .exec()

    return docs

};

async function get_all_registeredPromise() {
  try {
  
    const doc = await telegram_profile_collection
      .find({ "permissions.registered": true })
      .lean();

    const result = doc.map((item) => item.id);

    return result;
  } catch (err) {
    throw err;
  }
}

const get_all_adminPromise = () => {
  return new Promise(async (resolve, reject) => {
    try {
 
      telegram_profile_collection
        .find({ "permissions.admin": true }, function (err, doc) {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            resolve(doc.map((item) => item.id)); //Возвращаем array idшников
          }
        })
        .lean();
    } catch (err) {
      reject(err);
    }
  });
};

const get_all_readPromise = () => {
  return new Promise(async (resolve, reject) => {
    try {
  
      telegram_profile_collection
        .find({ "permissions.readInfo": true }, function (err, doc) {
          if (err) {
            err.code = "MONGO_ERR";

            reject(err);
          } else {
           // console.log(doc.length);
            resolve(doc.map((item) => item.id)); //Возвращаем array idшников
          }
        })
        .lean();
    } catch (err) {

      reject(err);
    }
  });
};




async function deleteMsgFromDialogById (requestMsgInstance){

  try {
    const filter = { userid: requestMsgInstance.user.userid, TelegramMsgId: requestMsgInstance.refMsgId};
    const res = await dialog_collection.deleteMany(filter);
    return res;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteMsgFromDialogById";
    throw err;
  }
};

async function deleteMsgFromDialogByResponseId (userid, responseId){

  try {
    const filter = { userid: userid, responseId: responseId };
    const res = await dialog_collection.deleteMany(filter);
    return res;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteMsgFromDialogByResponseId";
    throw err;
  }
};

async function deleteMsgFromDialogByFileId (userid, fileId){

  try {

    const filter = { userid: userid, "content.file_id": { $in: fileId }};
    console.log(`Deleting messages with filter: ${JSON.stringify(filter)}`);
    const res = await dialog_collection.deleteMany(filter);
    return res;
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = "deleteMsgFromDialogByFileId";
    throw err;
  }
};

const deleteDialogByUserPromise = (userid, regime) => {

  return new Promise(async (resolve, reject) => {
    try {

      let filter;
      if (regime) {
        filter = { userid: userid, regime: regime };
      } else {
        filter = { userid: userid };
      }

      dialog_collection.deleteMany(filter, (err, res) => {
        if (err) {
          err.code = "MONGO_ERR";
          reject(err);
        } else {
          resolve(res);
        }
      });
    } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "deleteDialogByUserPromise";
      reject(err);
    }
  });
};

const delete_profile_by_id_arrayPromise = (profileIdArray) => {

  return new Promise(async (resolve, reject) => {
    try {

      telegram_profile_collection.deleteMany(
        { id: { $in: profileIdArray } },
        (err, res) => {
          if (err) {
            err.code = "MONGO_ERR";
            reject(err);
          } else {
            resolve(res);
          }
        }
      );
    } catch (err) {
      err.code = "MONGO_ERR";
      err.place_in_code = "delete_profile_by_id_arrayPromise";
      reject(err);
    }
  });
};

module.exports = {
  insert_profilePromise,
  insert_error_logPromise,
  insert_read_sectionPromise,
  get_all_registeredPromise,
  get_all_readPromise,
  get_all_profiles,
  update_models_listPromise,
  updatePromptTokens,
  upsertCompletionPromise,
  deleteDialogByUserPromise,
  insertTokenUsage,
  upsertProfilePromise,
  delete_profile_by_id_arrayPromise,
  insert_reg_eventPromise,
  insert_adminRolePromise,
  get_all_adminPromise,
  setDefaultVauesForNonExiting,
  UpdateSettingPromise,
  get_tokenUsageByUsers,
  get_tokenUsageByRegimes,
  get_errorsByMessages,
  get_tokenUsageByDates,
  getCompletionById,
  profileMigrationScript,
  insert_permissions_migrationPromise,
  insert_read_section_migrationPromise,
  queryTokensLogsByAggPipeline,
  mongooseVersion,
  queryLogsErrorByAggPipeline,
  insert_details_logPromise,
  insertFunctionUsagePromise,
  getUserProfileByid,
  deleteMsgFromDialogById,
  upsertPrompt,
  updateInputMsgTokenUsage,
  updateCurrentRegimeSetting,
  updateCompletionInDb,
  insertFunctionObject,
  addMsgIdToToolCall,
  insert_blank_profile,
  getUserProfileByToken,
  registerUser,
  insert_mdj_msg,
  get_mdj_msg_byId,
  saveHash,
  getJsonBy,
  updateManyEntriesInDbById,
  getKwgItemBy,
  getKwgItemsForUser,
  getUploadedFilesBySourceId,
  functionsUsageByAggPipeline,
  createDialogueMeta,
  deleteDialogueMeta,
  updateDialogueMeta,
  readDialogueMeta,
  replaceProfileValues,
  resetAllInProgressDialogueMeta,
  updateToolCallResult,
  getDialogueFromDB,
  getDocByTgmBtnsFlag,
  getLastCompletion,
  getFunctionQueueByName,
  addFunctionToQueue,
  removeFunctionFromQueue,
  getExtractedTextByReff,
  registerBotUser,
  insertFeatureUsage,
  update_elevenlabs_models_list,
  update_elevenlabs_voices_list,
  insertCreditUsage,
  getExchangeRateInternational,
  saveExchangeRateInternational,
  getDocByTgmRegenerateBtnFlag,
  saveNewEvent,
  getEventsList,
  addTokensUsage,
  saveNewTestDiagram,
  addCorrectionToInstructions,
  getSelfCorrectedInstructions,
  saveTempReplyMarkup,
  getTempReplyMarkup,
  deleteTempReplyMarkup,
  saveResourceToTempStorage,
  deleteTempStorageByUserId,
  updateDataInTempStorage,
  getNotExtractedResourcesShort,
  getResourcesById,
  getExtractedResourcesShort,
  getContentByFilename,
  insertContentToOutputStorage,
  deleteOutputStorageByUserId,
  getOAIStorageFiles,
  deleteTempStorageByUserIdAndAgent,
  deleteOutputStorageByUserIdAndAgent,
  getUniqueUserIdsFromDialogs,
  dropDialogCollection,
  dropTempResourceStorageCollection,
  dropOutputDocumentCollection,
  dropDialogueMetaCollection,
  updateProfile,
  deleteMsgFromDialogByFileId,
  updateDotNotationDialogueMeta,
  removeOAIDataInTempStorage,
  deleteMsgFromDialogByResponseId
};
