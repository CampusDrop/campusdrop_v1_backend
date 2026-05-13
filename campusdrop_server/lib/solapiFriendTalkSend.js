const CoolsmsMessageService = require('coolsms-node-sdk').default;
const {
  msUntilKakaoFriendTalkSendWindowOpens,
  delayMs,
  isWithinKakaoFriendTalkSendWindow,
} = require('./kakaoFriendTalkSendWindow');

/** 전날 확인(6번) 이미지 — 로컬 경로 또는 https URL */
const FRIEND_TALK_IMG_DAY_EVE = 'FRIEND_TALK_IMG_DAY_EVE';
/** 매칭 실패 계열(미매칭 주·7번 취소·6번 후 불가·수동 partner-declined 등) */
const FRIEND_TALK_IMG_MATCH_FAIL = 'FRIEND_TALK_IMG_MATCH_FAIL';
/** 매칭 성공 계열(7번 확정·6번 후 양쪽 가능·수동 partner-confirmed) */
const FRIEND_TALK_IMG_MATCH_SUCCESS = 'FRIEND_TALK_IMG_MATCH_SUCCESS';

const imageFileIdCache = new Map();

/**
 * @returns {{ ok: true, apiKey: string, apiSecret: string, from: string, pfId: string } | { ok: false, error: string }}
 */
function loadSolapiFriendTalkEnv() {
  const apiKey = (process.env.SOLAPI_API_KEY || '').trim();
  const apiSecret = (process.env.SOLAPI_API_SECRET || '').trim();
  const from = (process.env.SENDER_NUMBER || '').trim();
  const pfId = (process.env.KAKAO_PF_ID || '').trim();
  if (!apiKey || !apiSecret || !from || !pfId) {
    return {
      ok: false,
      error: 'Missing env: SOLAPI_API_KEY, SOLAPI_API_SECRET, SENDER_NUMBER, KAKAO_PF_ID',
    };
  }
  return { ok: true, apiKey, apiSecret, from, pfId };
}

/** @returns {string | null} 오류 메시지 또는 null */
function assertSolapiFriendTalkEnv() {
  const cfg = loadSolapiFriendTalkEnv();
  if (!cfg.ok) {
    return cfg.error;
  }
  return null;
}

/**
 * 친구톡 이미지 업로드 시 카카오 규격상 필요한 **https** 링크.
 * @returns {string | null}
 */
function friendTalkImageUploadLink() {
  const explicit = String(process.env.FRIEND_TALK_IMG_LINK || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(explicit)) {
    return explicit;
  }
  const pub = String(process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(pub)) {
    return pub;
  }
  return null;
}

/**
 * Solapi uploadFile 로 KAKAO 이미지 등록 후 fileId. 실패·미설정 시 null(텍스트만 발송).
 * @param {string} envPathKey 환경변수 **이름** (값 = 파일 절대/상대 경로 또는 이미지 URL)
 * @returns {Promise<string | null>}
 */
async function getKakaoFriendTalkImageIdFromEnv(envPathKey) {
  const raw = String(process.env[envPathKey] || '').trim();
  if (!raw) {
    return null;
  }

  const link = friendTalkImageUploadLink();
  if (!link) {
    console.warn(
      `[solapiFriendTalk] ${envPathKey} 은(는) 설정됐지만 FRIEND_TALK_IMG_LINK 또는 https PUBLIC_API_URL 없음 — 이미지 생략`,
    );
    return null;
  }

  const cfg = loadSolapiFriendTalkEnv();
  if (!cfg.ok) {
    return null;
  }

  const cacheKey = `${envPathKey}::${raw}`;
  if (imageFileIdCache.has(cacheKey)) {
    return imageFileIdCache.get(cacheKey);
  }

  const messageService = new CoolsmsMessageService(cfg.apiKey, cfg.apiSecret);
  const safeName = `friend-talk-${envPathKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;

  try {
    const res = await messageService.uploadFile(raw, 'KAKAO', safeName, link);
    const id = res && res.fileId ? String(res.fileId) : null;
    if (!id) {
      console.warn('[solapiFriendTalk] uploadFile 응답에 fileId 없음:', envPathKey);
      return null;
    }
    imageFileIdCache.set(cacheKey, id);
    return id;
  } catch (e) {
    console.warn(
      '[solapiFriendTalk] 이미지 업로드 실패, 텍스트만 발송:',
      envPathKey,
      e && e.message ? e.message : e,
    );
    return null;
  }
}

/**
 * 카카오 친구톡 버튼 (Solapi / coolsms-node-sdk 스펙)
 * @typedef {{ buttonName: string, buttonType: 'WL'|'AL'|'BK'|'MD'|'DS'|'BC'|'BT'|'AC', linkMo?: string, linkPc?: string, linkAnd?: string, linkIos?: string }} KakaoFriendTalkButton
 */

/**
 * 카카오 친구톡 단건 — Solapi `sendOne`.
 * `kakaoImageId` 있으면 CTI(이미지형), 없으면 CTA(텍스트형).
 * @param {{ to: string, text: string, buttons?: KakaoFriendTalkButton[], kakaoImageId?: string | null }} params
 */
async function sendFriendTalkCta({ to, text, buttons, kakaoImageId }) {
  const cfg = loadSolapiFriendTalkEnv();
  if (!cfg.ok) {
    const e = new Error(cfg.error);
    e.code = 'SOLAPI_CONFIG';
    throw e;
  }
  const waitMs = msUntilKakaoFriendTalkSendWindowOpens();
  if (waitMs > 0) {
    console.log(
      `[solapiFriendTalk] 발송 허용 시간대(KST 08:01~20:49) 밖 — 약 ${Math.ceil(
        waitMs / 60000,
      )}분 후(다음 오전 8:01 KST)에 친구톡 발송`,
    );
    await delayMs(waitMs);
  }
  const useImage = Boolean(kakaoImageId && String(kakaoImageId).trim());
  /** @type {{ pfId: string, buttons?: KakaoFriendTalkButton[], imageId?: string }} */
  const kakaoOptions = {
    pfId: cfg.pfId,
  };
  if (useImage) {
    kakaoOptions.imageId = String(kakaoImageId).trim();
  }
  if (Array.isArray(buttons) && buttons.length > 0) {
    kakaoOptions.buttons = buttons;
  }
  const message = {
    to,
    from: cfg.from,
    type: useImage ? 'CTI' : 'CTA',
    text,
    kakaoOptions,
  };
  const messageService = new CoolsmsMessageService(cfg.apiKey, cfg.apiSecret);
  return messageService.sendOne(message);
}

module.exports = {
  loadSolapiFriendTalkEnv,
  assertSolapiFriendTalkEnv,
  sendFriendTalkCta,
  getKakaoFriendTalkImageIdFromEnv,
  friendTalkImageUploadLink,
  FRIEND_TALK_IMG_DAY_EVE,
  FRIEND_TALK_IMG_MATCH_FAIL,
  FRIEND_TALK_IMG_MATCH_SUCCESS,
  isWithinKakaoFriendTalkSendWindow,
  msUntilKakaoFriendTalkSendWindowOpens,
};
