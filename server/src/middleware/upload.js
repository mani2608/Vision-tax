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

const uploader = multer({
  storage,
  limits: { fileSize: config.maxFileBytes, files: config.maxFiles },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimes = ALLOWED[ext];
    if (!mimes) return cb(new UploadError(`"${file.originalname}": file type not allowed (txt, docx, pdf, rtf, xml, json, csv).`));
    if (!mimes.includes(file.mimetype)) return cb(new UploadError(`"${file.originalname}": content type does not match its extension.`));
    cb(null, true);
  },
});

class UploadError extends Error {}

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
  return null;
}

// Express middleware: parse multipart field `files`, validate, clean up on any failure.
function receiveFiles({ required = true } = {}) {
  const parse = uploader.array('files', config.maxFiles);
  return (req, res, next) => {
    parse(req, res, (err) => {
      if (err) {
        removeFiles(req.files);
        let msg = err.message;
        if (err.code === 'LIMIT_FILE_SIZE') msg = `File too large (max ${config.maxFileBytes / 1024 / 1024} MB each).`;
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') msg = `Too many files (max ${config.maxFiles}).`;
        return res.status(400).json({ error: msg });
      }
      const files = req.files || [];
      if (required && files.length === 0) return res.status(400).json({ error: 'Please choose at least one file.' });
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
