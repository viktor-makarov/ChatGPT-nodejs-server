module.exports = {
"gpt-4o":{
    "name":"GPT-4 Омни",
    "request_length_limit_in_tokens": 128000,
    "canUseTool":true,
    "canUseTemperature":true
},
"gpt-4o-search-preview":{
    "name":"GPT Search",
    "request_length_limit_in_tokens": 128000,
    "canUseTool":false,
    "canUseTemperature":false
},
"gpt-4o-mini-search-preview":{
    "name":"GPT Search Mini",
    "request_length_limit_in_tokens": 128000,
    "canUseTool":false,
    "canUseTemperature":false
},
"o1":{
    "name":"O1",
    "request_length_limit_in_tokens": 200000,
    "canUseTool":true,
    "canUseTemperature":true
},
"o3-mini":{
    "name":"O3 Мини",
    "request_length_limit_in_tokens": 200000,
    "canUseTool":true,
    "canUseTemperature":true
}
};
