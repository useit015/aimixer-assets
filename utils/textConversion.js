const luxon = require('luxon');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const urlUtil = require('./url')
const articleExtractor = require('@extractus/article-extractor');
const { convert } = require('html-to-text'); 
const s3 = require('./s3');
const pdf = require('./pdf');
const deepgram = require('./deepgram');
const axios = require('axios');
const TurndownService = require('turndown')
const nlp = require('./nlp');
const ai = require('./ai');

exports.fetchHTML = async (url) => {
    try {
        const urlInfo = new URL(url);
        const test = urlInfo.hostname.indexOf('nyc3.digitaloceanspaces.com');
        if (test === -1) html = await urlUtil.scrapeHTML(url);
        else {
            const response = await axios.get(url);
            html = response.data;
            let regex = /[“”]/g
            html = html.replaceAll(regex, '"')
            regex = /’/g
            html = html.replaceAll(regex, "'");
    
        }
        return html;
    } catch(err) {
        console.error(err);
        return false;
    }
}

exports.htmlToArticle = async (html, url = '') => {
    let article;

    // see also https://apify.com/lukaskrivka/article-extractor-smart
    if (url) {
        article = await articleExtractor.extractFromHtml(html, url);
    } else {
        article = await articleExtractor.extractFromHtml(html);
    }

    if (!article) {
        const text = convert(html, {
            selectors: [
              { selector: 'a', options: { ignoreHref: true } },
              { selector: 'a.button', format: 'skip' }
            ]
          });
          article = {
            content: text,
            html,
            date: luxon.DateTime.now().toISODate(),
            published: luxon.DateTime.now().toISODate(),
            title: ''
          }
    }

    if (article && article.published) {
        try {
            const date = luxon.DateTime.fromISO(article.published).toISODate();
            article.date = date;
        } catch(err) {
            article.date = luxon.DateTime.now().toISODate();
        }
        
    } else article.date = '';

    if (article && article.content) {
        article.text = urlUtil.getTextFromHTML(article.content).replace(/\[http.*\]/g, '');
    }

    try {
        const date = luxon.DateTime.fromISO(article.published).toISODate();
        article.date = date;
    } catch(err) {
        article.date = luxon.DateTime.now().toISODate();
    }

    if (!article.title) article.title = '';

    return article;
}

exports.textToS3Link = async (text, title, date, accountId, bowlId, extension = 'txt', origURL = '') => {
    console.log('s3Text', text);
    let type = 'txt';
    if (extension === 'md') type = 'markdown';
    const s3Link = await s3.uploadTxt(text, `${accountId}/${bowlId}`, `${uuidv4()}.${extension}`, type)
    return {
        title,
        date,
        status: 'success',
        link: s3Link,
        type: 'html',
        subtype: extension,
        length: text.split(' ').length,
        origURL,
        id: uuidv4()
    }
}

exports.urlToMarkdown = async (url, accountId, bowlId) => {
    let html, markdown, article;
    html = await this.fetchHTML(url);
    //return {status: 'error', msg: 'Could not get HTML'};
   
    if (!html) return {status: 'error', msg: 'Could not get HTML'};

    article = await this.htmlToArticle(html);
    if (!article) return {status: 'error', msg: 'Could not get HTML in urlToMarkdown'};

    const turndownService = new TurndownService()
    markdown = turndownService.turndown(article.content);
    try {
        const date = luxon.DateTime.fromISO(article.published).toISODate();
        article.date = date;
    } catch(err) {
        article.date = luxon.DateTime.now().toISODate();
    }
    let title = article.title ? article.title : '';
    if (title) markdown = `#${title}\n` + markdown;
    return await exports.textToS3Link(markdown, title, article.date, accountId, bowlId, 'md', url);
}

exports.htmlUrlToMarkdown = async (url, accountId, bowlId, context = '') => {
    let html, markdown, article;
    html = await this.fetchHTML(url);
    if (!html) return false;

    article = await this.htmlToArticle(html);
    if (!article) return false;

    const turndownService = new TurndownService()
    markdown = turndownService.turndown(article.content);
    if (article.title) markdown = `#${article.title}\n` + markdown;
    const meta = {
        date: article.date,
        title: article.title
    }
    if (context) meta.context = context;

    return await s3.addFile(markdown, meta, accountId, bowlId, `${uuidv4()}.md`, 'text/markdown');
}

