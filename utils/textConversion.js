const luxon = require('luxon');
const { v4: uuidv4 } = require('uuid');

const urlUtil = require('./url')
const articleExtractor = require('@extractus/article-extractor');
const s3 = require('./s3');



exports.htmlToText = async (url, accountId, bowlId) => {
    const html = await urlUtil.scrapeHTML(url);
    if (!html) return {status: 'error', msg: 'Could not get HTML'};

    // see also https://apify.com/lukaskrivka/article-extractor-smart
    const article = await articleExtractor.extractFromHtml(html, url);

    if (article && article.published) {
        const date = luxon.DateTime.fromISO(article.published).toISODate();
        article.date = date;
    } else article.date = 'unknown';

    if (article && article.content) {
        article.text = urlUtil.getTextFromHTML(article.content).replace(/\[http.*\]/g, '');
        article.s3Link = await s3.uploadTxt(article.text, `${accountId}/${bowlId}`, `${uuidv4()}.txt`)
        
    }


    return article;
}