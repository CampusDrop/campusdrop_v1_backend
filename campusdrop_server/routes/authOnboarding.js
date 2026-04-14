const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { hashEmailForStorage, findIdentityIdByNormalizedEmail } = require('../lib/identityAuth');
const {
  validateSurveyPayload,
  identityProfileColumnsFromSurveyData,
} = require('../lib/surveyValidation');
const { verifyRegistrationToken } = require('../lib/registrationToken');
const {
  createSchoolProofUploader,
  schoolProofMaxBytes,
} = require('../lib/schoolProofMulter');
const { writeAccessLog } = require('../lib/accessLog');
const { storePinForIdentity } = require('../lib/pinSession');
const { computeImageUuidAccessUntil } = require('../lib/imageUuidAccess');
const { parseSignupProfile } = require('../lib/signupProfile');

const router = express.Router();
const upload = createSchoolProofUploader();

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

function parseSurveyField(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, error: 'survey 필드가 필요합니다. (JSON 문자열 또는 객체)' };
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'survey는 JSON 객체여야 합니다.' };
    }
    return { ok: true, data: parsed };
  } catch (_) {
    return { ok: false, error: 'survey JSON을 파싱할 수 없습니다.' };
  }
}

/** 설문 생략 허용(이메일 가입 마무리·이미지 온보딩). */
function parseOptionalSurveyField(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, data: null };
  }
  return parseSurveyField(raw);
}

/**
 * @openapi
 * /api/auth/complete-registration:
 *   post:
 *     tags: [Auth]
 *     summary: |
 *       구 클라이언트용: `registrationToken` + 설문(선택) + 증빙 이미지(선택). 신규는 `verify-code` 직후 `uuid`가 생기므로 설문은 `POST /api/survey/submit`으로 제출합니다.
 *       학교 증빙만 쓰는 플로우는 `POST /api/auth/complete-anonymous-onboarding`와 택일이며, 두 가지를 동시에 요구하지 않습니다.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [registrationToken]
 *             properties:
 *               registrationToken: { type: string }
 *               survey: { type: string, description: '선택. 설문 JSON 문자열(없으면 빈 Trait 후 /api/survey/submit)' }
 *               profile: { type: string, description: '선택. 설문 없을 때 studentId·birthYear·gender JSON 문자열' }
 *               image: { type: string, format: binary, description: '선택. 없으면 증빙 없이 가입' }
 */
