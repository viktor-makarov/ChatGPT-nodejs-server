module.exports = {
    "chat":{
        "welcome_msg":"Это режим диалога! \nНапишите сообщение, чтобы начать диалог. \nТекущие настройки: t° = [temperature], модель = [model], стиль = [response_style]",
        "incomplete_msg":"Это режим диалога!\n" +
                        "Текущие настройки: t° = [temperature], модель = [model], стиль = [response_style]\n" +
                        "Размер диалога = [previous_dialogue_tokens] токенов (из [request_length_limit_in_tokens]).\n" +
                        "Чтобы начать новый диалог, нажмите здесь: /resetchat. ",
        "name":"Диалог",
        "options_desc":"Параметры работы Диалога:",
        "options":{
            "temperature":{
                "name":"Температура (t°)",
                "options_desc":"Выберите новое значение температуры:",
                "templateRespMsg":"Параметр Температура (t°) для функции Диалог изменен на [value].",
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
                "templateRespMsg":"Модель для функции Диалог изменена на [value].",
                "options":{
                    "gpt-4o":{
                        "name":"gpt-4o",
                    },
                    "gpt-4.1":{
                        "name":"GPT-4.1",
                    },
                    "gpt-4.1-mini":{
                        "name":"GPT-4.1 mini",
                    },
                    "o1":{
                        "name":"O1",
                    },
                    "gpt-4o-search-preview":{
                            "name":"GPT Search",
                    },
                    "gpt-4o-mini-search-preview":{
                            "name":"GPT Search Mini",
                    },
                    "o3-mini":{
                        "name":"O3 Мини",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "response_style":{
                "name":"Стиль ответов",
                "options_desc":"Выберите стиль ответов:",
                "templateRespMsg":"Стиль ответов изменен на [value].",
                "options":{
                    "gentleman":{
                        "name":"Джентльмен",
                    },
                    "lady":{
                        "name":"Леди",
                    },
                    "criminal":{
                        "name":"Уголовник",
                    },
                    "philosopher":{
                        "name":"Философ",
                    },
                    "hacker":{
                        "name":"Хакер",
                    },
                    "peabody":{
                        "name":"Мистер Пибоди",
                    },
                    "genie":{
                        "name":"Джинни🧞‍♂️",
                    },
                    "neutral":{
                        "name":"Нейтральный",
                    },
                    "friendly":{
                        "name":"Приветливый",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }
            },
            "back":{
                "name":"<< Назад"
            }
        },
        "hostname":`https://${process.env.OAI_URL}`,
        "default_model":'gpt-4.1',
        "url_path":'/v1/chat/completions',
        "default_dialogue_ttl_ms":3600000,
    },
    "translator":{
        "welcome_msg":"Это Переводчик. Достаточно прислать текст. Русский текст будет переведен на английский. Текст на любом другом языке будет переведен на русский. t° = [temperature], модель = [model]" ,
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
                "templateRespMsg":"Модель для режима Переводчик изменена на [value].",
                "options":{
                    "gpt-4.1":{
                        "name":"GPT-4.1",
                    },
                    "o1":{
                        "name":"O1",
                    },
                    "o3-mini":{
                        "name":"O3 Мини",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "back":{
                "name":"<< Назад"
            }
        },
        "hostname":`https://${process.env.OAI_URL}`,
        "default_model":'gpt-4o',
        "url_path":'/v1/chat/completions',
        "default_dialogue_ttl_ms":3600000,
    },
    "texteditor":{
        "welcome_msg":"Это Редактор. Просто пришлите Ваш текст в виде сообщения и я помогу его отредактировать. t° = [temperature], модель = [model]" ,
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
                "templateRespMsg":"Модель для режима Редактор изменена на [value].",
                "options":{
                    "gpt-4.1":{
                        "name":"GPT-4.1",
                    },
                    "o1":{
                        "name":"O1",
                    },
                    "o3-mini":{
                        "name":"O3 Мини",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "back":{
                "name":"<< Назад"
            }
        },
        "hostname":`https://${process.env.OAI_URL}`,
        "default_model":'gpt-4o',
        "url_path":'/v1/chat/completions',
        "default_dialogue_ttl_ms":3600000,
    },
    "voicetotext":{
        "welcome_msg":"Функция 'Голос в текст' может преобразовать аудио или видео запись в текст. Пришлите голосовое сообщение, видео заметку Телеграм или файл с любой другой записью следующего формата: mp3, mpeg, mpga, m4a, wav, or webm и размером не более [size] Mb.",
        "name":"Голос в текст",
        "hostname":`https://${process.env.OAI_URL}`,
        "default_model":'whisper-1',
        "url_path":'/v1/audio/transcriptions',
        "response_format":"json",
        "mime_types":['audio/ogg','audio/mpeg','audio/mpeg','audio/wav','video_note','audio/mp4'],
        "filesize_limit_mb":25,
        "options_desc":"У функции Голос в текст нет параметров",
        "options":{
            "back":{
                "name":"<< Назад"
            }
        }
    },
    "texttospeech":{
        "welcome_msg":"Функция 'Текст в голос' может преобразовать текст в аудио запись. Пришлите текст, который нужно преобразовать. Длина текста не должна превышать [limit] символов. Текущий голос = [voice].",
        "name":"Текст в голос",
        "hostname":`https://${process.env.OAI_URL}`,
       // "default_model":'tts-1-hd',
        "default_model":'gpt-4o-mini-tts',
       "url_path":'/v1/audio/speech',
        "response_format":"json",
        "voice": "shimmer",
        "options_desc":"Параметры работы функции Текст в голос:",
        "options":{
            "model":{
                "name":"Версия модели",
                "options_desc":"Выберите версию модели:",
                "templateRespMsg":"Модель для функии Переводчик изменена на [value].",
                "options":{
                    "tts-1":{
                        "name":"Быстрее",
                    },
                    "tts-1-hd":{
                        "name":"Лучше качество",
                    },	
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "voice":{
                "name":"Версия голоса",
                "options_desc":"Выберите версию голоса:",
                "templateRespMsg":"Голос изменен на [value].",
                "options":{
                    "shimmer":{
                        "name":"Шимер",
                    },
                    "alloy":{
                        "name":"Аллой",
                    },	
                    "echo":{
                        "name":"Эко",
                    },
                    "fable":{
                        "name":"Фабле",
                    },
                    "onyx":{
                        "name":"Оникс",
                    },
                    "nova":{
                        "name":"Нова",
                    },
                    "back":{
                        "name":"<< Назад"
                    }
            }},
            "back":{
                "name":"<< Назад"
            }
        }
    },
    "currentsettings":{
        "name":"Текущие настройки",
    },
    };