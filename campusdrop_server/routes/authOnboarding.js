const fs = require('fs');
const express = require('express');
const multer = require('multer');
const {
  createSchoolProofUploader,
  schoolProofMaxBytes,
} = require('../lib/schoolProofMulter');

const router = express.Router();
const upload = createSchoolProofUploader();

function cleanupUploadedFile(req) {
  if (!req.file) {
    return;
  }
  try {
    fs.unlinkSync(req.file.path);
  } catch (_) {
    /* ignore */
  }
}

function handleSchoolProofMulter(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({
          error: `파일은 최대 ${Math.round(schoolProofMaxBytes() / 1024 / 1024)}MB까지 업로드할 수 있습니다.`,
        });
        return;
      }
    }
    if (err && (err.message === 'UNSUPPORTED_MIME' || err.code === 'UNSUPPORTED_MIME')) {
      res.status(400).json({ error: 'JPEG, PNG, WEBP 이미지만 업로드할 수 있습니다.' });
      return;
    }
    console.error('onboarding multer:', err);
    res.status(400).json({ error: '파일 업로드 처리에 실패했습니다.' });
  });
}

/**
 * @openapi
 * /api/auth/complete-registration:
 *   post:
 *     tags: [Auth]
 *     summary: |
 *       **폐기됨 — `403`.** 카카오 로그인(`POST /api/auth/kakao`) 후 `verify-code` 또는 `school-proof`를 사용하세요.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [registrationToken, privacyPolicyAgreed]
 *             properties:
 *               registrationToken: { type: string }
 *               privacyPolicyAgreed: { type: string, description: '개인정보처리방침 동의 — `true` 또는 문자열 true(대소문자 무관)' }
 *               survey: { type: string, description: '선택. 설문 JSON 문자열(없으면 빈 Trait 후 /api/survey/submit)' }
 *               profile: { type: string, description: '선택. 설문 없을 때 studentId·birthYear·gender JSON 문자열' }
 *               image: { type: string, format: binary, description: '선택. 없으면 증빙 없이 가입' }
 *     responses:
 *       403:
 *         description: 폐기됨
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/complete-registration', handleSchoolProofMulter, async (req, res) => {
  if (req.file) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {
      /* ignore */
    }
  }
  return res.status(403).json({
    error:
      '이 가입 경로는 더 이상 사용되지 않습니다. 카카오 로그인(`POST /api/auth/kakao`) 후 학교 이메일 인증 또는 학교 증빙 이미지를 이용해 주세요.',
  });
});

/**
 * @openapi
 * /api/auth/complete-anonymous-onboarding:
 *   post:
 *     tags: [Auth]
 *     summary: |
 *       **폐기됨 — `403`.** 카카오 로그인 후 `POST /api/auth/school-proof`로 증빙을 제출하세요.
 *     responses:
 *       403:
 *         description: 폐기됨
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/complete-anonymous-onboarding', handleSchoolProofMulter, async (req, res) => {
  cleanupUploadedFile(req);
  return res.status(403).json({
    error:
      '이 가입 경로는 더 이상 사용되지 않습니다. 카카오 로그인(`POST /api/auth/kakao`) 후 `POST /api/auth/school-proof`로 학교 증빙을 제출해 주세요.',
  });
});

module.exports = router;
