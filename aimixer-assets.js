require('dotenv').config();

const listenPort = process.argv.length === 2 ? 5002 : 6002;
const hostname = 'assets.aimixer.io'
const privateKeyPath = `/etc/sslkeys/aimixer.io/aimixer.io.key`;
const fullchainPath = `/etc/sslkeys/aimixer.io/aimixer.io.pem`;

const express = require('express');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const mysql = require('mysql2');
const bcrypt = require("bcrypt");
const luxon = require('luxon');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const mimeTypes = require('mime-types');
const { exec } = require("child_process");

const serp = require('./utils/serpWow');
const s3 = require('./utils/s3');
const ai = require('./utils/ai');
const urlUtil = require('./utils/url')
const proxycurl = require('./utils/proxycurl');
const auth = require('./utils/auth')
const textConversion = require('./utils/textConversion');

const { MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, JWT_PASSWORD } = process.env;

const mysqlOptions = {
  host: MYSQL_HOST,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
  idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
}

const pool = mysql.createPool(mysqlOptions);

const query = q => {
  return new Promise((resolve, reject) => {
    pool.query(q, function(err, rows, fields) {
      console.error(err);
      if (err) return resolve(false);
      resolve(rows)
    });
  })
}

const app = express();
app.use(express.static('public'));
app.use(express.json({limit: '200mb'})); 
app.use(cors());

app.get('/', (req, res) => {
    res.send('Hello, World!');
    
});

const urlToMp3 = (url, extension) => {
  return new Promise(async (resolve, reject) => {
    try {
      const tmpFile = `/tmp/${uuidv4()}.${extension}`;
      await urlUtil.download(url, tmpFile);
      const mp3File = `/tmp/${uuidv4()}.mp3`;
      exec(`ffmpeg -i ${tmpFile} ${mp3File}`, (error, stdout, stderr) => {
        if (error) {
            console.log(error);
            return resolve(false)
        }
        if (stderr) {
            //console.log(`stderr: ${stderr}`);
        }
        fs.unlink(tmpFile, () => {});
        return resolve(mp3File);
    });
     } catch (err) {
      console.error(err);
      return false;
     }
  })
}

const handleQuery = async (req, res) => {
  console.log(req.body);
  const {type, query, timePeriod, token } = req.body;

  if (!token) return res.status(400).json('bad request');

  /*
   * auth here
   */

  let result;
  switch (type) {
      case 'google_search_news':
          result = await serp.google('news', query, timePeriod, 50);
          if (result === false) return res.status(500).json('internal server error');
          return res.status(200).json(result);
          break;
      case 'google_search_web':
          result = await serp.google('web', query, timePeriod, 50);
          if (result === false) return res.status(500).json('internal server error');
          return res.status(200).json(result);
          break;
      case 'google_search_video':
          result = await serp.google('videos', query, timePeriod, 50);
          if (result === false) return res.status(500).json('internal server error');
          return res.status(200).json(result);
          break;
      case "pymnts_search_news":
          result = await serp.google('news', query + ' site:pymnts.com', timePeriod, 50);
          if (result === false) return res.status(500).json('internal server error');
          return res.status(200).json(result);
          break;
      case "pymnts_search_web":
          result = await serp.google('web', query + ' site:pymnts.com', timePeriod, 50);
          if (result === false) return res.status(500).json('internal server error');
          return res.status(200).json(result);
          break;
      case "pymnts_search_video":
          result = await serp.google('videos', query + ' site:pymnts.com', timePeriod, 50);
          if (result === false) return res.status(500).json('internal server error');
          return res.status(200).json(result);
          break;
      default:
          res.status(400).json('bad command');
  }
}

const getAssetData = async url => {
  try {
    const urlInfo = new URL(url);
    const fileName = urlInfo.pathname.substring(1);
    const q = `SELECT title, date, type, size, meta FROM assets WHERE file_name = '${fileName}'`;
    let r = await query(q);
    if (r.length) return r[0];

    let loc = urlInfo.pathname.lastIndexOf('/');
    let title = loc !== -1 ? urlInfo.pathname.substring(loc+1) : urlInfo.pathname;
    let date = luxon.DateTime.now().toISODate();
    let size = -1;
    let meta = JSON.stringify({});
    loc = urlInfo.pathname.lastIndexOf('.');
    let extension = loc !== -1 ? urlInfo.pathname.substring(loc) : '.bin';
    let type = mimeTypes.lookup(extension);

    return {
      title, date, type, size, meta
    }
    
  } catch (err) {
    console.error(err);
    return false;
  }
}

const handleTextToUrl = async (req, res) => {
  const { text, token, bowlId } = req.body;
  let info = auth.validateToken(token);
  if (info === false) return res.status(401).json('unautorized')
  const { accountId, email, username, domain } = info;

  const response = await textConversion.textToS3Link(text, text.substring(0, 20) + '...', luxon.DateTime.now().toISODate(), accountId, bowlId);
  return res.status(200).json(response);
}