router.post('/complete-registration', handleSchoolProofMulter, async (req, res) => {
  const token = String(req.body?.registrationToken ?? '').trim();
  if (!token) {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* ignore */
      }
    }
    return res.status(400).json({ error: 'registrationToken이 필요합니다.' });
  }

  const v = verifyRegistrationToken(token);
  if (!v.ok) {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* ignore */
      }
    }
    if (v.reason === 'not_configured') {
      return res.status(503).json({
        error:
          '가입 토큰 검증을 할 수 없습니다. AUTH_REGISTRATION_JWT_SECRET(16자 이상) 또는 ADMIN_JWT_SECRET·ADMIN_PASSWORD를 설정해 주세요.',
      });
    }
    return res.status(401).json({ error: '유효하지 않거나 만료된 가입 토큰입니다. 이메일 인증을 다시 진행해 주세요.' });
  }

  const parsedSurvey = parseOptionalSurveyField(req.body?.survey);
  if (!parsedSurvey.ok) {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* ignore */
      }
    }
    return res.status(400).json({ error: parsedSurvey.error });
  }

  let validation = { ok: true, data: null };
  if (parsedSurvey.data !== null) {
    validation = validateSurveyPayload(parsedSurvey.data);
    if (!validation.ok) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {
          /* ignore */
        }
      }
      return res.status(400).json({ error: validation.error });
    }
  } else {
    const pp = parseSignupProfile(req.body?.profile);
    if (!pp.ok) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {
          /* ignore */
        }
      }
      return res.status(400).json({ error: pp.error });
    }
  }

  const normalizedEmail = v.email;
  const dup = await findIdentityIdByNormalizedEmail(prisma, normalizedEmail);
  if (dup) {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* ignore */
      }
    }
    return res.status(409).json({
      error: '이미 가입된 이메일입니다. 로그인(verify-code)으로 세션을 받아 주세요.',
    });
  }

  const draft = req.schoolProofDraft;
  if (req.file && (!draft || !draft.id || !draft.relativePath)) {
    try {
      if (req.file.path) fs.unlinkSync(req.file.path);
    } catch (_) {
      /* ignore */
    }
    return res.status(500).json({ error: '업로드 메타데이터가 올바르지 않습니다.' });
  }

  try {
    const identityId = await prisma.$transaction(async (tx) => {
      const emailHash = await hashEmailForStorage(normalizedEmail);
      /** @type {Record<string, string>} */
      let profileCols = {};
      /** @type {{ gender: string | null, surveyData?: object }} */
      let traitCreate = { gender: null };
      if (validation.data) {
        profileCols = identityProfileColumnsFromSurveyData(validation.data);
        traitCreate = {
          gender: String(validation.data.gender),
          surveyData: validation.data,
        };
      } else {
        const pp = parseSignupProfile(req.body?.profile);
        if (pp.studentId) profileCols.studentId = pp.studentId;
        if (pp.birthYear) profileCols.birthYear = pp.birthYear;
        traitCreate = { gender: pp.genderTrait };
      }
      const created = await tx.identity.create({
        data: {
          email: normalizedEmail,
          emailHash,
          ...profileCols,
          trait: {
            create: traitCreate,
          },
        },
        select: { id: true },
      });
      if (req.file && draft) {
        await tx.schoolProofSubmission.create({
          data: {
            id: draft.id,
            identityId: created.id,
            storedPath: draft.relativePath,
            mimeType: draft.mimeType || req.file.mimetype,
            fileSize: typeof req.file.size === 'number' ? req.file.size : 0,
          },
        });
      }
      return created.id;
    });

    await writeAccessLog({
      actorType: 'user_session',
      actorId: identityId,
      action: 'AUTH_SIGNUP_COMPLETE',
      resource: 'POST /api/auth/complete-registration',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { hasImage: Boolean(req.file) },
    });

    let pin = null;
    let expiresInSec = null;
    try {
      const pinResult = await storePinForIdentity(identityId);
      pin = pinResult.pin;
      expiresInSec = pinResult.expiresInSec;
    } catch (pinErr) {
      console.error('complete-registration pin error:', pinErr);
    }

    return res.status(201).json({
      message: '가입이 완료되었습니다.',
      uuid: identityId,
      pin,
      expiresInSec,
    });
  } catch (err) {
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* ignore */
      }
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({
        error: '이미 가입된 이메일입니다. 로그인(verify-code)으로 세션을 받아 주세요.',
      });
    }
    console.error('complete-registration error:', err);
    return res.status(500).json({ error: '가입 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/auth/complete-anonymous-onboarding:
 *   post:
 *     tags: [Auth]
 *     summary: |
 *       이메일 인증 없이 학교 증빙(이미지 필수) + 선택 설문(또는 `profile` JSON만). `complete-registration`과 택일입니다.
 *       설문은 이후 `POST /api/survey/submit`으로 넣을 수 있습니다. `imageUuidAccessUntil`까지 설문·매칭 API 접근 가능(이메일 없을 때).
 *     responses:
 *       201:
 *         description: 제출 완료
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AnonymousOnboardingResponse'
 */
router.post('/complete-anonymous-onboarding', handleSchoolProofMulter, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'multipart 필드 image(단일 파일)가 필요합니다.' });
  }

  const parsedSurvey = parseOptionalSurveyField(req.body?.survey);
  if (!parsedSurvey.ok) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {
      /* ignore */
    }
    return res.status(400).json({ error: parsedSurvey.error });
  }

  let validation = { ok: true, data: null };
  if (parsedSurvey.data !== null) {
    validation = validateSurveyPayload(parsedSurvey.data);
    if (!validation.ok) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* ignore */
      }
      return res.status(400).json({ error: validation.error });
    }
  } else {
    const pp = parseSignupProfile(req.body?.profile);
    if (!pp.ok) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* ignore */
      }
      return res.status(400).json({ error: pp.error });
    }
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

  const imageAccessUntil = computeImageUuidAccessUntil(new Date());

  try {
    const identityId = await prisma.$transaction(async (tx) => {
      const id = crypto.randomUUID();
      const placeholder = `__anonymous_session__:${id}@internal.invalid`;
      const emailHash = await hashEmailForStorage(placeholder);
      /** @type {Record<string, string>} */
      let profileCols = {};
      /** @type {{ gender: string | null, surveyData?: object }} */
      let traitCreate = { gender: null };
      if (validation.data) {
        profileCols = identityProfileColumnsFromSurveyData(validation.data);
        traitCreate = {
          gender: String(validation.data.gender),
          surveyData: validation.data,
        };
      } else {
        const pp = parseSignupProfile(req.body?.profile);
        if (pp.studentId) profileCols.studentId = pp.studentId;
        if (pp.birthYear) profileCols.birthYear = pp.birthYear;
        traitCreate = { gender: pp.genderTrait };
      }
      await tx.identity.create({
        data: {
          id,
          email: null,
          emailHash,
          imageUuidAccessUntil: imageAccessUntil,
          ...profileCols,
          trait: {
            create: traitCreate,
          },
        },
      });
      await tx.schoolProofSubmission.create({
        data: {
          id: draft.id,
          identityId: id,
          storedPath: draft.relativePath,
          mimeType: draft.mimeType || req.file.mimetype,
          fileSize: typeof req.file.size === 'number' ? req.file.size : 0,
        },
      });
      return id;
    });

    await writeAccessLog({
      actorType: 'user_session',
      actorId: identityId,
      action: 'AUTH_ANONYMOUS_ONBOARDING_COMPLETE',
      resource: 'POST /api/auth/complete-anonymous-onboarding',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { submissionId: draft.id, identityId },
    });

    let pin = null;
    let expiresInSec = null;
    try {
      const pinResult = await storePinForIdentity(identityId);
      pin = pinResult.pin;
      expiresInSec = pinResult.expiresInSec;
    } catch (pinErr) {
      console.error('complete-anonymous-onboarding pin error:', pinErr);
    }

    return res.status(201).json({
      message: '제출이 저장되었습니다. 관리자 검토 후 증빙이 승인되면 이미지 인증이 완료됩니다.',
      uuid: identityId,
      pin,
      expiresInSec,
      imageUuidAccessUntil: imageAccessUntil.toISOString(),
      submission: { id: draft.id, status: 'pending' },
    });
  } catch (err) {
    console.error('complete-anonymous-onboarding error:', err);
    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {
      /* ignore */
    }
    return res.status(500).json({ error: '가입 처리 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
