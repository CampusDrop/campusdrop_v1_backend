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
const {
  checkSendCodeAllowed,
  recordSendCode,
  clearSendCodeRate,
} = require('../lib/sendCodeRateLimit');
const { requireUserUuid } = require('../lib/requireUserUuid');
const { storePinForIdentity } = require('../lib/pinSession');
const { traitGenderLabelKo } = require('../lib/genderPolicy');
const { parsePrivacyPolicyAgreed } = require('../lib/privacyPolicyConsent');
const { exchangeKakaoCode, fetchKakaoUserId } = require('../lib/kakaoOAuth');
const { userHasSchoolVerification } = require('../lib/surveyAccess');
const { decryptPhoneFromStorage, encryptPhoneForStorage } = require('../lib/phoneCrypto');
const { registerNewUser } = require('../lib/nickname');
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

function meetingSeedFromEnv() {
  return {
    meetingTime: String(process.env.DEFAULT_MEETING_TIME || '이번 주 금요일 오후 6시')
      .trim()
      .slice(0, 500),
    meetingPlace: String(process.env.DEFAULT_MEETING_PLACE || '세종대 후문 커피니')
      .trim()
      .slice(0, 500),
  };
}

/** @param {Record<string, unknown> | undefined} body */
function meetingPatchFromLoginBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const rawMt =
    typeof b.meeting_time === 'string'
      ? b.meeting_time
      : typeof b.meetingTime === 'string'
        ? b.meetingTime
        : '';
  const rawMp =
    typeof b.meeting_place === 'string'
      ? b.meeting_place
      : typeof b.meetingPlace === 'string'
        ? b.meetingPlace
        : '';
  const patch = {};
  if (rawMt.trim()) {
    patch.meetingTime = rawMt.trim().slice(0, 500);
  }
  if (rawMp.trim()) {
    patch.meetingPlace = rawMp.trim().slice(0, 500);
  }
  return patch;
}

