const fs = require('fs');
const modelConfig = require("../config/modelConfig");
const { Script } = require('vm');
const cryptofy = require('crypto');
const axios = require("axios");
const awsApi = require("./AWS_API.js")
const unicodeit = require('unicodeit');
const mjAPI = require('mathjax-node');
const mongo = require("./mongo");
const googleApi = require("./google_API.js");
const path = require('path');
const pdf = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');

function generateButtonDescription(buttonLabels,buttonsShownBefore){

  let description ={};
  let lables = buttonLabels;
  const descriptionSource = appsettings.mdj_options.buttons_description
  const exclude_buttons = appsettings.mdj_options.exclude_buttons;
  lables = lables.filter(label => !exclude_buttons.includes(label));
  if(buttonsShownBefore){
  lables = lables.filter(label => !buttonsShownBefore.includes(label));
  }
  
  for (const label of lables){

      description[label] = descriptionSource[label]
  }

  return description
  }


function extractSystemRolesFromEnd(documents) {
  const result = [];
  for (let i = documents.length - 1; i >= 0; i--) {
      if (documents[i].role === 'system' && documents[i].fileName) {
          result.push({
            sourceid:documents[i].sourceid,
            telegramMsgId:documents[i].telegramMsgId,
            fileName:documents[i].fileName,
            fileUrl:documents[i].fileUrl,
            fileCaption:documents[i].fileCaption,
            fileAIDescription:documents[i].fileAIDescription
          });
      } else {
          break;
      }
  }
  return result;
}

async function startFileDownload(url){
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 5000
  });

return response
}

async function getPDFPageNumber(pdfBuffer){

  const pdfData = await pdf(pdfBuffer, { max: 0 }); // max: 0 to avoid parsing content

  return pdfData.numpages
}


async function splitPDFByPageChunks(pdfBuffer, limit) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new Error('Invalid PDF buffer provided');
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Page limit must be a positive integer');
  }

    const srcPdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = srcPdfDoc.getPageCount(); // Using direct page count instead of separate function call
    const chunks = [];

    for (let startPage = 0; startPage < totalPages; startPage += limit) {
      const endPage = Math.min(startPage + limit, totalPages);
      const pageIndicesToCopy = Array.from(
        { length: endPage - startPage }, 
        (_, i) => i + startPage
      );
      
      const chunkPdfDoc = await PDFDocument.create();
      const copiedPages = await chunkPdfDoc.copyPages(srcPdfDoc, pageIndicesToCopy);
      
      copiedPages.forEach(page => chunkPdfDoc.addPage(page));
      
      const chunkBuffer = await chunkPdfDoc.save({ 
        useObjectStreams: false // Improves compatibility with some PDF readers
      });
      
      chunks.push(Buffer.from(chunkBuffer));
    }

    return chunks;

}

async function fileDownload(url){
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer',
    timeout: 5000
  });

return Buffer.from(response.data)
}

mjAPI.start();
const sharp = require('sharp');
const svgson = require('svgson');

const { encode, decode } = require("gpt-3-encoder");
const msqTemplates = require("../config/telegramMsgTemplates");

async function getSvgDimensions(svg) {
  const parsedSvg = await svgson.parse(svg);
  const widthLatex = Math.round(parseFloat(parsedSvg.attributes.width))*8 || 800; // Default to 800 if not specified
  const heightLatex = Math.round(parseFloat(parsedSvg.attributes.height))*8 || 600; // Default to 600 if not specified
  return { widthLatex, heightLatex };
}

async function encodeJson(json){
  
  let hash = cryptofy.createHash('md5');
  hash =  hash.update(JSON.stringify(json)).digest('hex');
  await mongo.saveHash(hash,json);
  return hash
};

async function decodeJson(hash){
  return await mongo.getJsonBy(hash)
};

async function createTextImage(text,options = {}) {

  if (!text) {
    throw new Error('Text input is required');
  }

  const { 
    fontSize = 10, 
    fontFamily = 'Arial',
    background = { r: 255, g: 255, b: 255, alpha: 1 }
  } = options;

  const estimatedWidth = Math.round(text.length * (fontSize * 0.6));
  const height = Math.round(fontSize * 1.5);

  const svgText = `<svg width="${estimatedWidth}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text 
        x="0" 
        y="${fontSize}" 
        font-family="${fontFamily}" 
        font-size="${fontSize}"
        fill="black"
      >${text}</text>
    </svg>`;

    const sharpInstance = sharp(Buffer.from(svgText));
    
    // Apply background if specified
    if (!background) {
      sharpInstance.ensureAlpha();
    }

    const pngBufferText = await sharpInstance.png().toBuffer();

    return {
    pngBufferText,
    widthText: estimatedWidth,
    heightText: height,
  };
}

