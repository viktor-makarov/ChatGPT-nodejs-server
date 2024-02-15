const fs = require('fs').promises;
const { Script } = require('vm');

const { encode, decode } = require("gpt-3-encoder");
const { lte } = require('lodash');
const msqTemplates = require("../config/telegramMsgTemplates");

function countTokens(text) {
  //Converts string to tokens and counts their number
  const encoded = encode(text);
  return encoded.length;
}


function reorderArrayForTools(array) {
  // Create a map of assistant index by their id
  const assistantIndexById = {};
  array.forEach((item, index) => {
    if (item.role === 'assistant') {
      assistantIndexById[item.id] = index;
    }
  });

  // Create a copy of the array to prevent modification of the original array
  const arrayCopy = [...array];

  // Find tools and move them after their respective assistants
  array.forEach((item, index) => {
    if (item.role === 'tool') {
      // Find the index where this tool should go (after its matching assistant)
      const correctIndex = assistantIndexById[item.id] + 1;

      // Remove the tool from its current position
      arrayCopy.splice(index, 1);

      // Insert the tool after its matching assistant
      arrayCopy.splice(correctIndex, 0, item);

      // Update the index for assistants that come after the moved tool
      for (const id in assistantIndexById) {
        if (assistantIndexById[id] >= correctIndex) {
          assistantIndexById[id]++;
        }
      }
    }
  });

  return arrayCopy;
}


function countTokensProportion(text) {
  //Converts string to tokens and counts their number
  return text.length/3.2;
};

function recursiveReplace(obj) {
  for (var key in obj) {
    if (typeof obj[key] === 'object') {
      // If the value is an object, recursively call the function
      recursiveReplace(obj[key]);
    } else if (typeof obj[key] === 'string') {
      // If the value is a string, check if it matches the date format
      var datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      if (datePattern.test(obj[key])) {
        // If it matches, replace it with new Date()
        obj[key] = new Date(obj[key]);
      }
    }
  }
  return obj
}

const replaceNewDate = (str) => {

  const evalString = `(function(){return ${str}})()`;

  const script = new Script(evalString, {displayErrors: true,
});

let obj = script.runInThisContext();

obj = recursiveReplace(obj) //Заменяем даты на new Date(), чтобы mongoose понял.

//console.log("obj",JSON.stringify(obj));
  
  return obj

};

function escapeMarkdownV2(text) {
  // List of special characters to escape for MarkdownV2
  const escapeChars = '_*[]()~`>#+-=|{}!.\'.';

  // Replace each special character with its escaped version
  return [...text].map((char) => {
      return escapeChars.includes(char) ? `\\${char}` : char;
  }).join('');
}

function jsonToMarkdownCodeBlock(jsonObject) {
  const jsonString = JSON.stringify(jsonObject, null, 2);

  // In MarkdownV2, escape the backtick ` and the backslash \ characters.
  let escapedJsonString = jsonString
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/`/g, '\\`');   // Escape backticks

    if(escapedJsonString.length>appsettings.telegram_options.big_outgoing_message_threshold*0.8){
      escapedJsonString = escapedJsonString.substring(0, appsettings.telegram_options.big_outgoing_message_threshold) + msqTemplates.too_long_message
  }

  return '```\n' + escapedJsonString + '\n```';
}

function safeStringify(obj) {
  const cache = new Set();
  const stringified = JSON.stringify(obj, function(key, value) {
      if (typeof value === 'object' && value !== null) {
          if (cache.has(value)) {
              // Duplicate reference found, discard key
              return;
          }
          // Store value in our collection
          cache.add(value);
      }
      return value;
  });
  cache.clear();
  return stringified;
}


const replaceISOStr = (str) => {

const obj = JSON.parse(str, (key, value) => {
  if (typeof value === 'string') {
    console.log(value)
    const match = value.match(/ISODate\(\"(.*)\"\)$/);
    if (match) {
      return `ISODate("${match[1]}")`;
    }
  }
  return value;
})

return obj
}

function wireStingForMarkdown(inputString) {
  //Replaces some symbols in a string to alow markdown work properly
  inputString = inputString.replace(/[.*+?^${}()|[\]\\]/g, "\$&");
  // Return the updated input string
  return inputString;
}

function debounceConstructor(func, timeout = 300) {

  let timer;

  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (typeof func === 'function' && typeof timeout === 'number') {
        try {
          func.apply(this, args);
        } catch (err) {
          err.mongodblog=true;
          throw err
        }
      } else {
        var err = new Error('Incorrect parameters of the function')
        err.mongodblog=true;
      }
    }, timeout);
  };
}

