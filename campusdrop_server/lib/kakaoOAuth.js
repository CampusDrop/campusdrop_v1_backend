const axios = require('axios');

const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_USER_ME = 'https://kapi.kakao.com/v2/user/me';
const KAKAO_MEMO_DEFAULT_SEND = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';

function kakaoWebLinkBaseUrl() {
  const u = String(
    process.env.KAKAO_MEMO_LINK_URL ||
      process.env.PUBLIC_API_URL ||
      process.env.APP_WEB_URL ||
      'https://campus-drop.com',
  ).trim()
    .replace(/\/+$/, '');
  return u || 'https://campus-drop.com';
}

/**
 * @param {{ code: string, redirectUri: string }} params
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number }>}
 */
async function exchangeKakaoCode({ code, redirectUri }) {
  const clientId = String(process.env.KAKAO_REST_API_KEY || '').trim();
  if (!clientId) {
    const err = new Error('KAKAO_CONFIG');
    err.code = 'KAKAO_CONFIG';
    throw err;
  }

  const paramsBody = new URLSearchParams();
  paramsBody.set('grant_type', 'authorization_code');
  paramsBody.set('client_id', clientId);
  paramsBody.set('redirect_uri', redirectUri);
  paramsBody.set('code', code);

  const secret = String(process.env.KAKAO_CLIENT_SECRET || '').trim();
  if (secret) {
    paramsBody.set('client_secret', secret);
  }

  const { data, status } = await axios.post(KAKAO_TOKEN_URL, paramsBody.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    validateStatus: () => true,
    timeout: 15_000,
  });

  if (status < 200 || status >= 300) {
    const err = new Error('KAKAO_TOKEN');
    err.code = 'KAKAO_TOKEN';
    err.kakaoStatus = status;
    err.kakaoBody = data;
    throw err;
  }

  if (!data || typeof data.access_token !== 'string' || !data.access_token.trim()) {
    const err = new Error('KAKAO_TOKEN');
    err.code = 'KAKAO_TOKEN';
    err.kakaoBody = data;
    throw err;
  }

  return data;
}

/**
 * @param {string} accessToken
 * @returns {Promise<string>} 카카오 회원번호(문자열)
 */
async function fetchKakaoUserId(accessToken) {
  const { data, status } = await axios.get(KAKAO_USER_ME, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
    timeout: 15_000,
  });

  if (status < 200 || status >= 300) {
    const err = new Error('KAKAO_USER_ME');
    err.code = 'KAKAO_USER_ME';
    err.kakaoStatus = status;
    err.kakaoBody = data;
    throw err;
  }

  const id = data && data.id;
  if (id === undefined || id === null) {
    const err = new Error('KAKAO_USER_ME');
    err.code = 'KAKAO_USER_ME';
    err.kakaoBody = data;
    throw err;
  }

  return String(id);
}

/**
 * 리프레시 토큰으로 액세스 토큰 재발급(나에게 보내기 등 백그라운드 호출용).
 * @param {string} refreshToken
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number }>}
 */
async function refreshKakaoAccessToken(refreshToken) {
  const rt =
    typeof refreshToken === 'string' && refreshToken.trim() ? refreshToken.trim() : '';
  if (!rt) {
    const err = new Error('KAKAO_REFRESH');
    err.code = 'KAKAO_REFRESH';
    throw err;
  }

  const clientId = String(process.env.KAKAO_REST_API_KEY || '').trim();
  if (!clientId) {
    const err = new Error('KAKAO_CONFIG');
    err.code = 'KAKAO_CONFIG';
    throw err;
  }

  const paramsBody = new URLSearchParams();
  paramsBody.set('grant_type', 'refresh_token');
  paramsBody.set('client_id', clientId);
  paramsBody.set('refresh_token', rt);

  const secret = String(process.env.KAKAO_CLIENT_SECRET || '').trim();
  if (secret) {
    paramsBody.set('client_secret', secret);
  }

  const { data, status } = await axios.post(KAKAO_TOKEN_URL, paramsBody.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    validateStatus: () => true,
    timeout: 15_000,
  });

  if (status < 200 || status >= 300) {
    const err = new Error('KAKAO_REFRESH');
    err.code = 'KAKAO_REFRESH';
    err.kakaoStatus = status;
    err.kakaoBody = data;
    throw err;
  }

  if (!data || typeof data.access_token !== 'string' || !data.access_token.trim()) {
    const err = new Error('KAKAO_REFRESH');
    err.code = 'KAKAO_REFRESH';
    err.kakaoBody = data;
    throw err;
  }

  return data;
}

/**
 * 카카오톡 나에게 보내기 — 기본 템플릿(TEXT). 액세스 토큰에 `talk_message` 동의가 필요합니다.
 * @param {string} accessToken
 * @param {string} text
 */
async function sendKakaoTalkDefaultTextMemo(accessToken, text) {
  const plain = typeof text === 'string' ? text.trim() : '';
  const at =
    typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : '';
  if (!plain) {
    const err = new Error('KAKAO_MEMO');
    err.code = 'KAKAO_MEMO';
    throw err;
  }
  if (!at) {
    const err = new Error('KAKAO_MEMO');
    err.code = 'KAKAO_MEMO';
    throw err;
  }

  const url = kakaoWebLinkBaseUrl();
  const template_object = JSON.stringify({
    object_type: 'text',
    text: plain.slice(0, 200),
    link: { web_url: url, mobile_web_url: url },
  });

  const form = new URLSearchParams();
  form.set('template_object', template_object);

  const { data, status } = await axios.post(KAKAO_MEMO_DEFAULT_SEND, form.toString(), {
    headers: {
      Authorization: `Bearer ${at}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    validateStatus: () => true,
    timeout: 15_000,
  });

  if (status < 200 || status >= 300) {
    const err = new Error('KAKAO_MEMO');
    err.code = 'KAKAO_MEMO';
    err.kakaoStatus = status;
    err.kakaoBody = data;
    throw err;
  }

  return data;
}

module.exports = {
  exchangeKakaoCode,
  fetchKakaoUserId,
  refreshKakaoAccessToken,
  sendKakaoTalkDefaultTextMemo,
};
