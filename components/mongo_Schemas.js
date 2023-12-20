const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const modelSettings = require("../config/telegramModelsSettings");

const ProfileSheema = new Schema(
  {
    datetimeUTC: {
      type: Date,
      default: Date.now,
    },
    id: { type: Number, index: true },
    id_chat: { type: Number },
    is_bot: { type: Boolean },
    first_name: { type: String },
    last_name: { type: String },
    username: { type: String },
    language_code: { type: String },
    settings: {
      current_regime: { type: String, default: "assistant" },
      assistant: {
        temperature: { type: Number, default: 1 },
        model: { type: String, default: modelSettings.assistant.default_model },
        sysmsg:{ type: Boolean, default: false }
      },
      texteditor: {
        temperature: { type: Number, default: 1 },
        model: {
          type: String,
          default: modelSettings.texteditor.default_model,
        },
        sysmsg:{ type: Boolean, default: false }
      },
      codereviewer: {
        temperature: { type: Number, default: 1 },
        model: {
          type: String,
          default: modelSettings.codereviewer.default_model,
        },
        sysmsg:{ type: Boolean, default: false }
      },
      translator: {
        temperature: { type: Number, default: 1 },
        model: {
          type: String,
          default: modelSettings.translator.default_model,
        },
        sysmsg:{ type: Boolean, default: false }
      },
    },
    permissions: {
      registrationCode: { type: String },
      registrationCodeUpToDate:{ type: Boolean,default: true },
      registered: { type: Boolean },
      registeredDTUTC: { type: Date },
      readInfo: { type: Boolean },
      readInfoDTUTC: { type: Date },
      admin: { type: Boolean },
      adminDTUTC: { type: Date },
      adminCode: { type: String },
    },
  },
 
  { collection: appsettings.mongodb_names.coll_profiles }
  
);

const LogsSheema = new Schema(
  {
    datetimeUTC: {
      type: Date,
      default: Date.now,
    },
    error: {type: Object },
    comment: { type: String },
  },
  { collection: appsettings.mongodb_names.coll_errors_log }
);

const RegistrationLogSheema = new Schema(
  {
    datetimeUTC: {
      type: Date,
      default: Date.now,
    },
    id: { type: Number },
    id_chat: { type: Number },
    is_bot: { type: Boolean },
    first_name: { type: String },
    last_name: { type: String },
    username: { type: String },
    comment: { type: String },
    language_code: { type: String },
    event: { type: String },
    reason: { type: String },
  },
  { collection: appsettings.mongodb_names.coll_reg_log }
);

const ModelsSheema = new Schema(
  {
    updatedDTUTC: { type: Date },
    id: { type: String, index: { unique: true } },
    object: { type: String },
    created: { type: Number },
    owned_by: { type: String },
    permission: { type: Object },
    root: { type: String },
    parent: { type: String },
  },
  { collection: appsettings.mongodb_names.coll_models }
);

const TokensLogSheema = new Schema(
  {
    datetimeUTC: { type: Date, default: Date.now,description:"Date and time of user's request. This field should be queried using format of new Date(). Should be queried as new Date()" },
    userid: { type: Number, index: true },
    userFirstName: { type: String },
    userLastName: { type: String },
    username: { type: String },
    model: { type: String,description: "OpenAI model used for request." },
    prompt_tokens: { type: Number,description: "Number of tokens in prompt of the request." },
    completion_tokens: { type: Number,description: "Number of tokens in completion of the request." },
    total_tokens: { type: Number,description: "Total number of tokens in the request: prompt plus completion." },
    regime: { type: String,description: "Chat bot mode used by user" },
  },
  { collection: appsettings.mongodb_names.tokens_log }
);

const TelegramDialogSheema = new Schema(
  {
    sourceid: { type: String, index: true },
    createdAtSourceTS: { type: Number, index: true },
    createdAtSourceDT_UTC: { type: Date },
    TelegramMsgId: { type: Number },
    userid: { type: Number, index: true },
    userFirstName: { type: String },
    userLastName: { type: String },
    telegamPaused:{ type: Boolean },
    model:{ type: String },
    role: { type: String },
    roleid: { type: Number },
    name: { type: String },
    content: { type: String },
    functions: { type: Object },
    function_call:{ type: Object },
    content_parts:{ type: Object },
    completion_ended:{type: Boolean},
    content_ending: { type: String },
    telegramMsgOptions: { type: Object },
    finish_reason: { type: String },
    tokens: { type: Number },
    regime: { type: String },
  },
  { collection: appsettings.mongodb_names.tokens_log }
);

module.exports = {
  ProfileSheema,
  LogsSheema,
  RegistrationLogSheema,
  ModelsSheema,
  TokensLogSheema,
  TelegramDialogSheema,
};