function debounceConstructorPromise(f, interval) {
  let timer = null;

  return (...args) => {
    clearTimeout(timer);
    return new Promise((resolve) => {
      timer = setTimeout(() => resolve(f(...args)), interval);
    });
  };
}

function throttle(func, delay) {

  let lastFunc;
  let lastRan;
  return function() {
    const context = this;
    const args = arguments;
    if (!lastRan) {
      func.apply(context, args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(function() {
        if ((Date.now() - lastRan) >= delay) {
          func.apply(context, args);
          lastRan = Date.now();
        }
      }, delay - (Date.now() - lastRan));
    }
  }
}



function optionsToButtons(object,callback_key){


  const limit_in_line = 25;
  let buttons_array =[];
  let main_rows =[]
  let main_rows_final =[]
  let back_row =[]
  let listItems = Object.keys(object)
  //listItems.sort()
  listItems.forEach((item)=>{
    if(item==="back"){
      back_row.push({text:object[item].name,callback_data:callback_key+"_"+item})
    } else {
      main_rows.push({text:object[item].name,callback_data:callback_key+"_"+item})
    }
  })
  //Дальше будем разбивать кнопки по строчкам
  let temp_array = new Array();
  let nameLength = 0;

  let count = 0
  main_rows.forEach((item)=>{
    count +=1
    nameLength = nameLength + String(item.text).length
    if(nameLength<=limit_in_line){
      temp_array.push(item)
    } else {
      buttons_array.push(temp_array)
      temp_array =new Array();
      temp_array.push(item)
      nameLength = item.text.length
    }
    if(count===main_rows.length){
      buttons_array.push(temp_array)
    }
  })

  if(back_row.length>0){
    buttons_array.push(back_row)
  }

  return buttons_array

}


function throttlePromise(fn, delay) {
  let timerId;
  let lastExecutedTime = 0;

  return function () {
    return new Promise((resolve) => {
    const context = this;
    const args = arguments;

    const execute = function () {
      resolve(fn.apply(context, args));
      lastExecutedTime = Date.now();
    };

    if (timerId) {
      clearTimeout(timerId);
    }
  //  console.log(Date.now() - lastExecutedTime)
    if (lastExecutedTime===0){ //first start
      lastExecutedTime = Date.now();
    }
    
    if (Date.now() - lastExecutedTime > delay) {
      execute();
    } else {
      timerId = setTimeout(execute, delay);
    }
  })
  };
}

async function get_ielts_part1_heders(){

  const questionObject = JSON.parse(await fs.readFile("./config/ielts_questions_list_p_1.json", 'utf8'));

  const subjects = Object.keys(questionObject)
  return subjects
}

async function get_ielts_part1_questions_by_headers(header_str){

  const questionObject = JSON.parse(await fs.readFile("./config/ielts_questions_list_p_1.json", 'utf8'));
  const question_list = questionObject[header_str]

  return question_list
}


function jsonToText(obj, indent = '') {
  let text = '';
  for (let key in obj) {
      if(typeof obj[key] === 'object' && obj[key] !== null) {
          text += `${indent}${key}:\n${jsonToText(obj[key], indent + '    ')}`;
      } else {
          text += `${indent}${key}: ${obj[key]}\n`;
      }
  }
  return text;
}

module.exports = {
  countTokens,
  wireStingForMarkdown,
  debounceConstructor,
  debounceConstructorPromise,
  throttle,
  throttlePromise,
  optionsToButtons,
  get_ielts_part1_heders,
  get_ielts_part1_questions_by_headers,
  jsonToText,
  replaceNewDate,
  replaceISOStr,
  countTokensProportion,
  reorderArrayForTools,
  safeStringify,
  jsonToMarkdownCodeBlock
};