/**
 * @openapi
 * /api/auth/kakao:
 *   post:
 *     tags: [Auth]
 *     summary: 카카오 로그인(인가 코드) — Identity 조회·생성 후 uuid 반환
 *     description: |
 *       카카오에서 받은 code로 토큰을 교환하고 회원번호(id)로 계정을 찾습니다.
 *       앱 사용자 식별용 UUID는 DB Identity.id이며 카카오의 숫자 회원번호는 kakaoId로 저장합니다.
 *       신규는 privacyPolicyAgreed true 필수. 이후 학교 인증은 send-code/verify-code(이메일) 또는 school-proof(이미지)로 진행합니다.
 *       나에게 보내기 등 백그라운드 알림을 쓰려면 카카오 동의항목에서 메시지/리프레시 토큰 발급이 필요할 수 있습니다(있으면 DB kakaoRefreshToken에 저장).
 *       선택 필드 meeting_time(또는 meetingTime), meeting_place(또는 meetingPlace)는 만남 일정·장소 문자열로 저장합니다. 생략 시 신규 가입에만 서버 기본값(DEFAULT_* 또는 예시 문구), 기존 유저는 본문으로 보낸 값만 덧씌웁니다.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KakaoLoginRequest'
 *     responses:
 *       200:
 *         description: 세션 UUID 발급
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KakaoLoginResponse'
 *       400:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       409:
 *         description: kakaoId 충돌 등
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       502:
 *         description: 카카오 API 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       503:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/kakao', async (req, res) => {
  const { code, redirectUri, redirect_uri: redirectSnake } = req.body ?? {};
  const redirectRaw = redirectUri !== undefined && redirectUri !== null ? redirectUri : redirectSnake;
  const codeStr = typeof code === 'string' ? code.trim() : '';
  const redir = typeof redirectRaw === 'string' ? redirectRaw.trim() : '';

  if (!codeStr) {
    return res.status(400).json({ error: 'code가 필요합니다.' });
  }
  if (!redir) {
    return res.status(400).json({ error: 'redirectUri가 필요합니다. (카카오 로그인에 사용한 값과 동일)' });
  }

  let accessToken;
  /** @type {string | null} */
  let kakaoRefreshTokenStored = null;
  try {
    const tokenRes = await exchangeKakaoCode({ code: codeStr, redirectUri: redir });
    accessToken = tokenRes.access_token;
    const rtRaw = tokenRes.refresh_token;
    if (typeof rtRaw === 'string' && rtRaw.trim()) {
      kakaoRefreshTokenStored = rtRaw.trim();
    }
  } catch (err) {
    if (err && err.code === 'KAKAO_CONFIG') {
      return res.status(503).json({
        error: '카카오 로그인 설정이 없습니다. KAKAO_REST_API_KEY를 확인해 주세요.',
      });
    }
    if (
      err &&
      err.code === 'KAKAO_TOKEN' &&
      err.kakaoStatus === 429 &&
      err.kakaoBody &&
      err.kakaoBody.error_code === 'KOE237'
    ) {
      const retryAfterSec =
        Number.isFinite(err.kakaoRetryAfterSec) && err.kakaoRetryAfterSec > 0
          ? err.kakaoRetryAfterSec
          : 3;
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: '카카오 로그인 요청이 일시적으로 많습니다. 잠시 후 다시 시도해 주세요.',
        code: 'KAKAO_TOKEN_RATE_LIMIT',
        providerCode: 'KOE237',
        retryAfterSec,
      });
    }
    console.error('kakao token exchange:', err && err.kakaoStatus, err && err.kakaoBody);
    return res.status(502).json({ error: '카카오 로그인 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }

  let kakaoUserId;
  try {
    kakaoUserId = await fetchKakaoUserId(accessToken);
  } catch (err) {
    console.error('kakao user/me:', err && err.kakaoStatus, err && err.kakaoBody);
    return res.status(502).json({ error: '카카오 사용자 정보를 가져오지 못했습니다.' });
  }

  try {
    const existing = await prisma.identity.findUnique({
      where: { kakaoId: kakaoUserId },
      include: { trait: true },
    });

    const meetingPatch = meetingPatchFromLoginBody(req.body);

    if (existing) {
      if (existing.blockedAt) {
        return res.status(403).json({
          error: '이 계정은 이용이 제한되었습니다. 문의가 필요하면 운영팀에 연락해 주세요.',
        });
      }

      const data = { ...meetingPatch };
      if (kakaoRefreshTokenStored) {
        data.kakaoRefreshToken = kakaoRefreshTokenStored;
      }
      if (Object.keys(data).length > 0) {
        await prisma.identity.update({
          where: { id: existing.id },
          data,
        });
      }

      return res.status(200).json({
        verified: true,
        uuid: existing.id,
        schoolVerified: userHasSchoolVerification(existing),
        nickname: existing.nickname ?? null,
        meetingTime: meetingPatch.meetingTime ?? existing.meetingTime ?? null,
        meetingPlace: meetingPatch.meetingPlace ?? existing.meetingPlace ?? null,
      });
    }

    const pp = parsePrivacyPolicyAgreed(req.body?.privacyPolicyAgreed, { required: true });
    if (!pp.ok) {
      return res.status(400).json({ error: pp.error });
    }
    if (pp.value !== true) {
      return res.status(400).json({
        error: '개인정보처리방침에 동의해야 카카오로 가입할 수 있습니다.',
      });
    }

    const seed = meetingSeedFromEnv();
    const mergedMeeting = { ...seed, ...meetingPatch };

    const created = await registerNewUser(
      {
        kakaoId: kakaoUserId,
        kakaoRefreshToken: kakaoRefreshTokenStored,
        email: null,
        privacyPolicyAgreed: true,
        meetingTime: mergedMeeting.meetingTime,
        meetingPlace: mergedMeeting.meetingPlace,
        trait: { create: { gender: null } },
      },
      { prismaClient: prisma },
    );

    return res.status(200).json({
      verified: true,
      uuid: created.id,
      schoolVerified: userHasSchoolVerification(created),
      nickname: created.nickname ?? null,
      meetingTime: created.meetingTime,
      meetingPlace: created.meetingPlace,
    });
  } catch (err) {
    console.error('kakao identity upsert:', err);
    if (err instanceof PrismaClientInitializationError) {
      return res.status(503).json({
        error:
          '데이터베이스에 연결할 수 없습니다. .env의 DATABASE_URL을 확인한 뒤 서버를 재시작해 주세요.',
      });
    }
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return res.status(409).json({ error: '이미 연결된 카카오 계정입니다. 다시 로그인해 주세요.' });
    }
    return res.status(500).json({ error: '계정 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/auth/send-code:
 *   post:
 *     tags: [Auth]
 *     security:
 *       - UserUuidAuth: []
 *     summary: 세종대 이메일로 인증 코드 발송 — 카카오 로그인(x-user-uuid 헤더) 후 학교 이메일 연동 시 사용
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
 *       401:
 *         description: 카카오 로그인 전 — 헤더 x-user-uuid 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       429:
 *         description: |
 *           동일 이메일에 대해 발송 간격 제한(최근 1~3회는 10초, 4회째부터는 10분) 위반.
 *           응답 헤더 `Retry-After`에 남은 대기 시간(초)을 포함합니다.
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
router.post('/send-code', requireUserUuid, async (req, res) => {
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

  const rate = checkSendCodeAllowed(normalized);
  if (!rate.ok) {
    const retryAfterSec = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    res.set('Retry-After', String(retryAfterSec));
    const minutes = Math.floor(retryAfterSec / 60);
    const seconds = retryAfterSec % 60;
    const waitText =
      minutes > 0
        ? `${minutes}분${seconds > 0 ? ` ${seconds}초` : ''}`
        : `${seconds}초`;
    return res.status(429).json({
      error: `인증 메일 요청이 너무 잦습니다. ${waitText} 후 다시 시도해 주세요.`,
      retryAfterSec,
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

  recordSendCode(normalized);

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
 *     security:
 *       - UserUuidAuth: []
 *     summary: |
 *       카카오 로그인(x-user-uuid)된 계정에 학교 이메일(@sju.ac.kr)을 연결합니다. 최초 연결 시 privacyPolicyAgreed true·JSON `profile`(필수) 및 `profile.phone`(010 포함 11자리 휴대폰) 필수.
 *       이미 동일 학교 메일만 코드 재검증하는 경우에는 profile 없이 진행 가능합니다.
 *       linkUuid는 현재 세션과 같을 때만 허용(호환용). 이메일이 다른 계정에 이미 있으면 거절합니다.
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
 *       401:
 *         description: 헤더 x-user-uuid 없음
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
router.post('/verify-code', requireUserUuid, async (req, res) => {
  const { email, code, linkUuid } = req.body ?? {};
  const sessionIdentityId = req.user.id;

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

  const linkRaw =
    linkUuid !== undefined && linkUuid !== null && linkUuid !== ''
      ? String(linkUuid).trim()
      : '';
  if (linkRaw && !isUuidString(linkRaw)) {
    return res.status(400).json({ error: 'linkUuid는 유효한 UUID 형식이어야 합니다.' });
  }
  if (linkRaw && linkRaw !== sessionIdentityId) {
    return res.status(400).json({ error: 'linkUuid는 현재 로그인한 계정(`x-user-uuid`)과 같아야 합니다.' });
  }

  const currentEmail = req.user.email != null ? normalizeEmail(String(req.user.email)) : '';
  if (currentEmail) {
    if (currentEmail === normalized) {
      const resultSame = verifyAndConsume(normalized, code);
      if (!resultSame.ok) {
        if (resultSame.reason === 'expired') {
          return res.status(400).json({
            error: '인증 번호가 만료되었습니다. 다시 요청해 주세요.',
          });
        }
        if (resultSame.reason === 'not_found') {
          return res.status(400).json({
            error: '유효한 인증 요청이 없습니다. 인증 번호를 다시 요청해 주세요.',
          });
        }
        return res.status(400).json({ error: '인증 번호가 올바르지 않습니다.' });
      }
      clearSendCodeRate(normalized);
      return res.status(200).json({ verified: true, uuid: sessionIdentityId });
    }
    return res.status(400).json({
      error: '이 계정에는 이미 다른 학교 이메일이 연결되어 있습니다.',
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

  try {
    const ppLink = parsePrivacyPolicyAgreed(req.body?.privacyPolicyAgreed, { required: true });
    if (!ppLink.ok) {
      return res.status(400).json({ error: ppLink.error });
    }
    if (ppLink.value !== true) {
      return res.status(400).json({
        error: '개인정보처리방침에 동의해야 학교 이메일을 연결할 수 있습니다.',
      });
    }

    const prof = parseSignupProfile(req.body?.profile, { phoneRequired: true });
    if (!prof.ok) {
      return res.status(400).json({ error: prof.error });
    }
    const resolvedUuid = await prisma.$transaction(async (tx) => {
      const sessionIdentity = await tx.identity.findUnique({
        where: { id: sessionIdentityId },
        include: { trait: true },
      });
      if (!sessionIdentity) {
        throw new Error('SESSION_IDENTITY_NOT_FOUND');
      }

      const emailOwner = await tx.identity.findUnique({
        where: { email: normalized },
        include: { trait: true },
      });

      if (emailOwner && emailOwner.id !== sessionIdentityId) {
        if (emailOwner.blockedAt) {
          throw new Error('EMAIL_OWNER_BLOCKED');
        }
        if (!sessionIdentity.kakaoId) {
          throw new Error('SESSION_KAKAO_REQUIRED');
        }
        if (emailOwner.kakaoId && emailOwner.kakaoId !== sessionIdentity.kakaoId) {
          throw new Error('EMAIL_ALREADY_LINKED_TO_OTHER_KAKAO');
        }

        const ownerUpdate = {
          kakaoId: sessionIdentity.kakaoId,
          email: normalized,
          imageUuidAccessUntil: null,
          privacyPolicyAgreed: true,
        };
        if (!emailOwner.kakaoRefreshToken && sessionIdentity.kakaoRefreshToken) {
          ownerUpdate.kakaoRefreshToken = sessionIdentity.kakaoRefreshToken;
        }
        if (!emailOwner.studentId) {
          const candidateStudentId = prof.studentId || sessionIdentity.studentId || null;
          if (candidateStudentId) ownerUpdate.studentId = candidateStudentId;
        }
        if (!emailOwner.birthYear) {
          const candidateBirthYear = prof.birthYear || sessionIdentity.birthYear || null;
          if (candidateBirthYear) ownerUpdate.birthYear = candidateBirthYear;
        }
        if (!emailOwner.department) {
          const candidateDepartment = prof.department || sessionIdentity.department || null;
          if (candidateDepartment) ownerUpdate.department = candidateDepartment;
        }
        if (!emailOwner.meetingTime && sessionIdentity.meetingTime) {
          ownerUpdate.meetingTime = sessionIdentity.meetingTime;
        }
        if (!emailOwner.meetingPlace && sessionIdentity.meetingPlace) {
          ownerUpdate.meetingPlace = sessionIdentity.meetingPlace;
        }
        ownerUpdate.phoneEncrypted = encryptPhoneForStorage(prof.phone);
        if (!emailOwner.trait?.gender) {
          const candidateGender = prof.genderTrait ?? sessionIdentity.trait?.gender ?? null;
          if (candidateGender != null) {
            ownerUpdate.trait = {
              upsert: {
                create: { gender: candidateGender },
                update: { gender: candidateGender },
              },
            };
          }
        }

        await tx.identity.update({
          where: { id: sessionIdentity.id },
          data: {
            kakaoId: null,
            kakaoRefreshToken: null,
          },
        });

        await tx.identity.update({
          where: { id: emailOwner.id },
          data: ownerUpdate,
        });

        console.log('[verify-code] linked kakao account to existing email owner', {
          ownerId: emailOwner.id,
          sessionIdentityId,
        });

        return emailOwner.id;
      }

      const sessionUpdate = {
        email: normalized,
        imageUuidAccessUntil: null,
        privacyPolicyAgreed: true,
      };
      sessionUpdate.phoneEncrypted = encryptPhoneForStorage(prof.phone);
      if (prof.studentId) sessionUpdate.studentId = prof.studentId;
      if (prof.birthYear) sessionUpdate.birthYear = prof.birthYear;
      if (prof.department) sessionUpdate.department = prof.department;
      if (prof.genderTrait != null) {
        sessionUpdate.trait = {
          upsert: {
            create: { gender: prof.genderTrait },
            update: { gender: prof.genderTrait },
          },
        };
      }

      await tx.identity.update({
        where: { id: sessionIdentityId },
        data: sessionUpdate,
      });
      return sessionIdentityId;
    });
    clearSendCodeRate(normalized);
    return res.status(200).json({ verified: true, uuid: resolvedUuid });
  } catch (err) {
    console.error('verify-code identity error:', err);
    if (err instanceof PrismaClientInitializationError) {
      return res.status(503).json({
        error:
          '데이터베이스에 연결할 수 없습니다. .env의 DATABASE_URL을 확인한 뒤 서버를 재시작해 주세요. 인증 메일 발송(send-code)은 DB를 쓰지 않아 정상일 수 있습니다.',
      });
    }
    if (err instanceof Error && err.message === 'EMAIL_OWNER_BLOCKED') {
      return res.status(403).json({
        error: '이 계정은 이용이 제한되었습니다. 문의가 필요하면 운영팀에 연락해 주세요.',
      });
    }
    if (
      err instanceof Error &&
      (err.message === 'EMAIL_ALREADY_LINKED_TO_OTHER_KAKAO' || err.message === 'SESSION_KAKAO_REQUIRED')
    ) {
      return res.status(400).json({
        error: '해당 학교 이메일은 다른 계정에서 이미 사용 중입니다. 해당 카카오 계정으로 로그인해 주세요.',
      });
    }
    if (err instanceof Error && err.message === 'PHONE_ENCRYPTION_KEY_INVALID') {
      return res.status(500).json({
        error: '전화번호 저장 암호화 키가 설정되지 않았습니다. 서버 설정을 확인해 주세요.',
      });
    }
    return res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다.' });
  }
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
 *     summary: 현재 세션(x-user-uuid 헤더)의 서버 저장 프로필·이메일 요약
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
  const department = u.department != null ? String(u.department).trim() : null;
  let phone = null;
  if (u.phoneEncrypted) {
    try {
      phone = decryptPhoneFromStorage(u.phoneEncrypted);
    } catch (err) {
      console.error('auth /me phone decrypt error:', err);
      phone = null;
    }
  }
  const genderTrait = u.trait?.gender != null ? String(u.trait.gender).trim() : null;
  const genderLabel = traitGenderLabelKo(u.trait?.gender) || null;
  const schoolVerified = userHasSchoolVerification(u);
  const profile = {
    studentId: studentId || null,
    birthYear: birthYear || null,
    department: department || null,
    phone,
    gender: genderLabel,
    genderTrait: genderTrait || null,
    schoolVerified,
  };
  return res.status(200).json({
    uuid: u.id,
    nickname: u.nickname ?? null,
    email: u.email ?? null,
    kakaoLinkPin: u.kakaoLinkPin ?? null,
    kakaoLinked: Boolean(u.kakaoId && String(u.kakaoId).trim()),
    schoolVerified,
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
 *       서버 무상태 세션 — 별도 토큰 폐기 없음. 클라이언트에서 헤더 x-user-uuid(및 사용 중인 쿠키) 삭제용.
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
