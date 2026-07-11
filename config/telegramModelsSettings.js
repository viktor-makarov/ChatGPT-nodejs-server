module.exports = {
    "chat": {
        "name": "Основной диалог",
        "options_desc": "Параметры работы Основного диалога:",
        "options": {
            "model": {
                "name": "Версия модели",
                "options_desc": "Выберите версию модели:",
                "templateRespMsg": "Модель для функции Диалог изменена на <b>[value]</b>.",
                "options": {
                    "gpt-5": {
                        "name": "GPT-5",
                    },
                    "gpt-5.1": {
                        "name": "GPT-5.1",
                    },
                    "gpt-5.2": {
                        "name": "GPT-5.2",
                    },
                    "back": {
                        "name": "<< Назад"
                    },
                    "close_settings": {
                        "name": "Закрыть",
                    }
                }
            },
            "response_style": {
                "name": "Стиль ответов",
                "options_desc": "Выберите стиль ответов:",
                "templateRespMsg": "Стиль ответов изменен на <b>[value]</b>.",
                "options": {
                    "gentleman": {
                        "name": "Джентльмен",
                    },
                    "lady": {
                        "name": "Леди",
                    },
                    "criminal": {
                        "name": "Уголовник",
                    },
                    "philosopher": {
                        "name": "Философ",
                    },
                    "hacker": {
                        "name": "Хакер",
                    },
                    "peabody": {
                        "name": "Мистер Пибоди",
                    },
                    "genie": {
                        "name": "Джинни🧞‍♂️",
                    },
                    "neutral": {
                        "name": "Нейтральный",
                    },
                    "friendly": {
                        "name": "Приветливый",
                    },
                    "back": {
                        "name": "<< Назад"
                    },
                    "close_settings": {
                        "name": "Закрыть",
                    }
                }
            },
            "image_choice": {
                "name": "Генератор изображений",
                "options_desc": "Выберите сервис для генерации изображений:",
                "templateRespMsg": "Сервис генерации изображений изменен на <b>[value]</b>.",
                "options": {
                    "mdj": {
                        "name": "Midjourney",
                    },
                    "oai": {
                        "name": "OpenAI",
                    },
                    "auto": {
                        "name": "Автоматически",
                    },
                    "back": {
                        "name": "<< Назад"
                    },
                    "close_settings": {
                        "name": "Закрыть",
                    }
                }
            },
            "back": {
                "name": "<< Назад"
            },
            "close_settings": {
                "name": "Закрыть",
            }
        },
        "hostname": `https://${process.env.OAI_URL}`,
        "default_model": 'gpt-5.2',
        "url_path": '/v1/chat/completions',
        "default_dialogue_ttl_ms": 3600000,
    },
    "translator": {
        "name": "Переводчик",
        "options_desc": "Параметры работы Переводчика:",
        "options": {
            "model": {
                "name": "Версия модели",
                "options_desc": "Выберите версию модели:",
                "templateRespMsg": "Модель для режима Переводчик изменена на <b>[value]</b>.",
                "options": {
                    "gpt-5": {
                        "name": "GPT-5",
                    },
                    "gpt-5.1": {
                        "name": "GPT-5.1",
                    },
                    "gpt-5.2": {
                        "name": "GPT-5.2",
                    },
                    "back": {
                        "name": "<< Назад"
                    },
                    "close_settings": {
                        "name": "Закрыть",
                    }
                }
            },
            "back": {
                "name": "<< Назад"
            },
            "close_settings": {
                "name": "Закрыть",
            }
        },
        "hostname": `https://${process.env.OAI_URL}`,
        "default_model": 'gpt-5.2',
        "url_path": '/v1/chat/completions',
        "default_dialogue_ttl_ms": 3600000,
    },
    "texteditor": {
        "name": "Редактор",
        "options_desc": "Параметры работы Редактора:",
        "options": {
            "model": {
                "name": "Версия модели",
                "options_desc": "Выберите версию модели:",
                "templateRespMsg": "Модель для режима Редактор изменена на <b>[value]</b>.",
                "options": {
                    "gpt-5": {
                        "name": "GPT-5",
                    },
                    "gpt-5.1": {
                        "name": "GPT-5.1",
                    },
                    "gpt-5.2": {
                        "name": "GPT-5.2",
                    },
                    "back": {
                        "name": "<< Назад"
                    },
                    "close_settings": {
                        "name": "Закрыть",
                    }
                }
            },
            "back": {
                "name": "<< Назад"
            },
            "close_settings": {
                "name": "Закрыть",
            }
        },
        "hostname": `https://${process.env.OAI_URL}`,
        "default_model": 'gpt-5.2',
        "url_path": '/v1/chat/completions',
        "default_dialogue_ttl_ms": 3600000,
    },
    "texttospeech": {
        "name": "Текст в голос",
        "hostname": `https://${process.env.OAI_URL}`,
        // "default_model":'tts-1-hd',
        "default_model": 'gpt-4o-mini-tts',
        "url_path": '/v1/audio/speech',
        "response_format": "json",
        "voice": "Sarah",
        "options_desc": "Параметры работы функции Текст в голос:",
        "options": {
            "voice": {
                "name": "Версия голоса",
                "options_desc": "Выберите версию голоса:",
                "templateRespMsg": "Голос изменен на <b>[value]</b>.",
                "options": {
                    "Paul": {
                        "name": "Пол",
                    },
                    "Sarah": {
                        "name": "Сара",
                    },
                    "Callum": {
                        "name": "Калум",
                    },
                    "back": {
                        "name": "<< Назад"
                    },
                    "close_settings": {
                        "name": "Закрыть",
                    }
                }
            },
            "back": {
                "name": "<< Назад"
            },
            "close_settings": {
                "name": "Закрыть",
            }
        }
    },
    "pinnedHeaderAllowed": {
        "options_desc": "Параметры закрепленного заголовка:",
        "name": "Закрепленный заголовок",
        "templateRespMsg": "Текущие настройки закрепленного заголовка изменены на: <b>[value]</b>.",
        "options": {
            "true": {
                "name": "Разрешить отображение",
            },
            "false": {
                "name": "Запретить отображение",
            },
            "back": {
                "name": "<< Назад"
            },
            "close_settings": {
                "name": "Закрыть",
            }
        }
    },
    "showDetails": {
        "options_desc": "Параметры отображения деталей выполнения функций:",
        "name": "Отображение деталей",
        "templateRespMsg": "Текущие настройки отображения деталей изменены на: <b>[value]</b>.",
        "options": {
            "true": {
                "name": "Разрешить отображение",
            },
            "false": {
                "name": "Запретить отображение",
            },
            "back": {
                "name": "<< Назад"
            },
            "close_settings": {
                "name": "Закрыть",
            }
        }
    },
    "currentsettings": {
        "name": "Текущие настройки",
    },
    "close_settings": {
        "name": "Закрыть",
    }
};





