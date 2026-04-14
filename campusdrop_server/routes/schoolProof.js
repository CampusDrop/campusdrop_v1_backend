const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { prisma } = require('../lib/prisma');
const { requireUserUuid } = require('../lib/requireUserUuid');
const {
  createSchoolProofUploader,
  schoolProofMaxBytes,
} = require('../lib/schoolProofMulter');

const router = express.Router();
const upload = createSchoolProofUploader();

function handleMulterSingle(req, res, next) {
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
    console.error('school-proof multer:', err);
    res.status(400).json({ error: '파일 업로드 처리에 실패했습니다.' });
  });
}

/**
 * @openapi
 * /api/auth/school-proof:
 *   post:
 *     tags: [Auth]
 *     summary: |
 *       학교 소속 증빙 이미지 **추가** 제출 (pending). **`x-user-uuid` 필수** — 익명이 아닙니다.
 *       **최초 이미지 1차 제출**은 반드시 `POST /api/auth/complete-anonymous-onboarding`(multipart, 이미지 필수)로 하고,
 *       이후 교체·재제출·이메일 가입자의 증빙만 올릴 때 이 엔드포인트를 사용합니다. (`complete-anonymous`와 통합 폐기 예정 없음)
 *     security:
 *       - UserUuidAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: 저장됨
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SchoolProofSubmitResponse'
 *       400:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       401:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/school-proof', requireUserUuid, handleMulterSingle, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'multipart 필드 image(단일 파일)가 필요합니다.' });
  }
  const draft = req.schoolProofDraft;
  if (!draft || !draft.id || !draft.relativePath) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {
      /* ignore */
    }
    return res.status(500).json({ error: '업로드 메타데이터가 올바르지 않습니다.' });
  }

  try {
    const created = await prisma.schoolProofSubmission.create({
      data: {
        id: draft.id,
        identityId: req.user.id,
        storedPath: draft.relativePath,
        mimeType: draft.mimeType || req.file.mimetype,
        fileSize: typeof req.file.size === 'number' ? req.file.size : 0,
      },
      select: { id: true, status: true, createdAt: true },
    });
    return res.status(201).json({
      message: '제출이 저장되었습니다. 관리자 검토 후 승인되면 이미지 인증이 완료됩니다.',
      submission: created,
    });
  } catch (err) {
    console.error('school-proof create:', err);
    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {
      /* ignore */
    }
    return res.status(500).json({ error: '제출 저장 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/auth/school-proof/status:
 *   get:
 *     tags: [Auth]
 *     summary: 이메일·이미지(관리자 승인) 인증 상태
 *     security:
 *       - UserUuidAuth: []
 */
router.get('/school-proof/status', requireUserUuid, async (req, res) => {
  try {
    const row = await prisma.identity.findUnique({
      where: { id: req.user.id },
      select: {
        schoolProofVerifiedAt: true,
        email: true,
      },
    });
    const latest = await prisma.schoolProofSubmission.findFirst({
      where: { identityId: req.user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, createdAt: true },
    });
    return res.status(200).json({
      emailVerified: Boolean(row && row.email),
      schoolImageVerified: Boolean(row && row.schoolProofVerifiedAt),
      schoolProofVerifiedAt: row?.schoolProofVerifiedAt ?? null,
      latestSubmission: latest,
    });
  } catch (err) {
    console.error('school-proof status:', err);
    return res.status(500).json({ error: '상태 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
