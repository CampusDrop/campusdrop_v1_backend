const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const SERVER_ROOT = path.resolve(__dirname, '..');
const UPLOAD_SUBDIR = path.join(SERVER_ROOT, 'uploads', 'school-proof');

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function extForMime(mime) {
  return MIME_TO_EXT[mime] || '';
}

function schoolProofMaxBytes() {
  const n = Number(process.env.SCHOOL_PROOF_MAX_BYTES || 5 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
}

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_SUBDIR, { recursive: true });
}

/**
 * 디스크에 저장된 `storedPath`(repo 루트의 `campusdrop_server` 기준 상대 경로)의 절대 경로.
 * `uploads/school-proof/` 밖으로 나가면 예외.
 * @param {string} storedPath
 */
function absoluteSchoolProofPath(storedPath) {
  const normalized = String(storedPath || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('..')) {
    const e = new Error('INVALID_STORED_PATH');
    e.code = 'INVALID_STORED_PATH';
    throw e;
  }
  const abs = path.resolve(SERVER_ROOT, ...normalized.split('/').filter(Boolean));
  const prefix = path.resolve(SERVER_ROOT, 'uploads', 'school-proof');
  const sep = path.sep;
  if (abs !== prefix && !abs.startsWith(prefix + sep)) {
    const e = new Error('INVALID_STORED_PATH');
    e.code = 'INVALID_STORED_PATH';
    throw e;
  }
  return abs;
}

function createSchoolProofUploader() {
  ensureUploadDir();
  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, UPLOAD_SUBDIR);
    },
    filename(req, file, cb) {
      const ext = extForMime(file.mimetype);
      if (!ext) {
        cb(Object.assign(new Error('UNSUPPORTED_MIME'), { code: 'UNSUPPORTED_MIME' }));
        return;
      }
      const id = crypto.randomUUID();
      const relativePath = path.posix.join('uploads', 'school-proof', `${id}${ext}`);
      req.schoolProofDraft = {
        id,
        relativePath,
        mimeType: file.mimetype,
      };
      cb(null, `${id}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: schoolProofMaxBytes(), files: 1 },
    fileFilter(_req, file, cb) {
      if (extForMime(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(Object.assign(new Error('UNSUPPORTED_MIME'), { code: 'UNSUPPORTED_MIME' }));
    },
  });
}

module.exports = {
  createSchoolProofUploader,
  absoluteSchoolProofPath,
  schoolProofMaxBytes,
};
