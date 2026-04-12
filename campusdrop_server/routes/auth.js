const crypto = require('crypto');
const express = require('express');
const { prisma } = require('../lib/prisma');
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

const router = express.Router();

function randomSixDigitCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * @openapi
 * /api/auth/send-code:
 *   post:
 *     tags: [Auth]
 *     summary: 세종대 이메일로 6자리 인증 코드 발송
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

  const code = randomSixDigitCode();
  setVerificationCode(normalized, code);

  try {
    await sendVerificationCode(normalized, code);
  } catch (err) {
    console.error('send-code mail error:', err);
    clearVerificationCode(normalized);
    return res.status(500).json({
      error: '인증 메일 발송에 실패했습니다. 이메일(SES/SMTP) 환경 변수를 확인해 주세요.',
    });
  }

  return res.status(200).json({ message: '인증 번호를 발송했습니다.' });
});

/**
 * @openapi
 * /api/auth/verify-code:
 *   post:
 *     tags: [Auth]
 *     summary: 이메일·코드 검증 후 세션 UUID 발급
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
  const { email, code } = req.body ?? {};

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

  let sessionId;
  try {
    const existingId = await findIdentityIdByNormalizedEmail(prisma, normalized);
    if (existingId) {
      sessionId = existingId;
    } else {
      const emailHash = await hashEmailForStorage(normalized);
      const created = await prisma.identity.create({
        data: {
          emailHash,
          trait: {
            create: {},
          },
        },
        select: { id: true },
      });
      sessionId = created.id;
    }
  } catch (err) {
    console.error('verify-code identity error:', err);
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
    return res.status(503).json({
      error: 'PIN을 발급할 수 없습니다. Redis 연결(REDIS_URL)을 확인해 주세요.',
    });
  }
});

module.exports = router;
