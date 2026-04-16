const crypto = require('crypto');
const express = require('express');
const { PrismaClientInitializationError } = require('@prisma/client/runtime/library');
const { prisma } = require('../lib/prisma');
const { parseSignupProfile } = require('../lib/signupProfile');
const { isSjuAcKrEmail, normalizeEmail } = require('../lib/sjuEmail');
const { sendVerificationCode } = require('../lib/mailer');
const {
  setVerificationCode,
  clearVerificationCode,
  verifyAndConsume,
} = require('../lib/verificationCodes');
const { hashEmailForStorage, findIdentityIdByNormalizedEmail } = require('../lib/identityAuth');
const { requireUserUuid } = require('../lib/requireUserUuid');
const { storePinForIdentity } = require('../lib/pinSession');
const { traitGenderLabelKo } = require('../lib/genderPolicy');
const { parsePrivacyPolicyAgreed } = require('../lib/privacyPolicyConsent');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidString(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function randomSixDigitCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 비어 있지 않으면 해당 문자열만 코드로 쓰고 메일을 보내지 않습니다. 운영에서는 설정하지 마세요. */
function fixedVerificationCodeFromEnv() {
  return String(process.env.AUTH_FIXED_VERIFICATION_CODE || '').trim();
}

/**
 * @openapi
 * /api/auth/send-code:
 *   post:
 *     tags: [Auth]
 *     summary: 세종대 이메일로 인증 코드 발송 (AUTH_FIXED_VERIFICATION_CODE 설정 시 메일 미발송)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendCodeRequest'
 *     responses:
 *       200:
 *         description: 발송 완료
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageOk'
 *       400:
 *         description: email 누락·타입 오류·비 sju 도메인 등
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         description: SMTP 실패(메모리 코드 제거)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/send-code', async (req, res) => {
  const { email } = req.body ?? {};

  if (email === undefined || email === null || email === '') {
    return res.status(400).json({ error: 'email이 필요합니다.' });
  }
  if (typeof email !== 'string') {
    return res.status(400).json({ error: 'email은 문자열이어야 합니다.' });
  }

  const normalized = normalizeEmail(email);
  if (!isSjuAcKrEmail(normalized)) {
    return res.status(400).json({
      error: '세종대학교 이메일(@sju.ac.kr)만 인증할 수 있습니다.',
    });
  }

  const fixedCode = fixedVerificationCodeFromEnv();
  const code = fixedCode || randomSixDigitCode();
  setVerificationCode(normalized, code);

  if (!fixedCode) {
    try {
      await sendVerificationCode(normalized, code);
    } catch (err) {
      console.error('send-code mail error:', err);
      clearVerificationCode(normalized);
      return res.status(500).json({
        error: '인증 메일 발송에 실패했습니다. 이메일(SES/SMTP) 환경 변수를 확인해 주세요.',
      });
    }
  }

  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.AUTH_LOG_SEND_CODE === 'true'
  ) {
    console.log(
      '[send-code]',
      fixedCode ? '메일 생략(AUTH_FIXED_VERIFICATION_CODE)' : '메일 발송 호출 완료',
      normalized,
    );
  }

  return res.status(200).json({ message: '인증 번호를 발송했습니다.' });
});

/**
 * @openapi
 * /api/auth/verify-code:
 *   post:
 *     tags: [Auth]
 *     summary: |
 *       이메일·코드 검증. DB에 해당 이메일 계정이 이미 있으면 `uuid`만 반환해 세션을 복구합니다.
 *       아직 `Identity`가 없으면 **즉시** `Identity`+빈 `Trait`을 만들고 `uuid`를 반환합니다(선택 `profile`: studentId, birthYear, gender). 신규 가입·`linkUuid` 이메일 연결 시 `privacyPolicyAgreed: true` 필수.
 *       설문은 이후 `POST /api/survey/submit`으로 저장합니다. `registrationToken`·`complete-registration`은 구 클라이언트용으로만 유지됩니다.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyCodeRequest'
 *     responses:
 *       200:
 *         description: 검증 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerifyCodeResponse'
 *       400:
 *         description: 누락·도메인 오류·만료·미요청·코드 불일치
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         description: Identity 처리 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/verify-code', async (req, res) => {
  const { email, code, linkUuid } = req.body ?? {};

  if (email === undefined || email === null || email === '') {
    return res.status(400).json({ error: 'email이 필요합니다.' });
  }
  if (typeof email !== 'string') {
    return res.status(400).json({ error: 'email은 문자열이어야 합니다.' });
  }
  if (code === undefined || code === null || code === '') {
    return res.status(400).json({ error: 'code가 필요합니다.' });
  }

  const normalized = normalizeEmail(email);
  if (!isSjuAcKrEmail(normalized)) {
    return res.status(400).json({
      error: '세종대학교 이메일(@sju.ac.kr)만 인증할 수 있습니다.',
    });
  }

  const result = verifyAndConsume(normalized, code);
  if (!result.ok) {
    if (result.reason === 'expired') {
      return res.status(400).json({
        error: '인증 번호가 만료되었습니다. 다시 요청해 주세요.',
      });
    }
    if (result.reason === 'not_found') {
      return res.status(400).json({
        error: '유효한 인증 요청이 없습니다. 인증 번호를 다시 요청해 주세요.',
      });
    }
    return res.status(400).json({ error: '인증 번호가 올바르지 않습니다.' });
  }

  const linkRaw =
    linkUuid !== undefined && linkUuid !== null && linkUuid !== ''
      ? String(linkUuid).trim()
      : '';
  if (linkRaw && !isUuidString(linkRaw)) {
    return res.status(400).json({ error: 'linkUuid는 유효한 UUID 형식이어야 합니다.' });
  }
  const linkId = linkRaw && isUuidString(linkRaw) ? linkRaw : null;

  let sessionId = null;
  try {
    if (linkId) {
      const ppLink = parsePrivacyPolicyAgreed(req.body?.privacyPolicyAgreed, { required: true });
      if (!ppLink.ok) {
        return res.status(400).json({ error: ppLink.error });
      }
      if (ppLink.value !== true) {
        return res.status(400).json({
          error: '개인정보처리방침에 동의해야 학교 이메일을 연결할 수 있습니다.',
        });
      }
      const anon = await prisma.identity.findUnique({
        where: { id: linkId },
        select: { id: true, email: true, blockedAt: true },
      });
      if (!anon) {
        return res.status(400).json({ error: '연결할 세션(UUID)을 찾을 수 없습니다.' });
      }
      if (anon.blockedAt) {
        return res.status(403).json({
          error: '이 계정은 이용이 제한되었습니다. 문의가 필요하면 운영팀에 연락해 주세요.',
        });
      }
      if (anon.email) {
        return res.status(400).json({
          error: '이 세션에는 이미 이메일이 연결되어 있습니다. linkUuid 없이 인증해 주세요.',
        });
      }
      const emailOwnerId = await findIdentityIdByNormalizedEmail(prisma, normalized);
      if (emailOwnerId && emailOwnerId !== linkId) {
        return res.status(400).json({
          error: '해당 학교 이메일은 다른 계정에서 이미 사용 중입니다. 해당 계정으로 로그인해 주세요.',
        });
      }
      const emailHash = await hashEmailForStorage(normalized);
      await prisma.identity.update({
        where: { id: linkId },
        data: {
          email: normalized,
          emailHash,
          imageUuidAccessUntil: null,
          privacyPolicyAgreed: true,
        },
      });
      sessionId = linkId;
    } else {
      const existingId = await findIdentityIdByNormalizedEmail(prisma, normalized);
      if (existingId) {
        sessionId = existingId;
        await prisma.identity.update({
          where: { id: existingId },
          data: { email: normalized, imageUuidAccessUntil: null },
        });
      } else {
        const ppNew = parsePrivacyPolicyAgreed(req.body?.privacyPolicyAgreed, { required: true });
        if (!ppNew.ok) {
          return res.status(400).json({ error: ppNew.error });
        }
        if (ppNew.value !== true) {
          return res.status(400).json({
            error: '개인정보처리방침에 동의해야 가입할 수 있습니다.',
          });
        }
        const prof = parseSignupProfile(req.body?.profile);
        if (!prof.ok) {
          return res.status(400).json({ error: prof.error });
        }
        const emailHash = await hashEmailForStorage(normalized);
        const created = await prisma.identity.create({
          data: {
            email: normalized,
            emailHash,
            privacyPolicyAgreed: true,
            ...(prof.studentId ? { studentId: prof.studentId } : {}),
            ...(prof.birthYear ? { birthYear: prof.birthYear } : {}),
            trait: {
              create: {
                gender: prof.genderTrait,
              },
            },
          },
          select: { id: true },
        });
        sessionId = created.id;
      }
    }
  } catch (err) {
    console.error('verify-code identity error:', err);
    if (err instanceof PrismaClientInitializationError) {
      return res.status(503).json({
        error:
          '데이터베이스에 연결할 수 없습니다. .env의 DATABASE_URL을 확인한 뒤 서버를 재시작해 주세요. 인증 메일 발송(send-code)은 DB를 쓰지 않아 정상일 수 있습니다.',
      });
    }
    return res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다.' });
  }

  return res.status(200).json({ verified: true, uuid: sessionId });
});

/**
 * @openapi
 * /api/auth/pin:
 *   get:
 *     tags: [Auth]
 *     summary: 카카오 챗봇 연동용 4자리 PIN 발급 (Redis TTL 3분)
 *     security:
 *       - UserUuidAuth: []
 *     responses:
 *       200:
 *         description: PIN 발급
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PinResponse'
 *       401:
 *         description: x-user-uuid 없음·무효
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       503:
 *         description: PIN 충돌 또는 Redis 연결 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/pin', requireUserUuid, async (req, res) => {
  try {
    const { pin, expiresInSec } = await storePinForIdentity(req.user.id);
    return res.status(200).json({ pin, expiresInSec });
  } catch (err) {
    console.error('auth GET /pin error:', err);
    if (err && typeof err === 'object' && 'code' in err && err.code === 'PIN_COLLISION') {
      return res.status(503).json({ error: 'PIN 발급에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
    }
    if (err && typeof err === 'object' && 'code' in err && err.code === 'IDENTITY_NOT_FOUND') {
      return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
    }
    return res.status(503).json({
      error: 'PIN을 발급할 수 없습니다. Redis(REDIS_URL)와 데이터베이스 연결을 확인해 주세요.',
    });
  }
});

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: 현재 세션(`x-user-uuid`)의 서버 저장 프로필·이메일 요약
 *     security:
 *       - UserUuidAuth: []
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthMeResponse'
 *       401:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/me', requireUserUuid, async (req, res) => {
  const u = req.user;
  const studentId = u.studentId != null ? String(u.studentId).trim() : null;
  const birthYear = u.birthYear != null ? String(u.birthYear).trim() : null;
  const genderTrait = u.trait?.gender != null ? String(u.trait.gender).trim() : null;
  const genderLabel = traitGenderLabelKo(u.trait?.gender) || null;
  const profile = {
    studentId: studentId || null,
    birthYear: birthYear || null,
    gender: genderLabel,
    genderTrait: genderTrait || null,
  };
  return res.status(200).json({
    uuid: u.id,
    email: u.email ?? null,
    profile,
    participantMeta: { profile: { ...profile } },
    privacyPolicyAgreed: Boolean(u.privacyPolicyAgreed),
    imageUuidAccessUntil: u.imageUuidAccessUntil
      ? new Date(u.imageUuidAccessUntil).toISOString()
      : null,
  });
});

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: |
 *       서버 무상태 세션 — 별도 토큰 폐기 없음. 클라이언트에서 `x-user-uuid`/쿠키 삭제용.
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LogoutResponse'
 */
router.post('/logout', (req, res) => {
  return res.status(200).json({
    ok: true,
    message:
      '서버에 저장된 로그인 토큰은 없습니다. 클라이언트에서 x-user-uuid(또는 이를 둔 쿠키)를 삭제하면 로그아웃됩니다.',
  });
});

router.use(require('./authOnboarding'));

module.exports = router;
