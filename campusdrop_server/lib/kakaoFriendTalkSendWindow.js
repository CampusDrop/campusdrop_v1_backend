'use strict';

/** 카카오 친구톡(등) 발송 허용 구간 — KST 벽시계 기준. */
const KST_MS = 9 * 60 * 60 * 1000;
/** 포함 — 08:01:00 */
const WINDOW_START_SEC_OF_DAY = 8 * 3600 + 60;
/** 포함 — 20:49:59 */
const WINDOW_END_SEC_OF_DAY = 20 * 3600 + 49 * 60 + 59;

/**
 * @param {Date} d
 * @returns {{ y: number, mo: number, day: number }}
 */
function kstCalendarFromInstant(d) {
  const k = new Date(d.getTime() + KST_MS);
  return {
    y: k.getUTCFullYear(),
    mo: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
  };
}

/**
 * @param {{ y: number, mo: number, day: number }} cal
 * @returns {{ y: number, mo: number, day: number }}
 */
function addOneKstCalendarDay(cal) {
  const noonMs = Date.UTC(cal.y, cal.mo - 1, cal.day, 12 - 9, 0, 0, 0);
  return kstCalendarFromInstant(new Date(noonMs + 86400000));
}

/**
 * 해당 KST 달력일의 오전 8시 1분 시작 시각(UTC `Date`).
 * @param {{ y: number, mo: number, day: number }} cal
 * @returns {Date}
 */
function kstOpenInstantOnCalendarDay(cal) {
  return new Date(Date.UTC(cal.y, cal.mo - 1, cal.day, 8 - 9, 1, 0, 0));
}

/**
 * @param {Date} [now]
 * @returns {number} KST 기준 자정부터의 초 (0 ~ 86399)
 */
function kstSecOfDay(now = new Date()) {
  const k = new Date(now.getTime() + KST_MS);
  return k.getUTCHours() * 3600 + k.getUTCMinutes() * 60 + k.getUTCSeconds();
}

/**
 * Solapi 친구톡 발송이 허용되는 시간대인지 (KST 08:01:00 ~ 20:49:59).
 * @param {Date} [now]
 * @returns {boolean}
 */
function isWithinKakaoFriendTalkSendWindow(now = new Date()) {
  const s = kstSecOfDay(now);
  return s >= WINDOW_START_SEC_OF_DAY && s <= WINDOW_END_SEC_OF_DAY;
}

/**
 * 허용 창이 열릴 때까지 남은 ms. 이미 창 안이면 0.
 * @param {Date} [now]
 * @returns {number}
 */
function msUntilKakaoFriendTalkSendWindowOpens(now = new Date()) {
  if (isWithinKakaoFriendTalkSendWindow(now)) {
    return 0;
  }
  const cal = kstCalendarFromInstant(now);
  const openToday = kstOpenInstantOnCalendarDay(cal).getTime();
  if (now.getTime() < openToday) {
    return openToday - now.getTime();
  }
  const nextCal = addOneKstCalendarDay(cal);
  const openNext = kstOpenInstantOnCalendarDay(nextCal).getTime();
  return openNext - now.getTime();
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  isWithinKakaoFriendTalkSendWindow,
  msUntilKakaoFriendTalkSendWindowOpens,
  delayMs,
  kstSecOfDay,
  kstCalendarFromInstant,
};
