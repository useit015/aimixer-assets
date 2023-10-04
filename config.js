require('dotenv').config();

const { NODE_ENV } = process.env;

const isDev = NODE_ENV === 'dev';

module.exports = {
  isDev,
  hostname: 'assets.aimixer.io',
  listenPort: !isDev ? 5002 : 5302,
  privateKeyPath: isDev
    ? './ssl/localhost-key.pem'
    : '/etc/sslkeys/aimixer.io/aimixer.io.key',
  fullchainPath: isDev
    ? './ssl/localhost.pem'
    : '/etc/sslkeys/aimixer.io/aimixer.io.pem'
};