const handleUrlToText = async (req, res, markdown = false) => {
  const { url, token, bowlId, markdown } = req.body;
  let info = auth.validateToken(token);
  if (info === false) return res.status(401).json('unautorized')
  const { accountId, email, username, domain } = info;

  if (!url || !bowlId) return res.status(400).json('bad request');
  if (!urlUtil.isValidUrl(url)) return res.status(402).json('bad request');

  const options = req.body.options ? req.body.options : {};

  const urlType = urlUtil.urlType(url);

  let text, mp3File = '';
  const data = await getAssetData(url);

  switch (urlType) {

    case 'html':
      if (markdown) text = await textConversion.urlToMarkdown(url);
      else text = await textConversion.htmlToText(url, accountId, bowlId, options);
      break;

    case 'pdf':
      text = await textConversion.pdfToText(url, data.title, data.date, accountId, bowlId);
      break;

    case 'mkv':
    case 'mov':
    case 'wmv':
    case 'avi':
    case 'm4a':
    case 'flac':
    case 'wav':
      mp3File = await urlToMp3(url, urlType);
      if (!mp3File) return res.status(500).json({status: 'error', msg: `could not create mp3 file`});
    case 'mp3':
      if (!mp3File) {
        mp3File = `/tmp/${uuidv4()}.mp3`;
        mp3File = await urlUtil.download(url, mp3File);
      }
      text = await textConversion.mp3ToText(mp3File, data.title, data.date, accountId, bowlId, options);
      break;

    case 'mp4':
      console.log('data', data);
      text = await textConversion.mp4ToText(url, data.title, data.date, accountId, bowlId, options);
      break;

    default:
      console.error('Unknown URL Type: ', urlType);
      return res.status(500).json({status: 'error', msg: `unknown url type: [${urlType}]`});
  }

  return res.status(200).json(text);
}


const getInfoRelatedToTopic = async (text, topic) => {
  let prompt = `"""Below is some Text. Solely using the provided Text, write an article on the following topic: ${topic}. If there is no information on that topic reply "There are no facts."
  
  ${text}"""
`
  console.log(prompt);
  let info = await ai.chatGPT(prompt);
  if (info.length < 100 && 
      (info.toLowerCase().indexOf('no facts') !== -1 || 
      info.toLowerCase().indexOf('no specific information') !== -1 || 
      info.toLowerCase().indexOf('no information') !== -1
  )) info = '';
  console.log(info);
  return info;
}

const handleFilterTopics = async (req, res) => {
  const { token, topics, link, bowlId } = req.body;
  const info = auth.validateToken(token);
  if (info === false) return res.status(401).json('unauthorized')
  const { accountId, email, username, domain } = info;

  if (!bowlId || !link || !topics) return res.status(400).json('bad request');

  try {
    const response = await axios({
      url: link,
      method: 'get'
    })
    const topicList = topics.split("\n");
    const promises = [];
    for (let i = 0; i < topicList.length; ++i) promises.push(getInfoRelatedToTopic(response.data, topicList[i]))
    const info = await Promise.all(promises);
    const text = info.join("\n");
    const s3Link = await s3.uploadTxt(text, `${accountId}/${bowlId}`, `${uuidv4()}.txt`);
    let length = text.trim().split(' ').length;
    if (length <= 2) length = 0;
    return res.status(200).json({
      infoLink: s3Link,
      infoLength: length
    })
  } catch (err) {
    console.error(err);
    return res.status(500).json('internal server error');
  }
}

const handleUploadFile = async (req, res) => {
  let { token, bowlId, title, name, type, size, date } = req.body;
  const info = auth.validateToken(token);
  if (info === false) return res.status(401).json('unauthorized')
  const { accountId, email, username, domain } = info;

  if (!bowlId || typeof title === 'undefined' || !name || !type || !size || !date) return res.status(400).json('bad request');

  try {
    let loc = name.lastIndexOf('.');
    let extension = loc !== -1 ? name.substr(loc+1) : mimeTypes.extension(type);
    
    bowlId = mysql.escape(bowlId);
    title = mysql.escape(title);
    
    date = mysql.escape(date);

    const fileName =`account--${accountId}/assets/${uuidv4()}.${extension}`;

    let q = `INSERT INTO assets (file_name, bowl_id, title, type, size, date, meta) 
    VALUES ('${fileName}', ${bowlId}, ${title}, ${mysql.escape(type)}, ${size}, ${date}, '${JSON.stringify({})}')`;

    let r = await query(q);

    if (r === false) {
      console.error('DB Error: ', q);
      return res.status(500).json('Database Error');
    }

    const url = await s3.presignedUploadUrl(fileName, type);

    if (r === false) {
      console.error('S3 Error: ', q);
      return res.status(500).json('S3 Error');
    }

    return res.status(200).send(url);

  } catch(err) {
    console.error(err);
    return res.status(500).json(err);
  }
}

const handleUpdateLink = async (req, res) => {
  let { token, link, content } = req.body;
  const info = auth.validateToken(token);
  if (info === false) return res.status(401).json('unauthorized')
  const { accountId, email, username, domain } = info;

  try {
    const urlInfo = new URL(link);
    const loc = urlInfo.pathname.lastIndexOf('/');
    if (loc === -1) return res.status(500).json('internal server error 002');
    const folder = urlInfo.pathname.substring(1, loc);
    const fileName = urlInfo.pathname.substring(loc+1);
    console.log(folder, fileName);
    const result = await s3.uploadTxt(content, folder, fileName);
    console.log(link);
    console.log(result);
    if (result !== link) return res.status(500).json('insert server error 003');
    return res.status(200).json('ok');
  } catch (err) {
    console.error(err);
    return res.status(500).json('internal server error');
  }

}

app.post('/query', (req, res) => handleQuery(req, res));
app.post('/urlToText', (req, res) => handleUrlToText(req, res));
app.post('/textToUrl', (req, res) => handleTextToUrl(req, res));
app.post('/filterTopics', (req, res) => handleFilterTopics(req, res));
app.post('/uploadFile', (req, res) => handleUploadFile(req, res));
app.post('/updateLink', (req, res) => handleUpdateLink(req, res));

const httpsServer = https.createServer({
    key: fs.readFileSync(privateKeyPath),
    cert: fs.readFileSync(fullchainPath),
  }, app);
  

  httpsServer.listen(listenPort, '0.0.0.0', () => {
    console.log(`HTTPS Server running on port ${listenPort}`);
});
