const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { config } = require('../config');

const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
  '.txt': ['text/plain'],
  '.rtf': ['application/rtf', 'text/rtf', 'text/plain'],
  '.xml': ['text/xml', 'application/xml', 'text/plain'],
  '.json': ['application/json', 'text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv'],
};
const TEXT_EXT = new Set(['.txt', '.rtf', '.xml', '.json', '.csv']);

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

class UploadError extends Error {}

// Payment QR codes: raster images only (no SVG, which can carry scripts).
const IMAGE_ALLOWED = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
};

function makeUploader(maxBytes, maxCount, allowed = ALLOWED) {
  const label = Object.keys(allowed).map((e) => e.slice(1)).join(', ');
  return multer({
    storage,
    limits: { fileSize: maxBytes, files: maxCount },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const mimes = allowed[ext];
      if (!mimes) return cb(new UploadError(`"${file.originalname}": file type not allowed (${label}).`));
      if (!mimes.includes(file.mimetype)) return cb(new UploadError(`"${file.originalname}": content type does not match its extension.`));
      cb(null, true);
    },
  });
}

function removeFiles(files) {
  for (const f of files || []) fs.unlink(f.path, () => {});
}

// Cheap content sniffing so a renamed executable cannot pass as a PDF/DOCX/text file.
function sniff(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const fd = fs.openSync(file.path, 'r');
  const buf = Buffer.alloc(512);
  const n = fs.readSync(fd, buf, 0, 512, 0);
  fs.closeSync(fd);
  const head = buf.subarray(0, n);
  if (n === 0) return 'is empty';
  if (ext === '.pdf' && !head.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'is not a valid PDF';
  if (ext === '.docx' && !(head[0] === 0x50 && head[1] === 0x4b)) return 'is not a valid DOCX';
  if (TEXT_EXT.has(ext) && head.includes(0)) return 'is not a text file';
  if (IMAGE_ALLOWED[ext]) return imageProblem(file.path, ext);
  return null;
}

// Verifies the real structure of an uploaded image (not just its name, declared type or first bytes), so a renamed
// or truncated/corrupted file is rejected and never stored. Images are small (QR limit 2 MB), so we read the file.
function imageProblem(filePath, ext) {
  const buf = fs.readFileSync(filePath);
  const bad = (kind) => `is not a valid ${kind} image`;
  if (ext === '.png') {
    if (buf.length < 45 || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return bad('PNG');
    if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return bad('PNG');
    const w = buf.readUInt32BE(16); const h = buf.readUInt32BE(20);
    if (!(w >= 1 && h >= 1 && w <= 10000 && h <= 10000)) return 'has unsupported image dimensions';
    if (buf.subarray(buf.length - 8, buf.length - 4).toString('latin1') !== 'IEND') return 'is an incomplete PNG image';
    return null;
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    if (buf.length < 4 || !(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return bad('JPEG');
    let end = buf.length;
    while (end > 2 && buf[end - 1] === 0) end--; // some encoders pad with zeros
    if (!(buf[end - 2] === 0xff && buf[end - 1] === 0xd9)) return 'is an incomplete JPEG image';
    return null;
  }
  if (ext === '.webp') {
    if (buf.length < 20 || buf.subarray(0, 4).toString('latin1') !== 'RIFF' || buf.subarray(8, 12).toString('latin1') !== 'WEBP') return bad('WebP');
    if (!['VP8 ', 'VP8L', 'VP8X'].includes(buf.subarray(12, 16).toString('latin1'))) return bad('WebP');
    if (buf.readUInt32LE(4) + 8 > buf.length) return 'is an incomplete WebP image';
    return null;
  }
  return null;
}

// Express middleware: parse multipart field `files`, validate, clean up on any failure.
// opts.maxBytes / opts.maxCount override the defaults (client documents use a hard 5 MB cap).
// opts.images switches the allow-list from documents to QR-code images.
function receiveFiles({ required = true, maxBytes = config.maxFileBytes, maxCount = config.maxFiles, images = false, emptyMessage = 'Please choose at least one file.' } = {}) {
  const parse = makeUploader(maxBytes, maxCount, images ? IMAGE_ALLOWED : ALLOWED).array('files', maxCount);
  return (req, res, next) => {
    parse(req, res, (err) => {
      if (err) {
        removeFiles(req.files);
        let msg = err.message;
        if (err.code === 'LIMIT_FILE_SIZE') msg = `File too large (max ${maxBytes / 1024 / 1024} MB each).`;
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') msg = `Too many files (max ${maxCount}).`;
        return res.status(400).json({ error: msg });
      }
      const files = req.files || [];
      if (required && files.length === 0) return res.status(400).json({ error: emptyMessage });
      for (const f of files) {
        const problem = sniff(f);
        if (problem) {
          removeFiles(files);
          return res.status(400).json({ error: `"${f.originalname}" ${problem}.` });
        }
      }
      next();
    });
  };
}

module.exports = { receiveFiles, removeFiles };
