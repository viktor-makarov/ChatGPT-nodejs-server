//https://www.exchangerate-api.com/

const axios = require("axios");

const availableCurrencies = [
  "USD", "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG",
  "AZN", "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB",
  "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP",
  "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD",
  "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "FOK", "GBP", "GEL", "GGP",
  "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG",
  "HUF", "IDR", "ILS", "IMP", "INR", "IQD", "IRR", "ISK", "JEP", "JMD",
  "JOD", "JPY", "KES", "KGS", "KHR", "KID", "KMF", "KRW", "KWD", "KYD",
  "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA",
  "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR",
  "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN",
  "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF",
  "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SLL", "SOS",
  "SRD", "SSP", "STN", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP",
  "TRY", "TTD", "TVD", "TWD", "TZS", "UAH", "UGX", "UYU", "UZS", "VES",
  "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XDR", "XOF", "XPF", "YER",
  "ZAR", "ZMW", "ZWL"
];


async function get_rate(baseCurrency="USD", timeout = 10000) {

 const config = {
        method: 'get',
        timeout:timeout,
        url: `https://v6.exchangerate-api.com/v6/${process.env.ExRate_API_TOKEN}/latest/${baseCurrency}`,
        headers: {
                "Content-Type": "application/json"
            }
    }


    const result = await axios(config);

    if(result.data.result !== "success") {
        const error = new Error("Exchange rate API error");
        error.code = "EX_RATE_ERR";
        error.place_in_code = "ExRate_API.get_rate";
        error.details = result.data.error-type || "Unknown error";
        throw error;
    }

    const convertedData = convertExchangeApiResponse(result.data);

    return convertedData
  }

  function convertExchangeApiResponse(obj) {
        return {
            time_last_update_unix: obj.time_last_update_unix,
            time_last_update_iso4217: new Date(obj.time_last_update_unix * 1000).toISOString(),
            base_code: obj.base_code,
            ...obj.conversion_rates
        };
        }

module.exports = {
    availableCurrencies,
    get_rate
}