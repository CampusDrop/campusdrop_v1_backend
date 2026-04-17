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

const PROOF_FILE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * DB `storedPath` 기준 경로를 먼저 쓰고, 파일이 없으면 `uploads/school-proof/<submissionId>.(jpg|jpeg|png|webp)` 를 순서대로 시도합니다.
 * (경로 불일치·마이그레이션 등 소규모 복구용. 디스크가 비어 있으면 null.)
 * @param {{ id: string, storedPath: string | null }} row
 * @returns {string | null}
 */
function resolveSchoolProofAbsolutePath(row) {
  const sp = row.storedPath;
  if (sp) {
    try {
      const primary = absoluteSchoolProofPath(sp);
      if (fs.existsSync(primary)) return primary;
    } catch (_) {
      /* invalid storedPath — try fallbacks */
    }
  }
  const dir = path.join(SERVER_ROOT, 'uploads', 'school-proof');
  if (!fs.existsSync(dir)) return null;
  const sid = String(row.id || '').trim();
  if (!sid) return null;
  for (const ext of PROOF_FILE_EXTENSIONS) {
    const p = path.join(dir, sid + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
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
  resolveSchoolProofAbsolutePath,
  schoolProofMaxBytes,
};