async function getImageByUrl(url){

  const response = await axios({
      method: 'get',
      url: url,
      responseType: "arraybuffer"
      });

   const binaryImage = Buffer.from(response.data, "binary");
   return binaryImage
};

function latexToSvg(latex, options = {}) {

  if (!latex || typeof latex !== 'string') {
    return Promise.reject(new Error('Invalid LaTeX input: must be a non-empty string'));
  }

  const { displayMode = false, fontSize = 1.0 } = options;

  return new Promise((resolve, reject) => {
    mjAPI.typeset({
      math: latex,
      format: "TeX",      // Input format
      svg: true,
      displayMode: displayMode,
      ex: 6 * fontSize,
      linebreaks: true 
    }, function (data) {
      if (data.errors) {
        reject(new Error(`MathJax failed to convert LaTeX: ${data.errors.join(', ')}`));
      } else {
        resolve(data.svg);
      }
    });
  });
}

async function convertLatexToPNG(latex, options = {}){
  if (!latex || typeof latex !== 'string') {
    throw new Error('Invalid LaTeX input: must be a non-empty string');
  }

  const { 
    transparent = false, 
    scale = 1,
    displayMode = false,
    fontSize = 1.0,
    quality = 6
  } = options;

  const svg = await latexToSvg(latex, { displayMode, fontSize });

  const { widthLatex, heightLatex } = await getSvgDimensions(svg);
  const svgBuffer = Buffer.from(svg);

  const sharpInstance = sharp(svgBuffer);
    
  // Configure output options
  const outputOptions = { quality };
  
  // Apply transparency if requested
  if (transparent) {
    sharpInstance.ensureAlpha();
  }

  if (scale !== 1) {
    sharpInstance.resize({
      width: Math.round(widthLatex * scale),
      height: Math.round(heightLatex * scale),
      fit: 'contain'
    });
  }

  const pngBufferLatex = await sharpInstance
  .png(outputOptions)
  .toBuffer();

  return {pngBufferLatex,
          widthLatex: scale !== 1 ? Math.round(widthLatex * scale) : widthLatex,
          heightLatex: scale !== 1 ? Math.round(heightLatex * scale) : heightLatex
        }
}

async function generateCanvasPNG(latexObject, options = {}){

  if (!latexObject || typeof latexObject !== 'object' || Object.keys(latexObject).length === 0) {
    throw new Error('Invalid latexObject: must be a non-empty object');
  }

  try {
  const {
    majorMargin = 10,
    minorMargin = 5,
    initialOffset = 10
  } = options;

  
  const latexArray = Object.entries(latexObject)

  let compositeImages = [];

  // Step 1: Generate all images first
  for (const [number, latexText] of latexArray) {

    const { pngBufferText,widthText,heightText} = await createTextImage(`# ${number}`);
    const { pngBufferLatex,widthLatex,heightLatex} = await convertLatexToPNG(latexText);
    
    compositeImages.push({
      png:pngBufferText,
      width:widthText,
      height:heightText,
      marginDown:minorMargin,
      type: 'label'

    });
    compositeImages.push({
      png:pngBufferLatex,
      width:widthLatex,
      height:heightLatex,
      marginDown: majorMargin,
      type: 'formula'
    });
  }

  // Step 2: Calculate layout dimensions
  const maxWidth = Math.max(...compositeImages.map(item => item.width));

  const totalHeight = compositeImages.reduce((total, item) => {
    return total + item.height + item.marginDown;
  }, initialOffset);
  

 // Step 3: Create positioning layout
 const canvasWidth = maxWidth + 2 * initialOffset;
 const canvasHeight = totalHeight;

  // Position all elements
  let currentY = initialOffset;
  const compositionLayout = compositeImages.map(item => {
    const position = {
      input: item.png,
      top: currentY,
      left: initialOffset
    };

    // Update Y position for next item
    currentY += item.height + item.marginDown; 
    return position;
  });


  // Step 4: Generate final image
  let pngBuffer = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
  .composite(compositionLayout)
  .png()
  .toBuffer();

  return pngBuffer


} catch (error) {
  error.place_in_code = "otherfunctions.generateCanvasPNG"
  throw new Error(`Error in generating PNG from LaTeX formula: ${error}`);
}
}


