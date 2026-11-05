const express = require('express');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');
const { getSettings, paymentInfo } = require('../settings');
const { asyncRoute, PHONE_REGIONS } = require('../lib');

const router = express.Router();

// Homepage payment section: the active QR (as a URL, never a filesystem path) and the UPI ID.
// Not cacheable (index.js already sends no-store) so admin changes show up on the next load.
router.get('/payment-info', asyncRoute(async (_req, res) => {
  try {
    res.json(await paymentInfo());
  } catch (e) {
    // Migration not applied yet: show the homepage empty state instead of an error.
    if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ qr: null, upi: null });
    throw e;
  }
}));

// Lets the static homepage and dashboard show/validate phone numbers for the active market (IN while testing, US later).
router.get('/config', (_req, res) => {
  const R = PHONE_REGIONS[config.phoneRegion];
  res.json({ phoneRegion: config.phoneRegion, phoneExample: R.example, phonePlaceholder: config.phoneRegion === 'IN' ? '+91 98765 43210' : '+1 (212) 555-1234', currency: 'INR' });
});

router.get('/payment-qr', asyncRoute(async (_req, res) => {
  const s = await getSettings(['qr_file', 'qr_mime']).catch((e) => (e.code === 'ER_NO_SUCH_TABLE' ? {} : Promise.reject(e)));
  const name = s.qr_file && s.qr_file.value;
  if (!name || !/^[a-f0-9]{32}\.(png|jpg|jpeg|webp)$/.test(name)) return res.status(404).json({ error: 'No QR code configured.' });
  const full = path.join(config.uploadDir, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'No QR code configured.' });
  res.setHeader('Content-Type', (s.qr_mime && s.qr_mime.value) || 'image/png');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(full);
}));

module.exports = router;
