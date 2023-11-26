module.exports = {
    "register": "Чтобы начать работу, нужно прислать код регистрации в следующем формате: /start код.",
    "register_depricated":"Конанда /register более не используется для регистрации. Вместо нее используйте коданду /start с указанием кода регистрации после пробела.",
    "info":"Я - бот, который использует сервис компании Open AI, известный как Chat GPT. Меня можно попросить выполнить различные задания.\n\nДля разных задач предусмотрены разные функции, все они перечистены в меню.\nОсновная и универсальная - /assistant. Ассистент подерживает диалог, то есть после получения ответа на первоначальный запрос ему можно задавать уточняющие вопросы и корректировать задания. При ответе на них он будет учитывать весь предыдущий диалог. Если нужно, чтобы Ассистент забыл диалог - отправьте команду /resetdialogue.\n\nКроме того, есть специализированные функции /texteditor, /codereviewer и /translator. Они заранее настроены на выполнение конкретных часто встречающихся задач, чтобы пользователю не нужно было формулировать каждый раз задачу заново: редактирование текста, улучшение программного кода и перевод текста на другие языки. Эти функции всегда отвечают только на первоначальный запрос, уточнения не поддерживаются.\n\nЗадания можно направлять не только текстом, но и голосовыми сообщениями, видео заметками Телеграмм и просто аудио файлами.\n\nЕсли нужно просто преобразовать голосовую запись в текст, для этого есть отдельная функция: 'Голос в текст'. Вы можете выбрать эту функцию в меню, отправить мне голосовое сообщение из Телеграмма или другого мессенджера, и я переведу его в текст.\n\nВ настройках можно выбрать, какую модель использовать для каждой функции: GPT-3.5 или GPT4.  \n\nЧего я не могу:\n(1) обрабатывать картинки и файловые приложения;\n(2) гарантировать, что информация о событиях, людях и фактах, предоставленная в ответах, будет на 100% верна;\n(3) обрабатывать диалоги и отдельные сообщения более определенной длины.\n\n Советую так же прочитать ответы на часто задаваемые вопросы запросите команду /faq\n\nЧтобы вызвать это сообщение еще раз в будущем, нужно отправить команду /info.",
    "welcome":"Отлично! Теперь можно спросить меня о чем-нибудь!",
    "help":"Нажмите на кнопку «Меню», чтобы узнать список доступных команд.\n\nЕсли возникают проблемы с работой бота, пожалуйста, свяжитесь с администратором https://t.me/Truvoruwka.\n\n - чтобы отвязать вашу учетную запись от этого бота и удалить из него все ваши данные необходимо отправить команду /unregister.\n - чтобы активировать права администратора пришлите команду /admin <код администратора>",
    "help_advanced":"\n\n Как администратор вы также можете:\n\n- направлять сообщения всем пользователям с помощью команды /sendtoall [текст сообщения]. Перед общей рассылкой  рекомендуется проверить сообщение командой /sendtome [текст сообщения].\n- запрашивать отчеты с помощью команды /reports.\n- отменять регистрацию пользователей, у которых просрочен код регистрации, командой /delete_not_uptodate_users. Но перед этим просмотрите список таких пользовтаелей в отчете Устаревшая регистрация.",
    "faq":"Часто задаваевые вопросы.\n\nВ: Может ли Администратор бота видеть мои сообщения? \nО: Только в части незавершенных диалогов с Ассистентом. Хранение этой информации необходимо для работы самого сервиса. Чтобы удалить сообщения незаврешенного диалога используйте команду /resetdialogue. А если Вы решили перестать пользоваться ботом совсем, то при выполнении команды /unregister из бота вместе с Вашей регистрацией удаляется вся информация, связанная с Вашей учетной записью в Телеграмм, и все ваши неоконченные диалоги. Остается только статистика использованных токенов.\n\nВ: На какие темы можно общаться с Ассистентом? \nО: Ограницений по темам нет. Можно отметить лишь два аспекта: (1) Ассистент не будет отвечать на вопросы с сомнительной этической коннотацией. Например, нельзя ожидать, что Ассистент даст инструкции о том, как убить бабушку топором, как это сделал Раскольников в романе Достоевского. (2) Модель была обучена на данных, собранных из Интернета до сентября 2021 года, поэтому она не имеет информации о последних мировых событиях.\n\nВ: На каком языке нужно писать задания? \nО: На любом языке. Однако, предпочтительным является английский, если само задание не требует использования другого языка, например, перевод текста. Процесс обработки запросов построен таким образом, что любой запрос перед обработкой переводится на английский язык, а сгенерированный ответ затем переводится на язык запроса. Таким образом, запросы на английском будут выполняться чуть более точно, так как исключаются погрешности перевода.\n\nВ: В чем разница между версией 3.5 и 4?\nО: Версия 4 считается более продвинутой. Разработчики заявляют, что она выполняет задания более точно и качественно. Однако, новая версия имеет и дополнительные ограничения: ответы поступают медленнее и размер поддерживаемого диалога меньше в два раза. Впрочем, разработчики планируют убрать эти ограничения в будущем.\n\nВ: Зачем под каждым ответом появляется кнопка <Предложи еще вариант>?\nО: Если на неё нажать, то будет сгенерирован дополнительный вариант ответа на то же задание. Он будет немного отличаться и, возможно, понравится Вам больше.\n\nВ: Что такое Температура (t°)?\nО: Это параметр для продвинутого использования. Его значение можно менять в диапазоне от 0 до 2, а значение по умолчанию равно 1. Значение температуры можно изменить в разделе Настройки (/settings) для любой из функций. При значении t° = 0 ответ сервиса всегда будет практически одним и тем же для одного и того же вопроса, в то время как при значении t° = 2, ответы могут значительно отличаться, несмотря на одинаковый вопрос. Значение температуры выше 1 может приводить к неожиданным или бессмысленным ответам сервиса, поэтому в данном чатботе возможные значения ограничены диапазоном от 0 до 1.",
    "admin_welcome":"Поздравляю! Теперь у вас есть права администратора. Чтобы узнать, какие дополнительные возможности это Вам дает, направьте команду /help.",
    "reports":"Пока не настроено ни одного отчета))",
    "reports_no_permission":"Для просмотра отчетов требуются права администратора.",
    "incorrect_code":"Код неверный. Попробуйте еще раз. Но не пытайтесь взломать его перебором. Он очень сложный! :)",
    "unregistered":"Окей! Ваша регистрация прекращена и данные диалогов удалены. Теперь каждый сам по себе... ) Шутка! Надеюсь, еще увидимся! )",
    "unregisteredAllResultMsg":"Регистрация отменена у [number] пользователя(ей). Всем направлены уведомления.",
    "blank_registration":"В сообщении не найден регистрационный код. Попробуйте еще и на этот раз добавьте код регистрации через пробел после команды /start.",
    "blank_admin_code":"Я не нашел в сообщении кода администратора. Попробуте еще раз.",
    "no_admin_permissions":"У вас нет администраторских прав, чтобы делать рассылки пользователям. Чтобы активировать права администратора пришлите команду /admin <код администратора>",
    "no_text_msg":"К сожалению, я отвечаю только на текстовые, голосовые и аудио сообщения.",
    "erros_msg_basic":"Какие-то проблемы с обработкой вашего сообщения. Перешлите код ошибки администратору бота.",
    "erros_msg_reset":"Возникли проблемы при перезапуске далога. Напишите в поддержку.",
    "error_api_too_many_req":"Ошибка стороннего сервиса. Превышен лимит обращений в минуту. Попробуйте повторить запрос немного позже.",
    "error_api_other_problems": "Сервер OpenAI временно недоступен. Повторите запрос позже.",
    "error_strange":"Какая-то странная ошибка. Обратитесь к администратору.",
    "already_registered":"Регистрация уже пройдена ранее!",
    "already_admin":"Активация админских прав уже произведена ранее!",
    "no_profile_yet":"Пожалуйста, начните с команды /start.",
    "sendtome_error":"Поместите текст для отправки в квадратные скобки.",
    "sendtoall_error":"Поместите текст для отправки в квадратные скобки.",
    "sendtoall_success":"Сообщение разослано.",
    "dialogresetsuccessfully":"Диалог с Ассистентом перезапущен.",
    "overlimit_dialog_msg":"Не удается отправить сообщение Ассистенту, так как общий размер диалога, включая последнее сообщение, превышает лимит. Диалог будет автоматически перезапущен.",
    "token_limit_exceeded":"Ассистент не смог завершить свой ответ, так как исчерпались токены для продолжения диалога. Диалог будет автоматически перезапущен.",
    "code_change_mesage":"Администратор чатбота сменил код регистрации. Для возобновления доступа нужно повторно пройти регистрацию. Для получения нового кода регистрации обратитесь к администратору бота.",
    "token_limit_exceeded_not_dialogue":"Не удалось завершить ответ, так как исчерпались токены.",
    "empty_completion":"Ошибка стороннего сервиса. Сервис прислал некорректный ответ. Попробуйте повторить запрос.",
    "external_service_error":"При обращении к сторнему сервису возникла ошибка. Свяжитесь с администратором бота.",
    "regenerate":"Предложи еще вариант (t° = [temperature])",
    "settings_intro":"Выберите, где будем менять настройки:",
    "choice_made":"выбор = [value]",
    "audiofile_format_limit_error":"К сожалению, я могу прочитать только голосовые сообщения и видео заметки Телеграмм, а также аудио файлы следующих форматов: mp3, mpeg, mpga, m4a, wav, or webm",
    "audiofile_size_limit_error":"Сожалею, но я не могу прочитать файл, размер которого превышает [size] Мб. Попробуйте с помощью онлайн конвертеров разбить файл на части или снизить его качество.",
    "audio_dowload_progess":"Слушаю запись...",
    "error_voicetotext_doesnot_process_text":"Функция Голос в текст не обрабатывает текстовые сообщения, только аудио и видео файлы.",
    "telegram_TGR_ERR1":"Ошибка при формировании сообщения Телеграмм. Обратитесь к администратору.",
    "telegram_TGR_ERR2":"Ошибка Телеграмм. Превышен лимит сообщений в минуту. Повторите запрос позже.",
    "telegram_TGR_ERR99":"Ошибка при формировании сообщения Телеграмм. Обратитесь к администратору.",
    "INT_ERR":"Внутренняя ошибка сервера. Обратитесь к администратору.",
    "OAI_ERR1":"Ошибка стороннего сервиса. Сервер временно недоступен. Попробуйте повторить запрос позже.",
    "DB_ERROR":"Ошибка базы данных. Обратитесь к администратору.",
    "telegram_wait_time":"Сервер Телеграмм перегружен. Оставшаяся часть сообщения будет доставлена через [seconds_to_wait] сек.",
    "wrong_regime":"Для запроса еще одного варианта, пожалуйста, переключитесь на функцию [regime], т.к. именно в ней было сформировано первоначальное сообщение.",
    "resend_to_admin":"Переслать администратору",
    "empty_message":"Пустое сообщение",
    "function_request_msg":"Запрошено выполнение функции: [function]",
    "function_result_msg":"Результат выполнения функции:\n [result]",
    "current_settings":"Текущие настройки: \n [settings]",
    "too_long_message":"... \nСообщение сокращено, т.к. превысило допустимый размер сообшения Телеграмм."
};