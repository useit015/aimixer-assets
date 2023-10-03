require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const articleExtractor = require('@extractus/article-extractor');
const HTMLParser = require('node-html-parser');
const h2p = require('html2plaintext')
const mime = require('mime-types');
const fs = require('fs');

const { convert } = require('html-to-text');

const { SCRAPERAPI_KEY } = process.env;

//const url = 'https://www.pymnts.com/news/retail/2023/will-consumers-pay-50-for-drugstore-brand-sunscreen/';

exports.isValidUrl = url => {
  try {
    let info = new URL(url);
    return true;
  } catch (err) {
    return false;
  }
}

exports.urlType = url => {
    //console.log('urlType', url);

    const base = url.substring(url.lastIndexOf('/')+1);

    const loc = base.lastIndexOf('.');

    if (loc === -1) return 'html';

    const extension = base.substring(loc+1).toLowerCase();

    return extension;
}

exports.getHTML = async url => {
  const request = {
    url,
    method:'get'
  }

  try {
    const response = await axios(request);
    return response.data;
  } catch(err) {
    console.error(err);
    return false;
  }
}

exports.scrapeHTML = async (url, debugMe = false) => {
  console.log('url getHTML', url);
  let request = {
      url: 'http://api.scraperapi.com?country_code=us&device_type=desktop',
      params: {
        api_key: SCRAPERAPI_KEY,
        url
      },
      method: 'get',
      headers: {
        "Content-Type": "application/json"
      }
    }

    if (debugMe) console.log(request);
  
    let response;
  
    try {
      response = await axios(request);
    } catch (err) {
      console.log('Error getHTML', url);
      console.error(err);
      return false;
    }

    if (debugMe) console.log('RESPONSE DATA', response.data);
  
    return response.data;
}


exports.extractArticleFromHTML = async (html, url = '') => {
    
    if (typeof html !== 'string') {
      console.log('extractArticleFromHTML html error', html);
      return '';
    }
    

    let article;
    
    if (url) article =  await articleExtractor.extractFromHtml(html, url);
    else article = await articleExtractor.extractFromHtml(html);

    console.log('utils/url.js extractArticleFromHTML article length', article ? article.length : 0);

    if (article && article.title && article.content) return `<h1>${article.title}</h1>\n${article.content}`;

    return html;
}

exports.getTextFromHTML = html => {
  console.log('utils/urls.js getTextFromHTML html length', html ? html.length : 0 );
  const options = {
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'a.button', format: 'skip' }
      ]
    }
    
    let text = convert(html, options);
    console.log('utils/urls.js getTextFromHTML text length', text ? text.length : 0 );
    if (text) {
      let lines = text.split("\n");
      for (let i = 0; i < lines.length; ++i) {
        if (lines[i]) lines[i] = lines[i].trim();
        else lines[i] = "\n";
      }
      text = lines.join(' ');
  
      return text;
    }


    // console.log(html);
    // let test = h2p(html);
    // console.log('test', test);

    // let test = HTMLParser.parse(html);
    // console.log('test', test.text);

    return '';

    
}

exports.articleExtractor = async (url, html = false) => {
  const body = await exports.getHTML(url);

  if (body === false) return false;

  let article = await articleExtractor.extractFromHtml(body, url);
  if (!article) return false;
   
  text = getTextFromHTML(article.content);

  return {title: article.title, text, html: article.content, url};
}

exports.articleTextExtractor = async (body) => {
  articleExtractor.setSanitizeHtmlOptions({parseStyleAttributes: false});
  let article = await articleExtractor.extractFromHtml(body);
  console.log('returned article', article);
  if (!article) {
    article = {
      title: 'seed',
      content: body
    }
  }
  
  text = exports.getTextFromHTML(article.content);

  return {title: article.title, text, html: article.content, url: 'seed'};
}

exports.isUrl = url => {
  try {
    const test = new URL(url);
  } catch (err) {
    return false;
  }

  return true;
}



exports.download = async (url, filePath) => {  
  return new Promise(async (resolve, reject) => {
      const writer = fs.createWriteStream(filePath)
  
      let response;

      try {
          response = await axios({
          url,
          method: 'GET',
          responseType: 'stream'
          })
      } catch (e) {
          console.error(e);
          reject(e);
          return false;
      }
      response.data.pipe(writer)

      writer.on('finish', resolve)
      writer.on('error', reject)
  })
}

exports.getContentType = async (url) => {
  const request = {
    url,
    method: 'get'
  }

  try {
    const response = await axios(request);
    console.log(response.headers['content-type']);
    return response.headers['content-type'];
  } catch(err) {
    console.error(err);
  }
}

exports.getExtensionFromContentType = contentType => {
  console.log('getExtensionFromContentType', contentType);
  return mime.extension(contentType);
}

