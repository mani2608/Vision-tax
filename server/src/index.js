const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { config, assertRuntimeConfig } = require('./config');

assertRuntimeConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Next rewrite / reverse proxy
app.use(helmet());
const payments = require('./routes/payments');
// Razorpay webhook needs the raw request body for signature verification, so it is mounted before express.json().
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '200kb' }), payments.webhook);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Cookie auth + same-site: reject state-changing requests from other origins (CSRF defence in depth).
// The Next.js proxy forwards the browser's Origin header unchanged.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== config.clientOrigin) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/files', require('./routes/files'));
app.use('/api/public', require('./routes/public'));
app.use('/api/payments', payments.router);
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body.' });
  // A newer feature's table is missing because its migration has not been applied yet (manual step: npm run migrate).
  // Only that feature reports "not set up"; login, dashboards and filings never touch these tables.
  const missingTable = err.code === 'ER_NO_SUCH_TABLE' && /site_settings|payments|payment_webhook_events|payment_references|notifications/.test(err.sqlMessage || '');
  const missingColumn = err.code === 'ER_BAD_FIELD_ERROR' && /user_id|filing_id|reference_code|paid_payment_id|utr|source/.test(err.sqlMessage || '');
  if (missingTable || missingColumn) {
    console.error('Migration pending:', err.sqlMessage);
    return res.status(503).json({ error: 'This feature is not set up yet. The database migration has not been applied.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(config.port, () => console.log(`Vision-Tax API listening on :${config.port}`));
