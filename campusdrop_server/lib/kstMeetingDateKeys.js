'use strict';

/** @param {Date} meetingStartsAt */
function meetingDateKeyKst(meetingStartsAt) {
  return new Date(meetingStartsAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/**
 * 서울 달력 기준 오늘으로부터 **다음 날부터 연속 6일** YYYY-MM-DD (설문 만남 선택지 화~일 6일과 동일한 폭).
 * 매주 월요일 16:00 크론에서 오늘이 월요일이면 화~일을 가리킨다.
 *
 * @param {Date} [referenceNow]
 * @returns {string[]}
 */
function kstSixMeetingOfferDaysAfterToday(referenceNow = new Date()) {
  const today = referenceNow.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const [y, m, d] = today.split('-').map(Number);
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  /** @type {string[]} */
  const keys = [];
  for (let i = 1; i <= 6; i += 1) {
    keys.push(new Date(noonUtc + i * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
  }
  return keys;
}

/**
 * DB 범위 쿼리용: 위 날짜 키들이 커버하는 meetingStartsAt 구간 [min, max] UTC.
 *
 * @param {Iterable<string>} dateKeysYmd
 */
function utcBoundsForKstDateKeys(dateKeysYmd) {
  const keys = [...dateKeysYmd].sort();
  if (keys.length === 0) {
    return { rangeStart: null, rangeEnd: null };
  }
  const rangeStart = new Date(`${keys[0]}T00:00:00+09:00`);
  const rangeEnd = new Date(`${keys[keys.length - 1]}T23:59:59.999+09:00`);
  return { rangeStart, rangeEnd };
}

module.exports = {
  meetingDateKeyKst,
  kstSixMeetingOfferDaysAfterToday,
  utcBoundsForKstDateKeys,
};
