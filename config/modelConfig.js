module.exports = {
"gpt-4o":{
    "name":"GPT-4 Омни",
    "knowledge_cutoff": "2023-10-01",
    "request_length_limit_in_tokens": 128000,
    "search_length_limit_in_tokens":100_000,
    "image_input_limit_bites": 52_428_800,
    "image_input_limit_count": 500,
    "pdf_input_limit_bites": 33_554_432,
    "pdf_input_limit_pages": 100,
    "canUseTool":true,
    "canUseTemperature":true,
    "canUseReasoning":false,
    "includeUsage":[
        "message.input_image.image_url"
    ],
    "timeout_ms":120000,
    "long_wait_notes": [
        {time_ms:30000,comment:"Сервер отвечает дольше обычного ...🤔"},
        {time_ms:60000,comment:"Так бывает очень редко. Но пока беспокоиться рано. Надо еще подождать ... ☕️"},
        {time_ms:90000,comment:"К сожалению, запрос не может быть выполнен сейчас, просим прощения и предлагаем попробовать позже. 🙈"}
    ],
},
"gpt-4.1":{
    "name":"GPT-4.1",
    "knowledge_cutoff": "2024-07-01",
    "request_length_limit_in_tokens": 1_047_576,
    "search_length_limit_in_tokens":100_000,
    "image_input_limit_bites": 52_428_800,
    "image_input_limit_count": 500,
    "pdf_input_limit_bites": 33_554_432,
    "pdf_input_limit_pages": 100,
    "canUseTool":true,
    "canUseTemperature":true,
    "canUseReasoning":false,
    "includeUsage":[
        "message.input_image.image_url"
    ],
    "long_wait_notes": [
        {time_ms:30000,comment:"Сервер отвечает дольше обычного ...🤔"},
        {time_ms:60000,comment:"Так бывает очень редко. Но пока беспокоиться рано. Надо еще подождать ... ☕️"},
        {time_ms:90000,comment:"К сожалению, запрос не может быть выполнен сейчас, просим прощения и предлагаем попробовать позже. 🙈"}
    ],
},
"o3":{
    "name":"O3",
    "knowledge_cutoff": "2024-07-01",
    "request_length_limit_in_tokens": 200_000,
    "search_length_limit_in_tokens":100_000,
    "image_input_limit_bites": 52_428_800,
    "image_input_limit_count": 500,
    "pdf_input_limit_bites": 33_554_432,
    "pdf_input_limit_pages": 100,
    "canUseTool":true,
    "canUseTemperature":true,
    "canUseReasoning":true,
    "includeUsage":[
        "message.input_image.image_url",
        "reasoning.encrypted_content"
    ],
    "long_wait_notes": [
        {time_ms:30000,comment:"Сервер отвечает дольше обычного ...🤔"},
        {time_ms:60000,comment:"Так бывает очень редко. Но пока беспокоиться рано. Надо еще подождать ... ☕️"},
        {time_ms:90000,comment:"К сожалению, запрос не может быть выполнен сейчас, просим прощения и предлагаем попробовать позже. 🙈"}
    ],
},
"gpt-5":{
    "name":"GPT-5",
    "knowledge_cutoff": "2024-10-01",
    "request_length_limit_in_tokens": 400_000,
    "search_length_limit_in_tokens":100_000,
    "image_input_limit_bites": 52_428_800,
    "image_input_limit_count": 500,
    "pdf_input_limit_bites": 33_554_432,
    "pdf_input_limit_pages": 100,
    "canUseTool":true,
    "canUseTemperature":true,
    "canUseReasoning":true,
    "includeUsage":[
        "message.input_image.image_url",
        "reasoning.encrypted_content"
    ],
    "long_wait_notes": [
        {time_ms:30000,comment:"Сервер отвечает дольше обычного ...🤔"},
        {time_ms:60000,comment:"Так бывает очень редко. Но пока беспокоиться рано. Надо еще подождать ... ☕️"},
        {time_ms:90000,comment:"К сожалению, запрос не может быть выполнен сейчас, просим прощения и предлагаем попробовать позже. 🙈"}
    ],
},
"o4-mini":{
    "name":"O4 Мини",
    "knowledge_cutoff": "2024-06-01",
    "request_length_limit_in_tokens": 200_000,
    "search_length_limit_in_tokens":100_000,
    "image_input_limit_bites": 52_428_800,
    "image_input_limit_count": 500,
    "pdf_input_limit_bites": 33_554_432,
    "pdf_input_limit_pages": 100,
    "canUseTool":true,
    "canUseTemperature":true,
    "canUseReasoning":true,
    "includeUsage":[
        "message.input_image.image_url",
        "reasoning.encrypted_content"
    ],
    "long_wait_notes": [
        {time_ms:30000,comment:"Сервер отвечает дольше обычного ...🤔"},
        {time_ms:60000,comment:"Так бывает очень редко. Но пока беспокоиться рано. Надо еще подождать ... ☕️"},
        {time_ms:90000,comment:"К сожалению, запрос не может быть выполнен сейчас, просим прощения и предлагаем попробовать позже. 🙈"}
    ],
},
"computer-use-preview":{
    "name":"Code use preview",
    "knowledge_cutoff": "2023-10-01",
    "request_length_limit_in_tokens": 8_192,
    "image_input_limit_bites": 52_428_800,
    "image_input_limit_count": 500,
    "canUseTool":true,
    "canUseTemperature":true,
    "reasoning": {
        "effort": "medium",
        "summary": "auto",
    },
    "includeUsage":[
        "reasoning.encrypted_content",
        "computer_call_output.output.image_url"
    ],
    "long_wait_notes": [
        {time_ms:30000,comment:"Сервер отвечает дольше обычного ...🤔"},
        {time_ms:60000,comment:"Так бывает очень редко. Но пока беспокоиться рано. Надо еще подождать ... ☕️"},
        {time_ms:90000,comment:"К сожалению, запрос не может быть выполнен сейчас, просим прощения и предлагаем попробовать позже. 🙈"}
    ],
}
};
