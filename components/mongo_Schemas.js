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
      current_regime: { type: String, default: "chat" },
      chat: {
        temperature: { type: Number, default: 1 },
        model: { type: String, default: modelSettings.chat.default_model },
      },
      texttospeech: {
        voice: { type: String, default: modelSettings.texttospeech.voice},
        model: {
          type: String,
          default: modelSettings.texttospeech.default_model,
        }},
        voicetotext: {
          model: {
            type: String,
            default: modelSettings.voicetotext.default_model,
          }
      },
    },
    token: {type: String},
    plan:{type: String},
    active:{type: Boolean},
    permissions: {
      registered: { type: Boolean },
      registeredDTUTC: { type: Date },
      readInfo: { type: Boolean },
      readInfoDTUTC: { type: Date },
      admin: { type: Boolean },
      adminDTUTC: { type: Date },
      adminCode: { type: String },
      groups: {type: Object}
    },
  },
  { collection: appsettings.mongodb_names.coll_profiles }
);

ProfileSheema.index({ id: -1 });

const MdjImages = new Schema(
{
  userid: { type: Number},
  content:{type: String},
  id:{type: String},
  url:{type: String},
  proxy_url:{type: String},
  flags:{ type: Number },
  hash:{type: String},
  progress:{type: String},
  options: {type: Object},
  width:{ type: Number },
  height:{ type: Number },
  prompt:{type: String},
  executionType:{type: String},
  datetimeUTC: {
    type: Date,
    default: Date.now
  }
},
  { collection: appsettings.mongodb_names.coll_mdj_image }
)

MdjImages.index({ id: -1,userid:-1});

const LogsSheema = new Schema(
  {
    datetimeUTC: {
      type: Date,
      default: Date.now,
      description:"Date and time of error occurance. This field should be queried using format of new Date('YYYY-MM-DDTHH:MM:SS')."
    },
    error: {type: Object,description:"Error details" },
    comment: { type: String,description: "Additional comment" },
  },
  { collection: appsettings.mongodb_names.coll_errors_log }
);

const DetailsSheema = new Schema(
  {
    datetimeUTC: {
      type: Date,
      default: Date.now
    },
    object: {type: Object},
    place_in_code: {type: String},
  },
  { collection: appsettings.mongodb_names.coll_details }
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
    datetimeUTC: { type: Date, default: Date.now,description:"Date and time of user's request. This field should be queried using format of new Date('YYYY-MM-DDTHH:MM:SS')." },
    userid: { type: Number, index: true },
    userFirstName: { type: String },
    userLastName: { type: String },
    username: { type: String, description: "Use this field as default and primary identificator of a user. Hint: for correct filtering on this field first fetch all the unique values." },
    model: { type: String,description: "OpenAI model used for request. Hint: for correct filtering on this field first fetch all the unique values." },
    prompt_tokens: { type: Number,description: "Number of tokens in prompt of the request." },
    completion_tokens: { type: Number,description: "Number of tokens in completion of the request." },
    total_tokens: { type: Number,description: "Total number of tokens in the request: prompt plus completion." }
  },
  { collection: appsettings.mongodb_names.tokens_log }
);

const FunctionUsageLogSheema = new Schema(
  {
    datetimeUTC: { type: Date, default: Date.now,description:"Date and time of user's request. This field should be queried using format of new Date('YYYY-MM-DDTHH:MM:SS')." },
    userid: { type: Number, index: true },
    userFirstName: { type: String },
    userLastName: { type: String },
    username: { type: String, description: "Use this field as default and primary identificator of a user. Hint: for correct filtering on this field first fetch all the unique values." },
    model: { type: String,description: "OpenAI model used for request. Hint: for correct filtering on this field first fetch all the unique values." },
    tool_function:{ type: String,description: "Function name. Hint: for correct filtering on this field first fetch all the unique values." },
    tool_reply: { type: Object,description: "Function details. Hint: for correct filtering on this field first fetch all the unique values." },
    call_duration: {type: Number},
    call_number: {type: String},
    regime: { type: String,description: "Chat bot mode used by user. Hint: for correct filtering on this field first fetch all the unique values." },
  },
  { collection: appsettings.mongodb_names.coll_functions_log }
);

const TelegramDialogSheema = new Schema(
  {
    sourceid: { type: String, index: true },
    createdAtSourceTS: { type: Number, index: true },
    createdAtSourceDT_UTC: { type: Date },
    telegramMsgId:{type: Object},
    telegramMsgBtns:{type: Boolean},
    userid: { type: Number, index: true },
    userFirstName: { type: String },
    userLastName: { type: String },
    model:{ type: String },
    role: { type: String },
    roleid: { type: Number },
    name: { type: String },
    content: Schema.Types.Mixed,
    content_latex_formula: Schema.Types.Mixed,
    tools: { type: Object },
    tool_choice: Schema.Types.Mixed,
    tool_calls:{ type: Object },
    tool_reply:{ type: Object },
    completion_version:{ type: Number},
    completion_ended:{type: Boolean},
    content_ending: { type: String },
    finish_reason: { type: String },
    tokens: { type: Number },
    regime: { type: String },
  },
  { collection: appsettings.mongodb_names.tokens_log }
);

TelegramDialogSheema.index({ sourceid: -1, regime: -1 });
TelegramDialogSheema.index({ userid: -1, regime: -1 });
TelegramDialogSheema.index({ userid: -1, TelegramMsgId: -1 });
TelegramDialogSheema.index({ sourceid: -1});
TelegramDialogSheema.index({ regime: -1 });
TelegramDialogSheema.index({ userid: -1 });


module.exports = {
  ProfileSheema,
  LogsSheema,
  RegistrationLogSheema,
  ModelsSheema,
  DetailsSheema,
  TokensLogSheema,
  TelegramDialogSheema,
  FunctionUsageLogSheema,
  MdjImages
};
