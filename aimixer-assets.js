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

const handleUrlToText = async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json('bad request');

  if (!urlUtil.isValidUrl(url)) return res.status(402).json('bad request');

  const urlType = urlUtil.urlType(url);

  let text = '';
  switch (urlType) {

    case 'html':
      const info = await textConversion.htmlToText(url);
      info.status = 'success';
      return res.status(200).json(info);
      break;

    default:
      console.error('Unknown URL Type: ', urlType);
      return res.status(500).json({status: 'error', msg: `unknown url type: ${urlType}`});
  }

  return res.status(200).send(text);
}

app.post('/query', (req, res) => handleQuery(req, res));
app.post('/urlToText', (req, res) => handleUrlToText(req, res));

const httpsServer = https.createServer({
    key: fs.readFileSync(privateKeyPath),
    cert: fs.readFileSync(fullchainPath),
  }, app);
  

  httpsServer.listen(listenPort, '0.0.0.0', () => {
    console.log(`HTTPS Server running on port ${listenPort}`);
});
