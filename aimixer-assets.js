require('dotenv').config();

const listenPort = 5002;
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

const getAssetInfo = async url => {
  try {
    const urlInfo = new URL(url);
    const fileName = urlInfo.pathname.substring(1);
    const q = `SELECT title, date, type, size, meta FROM assets WHERE file_name = '${fileName}'`;
    const r = await query(q);
    return r;
    
  } catch (err) {
    console.error(err);
    return false;
  }
}

const handleUrlToText = async (req, res) => {
  const { url, token, bowlId } = req.body;
  let info = auth.validateToken(token);
  if (info === false) return res.status(401).json('unautorized')
  const { accountId, email, username, domain } = info;

  if (!url || !bowlId) return res.status(400).json('bad request');
  if (!urlUtil.isValidUrl(url)) return res.status(402).json('bad request');

  const urlType = urlUtil.urlType(url);

  let text;
  
  switch (urlType) {

    case 'html':
      text = await textConversion.htmlToText(url, accountId, bowlId);
      break;

    case 'pdf':
      info = await getAssetInfo(url);
      if (!info.length) return res.status(500).json({status: 'error', msg: `could not get asset info for: ${url}`});
      const { title, date, meta, type, size } = info[0];
      text = await textConversion.pdfToText(url, title, date, accountId, bowlId);
      break;

    default:
      console.error('Unknown URL Type: ', urlType);
      return res.status(500).json({status: 'error', msg: `unknown url type: [${urlType}]`});
  }

  return res.status(200).json(text);
}


const getInfoRelatedToTopic = async (text, topic) => {
  const prompt = `"""Below is some Text. Solely using the provided Text, write an article on the following topic: ${topic}. If there is no information on that topic reply "There are no facts."
    
  Text:
  ${text}"""
`
  console.log(prompt);
  let info = await ai.chatGPT(prompt);
  if (info.length < 100 && info.toLowerCase().indexOf('no facts') !== -1) info = '';
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

app.post('/query', (req, res) => handleQuery(req, res));
app.post('/urlToText', (req, res) => handleUrlToText(req, res));
app.post('/filterTopics', (req, res) => handleFilterTopics(req, res));
app.post('/uploadFile', (req, res) => handleUploadFile(req, res));

const httpsServer = https.createServer({
    key: fs.readFileSync(privateKeyPath),
    cert: fs.readFileSync(fullchainPath),
  }, app);
  

  httpsServer.listen(listenPort, '0.0.0.0', () => {
    console.log(`HTTPS Server running on port ${listenPort}`);
});
