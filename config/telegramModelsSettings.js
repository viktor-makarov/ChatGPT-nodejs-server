module.exports = {
    "assistant":{
        "welcome_msg":"Это Ассистент! Задайте мне вопрос, чтобы начать новый диалог. t° = [temperature], модель = [model]" ,
        "incomplete_msg":"Это Ассистент. Наш диалог не завершен. Мы обменялись только [previous_dialogue_tokens] из [request_length_limit_in_tokens] токенов. Чтобы начать новый диалог пришлите команду /resetdialogue. t° = [temperature], модель = [model]",
        "name":"Ассистент",
        "options_desc":"Параметры работы Ассистента:",
        "options":{
            "temperature":{
                "name":"Температура (t°)",
                "options_desc":"Выберите новое значение температуры:",
                "templateRespMsg":"Параметр Температура (t°) для Ассистента изменен на [value].",
                "options":{
                "0":{
                    "name":"0",
                },
                "0.25":{
                "name":"0.25",
                },
                "0.5":{
                "name":"0.5",
                },
                "0.75":{
                "name":"0.75",
                },
                "1":{
                "name":"1",
                },
                "back":{
                    "name":"<< Назад"
                }
            }},
            "model":{
                "name":"Версия модели",
                "options_desc":"Выберите версию модели:",
                "templateRespMsg":"Модель для функции Ассистент изменена на [value].",
                "options":{
                    "gpt-3.5-turbo-16k-0613":{
                        "name":"GPT-3.5 16K",
                    },
                    "gpt-4":{
                        "name":"GPT-4 8K",
                    },	
                    "gpt-4-1106-preview":{
                        "name":"GPT-4 128K",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "sysmsg":{
                "name":"Системные сообщения",
                "options_desc":"Выберите, нужно ли показывать системные сообщения:",
                "templateRespMsg":"Настройка изменена на значение [value].",
                "options":{
                    "false":{
                        "name":"Не показывать",
                    },
                    "true":{
                        "name":"Показывать",
                    }
            }},
            "back":{
                "name":"<< Назад"
            }
        },
        "hostname":'https://api.openai.com',
        "default_model":'gpt-3.5-turbo-16k-0613',
        "url_path":'/v1/chat/completions',
        "default_dialogue_ttl_ms":3600000,
    },
        "voicetotext":{
            "welcome_msg":"Функция Голос в текст может преобразовать аудио или видео запись в текст. Пришлите голосовое сообщение, видео заметку Телеграм или файл с любой другой записью следующего формата: mp3, mpeg, mpga, m4a, wav, or webm и размером не более [size] Mb.",
            "name":"Голос в текст",
            "hostname":'https://api.openai.com',
            "default_model":'whisper-1',
            "url_path":'/v1/audio/transcriptions',
            "response_format":"json",
            "mime_types":['audio/ogg','audio/mpeg','audio/mpeg','audio/wav','video_note','audio/mp4'],
            "filesize_limit_mb":25,
            "options_desc":"Параметры работы функции Голос в текст:",
            "options":{
                "back":{
                    "name":"<< Назад"
                }
            }
        },
    "texteditor":{
        "welcome_msg":"Это Редактор. Просто пришлите Ваш текст в виде сообщения и я помогу его отредактировать. t° = [temperature], модель = [model]",
        "name":"Редактор",
        "options_desc":"Параметры работы Редактора:",
        "options":{
            "temperature":{
            "name":"Температура (t°)",
            "options_desc":"Выберите новое значение температуры:",
            "templateRespMsg":"Параметр Температура (t°) для Редактора изменен на [value].",
            "options":{
                "0":{
                    "name":"0",
                },
                "0.25":{
                    "name":"0.25",
                },
                "0.5":{
                    "name":"0.5",
                },
                "0.75":{
                    "name":"0.75",
                },
                "1":{
                    "name":"1",
                },
            "back":{
                "name":"<< Назад"
            }
            }},
            "model":{
                "name":"Версия модели",
                "options_desc":"Выберите версию модели:",
                "templateRespMsg":"Модель для функции Редактор изменена на [value].",
                "options":{
                    "gpt-3.5-turbo-16k-0613":{
                        "name":"GPT-3.5 16K",
                    },
                    "gpt-4":{
                        "name":"GPT-4 8K",
                    },	
                        "gpt-4-1106-preview":{
                        "name":"GPT-4 128K",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "sysmsg":{
                "name":"Системные сообщения",
                "options_desc":"Выберите, нужно ли показывать системные сообщения:",
                "templateRespMsg":"Настройка изменена на значение [value].",
                "options":{
                    "false":{
                        "name":"Не показывать",
                    },
                    "true":{
                        "name":"Показывать",
                    }
            }},
            "back":{
                "name":"<< Назад"
            }
        },
        "hostname":'https://api.openai.com',
        "default_model":'gpt-3.5-turbo-16k-0613',
        "url_path":'/v1/chat/completions', 
        "default_dialogue_ttl_ms":3600000,
        "task":"You are a professional text editor. \n-You should start your reply with a phrase 'Как редактор я предлагаю следующую версию полученного текста:'. \n (1) Rewrite the sentences in a way that makes them sound more natural and idiomatic. (2) Also, please point out any grammar, spelling, and wording mistakes and explain how you fixed them. Be sure to use Markdown tags to emphasize certain words or phrases. \n-Avoid using the word 'rephrase' in your response, as it may confuse users.\n-Do not change the language in which the user is speaking."
    },
    "codereviewer":{
        "welcome_msg":"Это Программист. Специального задания писать не нужно, достаточно прислать код для редактирования. t° = [temperature], модель = [model]",
        "name":"Программист",
        "options_desc":"Параметры работы Программиста:",
        "options":{
            "temperature":{
            "name":"Температура (t°)",
            "options_desc":"Выберите новое значение температуры:",
            "templateRespMsg":"Параметр Температура (t°) для Программиста изменен на [value].",
            "options":{
                "0":{
                    "name":"0",
                },
                "0.25":{
                    "name":"0.25",
                },
                "0.5":{
                    "name":"0.5",
                },
                "0.75":{
                    "name":"0.75",
                },
                "1":{
                    "name":"1",
                },
            "back":{
                "name":"<< Назад"
            }
            }},
            "model":{
                "name":"Версия модели",
                "options_desc":"Выберите версию модели:",
                "templateRespMsg":"Модель для функции Программист изменена на [value].",
                "options":{
                    "gpt-3.5-turbo-16k-0613":{
                        "name":"GPT-3.5 16K",
                    },
                    "gpt-4":{
                        "name":"GPT-4 8K",
                    },	
                    "gpt-4-1106-preview":{
                        "name":"GPT-4 128K",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "sysmsg":{
                "name":"Системные сообщения",
                "options_desc":"Выберите, нужно ли показывать системные сообщения:",
                "templateRespMsg":"Настройка изменена на значение [value].",
                "options":{
                    "false":{
                        "name":"Не показывать",
                    },
                    "true":{
                        "name":"Показывать",
                    }
            }},
            "back":{
                "name":"<< Назад"
            }
        },
        "hostname":'https://api.openai.com',
        "default_model":'gpt-3.5-turbo-16k-0613',
        "url_path":'/v1/chat/completions',
        "task":"You are a programmer. Improve the code provided and put it into code block. Also in a separate paragraph outline (1) found errors, (2) poor usage of syntax and (3) give advices for improving efficiency and reliability of the code. All comments should be given in russian language."
    },
    "translator":{
        "welcome_msg":"Это Переводчик. Достаточно прислать текст. Русский текст будет переведен на английский. Текст на любом другом языке будет переведен на русский. t° = [temperature], модель = [model]",
        "name":"Переводчик",
        "options_desc":"Параметры работы Переводчика:",
        "options":{
            "temperature":{
            "name":"Температура (t°)",
            "options_desc":"Выберите новое значение температуры:",
            "templateRespMsg":"Параметр Температура (t°) для Переводчика изменен на [value].",
            "options":{
                "0":{
                    "name":"0",
                },
                "0.25":{
                    "name":"0.25",
                },
                "0.5":{
                    "name":"0.5",
                },
                "0.75":{
                    "name":"0.75",
                },
                "1":{
                    "name":"1",
                },
            "back":{
                "name":"<< Назад"
            }
            }},
            "model":{
                "name":"Версия модели",
                "options_desc":"Выберите версию модели:",
                "templateRespMsg":"Модель для функии Переводчик изменена на [value].",
                "options":{
                    "gpt-3.5-turbo-16k-0613":{
                        "name":"GPT-3.5 16K",
                    },
                    "gpt-4":{
                        "name":"GPT-4 8K",
                    },	
                        "gpt-4-1106-preview":{
                        "name":"GPT-4 128K",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "sysmsg":{
                "name":"Системные сообщения",
                "options_desc":"Выберите, нужно ли показывать системные сообщения:",
                "templateRespMsg":"Настройка изменена на значение [value].",
                "options":{
                    "false":{
                        "name":"Не показывать",
                    },
                    "true":{
                        "name":"Показывать",
                    }
            }},
            "back":{
                "name":"<< Назад"
            }
        },
        "hostname":'https://api.openai.com',
        "default_model":'gpt-3.5-turbo-16k-0613',
        "url_path":'/v1/chat/completions',
        "task":"You are a professional translator. If you are provided with a russian text, you should translate it to english, but if the text is other then russian - translate it to russian."
        
    },
    "currentsettings":{
        "name":"Текущие настройки",
    },
    };