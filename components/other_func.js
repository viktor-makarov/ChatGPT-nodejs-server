const fs = require('fs').promises;

const { encode, decode } = require("gpt-3-encoder");

function countTokens(text) {
  //Converts string to tokens and counts their number
  const encoded = encode(text);
  return encoded.length;
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
  listItems.sort()
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
    } else if (Date.now() - lastExecutedTime > delay) {
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
  jsonToText
};
