const luxon = require('luxon');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const urlUtil = require('./url')
const articleExtractor = require('@extractus/article-extractor');
const s3 = require('./s3');
const pdf = require('./pdf');
const deepgram = require('./deepgram');

const textToS3Link = async (text, title, date, accountId, bowlId) => {
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
        id: uuidv4()
    }
}

exports.htmlToText = async (url, accountId, bowlId) => {
    const html = await urlUtil.scrapeHTML(url);
    if (!html) return {status: 'error', msg: 'Could not get HTML'};

    // see also https://apify.com/lukaskrivka/article-extractor-smart
    const article = await articleExtractor.extractFromHtml(html, url);

    if (article && article.published) {
        const date = luxon.DateTime.fromISO(article.published).toISODate();
        article.date = date;
    } else article.date = '';

    if (article && article.content) {
        article.text = urlUtil.getTextFromHTML(article.content).replace(/\[http.*\]/g, '');
        return await textToS3Link(article.text, article.title ? article.title : '', article.date, accountId, bowlId);
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
        return await textToS3Link(text, title, date, accountId, bowlId);
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
        return await textToS3Link(text, title, date, accountId, bowlId);
    } catch (err) {
        console.error(err);
        return {status: 'error', msg: 'Could not get text from PDF'};
    }
}

exports.mp3ToText = async (mp3File, title, date, accountId, bowlId, options) => {
    const text = await deepgram.transcribeRecording(mp3File, options && options.speakerTranscript ? options.speakerTranscript : false);
    fs.unlink(mp3File, () => {});
    console.log('text', text);
    return await textToS3Link(text, title, date, accountId, bowlId);
}
