const urlUtil = require('./url')
const articleExtractor = require('@extractus/article-extractor');
const luxon = require('luxon');

exports.htmlToText = async url => {
    const html = await urlUtil.scrapeHTML(url);
    if (!html) return {status: 'error', msg: 'Could not get HTML'};

    // see also https://apify.com/lukaskrivka/article-extractor-smart
    const article = await articleExtractor.extractFromHtml(html, url);

    if (article && article.published) {
        const date = luxon.DateTime.fromISO(article.published).toISODate();
        article.date = date;
    }
    if (article && article.content) {
        article.text = urlUtil.getTextFromHTML(article.content);
        article.html = article.content;
        delete article.content;
    }


    return article;
}