//http://www.cbr.ru/

const axios = require("axios");
const xml2js = require('xml2js');

const availableCurrencies = [
  "AUD", "AZN", "GBP", "AMD", "BYN", "BGN", "BRL", "HUF", "VND", "HKD", 
  "GEL", "DKK", "AED", "USD", "EUR", "EGP", "INR", "IDR", "KZT", "CAD", 
  "QAR", "KGS", "CNY", "MDL", "NZD", "NOK", "PLN", "RON", "XDR", "SGD", 
  "TJS", "THB", "TRY", "TMT", "UZS", "UAH", "CZK", "SEK", "CHF", "RSD", 
  "ZAR", "KRW", "JPY","RUB"
];

async function get_rate_by_date(dateString, timeout = 10000) {

    const day = dateString.split("-")[2];
    const month = dateString.split("-")[1];
    const year = dateString.split("-")[0];
    const config = {
            method: 'get',
            timeout:timeout,
            url: `http://www.cbr.ru/scripts/XML_daily.asp?date_req=${day}/${month}/${year}`,

        }
        const result = await axios(config);

        return result.data
}

async function convertCbrXmlToJson(xmlText) {
  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(xmlText);

  const date = result.ValCurs.$.Date;
  const obj = { date, "RUB": 1 }; // Добавляем RUB с курсом 1

  result.ValCurs.Valute.forEach(valute => {
    const code = valute.CharCode;
    // Если есть VunitRate, берем его, иначе Value и делим на Nominal
    let rate = valute.VunitRate
      ? parseFloat(valute.VunitRate.replace(',', '.'))
      : (parseFloat(valute.Value.replace(',', '.')) / parseInt(valute.Nominal));
    obj[code] = rate;
  });

  return obj;
}



module.exports = {
    availableCurrencies,
    get_rate_by_date,
    convertCbrXmlToJson
}