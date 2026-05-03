'use strict';

/** 소개팅 정각 기준 N분 전부터 채팅 허용 */
const CHAT_OPEN_BEFORE_MS = 10 * 60 * 1000;
/** 소개팅 정각 기준 채팅 종료(예: 16시 약속 → 17시까지) */
const CHAT_OPEN_AFTER_MS = 60 * 60 * 1000;

const KO_WEEKDAY = /** @type {Record<string, string>} */ ({
  Sun: '일',
  Mon: '월',
  Tue: '화',
  Wed: '수',
  Thu: '목',
  Fri: '금',
  Sat: '토',
});

/**
 * @param {Date} meetingStartsAtUtc
 * @returns {{ windowOpen: Date, windowEnd: Date }}
 */
function getChatWindow(meetingStartsAtUtc) {
  const start = meetingStartsAtUtc.getTime();
  return {
    windowOpen: new Date(start - CHAT_OPEN_BEFORE_MS),
    windowEnd: new Date(start + CHAT_OPEN_AFTER_MS),
  };
}

/**
 * @param {Date} now
 * @param {Date} meetingStartsAtUtc
 */
function isWithinUserChatWindow(now, meetingStartsAtUtc) {
  const { windowOpen, windowEnd } = getChatWindow(meetingStartsAtUtc);
  const t = now.getTime();
  return t >= windowOpen.getTime() && t <= windowEnd.getTime();
}

/**
 * `5/5(화) 오후 4시 제주몰빵` 형식
 * @param {Date} meetingStartsAtUtc
 * @param {string} venueName
 */
function formatMeetChatRoomTitle(meetingStartsAtUtc, venueName) {
  const place = typeof venueName === 'string' && venueName.trim() !== '' ? venueName.trim() : '장소 미정';
  const wShort = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(
    meetingStartsAtUtc,
  );
  const weekday = KO_WEEKDAY[wShort] || '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(meetingStartsAtUtc);

  const mo = Number(parts.find((p) => p.type === 'month')?.value);
  const da = Number(parts.find((p) => p.type === 'day')?.value);
  const h24 = Number(parts.find((p) => p.type === 'hour')?.value);
  let hourLabel;
  if (h24 === 0) hourLabel = '오전 12시';
  else if (h24 < 12) hourLabel = `오전 ${h24}시`;
  else if (h24 === 12) hourLabel = '오후 12시';
  else hourLabel = `오후 ${h24 - 12}시`;

  const dateChunk = weekday ? `${mo}/${da}(${weekday})` : `${mo}/${da}`;
  return `${dateChunk} ${hourLabel} ${place}`;
}

module.exports = {
  CHAT_OPEN_BEFORE_MS,
  CHAT_OPEN_AFTER_MS,
  getChatWindow,
  isWithinUserChatWindow,
  formatMeetChatRoomTitle,
};
