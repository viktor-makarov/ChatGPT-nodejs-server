const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const modelSettings = require("../config/telegramModelsSettings");

const ProfileSheema = new Schema(
  {
    datetimeUTF: {
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
      },
      texteditor: {
        temperature: { type: Number, default: 1 },
        model: {
          type: String,
          default: modelSettings.texteditor.default_model,
        },
      },
      codereviewer: {
        temperature: { type: Number, default: 1 },
        model: {
          type: String,
          default: modelSettings.codereviewer.default_model,
        },
      },
      translator: {
        temperature: { type: Number, default: 1 },
        model: {
          type: String,
          default: modelSettings.translator.default_model,
        },
      },
    },
    permissions: {
      registrationCode: { type: String },
      registrationCodeUpToDate:{ type: Boolean,default: true },
      registered: { type: Boolean },
      registeredDTUTF: { type: Date },
      readInfo: { type: Boolean },
      readInfoDTUTF: { type: Date },
      admin: { type: Boolean },
      adminDTUTF: { type: Date },
      adminCode: { type: String },
    },
  },
  { collection: appsettings.mongodb_names.coll_profiles }
);

const LogsSheema = new Schema(
  {
    datetimeUTF: {
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
    datetimeUTF: {
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
    updatedDTUTF: { type: Date },
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
    datetimeUTF: { type: Date, default: Date.now },
    userid: { type: Number, index: true },
    userFirstName: { type: String },
    userLastName: { type: String },
    username: { type: String },
    prompt_tokens: { type: Number },
    completion_tokens: { type: Number },
    total_tokens: { type: Number },
    regime: { type: String },
  },
  { collection: appsettings.mongodb_names.tokens_log }
);

const TelegramDialogSheema = new Schema(
  {
    sourceid: { type: String, index: true },
    createdAtSourceTS: { type: Number, index: true },
    createdAtSourceDT_UTF: { type: Date },
    TelegramMsgId: { type: Number },
    userid: { type: Number, index: true },
    userFirstName: { type: String },
    userLastName: { type: String },
    newMessagePaused:{ type: Boolean },
    telegamPaused:{ type: Boolean },
    role: { type: String },
    roleid: { type: Number },
    name: { type: String },
    content: { type: String },
    content_parts:{ type: Object },
    completion_ended:{type: Boolean},
    content_ending: { type: String },
    last_part_number: { type: Number },
    completed: { type: Boolean },
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
