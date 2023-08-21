module.exports = {

//Do not use "_" for keys
reports:{
    options_desc:"Выберите отчет",
    options:{
        currentProfiles:{
            name:"Все профили",
            templateRespMsg:"Список текущих профилей телеграм бота.\nFirstName LastName UserName RegistrationDate\n[report]",
        },
        oldusers:{
            name:"Устаревшая регистрация",
            templateRespMsg:"Список пользаваетелей, у которых код регистрации отличается от текущего.\nId FirstName LastName UserName RegistrationDate\n[report]",
        },
        statistics:{
            options_desc:"Статистические отчеты",
            name:"Статистика",
            options:{
                errors:{
                    name:"Ошибки",
                    templateRespMsg:"Статистика ошибок.\n ErrorMessage = (Number)\n[report]",
                },
                userActivity:{
                    name:"Активность пользователей",
                    templateRespMsg:"Статистика активности пользователей.\nFirstName LastName UserName NumberOfRequests NumberOfTokens LastRequestDTUTF\n[report]",
                },
                regimeUsage:{
                    name:"Исп. режимов",
                    templateRespMsg:"Статистика использования режимов.\nRegime NumberOfRequests NumberOfTokens\n[report]",
                },
                tokenUsage:{
                    name:"Использование токенов",
                    templateRespMsg:"Статистика использования токенов за поледние 10 дней\n Date NumberOfRequests NumberOfTokens, UniqueUsers\n[report]",
                },
                back:{
                    "name":"<< Назад"
                }
            }
        }
    }
}
}