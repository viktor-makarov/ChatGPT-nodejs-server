const otherfunc = require("./other_func");
const mongoose = require("mongoose");
const scheemas = require("./mongo_Schemas.js");
const moment = require("moment-timezone");
const fs = require("fs").promises;

// Define db connection string depending on circumstances
let connectionString_self_mongo = process.env.MONGODB_CONNECTION;
let db_name = appsettings.mongodb_names.db_prod

if (process.env.PROD_RUN == "true") {
  connectionString_self_mongo = process.env.MONGODB_CONNECTION; //via internal network of docker-compose
  db_name = appsettings.mongodb_names.db_prod
} else {
  connectionString_self_mongo = process.env.MONGODB_CONNECTION_DEV; ////test db for debuging
  db_name = appsettings.mongodb_names.db_dev
}

async function Connect_to_mongo(connectionString, db) {
  const connection = await mongoose.connect(
    connectionString + "/" + db + "?authSource=admin",
    appsettings.mongodb_connections.options
  );
  return connection;
}

async function insert_error_logPromise(error, comment) {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const error_log_collection = connection.model(
      appsettings.mongodb_names.coll_errors_log,
      scheemas.LogsSheema
    );
    const newLog = new error_log_collection({
      error: {
        code: error.code,
        original_code: error.original_code,
        message: error.message,
        stack: error.stack,
        place_in_code: error.place_in_code,
        user_message: error.user_message,
      },
      comment: comment,
    });
    return await newLog.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
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
  const func_name = arguments.callee.name;
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const reg_log_collection = connection.model(
      appsettings.mongodb_names.coll_reg_log,
      scheemas.RegistrationLogSheema
    );
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
    err.place_in_code = arguments.callee.name;
    throw err;
  }
}

const insertUsagePromise = async (msg, completion) => {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const token_collection = connection.model(
      appsettings.mongodb_names.coll_tokens_log,
      scheemas.TokensLogSheema
    );
    const prompt_tokens_count = otherfunc.countTokens(msg.text);
    const completion_tokens_count = otherfunc.countTokens(completion);
    const newTokenUsage = new token_collection({
      userid: msg.from.id,
      userFirstName: msg.from.first_name,
      userLastName: msg.from.last_name,
      username: msg.from.username,
      prompt_tokens: prompt_tokens_count,
      completion_tokens: completion_tokens_count,
      total_tokens: prompt_tokens_count + completion_tokens_count,
    });

    return await newTokenUsage.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
};

const insertUsageDialoguePromise = async (
  msg,
  previous_dialogue_tokens,
  completion_tokens_count,
  regime
) => {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const token_collection = connection.model(
      appsettings.mongodb_names.coll_tokens_log,
      scheemas.TokensLogSheema
    );
    const newTokenUsage = new token_collection({
      userid: msg.from.id,
      userFirstName: msg.from.first_name,
      userLastName: msg.from.last_name,
      username: msg.from.username,
      prompt_tokens: previous_dialogue_tokens,
      completion_tokens: completion_tokens_count,
      total_tokens: completion_tokens_count + previous_dialogue_tokens,
      regime: regime,
    });

    return await newTokenUsage.save();
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
};

const upsertPromptPromise = async (msg, regime) => {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const dialog_collection = connection.model(
      appsettings.mongodb_names.coll_dialogs,
      scheemas.TelegramDialogSheema
    );
    const newPrompt = {
      sourceid: msg.message_id,
      createdAtSourceTS: msg.date,
      createdAtSourceDT_UTF: new Date(msg.date * 1000),
      TelegramMsgId: msg.message_id,
      userid: msg.from.id,
      userFirstName: msg.from.first_name,
      userLastName: msg.from.last_name,
      regime: regime,
      role: "user",
      roleid: 1,
      content: msg.text,
      tokens: otherfunc.countTokens(msg.text),
    };

    return await dialog_collection.updateOne(
      { sourceid: msg.message_id, role: newPrompt.role },
      newPrompt,
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
};

const upsertSystemPromise = async (content, msg, regime) => {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const dialog_collection = connection.model(
      appsettings.mongodb_names.coll_dialogs,
      scheemas.TelegramDialogSheema
    );
    const newPrompt = {
      sourceid: msg.message_id,
      createdAtSourceTS: msg.date,
      createdAtSourceDT_UTF: new Date(msg.date * 1000),
      TelegramMsgId: msg.message_id,
      userid: msg.from.id,
      userFirstName: msg.from.first_name,
      userLastName: msg.from.last_name,
      regime: regime,
      role: "system",
      roleid: 0,
      content: content,
      tokens: otherfunc.countTokens(content),
    };

    return await dialog_collection.updateOne(
      { sourceid: msg.message_id, role: newPrompt.role },
      newPrompt,
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
};

const upsertCompletionPromise = async (CompletionObject) => {
  try {
    CompletionObject.roleid = 2; //ДОбавляем roleid
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const dialog_collection = connection.model(
      appsettings.mongodb_names.coll_dialogs,
      scheemas.TelegramDialogSheema
    );

    return await dialog_collection.updateOne(
      { sourceid: CompletionObject.sourceid },
      CompletionObject,
      { upsert: true }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
};

const upsertProfilePromise = async (msg) => {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );
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
    err.place_in_code = arguments.callee.name;
    throw err;
  }
};

const insert_profilePromise = async (msg) => {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );
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
      err.place_in_code = arguments.callee.name;
      throw err;
    }
  }
};

