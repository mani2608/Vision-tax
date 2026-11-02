const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { config, assertRuntimeConfig } = require('./config');

assertRuntimeConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Next rewrite / reverse proxy
app.use(helmet());
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
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(config.port, () => console.log(`Vision-Tax API listening on :${config.port}`));
