const func = require("../common_functions.js");
const axios = require("axios");
const https = require('https');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { convert } = require('html-to-text');

class UrlResource{

    #url;
    #resourceId;
    #isValid;
    #responseRaw;
    #isAccessible;
    #responseContentType;
    #responseEncoding;
    #headers;
    #htmlFullBody;
    #htmlFullBodyLengthChar;
    #htmlFullBodyLengthTokens;
    #cheerioObject

    constructor(url) {
        this.#url = url;
        this.defaultEncoding = 'utf-8';
        this.#resourceId = func.valueToMD5(url);
        this.#isValid = !(url === "" || url === null || url === undefined) & typeof url === "string"
      };

      get isValid(){
        return this.#isValid
      }

      async getUrlBody(){
        
        if(this.#isValid){
            try{
              const agent = new https.Agent({
                rejectUnauthorized: false
              });

                this.#responseRaw = await axios.get(this.#url,{
                    responseType: 'arraybuffer',
                    responseEncoding: 'binary',
                    httpsAgent: agent})
                this.#isAccessible = true;
            } catch(err){
                this.#isAccessible = false
                throw err
            }
                this.#headers = this.#responseRaw.headers
                
                this.#responseContentType = this.#responseRaw.headers['content-type']
                const match = this.#responseContentType.match(/charset=([a-zA-Z0-9-]+)/);
                
                this.#responseEncoding = match && match[1] ? match[1] : this.defaultEncoding;
                const decodedBody = iconv.decode(this.#responseRaw.data, this.#responseEncoding);
                const cheerioObject = cheerio.load(decodedBody);
                this.#cheerioObject = cheerioObject;
                this.#htmlFullBody = this.#cheerioObject('body').html();
                
                const text = convert(this.#htmlFullBody, {
                  wordwrap: false,
                  format: {
                    // Custom handler for 'a' tags
                    anchor: function(elem, walk, builder, formatOptions) {
                      const href = elem.attribs.href || '';
                      builder.openTag(true);
                      walk(elem.children, builder);
                      builder.addInline(' (');
                      builder.addInline(href);
                      builder.addInline(')');
                      builder.closeTag();
                    }
                  }
                });


                this.#htmlFullBodyLengthChar = text.length
        
              //  this.#htmlFullBodyLengthTokens = func.countTokens(this.#htmlFullBody)
                return text
 
        } else{
            throw new Error("Url param contains invalid data. You should provide a valid url, being as a string.")
        }       
      }

      getTextAndUrls(){
        const $ = this.#cheerioObject;
        let content = [];

        function walkNodes(node) {
        $(node).contents().each((index, elem) => {
          if(elem.type === 'text') {
            // This is a text node. Add its text content to the content array.
            const text = $(elem).text().trim();
            if (text) {
              content.push({ type: 'text', content: text });
            }
          } else if(elem.name === 'a') {
            // This is an anchor tag. Get its href and text, then add to the content array.
            const href = $(elem).attr('href');
            const linkText = $(elem).text().trim();
            if (href) {
              content.push({ type: 'link', content: linkText, href: href });
            }
            // Process the children of the anchor tag (if any)
            walkNodes(elem);
          } else {
            // This is another type of node, walk its children
            walkNodes(elem);
          }
        });
      }

      walkNodes('body');

      //  console.log(content)


      }

    
      get htmlFullBodyLengthChar(){
        return this.#htmlFullBodyLengthChar
      }

      get htmlFullBodyLengthTokens(){
        return this.#htmlFullBodyLengthTokens
      }
    
    };
    
    module.exports = UrlResource;