exports.htmlUrlToText = async (url, accountId, bowlId, options) => {
    if (options.markdown) return this.urlToMarkdown(url, accountId, bowlId, options);

    let html, article;
    html = await exports.fetchHTML(url);
    //return {status: 'error', msg: 'Could not get HTML'};
   
    if (!html) return {status: 'error', msg: 'Could not get HTML'};

    // see also https://apify.com/lukaskrivka/article-extractor-smart
    article = await articleExtractor.extractFromHtml(html, url);
    if (!article) {
        const text = convert(html, {
            selectors: [
              { selector: 'a', options: { ignoreHref: true } },
              { selector: 'a.button', format: 'skip' }
            ]
          });
          article = {
            content: text,
            html,
            date: luxon.DateTime.now().toISODate(),
            published: luxon.DateTime.now().toISODate(),
            title: 'Seed'
          }
    }
    console.log('article', article);

    if (article && article.published) {
        try {
            const date = luxon.DateTime.fromISO(article.published).toISODate();
            article.date = date;
        } catch(err) {
            article.date = luxon.DateTime.now().toISODate();
        }
        
    } else article.date = '';

    if (article && article.content) {
        article.text = urlUtil.getTextFromHTML(article.content).replace(/\[http.*\]/g, '');
        return await exports.textToS3Link(article.text, article.title ? article.title : '', article.date, accountId, bowlId, 'txt', url);
    }

    return {status: 'error', msg: 'Could not get HTML'};
}



exports.pdfToText = async (url, title, date, accountId, bowlId) => {
    try {
        const fileName = `/tmp/${uuidv4()}.pdf`;
        let result = await urlUtil.download(url, fileName);
        const text = await pdf.toText(fileName);
        console.log('pdfOutput', text);
        fs.unlink(fileName, () => {});
        return await exports.textToS3Link(text, title, date, accountId, bowlId);
    } catch (err) {
        console.error(err);
        return {status: 'error', msg: 'Could not get text from PDF'};
    }
}

exports.mp4ToText = async (url, title, date, accountId, bowlId, options) => {
    try {
        const fileName = `/tmp/${uuidv4()}.mp4`;
        let result = await urlUtil.download(url, fileName);
        const mp3File = await deepgram.convertMp4ToMp3(fileName);
        const text = await deepgram.transcribeRecording(mp3File, options && options.speakerTranscript ? options.speakerTranscript : false);  
        fs.unlink(fileName, () => {});
        fs.unlink(mp3File, () => {});
        console.log('text', text);
        return await exports.textToS3Link(text, title, date, accountId, bowlId);
    } catch (err) {
        console.error(err);
        return {status: 'error', msg: 'Could not get text from PDF'};
    }
}

exports.mp3ToText = async (mp3File, title, date, accountId, bowlId, options) => {
    const text = await deepgram.transcribeRecording(mp3File, options && options.speakerTranscript ? options.speakerTranscript : false);
    fs.unlink(mp3File, () => {});
    console.log('text', text);
    return await exports.textToS3Link(text, title, date, accountId, bowlId);
}

const getFactsQuotesLinks = async (text) => {
    const numSentences = nlp.numSentences(text);
    const numQuotes = nlp.numQuotes(text);
    let numLinks = nlp.numLinks(text);
    console.log('numSentences, numQuotes, numLinks', numSentences, numQuotes, numLinks);

    let prompt = `Below is some Text. I need you return ${numSentences} facts from the text.
Also return ${numQuotes} third-party quotes.
Also return ${numLinks} links along with the context in which each link is found.
The return format must be stringified JSON in the following format: {
      facts: array of ${numSentences} facts goes here,
      quotes: array of ${numQuotes} quotes in the following format {
        speaker: the identity of the speaker goes here,
        affiliation: the organization that the speaker is affiliated with goes here,
        quote: the speaker's quote goes here
      },
    links: [
        link: link in markdown format goes here,
        context: the context of the link goes here
    ]
    }
  
  Text:
  ${text}"""
  `
    console.log(prompt);
    let info = await ai.chatJSON(prompt);
    console.log('INFO', JSON.stringify(info, null, 4));
    return info;
  }

const getMarkdownArticle = async (html, url) => {
    let article = await articleExtractor.extractFromHtml(html, url);
    if (article) {
        const turndownService = new TurndownService()
        markdown = turndownService.turndown(article.content);
        try {
            const date = luxon.DateTime.fromISO(article.published).toISODate();
            article.date = date;
        } catch(err) {
            article.date = luxon.DateTime.now().toISODate();
        }
        let title = article.title ? article.title : '';
        if (title) markdown = `#${title}\n` + markdown;
        article.markdown = markdown;
    } else {
        const turndownService = new TurndownService()
        markdown = turndownService.turndown(html);
        article = {
            markdown,
            date: luxon.DateTime.now().toISODate(),
            title: ""
        }
    }

    return article;
}

exports.htmlUrlToFacts = async (url, accountId, bowlId, options) => {
    let html, markdown, article;
    html = await this.fetchHTML(url);
    
    //return {status: 'error', msg: 'Could not get HTML'};
   
    if (!html) return {status: 'error', msg: 'Could not get HTML'};

    article = await getMarkdownArticle(html, url);

    article.facts = await getFactsQuotesLinks(article.markdown);

    const link = await s3.uploadTxt(JSON.stringify(article.facts), `${accountId}/${bowlId}`, `${uuidv4()}.json`, 'json');

    return {status: 'success', facts: link};
    // see also https://apify.com/lukaskrivka/article-extractor-smart
  

    console.log(article);
    return {status: 'error', msg: 'Could not get HTML in urlToMarkdown'};
}