function countTokens(text) {
  //Converts string to tokens and counts their number
  const encoded = encode(text);
  return encoded.length;
}

function findBrokenTags(text){

  const codeBlockMatches = text.match(/```/g);
  
  if(codeBlockMatches && codeBlockMatches.length % 2 != 0){
    const lastCodeBlocIndex = text.lastIndexOf('```');
    const trimmedText = text.substring(lastCodeBlocIndex);
    const codeWithLanguagePattern = /```([^\s]+)/g
    const [fullMatch,language] = codeWithLanguagePattern.exec(trimmedText) || [];

    return {close:"\n```",open:"```"+ (language || "" ) +"\n"+commentSymbolForLanguage(language)+"continued\n"}
  } else {
    return {close:""}
  }
}

function convertMarkdownToLimitedHtml(text){

  let convertedText = text

      // Sanitize remaining special HTML characters
      convertedText = convertedText.replace(/&(?![a-z]+;)/g, '&amp;');
      convertedText = convertedText.replace(/</g, '&lt;');
      convertedText = convertedText.replace(/(?<!^)>(?!\s)/gm, '&gt;');
      
      const formulasObj = {};
            // Handle LaTeX block formulas using \[...\]
          convertedText = convertedText.replace(/\\\[(.*?)\\\]/gs, (_, formula) => {
            const index = Object.keys(formulasObj).length+1;
            formulasObj[index]= formula.trim();
            return `<pre><code class="language-Simplified LaTeX - # ${index}">${unicodeit.replace(formula.trim())}</code></pre>`;
        });

        // Handle LaTeX inline formulas using \(...\)
        convertedText = convertedText.replace(/\\\((.*?)\\\)/g, (_, formula) => {
            return `<code>${unicodeit.replace(formula.trim())}</code>`;
        });


      // Extract code blocks and replace them with placeholders/ We withdraw code blocks to awoid their altering by other replacements
      const placeholder = '\uFFFF';  // Character unlikely to appear in Markdown
      const codeObj = {};
      
      // Inline code handling. 
      convertedText = convertedText.replace(/^[\s]*```markdown?\s+([\s\S]+?)^[\s]*```/gm, (_, code) => {
        const index = Object.keys(codeObj).length;
        codeObj[index]= (`<pre><code  class="language-markdown">${code}</code></pre>`);
        return `${placeholder}${index}${placeholder}`;
      });

      convertedText = convertedText.replace(/^[\s]*```([^\s]+)?\s+([\s\S]+?)^[\s]*```/gm, (_, language, code) => {
        const index = Object.keys(codeObj).length;
        codeObj[index] = `<pre><code class="language-${language}">${code}</code></pre>`;
        return `${placeholder}${index}${placeholder}`;
    });
    
      convertedText = convertedText.replace(/`` `([^`]+)` ``/g, (_, code) => {
        const index = Object.keys(codeObj).length;
        codeObj[index]= (`<code>${code}</code>`);
        return `${placeholder}${index}${placeholder}`;
      });

      convertedText = convertedText.replace(/`([^`]+)`/g, (_, code) => {
        const index = Object.keys(codeObj).length;
        codeObj[index]= (`<code>${code}</code>`);
        return `${placeholder}${index}${placeholder}`;
      });

      // Replace headers
      convertedText = convertedText.replace(/^##### (.*$)/gim, '<i>$1</i>');
      convertedText = convertedText.replace(/^#### (.*$)/gim, '<i>$1</i>');
      convertedText = convertedText.replace(/^### (.*$)/gim, '<b><i>$1</i></b>');
      convertedText = convertedText.replace(/^## (.*$)/gim, '<b>$1</b>');
      convertedText = convertedText.replace(/^# (.*$)/gim, (_, header) => `${header.toUpperCase()}`);
    
    // Replace block quotes
    convertedText = convertedText.replace(/^[\s]*\> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Replace bold, italic and strikethrough text
    convertedText = convertedText.replace(/\*\*\*(.*?)\*\*\*/gim, '<b><i>$1</i></b>');
    convertedText = convertedText.replace(/\*\*(.*?)\*\*/gim, '<b>$1</b>');
    convertedText = convertedText.replace(/\*(.*?)\*/gim, '<i>$1</i>');
    convertedText = convertedText.replace(/\_\_(.*?)\_\_/gim, '<u>$1</u>');
    convertedText = convertedText.replace(/(?<=^|\s|[\r\n])\_(.*?)\_(?=$|\s|[\r\n])/gim, '<i>$1</i>');
    convertedText = convertedText.replace(/~~(.*?)~~/gim, '<s>$1</s>');

       // Replace emoji syntax
       convertedText = convertedText.replace(/!\[([^\]]*)\]\(tg:\/\/emoji\?id=([^\)]+)\)/gim, '<tg-emoji emoji-id="$2">$1</tg-emoji>');
       convertedText = convertedText.replace(/\!\[([^\]]+)\]\(([^)]+)\)/gim, function(match, text, url) {
        // Sanitize the URL by replacing double quotes with the HTML entity
        const sanitizedUrl = url.replace(/"/g, '&quot;');
        return `<a href="${sanitizedUrl}">${text}</a>`;
      }); 
      // Replace links
      convertedText = convertedText.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2">$1</a>');
      
      // Reinsert the code blocks and inline codes
      convertedText = convertedText.replace(new RegExp(`${placeholder}(\\d+)${placeholder}`, 'g'), (_, index) => codeObj[index]);

      let result = {"html":convertedText}

      if(Object.keys(formulasObj).length !== 0){
        result.latex_formulas = formulasObj;
      } else {
        result.latex_formulas = null;
      }
      
      return result
}

function wireHtml(text){
  
  let wiredText = text ? text: "";
  wiredText = wiredText
  .replace(/&/g,"&amp;")//this should be first
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;")

  return wiredText
}

  function generateTextBuffer(text) {
    // Convert the text to a buffer using UTF-8 encoding
    const buffer = Buffer.from(text, 'utf-8');
    return buffer;
  }



  async function htmlToPdfBuffer(htmlString, pdfOptions = {}) {

    const page = await global.chromeBrowserHeadless.newPage();
    
      await page.setContent(htmlString, {
        waitUntil: 'networkidle0',
    });
  
    // Генерируем PDF и возвращаем буфер
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin:{top: 20, right: 20, bottom: 20, left: 20},
      ...pdfOptions
    });

    return Buffer.from(buffer);
}


  function checkFileSizeToTgmLimit(fileSizeBites,fileLimitBites){

    if(fileSizeBites>fileLimitBites){
      throw new Error("File size exceeds the limit of " + fileLimitBites + " bytes")
    }
  }

  function filenameWoExtention(fullfilename){

    const fileNameParts = fullfilename.split('.')
    fileNameParts.pop()
    return fileNameParts.join('.')

  }

  function calculateFileSize(buffer) {
    // Get the size in bytes
    const bytes = buffer.length;
    
    // Convert to appropriate units for human-readable format
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    // Format with two decimal places if not in bytes
    const formattedSize = unitIndex === 0 ? size : size.toFixed(2);
    
    return {
      sizeBytes: bytes,
      sizeString: `${formattedSize} ${units[unitIndex]}`
    };
  }

async function countTokensLambda(text,model){

  const requestObj = {"text":text,"model":model}
  const start = performance.now();

  const resultJSON = await awsApi.lambda_invoke("R2D2-countTokens",requestObj)

  const endTime = performance.now();
  const executionTime = endTime - start;
  console.log(`countTokensLambda execution time: ${executionTime.toFixed(2)} ms`);


  if(resultJSON.body.warning){
    console.log("countTokensLambda warning:",resultJSON.body.warning)
  }

  if(resultJSON.statusCode === 200){
    return resultJSON.body.tokens_count
  } else if (resultJSON.statusCode){
      const err = new Error("countTokensLambda: " + resultJSON.body)
      throw err
  } else if (resultJSON.errorMessage){
    const err = new Error("countTokensLambda: " + resultJSON.errorMessage)
    throw err
  } else {
    const err = new Error('unspecified error in awsApi.lambda_invoke function')
    throw err
  }
}

async function extractTextFromFile(url,mine_type){

  try{
    if(mine_type==="image/jpeg" || mine_type ==="image/gif"){
     
      const fileBuffer = await fileDownload(url)
      const ocrResult =  await googleApi.ocr_document(fileBuffer,mine_type)
      const text = ocrResult.text
    
      return {success:1,text:text,was_extracted:1}

    } else if (mine_type === "application/pdf") {

      const result = await extractTextLambdaPDFFile(url)

      if(result.text.length>10){
        return {success:1,text:result.text}
      } else {

        const fileBuffer = await fileDownload(url)
        
        const pageNumber = await getPDFPageNumber(fileBuffer)

        let text ="";
        if(pageNumber <= appsettings.functions_options.OCR_max_allowed_pages_in_one_chunk){
          const ocrResult =  await googleApi.ocr_document(fileBuffer,mine_type)
          text = ocrResult.text
        } else {

          const pageChunks = await splitPDFByPageChunks(fileBuffer,appsettings.functions_options.OCR_max_allowed_pages_in_one_chunk)
          
          const ocrPromiseArr = pageChunks.map((chunk,index) => {
            return googleApi.ocr_document(chunk,mine_type,index)
          })

          const ocrResults = await Promise.all(ocrPromiseArr)
          ocrResults.sort((a, b) => a.index - b.index);

          ocrResults.forEach( result => {
            text += result.text
          })
        }

        return {success:1,text:text,was_extracted:1}
      }
    } else if (mine_type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    
      const result = await extractTextLambdaExcelFile(url)
      return {success:1,text:result.text}
    } else {
      const result = await extractTextLambdaOtherFiles(url,mine_type)
      return {success:1,text:result.text}
    }
  } catch(err){
    console.log("err",err)
    return {success:0,error:err.message}
  }
}

async function extractTextLambdaPDFFile(url){

  const requestObj = {"file_url":url}
  const start = performance.now();

  const resultJSON = await awsApi.lambda_invoke("R2D2-extractTextFromPDF",requestObj)
  
  const endTime = performance.now();
  const executionTime = endTime - start;
  console.log(`extractTextLambdaPDFFile execution time: ${executionTime.toFixed(2)} ms`);


  if(resultJSON.statusCode === 200){
    return resultJSON.body
  } else if (resultJSON.statusCode){
    const err = new Error("extractTextLambdaPDFFile: " + resultJSON.body)
    throw err
  } else if (resultJSON.errorMessage){
    const err = new Error("extractTextLambdaPDFFile: " + resultJSON.errorType + " " + resultJSON.errorMessage)
    throw err
  } else {
    const err = new Error('unspecified error in awsApi.lambda_invoke function')
    throw err
  }
}



async function executePythonCode(codeToExecute){

  const requestObj = {"code":codeToExecute}
  const start = performance.now();

  const resultJSON = await awsApi.lambda_invoke("R2D2-executePythonCode",requestObj)
  
  const endTime = performance.now();
  const executionTime = endTime - start;
  console.log(`executePythonCode execution time: ${executionTime.toFixed(2)} ms`);

   
  if(resultJSON.statusCode === 200){
    return resultJSON.body.result
  } else if (resultJSON.statusCode){
    const err = new Error("executePythonCode: " + resultJSON.body)
    throw err
  } else if (resultJSON.errorMessage){
    const err = new Error("executePythonCode: " + resultJSON.errorType + " " + resultJSON.errorMessage)
    throw err
  } else {
    const err = new Error('unspecified error in awsApi.lambda_invoke function')
    throw err
  }
}

async function extractTextLambdaExcelFile(url){

  const requestObj = {"file_url":url}
  const start = performance.now();

  const resultJSON = await awsApi.lambda_invoke("R2D2-extractTextFromExcelFile",requestObj)
  
  const endTime = performance.now();
  const executionTime = endTime - start;
  console.log(`extractTextLambdaExcelFile execution time: ${executionTime.toFixed(2)} ms`);


  if(resultJSON.statusCode === 200){
    return resultJSON.body
  } else if (resultJSON.statusCode){
      const err = new Error("extractTextLambdaExcelFile: " + resultJSON.body)
      throw err
  } else if (resultJSON.errorMessage){
    const err = new Error("extractTextLambdaExcelFile: " + resultJSON.errorMessage)
    throw err
  } else {
    const err = new Error('unspecified error in awsApi.lambda_invoke function')
    throw err
  }
}

async function extractTextLambdaOtherFiles(url,mine_type){

  const requestObj = {"file_url":url,"file_mime_type":mine_type}
  const start = performance.now();

  const resultJSON = await awsApi.lambda_invoke("R2D2-extractTextFromOtherFiles",requestObj)
  
  const endTime = performance.now();
  const executionTime = endTime - start;
  console.log(`extractTextLambdaOtherFiles execution time: ${executionTime.toFixed(2)} ms`);

  if(resultJSON.statusCode === 200){
    return resultJSON.body
  } else if (resultJSON.statusCode){
      const err = new Error("extractTextLambdaOtherFiles: " + JSON.stringify(resultJSON.body))
      throw err
  } else if (resultJSON.errorMessage){
    const err = new Error("extractTextLambdaOtherFiles: " + resultJSON.errorMessage)
    throw err
  } else {
    const err = new Error('unspecified error in awsApi.lambda_invoke function')
    throw err
  }
}


function startDeveloperPrompt(userInstance){

  let prompt = getLocalizedPhrase("system_start_dialogue",userInstance.language_code)


  if(userInstance.prefered_name){
    const placeholders = [{key:"[prefered_name]",filler:userInstance.prefered_name}]
    prompt += "\n\n"+ getLocalizedPhrase("call_the_user",userInstance.language_code,placeholders)
  }

  if(userInstance.response_style && userInstance.response_style !="neutral"){

    prompt += "\n\n" + getLocalizedPhrase("response_style_"+userInstance.response_style,userInstance.language_code)

    }

  return prompt
}

function getLocalizedPhrase(phrase_key,locale,placeholders){

  const msqTemplates = require("../config/telegramMsgTemplates");

  const langOption = locale ? (locale === "ru" ? "ru" : "en") : "ru"
  const phraseByKey = msqTemplates[phrase_key]
  
  let isLocalized = false;
  let localizedPhrase;

  if (phraseByKey === undefined) {
    throw new Error(`Phrase key "${phrase_key}" not found.`);
  } else if (typeof phraseByKey === "string") {
      isLocalized = false;
  } else if (typeof phraseByKey === "object") {
      isLocalized = true;
      localizedPhrase = phraseByKey[langOption]
      if(!localizedPhrase){
        throw new Error(`Phrase with key "${phrase_key}" is not localized for "${langOption}". Check telegramMsgTemplates file.`)
      }
  } else {
      throw new Error("Unexpected type for phraseByKey. Check telegramMsgTemplates file.");
  }

  let preFinalPhrase =  localizedPhrase ?? phraseByKey
  if(placeholders){
    for (const placeholder of placeholders){
      preFinalPhrase = preFinalPhrase.replace(placeholder.key,placeholder.filler)
    }
  }
  return preFinalPhrase
}


function valueToMD5(value){
  const hash = cryptofy.createHash('md5');
  return hash.update(value).digest('hex');
}

function reorderArrayForTools(array) {
  // Create a map of index by their id
  const IndexById = {};
  array.forEach((item, index) => {
    if (item.role === 'assistant') {
      IndexById[item.id] = index;
    }
  });

  // Create a copy of the array to prevent modification of the original array
  const arrayCopy = [...array];

  // Find tools and move them after their respective assistants
  array.forEach((item, index) => {
    if (item.role === 'tool') {
      // Find the index where this tool should go (after its matching assistant)
      const correctIndex = IndexById[item.id] + 1;

      // Remove the tool from its current position
      arrayCopy.splice(index, 1);

      // Insert the tool after its matching assistant
      arrayCopy.splice(correctIndex, 0, item);

      // Update the index for assistants that come after the moved tool
      for (const id in IndexById) {
        if (IndexById[id] >= correctIndex) {
          IndexById[id]++;
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

function charLimitFor(modelname){

  console.log("modelname",modelname)
  const tokenLimit = modelConfig[modelname].request_length_limit_in_tokens
 
  const charLimit = tokenLimit*3.2

  return charLimit
}

function splitTextByCharLimit(text) {
  const lines = text.split('\n');
  let result = [];

  const limit = charLimitFor(appsettings.functions_options.content_clean_oai_model)
  
  for (let line of lines) {
    if (line.length <= limit) {
      result.push(line);
    } else {
      let currentLine = '';
      
      // Split into words to avoid breaking words
      const words = line.split(' ');
      for (let word of words) {
        // Check if adding the next word exceeds the limit
        if (currentLine.length + word.length + 1 > limit) {
          if (currentLine !== '') {
            // Push the current line to the result and start a new line
            result.push(currentLine);
          }
          currentLine = word; // Start with the word that couldn't fit
        } else {
          // Add a space before the word if it's not the beginning of a new line
          currentLine += (currentLine ? ' ' : '') + word;
        }
      }
      // Push the last line of the current chunk if it's not empty
      if (currentLine !== '') {
        result.push(currentLine);
      }
    }
  }
  
  return result;
}

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

async function optionsToButtons(object,requestMsgInstance){

  try{
  const limit_in_line = 25;
  let buttons_array =[];
  let main_rows =[]
  let main_rows_final =[]
  let back_row =[]
  let listItems = Object.keys(object)
  
  const callback_data_decoded = await decodeJson(requestMsgInstance.callback_data)

  //listItems.sort()
  let previousData =  callback_data_decoded ? callback_data_decoded : []

  for (const item of listItems){

    const call_back_data_array = previousData.concat([item])
    const call_back_data_array_hashed =  await encodeJson(call_back_data_array)
    const callback_data = {
      e:requestMsgInstance.callback_event ? requestMsgInstance.callback_event : requestMsgInstance.commandName,
      d:call_back_data_array_hashed
    }

    if(item==="back"){
      back_row.push({text:object[item].name,callback_data:JSON.stringify(callback_data)})
    } else {
      main_rows.push({text:object[item].name,callback_data:JSON.stringify(callback_data)})
    }
  }

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
} catch(err){
  console.log(err)
  throw err
}
}

function extractTextBetweenDoubleAsterisks(text) {
  const matches = text.match(/\*\*(.*?)\*\*/);
  return matches ? matches[1] : null;
}

function throttleNew(func, delay) {
  let throttleTimeout = null
  return (...args)=> {
     if(!throttleTimeout) {
         throttleTimeout = setTimeout(()=> {
             func(...args)
             throttleTimeout = null
         }, delay)
     } 
  }
}

function debounceNew(func, delay) {
  let debounceTimer
  return (...args)=> {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(()=> {
          func(...args)
      }, delay)
  }
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

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}




function formatObjectToText(obj) {

  let formattedText = "";

  function iterate(obj, depth = 0) {
      for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            formattedText += `${'  '.repeat(depth)}${key}:\n`;
              if (typeof obj[key] === 'object' && obj[key] !== null) {
                  iterate(obj[key], depth + 2);
              } else {
                formattedText += ' '.repeat(depth + 2) + String(obj[key]).replace(/\n/g, '\n' + ' '.repeat(depth + 2)) + '\n';
              }
          }
      }
  }

  iterate(obj);
  return formattedText;
}

function saveTextToTempFile(text, filename) {
  const tempDir = path.join(__dirname, '../tempfiles');
  // Create directory if it doesn't exist
  if (fs.existsSync(tempDir)) {
    // Save text to the specified filename
    fs.writeFileSync(path.join(tempDir, filename), text, 'utf8');
  } else {
    const error = new Error(`Directory ${tempDir} does not exist`);
    throw error;
  }

  return path.join(tempDir, filename)
}

function saveBufferToTempFile(buffer, filename) {
  const tempDir = path.join(__dirname, '../tempfiles');
  // Create directory if it doesn't exist
  if (fs.existsSync(tempDir)) {
    // Save buffer to the specified filename
    fs.writeFileSync(path.join(tempDir, filename), buffer);
  } else {
    const error = new Error(`Directory ${tempDir} does not exist`);
    throw error;
  }

  return path.join(tempDir, filename);
}

function formatHtml(html,filename){

  
  html = html.split('\n').map(line =>
    line.replace(/^[ ]+/, m => '&nbsp;'.repeat(m.length))
  ).join('\n')
  html = html.replace(/<pre>/gi, '<div>').replace(/<\/pre>/gi, '</div>')

  return `<style>

          body {
            white-space: pre-line; /* Ensures text wraps and preserves whitespace */
            font-family: Arial, sans-serif;
            font-size: 12pt;
          }
          </style>
          <html>
          <head>
          <title>${filename}</title>
          </head>
          <body>
          <div>
          ${html}
          </div>
          </body>
      </html>`
}

function commentSymbolForLanguage(language){

  let symbol;
  // Convert language to lowercase to handle case variations
  language = language ? language.toLowerCase() : "";
  // Array of case objects for cleaner readability and alphabetical sorting
  const languageCases = [
    { language: "actionscript", symbol: "//" },
    { language: "ada", symbol: "--" },
    { language: "asm", symbol: ";" },
    { language: "awk", symbol: "#" },
    { language: "bash", symbol: "#" },
    { language: "c", symbol: "//" },
    { language: "c++", symbol: "//" },
    { language: "clojure", symbol: ";;" },
    { language: "cobol", symbol: "*" },
    { language: "cmd", symbol: "@REM" },
    { language: "cpp", symbol: "//" },
    { language: "cristal", symbol: "#" },
    { language: "csharp", symbol: "//" },
    { language: "css", symbol: "/*" },
    { language: "dart", symbol: "//" },
    { language: "dax", symbol: "//" },
    { language: "elixir", symbol: "#" },
    { language: "erlang", symbol: "%" },
    { language: "fsharp", symbol: "//" },
    { language: "fortran", symbol: "!" },
    { language: "forth", symbol: "\\" },
    { language: "go", symbol: "//" },
    { language: "groovy", symbol: "//" },
    { language: "haskell", symbol: "--" },
    { language: "haxe", symbol: "//" },
    { language: "html", symbol: "<!--" },
    { language: "java", symbol: "//" },
    { language: "javascript", symbol: "//" },
    { language: "json", symbol: "//" },
    { language: "kotlin", symbol: "//" },
    { language: "lisp", symbol: ";;" },
    { language: "lua", symbol: "--" },
    { language: "lulia", symbol: "#" },
    { language: "markdown", symbol: "<!--" },
    { language: "matlab", symbol: "%" },
    { language: "m", symbol: "//" },
    { language: "nim", symbol: "#" },
    { language: "objc", symbol: "//" },
    { language: "objective-c", symbol: "//" },
    { language: "pascal", symbol: "//" },
    { language: "perl", symbol: "#" },
    { language: "php", symbol: "//" },
    { language: "powershell", symbol: "#" },
    { language: "powerquery", symbol: "//" },
    { language: "prolog", symbol: "%" },
    { language: "python", symbol: "#" },
    { language: "r", symbol: "#" },
    { language: "racket", symbol: "#;" },
    { language: "ruby", symbol: "#" },
    { language: "rust", symbol: "//" },
    { language: "scala", symbol: "//" },
    { language: "scheme", symbol: ";;" },
    { language: "sh", symbol: "#" },
    { language: "shell", symbol: "#" },
    { language: "sql", symbol: "--" },
    { language: "swift", symbol: "//" },
    { language: "typescript", symbol: "//" },
    { language: "tcl", symbol: "#" },
    { language: "vhdl", symbol: "--" },
    { language: "vba", symbol: "'" },
    { language: "vbnet", symbol: "'" },
    { language: "xml", symbol: "<!--" },
    { language: "zig", symbol: "//" }
  ];

  // Find the matching language case or default to "//"
  const languageCase = languageCases.find(item => item.language === language);
  symbol = languageCase ? languageCase.symbol : "//";
    
    return symbol;
}

function extractFileExtention(fileName){

  const parts = fileName.split('.');
  if (parts.length < 2 || (parts.length === 2 && parts[0] === '')) {
      return '';
  };

  return parts[parts.length-1];
}

function extractFileNameFromURL(fileLink){

  const parts = fileLink.split('/');
  if (parts.length < 2 || (parts.length === 2 && parts[0] === '')) {
      return '';
  };

  return parts[parts.length-1]
}

module.exports = {
  formatObjectToText,
  countTokens,
  wireStingForMarkdown,
  debounceConstructor,
  debounceConstructorPromise,
  throttle,
  throttlePromise,
  optionsToButtons,
  saveTextToTempFile,
  saveBufferToTempFile,
  replaceNewDate,
  replaceISOStr,
  countTokensProportion,
  reorderArrayForTools,
  safeStringify,
  jsonToMarkdownCodeBlock,
  charLimitFor,
  splitTextByCharLimit,
  valueToMD5,
  countTokensLambda,
  wireHtml,
  convertMarkdownToLimitedHtml,
  convertLatexToPNG,
  generateCanvasPNG,
  getImageByUrl,
  encodeJson,
  decodeJson,
  startFileDownload,
  extractSystemRolesFromEnd,
  fileDownload,
  extractTextFromFile,
  executePythonCode,
  getLocalizedPhrase,
  startDeveloperPrompt,
  findBrokenTags,
  commentSymbolForLanguage,
  delay,
  generateTextBuffer,
  calculateFileSize,
  checkFileSizeToTgmLimit,
  htmlToPdfBuffer,
  formatHtml,
  generateButtonDescription,
  extractTextBetweenDoubleAsterisks,
  throttleNew,
  debounceNew,
  extractFileExtention,
  extractFileNameFromURL,
  filenameWoExtention,
  getPDFPageNumber,
  splitPDFByPageChunks
};