const updateOnePromise = async (model, filter, update, options) => {
  try {
    return await model.updateOne(filter, update, options);
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
};

const getDialogueByUserIdPromise = (userid, regime) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const dialogue_collection = connection.model(
        appsettings.mongodb_names.coll_dialogs,
        scheemas.TelegramDialogSheema
      );
      dialogue_collection
        .find(
          { userid: userid, regime: regime },
          { _id: 0, role: 1, name: 1, content: 1, tokens: 1 }
        )
        .lean()
        .sort({ createdAtSourceTS: "asc", roleid: "asc" })
        .exec((err, res) => {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            resolve(res);
          }
        });
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const update_models_listPromise = (model_list) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_model_collection = connection.model(
        appsettings.mongodb_names.coll_models,
        scheemas.ModelsSheema
      );

      if (model_list.length > 0) {
        //Если array пуст, то сразу возвращаем null
        for (const model of model_list) {
          try {
            await updateOnePromise(
              telegram_model_collection,
              { id: model.id },
              model,
              { upsert: true }
            );
          } catch (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          }
        }
        resolve("Success");
      } else {
        resolve(null);
      }
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

async function insert_permissionsPromise(msg) {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );
    return await telegram_profile_collection.findOneAndUpdate(
      { id: msg.from.id },
      {
        "permissions.registered": true,
        "permissions.registeredDTUTF": Date.now(),
        "permissions.registrationCode": process.env.REGISTRATION_KEY,
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
}

async function insert_permissions_migrationPromise(msg) {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );
    return await telegram_profile_collection.findOneAndUpdate(
      { id: msg.from.id },
      {
        "permissions.registered": true,
        "permissions.registeredDTUTF": msg.permissions.registeredDTUTF,
        "permissions.registrationCode": msg.permissions.registrationCode,
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
}

async function insert_adminRolePromise(msg) {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );
    return await telegram_profile_collection.findOneAndUpdate(
      { id: msg.from.id },
      {
        "permissions.admin": true,
        "permissions.adminDTUTF": Date.now(),
        "permissions.adminCode": process.env.ADMIN_KEY,
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
}

async function insert_read_sectionPromise(msg) {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );

    return await telegram_profile_collection.findOneAndUpdate(
      { id: msg.from.id },
      {
        "permissions.readInfo": true,
        "permissions.readInfoDTUTF": Date.now(),
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
}

async function insert_read_section_migrationPromise(msg) {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );

    return await telegram_profile_collection.findOneAndUpdate(
      { id: msg.from.id },
      {
        "permissions.readInfo": true,
        "permissions.readInfoDTUTF": msg.permissions.readInfoDTUTF["$date"],
      }
    );
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = arguments.callee.name;
    throw err;
  }
}

const setDefaultVauesForNonExiting = async () => {
  const func_name = arguments.callee.name;

  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );

    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );

    const profiles = await telegram_profile_collection.find({});

    for (const item of profiles) {
      //сначала удаляем
      await telegram_profile_collection.deleteOne({ id: item.id });

      //потом вставляем дефолтные занчения
      const newProfile = new telegram_profile_collection();
      await telegram_profile_collection.updateOne(
        { id: item.id },
        { $setOnInsert: newProfile },
        { upsert: true }
      );

      let plainItam = item.toObject();
      delete plainItam._id;

      //потом вставляем значения из удаленного профиля
      await telegram_profile_collection.updateOne(
        { id: plainItam.id },
        { $set: plainItam }
      );
    }
  } catch (err) {
    err.code = "MONGO_ERR";
    err.place_in_code = func_name;
    throw err;
  }
};

