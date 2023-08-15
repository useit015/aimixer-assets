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

exports.textToS3Link = async (text, title, date, accountId, bowlId, origURL = '') => {
    console.log('s3Text', text);
    const s3Link = await s3.uploadTxt(text, `${accountId}/${bowlId}`, `${uuidv4()}.txt`)
    return {
        title,
        date,
        status: 'success',
        link: s3Link,
        type: 'html',
        subtype: 'url',
        length: text.split(' ').length,
        origURL,
        id: uuidv4()
    }
}

exports.htmlToText = async (url, accountId, bowlId) => {
    let html, article;
    try {
        const urlInfo = new URL(url);
        const test = urlInfo.hostname.indexOf('nyc3.digitaloceanspaces.com');
        if (test === -1) html = await urlUtil.scrapeHTML(url);
        else {
            const response = await axios.get(url);
            html = response.data;
        }
        console.log('html', html);
    } catch(err) {
        console.error(err);
        return {status: 'error', msg: 'Could not get HTML'};
    }
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
        return await exports.textToS3Link(article.text, article.title ? article.title : '', article.date, accountId, bowlId, url);
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
