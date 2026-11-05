require('dotenv').config();
const path = require('path');

const env = process.env;
const config = {
  port: Number(env.PORT) || 4000,
  clientOrigin: env.CLIENT_ORIGIN || 'http://localhost:3000',
  isProd: env.NODE_ENV === 'production',
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'vision_tax',
  },
  jwtSecret: env.JWT_SECRET || '',
  // Which country's phone rules apply to filings and the Pay Now form: 'IN' (testing phase) or 'US' (default / launch).
  phoneRegion: String(env.PHONE_REGION || 'US').toUpperCase() === 'IN' ? 'IN' : 'US',
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  uploadDir: path.resolve(__dirname, '..', env.UPLOAD_DIR || './storage'),
  maxFileBytes: (Number(env.MAX_FILE_MB) || 10) * 1024 * 1024,
  // Hard 5 MB ceiling for documents uploaded by clients (initial and replacement), regardless of .env.
  userMaxFileBytes: Math.min(Number(env.MAX_FILE_MB) || 5, 5) * 1024 * 1024,
  maxFiles: Number(env.MAX_FILES_PER_UPLOAD) || 10,
};

function assertRuntimeConfig() {
  if (config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters (see .env.example).');
  }
}

module.exports = { config, assertRuntimeConfig };