const get_tokenUsageByRegimes = () => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const token_collection = connection.model(
        appsettings.mongodb_names.coll_tokens_log,
        scheemas.TokensLogSheema
      );
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
              err.place_in_code = func_name;
              reject(err);
            } else {
              resolve(res);
            }
          }
        )
        .sort({ requests: "desc" });
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

async function profileMigrationScript(path) {
  try {
    const profileArray = JSON.parse(await fs.readFile(path, "utf8"));

    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );
    const telegram_profile_collection = connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema
    );

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
          registeredDTUTF: item.permissions.registeredDTUTF?.$date,
          registrationCode: item.permissions.registrationCode,
          readInfoDTUTF: item.permissions?.readInfoDTUTF?.$date,
        },
      };

      await insert_profilePromise(msg); //Пробуем вставить профиль
      const res = await insert_permissions_migrationPromise(msg);
      console.log(res);

      const result = await insert_read_section_migrationPromise(msg);
      console.log(result);
    }
  } catch (err) {
    err.place_in_code = arguments.callee.name;
    throw err;
  }
}

const get_tokenUsageByDates = () => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const token_collection = connection.model(
        appsettings.mongodb_names.coll_tokens_log,
        scheemas.TokensLogSheema
      );
      const tenDaysAgo = moment().subtract(10, "days").startOf("day").toDate();

      token_collection
        .aggregate(
          [
            {
              $match: {
                datetimeUTF: { $gte: tenDaysAgo },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%d-%m-%Y",
                    date: "$datetimeUTF",
                    timezone: "Europe/Moscow",
                  },
                },
                date: { $max: "$datetimeUTF" },
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
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const error_log_collection = connection.model(
        appsettings.mongodb_names.coll_errors_log,
        scheemas.LogsSheema
      );
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
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const token_collection = connection.model(
        appsettings.mongodb_names.coll_tokens_log,
        scheemas.TokensLogSheema
      );
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
                last_request: { $max: "$datetimeUTF" },
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
        .sort({ requests: "desc" });
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const getCompletionById = (sourceid, regime) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const dialog_collection = connection.model(
        appsettings.mongodb_names.coll_dialogs,
        scheemas.TelegramDialogSheema
      );

      dialog_collection
        .find({ sourceid: sourceid, regime: regime }, function (err, res) {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            resolve(res);
          }
        })
        .lean();
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const get_all_settingsPromise = () => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );
      telegram_profile_collection
        .find({}, function (err, res) {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            const settingsDict = {};
            res.forEach((item) => {
              settingsDict[item.id] = item.settings;
            });
            resolve(settingsDict);
          }
        })
        .lean();
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const UpdateSettingPromise = (msg, pathString, value) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );
      telegram_profile_collection.updateOne(
        { id: msg.from.id },
        { $set: { [pathString]: value } },
        (err, res) => {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            resolve(res);
          }
        }
      );
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const UpdateCurrentRegimeSettingPromise = (msg, regime) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );

      telegram_profile_collection.updateOne(
        { id: msg.from.id },
        { "settings.current_regime": regime },
        (err, res) => {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            resolve(res);
          }
        }
      );
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const get_all_profilesPromise = () => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );
      telegram_profile_collection
        .find({}, function (err, doc) {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            resolve(doc); //Возвращаем array idшников
          }
        })
        .sort({ datetimeUTF: "asc" })
        .lean();
    } catch (err) {
      reject(err);
    }
  });
};

async function get_all_registeredPromise() {
  try {
    const connection = await Connect_to_mongo(
      connectionString_self_mongo,
      db_name
    );

    const telegram_profile_collection = await connection.model(
      appsettings.mongodb_names.coll_profiles,
      scheemas.ProfileSheema2
    );

    const doc = await telegram_profile_collection
      .find({ "permissions.registered": true })
      .lean();

    const result = doc.map((item) => item.id);

    return result;
  } catch (err) {
    err.place_in_code = arguments.callee.name;
    throw err;
  }
}

