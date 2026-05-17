const express = require('express');
const { PrismaClientInitializationError } = require('@prisma/client/runtime/library');
const { prisma } = require('../lib/prisma');
const { exchangeKakaoCode, fetchKakaoUserId } = require('../lib/kakaoOAuth');
const {
  attachFestivalSessionCookie,
} = require('../lib/festivalCookie');

const router = express.Router();

/** @returns {string} */
function festivalAfterLoginAbsoluteUrl() {
  const explicit = String(process.env.FESTIVAL_AFTER_LOGIN_REDIRECT_URL || '').trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  const fallbackBase =
    process.env.NODE_ENV === 'production' ? 'https://campus-drop.com' : 'http://127.0.0.1:5173';
  const base = String(process.env.FESTIVAL_FRONTEND_ORIGIN || process.env.APP_WEB_URL || fallbackBase)
    .trim()
    .replace(/\/+$/, '');
  const pathTailRaw = String(process.env.FESTIVAL_AFTER_LOGIN_PATH || '/festival').trim();
  const pathTail = pathRawToPath(pathTailRaw);
  return `${base}${pathTail}`;
}

/** @param {string} p */
function pathRawToPath(p) {
  if (!p.startsWith('/')) {
    return `/${p}`;
  }
  return p;
}

/**
 * GET /api/auth/kakao/callback
 * 축제 전용 카카오 OAuth 콜백 — `festival_users` upsert 후 쿠키에 공개 UUID를 두고 프론트로 리다이렉트.
 */
router.get('/kakao/callback', async (req, res) => {
  const codeRaw = req.query.code;
  const code = typeof codeRaw === 'string' ? codeRaw.trim() : '';
  if (!code) {
    return res.status(400).send('카카오 인가 코드(code)가 필요합니다.');
  }

  const redirectUri = String(process.env.FESTIVAL_KAKAO_REDIRECT_URI || '').trim();
  if (!redirectUri) {
    return res.status(503).send('축제 OAuth 리다이렉트 URI(FESTIVAL_KAKAO_REDIRECT_URI)가 설정되지 않았습니다.');
  }

  let accessToken;
  try {
    const tokenRes = await exchangeKakaoCode({ code, redirectUri });
    accessToken = tokenRes.access_token;
  } catch (err) {
    if (err && err.code === 'KAKAO_CONFIG') {
      return res.status(503).send('카카오 로그인 설정이 없습니다. KAKAO_REST_API_KEY를 확인해 주세요.');
    }
    console.error('festival kakao token:', err && err.kakaoStatus, err && err.kakaoBody);
    return res.status(502).send('카카오 로그인 처리에 실패했습니다.');
  }

  let kakaoUserId;
  try {
    kakaoUserId = await fetchKakaoUserId(accessToken);
  } catch (err) {
    console.error('festival kakao user/me:', err && err.kakaoStatus, err && err.kakaoBody);
    return res.status(502).send('카카오 사용자 정보를 가져오지 못했습니다.');
  }

  try {
    const user = await prisma.festivalUser.upsert({
      where: { kakaoId: kakaoUserId },
      create: { kakaoId: kakaoUserId },
      update: {},
    });

    attachFestivalSessionCookie(res, user.uuid);
    return res.redirect(302, festivalAfterLoginAbsoluteUrl());
  } catch (err) {
    console.error('festival user upsert:', err);
    if (err instanceof PrismaClientInitializationError) {
      return res.status(503).send(
        '데이터베이스에 연결할 수 없습니다. DATABASE_URL과 마이그레이션을 확인해 주세요.',
      );
    }
    return res.status(500).send('축제 계정 처리 중 오류가 발생했습니다.');
  }
});

module.exports = router;