const get_all_adminPromise = () => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );
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
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const get_all_readPromise = () => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );
      telegram_profile_collection
        .find({ "permissions.readInfo": true }, function (err, doc) {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
           // console.log(doc.length);
            resolve(doc.map((item) => item.id)); //Возвращаем array idшников
          }
        })
        .lean();
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const DeleteNotUpToDateProfilesPromise = () => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );

      const filter = {
        "permissions.registrationCodeUpToDate": false,
        admin: { $exists: false },
      };

      telegram_profile_collection.deleteMany(filter, (err, res) => {
        if (err) {
          err.code = "MONGO_ERR";
          err.place_in_code = func_name;
          reject(err);
        } else {
          resolve(res);
        }
      });
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const UpdateProfilesRegistrationCodeUpToDatePromise = (registration_code) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );
      var result_true;
      var result_false;
      //Сначала пометим все профили, где код соответствует
      telegram_profile_collection.updateMany(
        {
          $and: [
            { permissions: { $exists: true } },
            {
              "permissions.registrationCode": registration_code,
            },
          ],
        },
        { "permissions.registrationCodeUpToDate": true },
        (err, res) => {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            result_true = res;
            //Затем все, где не соответствует
            telegram_profile_collection.updateMany(
              {
                $and: [
                  { permissions: { $exists: true } },
                  {
                    "permissions.registrationCode": { $ne: registration_code },
                  },
                ],
              },
              { "permissions.registrationCodeUpToDate": false },
              (err, res) => {
                if (err) {
                  err.code = "MONGO_ERR";
                  err.place_in_code = func_name;
                  reject(err);
                } else {
                  result_false = res;
                  resolve({
                    upToDate: result_true.n,
                    notUpToDate: result_false.n,
                  });
                }
              }
            );
          }
        }
      );
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const get_all_profiles_with_old_registrationPromise = () => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );
      telegram_profile_collection
        .find(
          {
            "permissions.registrationCodeUpToDate": false,
          },
          function (err, docs) {
            if (err) {
              err.code = "MONGO_ERR";
              err.place_in_code = func_name;
              reject(err);
            } else {
              resolve(docs);
            }
          }
        )
        .lean();
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const deleteMsgByIdPromise = (userid, msgid) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const dialog_collection = connection.model(
        appsettings.mongodb_names.coll_dialogs,
        scheemas.TelegramDialogSheema
      );

      const filter = { userid: userid, TelegramMsgId: msgid };

      dialog_collection.deleteMany(filter, (err, res) => {
        if (err) {
          err.code = "MONGO_ERR";
          err.place_in_code = func_name;
          reject(err);
        } else {
          resolve(res);
        }
      });
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const deleteDialogByUserPromise = (userid, regime) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const dialog_collection = connection.model(
        appsettings.mongodb_names.coll_dialogs,
        scheemas.TelegramDialogSheema
      );

      let filter;
      if (regime) {
        filter = { userid: userid, regime: regime };
      } else {
        filter = { userid: userid };
      }

      dialog_collection.deleteMany(filter, (err, res) => {
        if (err) {
          err.code = "MONGO_ERR";
          err.place_in_code = func_name;
          reject(err);
        } else {
          resolve(res);
        }
      });
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

const delete_profile_by_id_arrayPromise = (profileIdArray) => {
  const func_name = arguments.callee.name;
  return new Promise(async (resolve, reject) => {
    try {
      const connection = await Connect_to_mongo(
        connectionString_self_mongo,
        db_name
      );
      const telegram_profile_collection = connection.model(
        appsettings.mongodb_names.coll_profiles,
        scheemas.ProfileSheema
      );

      telegram_profile_collection.deleteMany(
        { id: { $in: profileIdArray } },
        (err, res) => {
          if (err) {
            err.code = "MONGO_ERR";
            err.place_in_code = func_name;
            reject(err);
          } else {
            resolve(res);
          }
        }
      );
    } catch (err) {
      err.place_in_code = func_name;
      reject(err);
    }
  });
};

module.exports = {
  UpdateProfilesRegistrationCodeUpToDatePromise,
  insert_profilePromise,
  insert_error_logPromise,
  insert_permissionsPromise,
  insert_read_sectionPromise,
  get_all_registeredPromise,
  get_all_readPromise,
  get_all_profilesPromise,
  get_all_profiles_with_old_registrationPromise,
  update_models_listPromise,
  insertUsagePromise,
  upsertPromptPromise,
  upsertSystemPromise,
  upsertCompletionPromise,
  deleteDialogByUserPromise,
  getDialogueByUserIdPromise,
  insertUsageDialoguePromise,
  get_all_settingsPromise,
  UpdateCurrentRegimeSettingPromise,
  upsertProfilePromise,
  delete_profile_by_id_arrayPromise,
  insert_reg_eventPromise,
  deleteMsgByIdPromise,
  insert_adminRolePromise,
  get_all_adminPromise,
  setDefaultVauesForNonExiting,
  UpdateSettingPromise,
  get_tokenUsageByUsers,
  get_tokenUsageByRegimes,
  get_errorsByMessages,
  get_tokenUsageByDates,
  DeleteNotUpToDateProfilesPromise,
  getCompletionById,
  profileMigrationScript,
  insert_permissions_migrationPromise,
  insert_read_section_migrationPromise,
};
