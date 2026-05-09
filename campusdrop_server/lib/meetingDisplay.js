'use strict';

const { prisma } = require('./prisma');

const KST_DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 카카오톡 친구톡 본문에 들어가는 KST 일시 포맷.
 * 예: 2026-05-15T05:00:00Z → "2026년 5월 15일 (금) 오후 2시"
 *
 * @param {Date | string | number | null | undefined} input UTC 인스턴스
 * @returns {string | null}
 */
function formatMeetingStartsAtKst(input) {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;

  // KST = UTC+9 (no DST). 오프셋을 더해 UTC 메서드로 KST 벽시계 값을 읽는다.
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const dow = KST_DAY_KO[kst.getUTCDay()];
  const h24 = kst.getUTCHours();

  const period = h24 < 12 ? '오전' : '오후';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;

  return `${y}년 ${m}월 ${day}일 (${dow}) ${period} ${h12}시`;
}

/**
 * 매칭 ID로 친구톡에 보낼 일시·장소 문자열을 만든다.
 *
 * - `meetingTime`: KST 포맷 문자열 (`meetingStartsAt` 기반).
 * - `meetingPlace`: `cafe.name`이 있으면 그것, 없으면 `meetingVenueName` 스냅샷.
 * - 매칭이 없으면 null.
 *
 * @param {string} matchingId
 * @returns {Promise<{ meetingTime: string | null, meetingPlace: string | null, found: boolean }>}
 */
async function resolveMatchMeetingDisplay(matchingId) {
  const row = await prisma.matching.findUnique({
    where: { id: matchingId },
    select: {
      id: true,
      meetingStartsAt: true,
      meetingVenueName: true,
      cafe: { select: { name: true } },
    },
  });
  if (!row) {
    return { meetingTime: null, meetingPlace: null, found: false };
  }
  const meetingTime = formatMeetingStartsAtKst(row.meetingStartsAt);
  const meetingPlace = row.cafe?.name?.trim() || row.meetingVenueName?.trim() || null;
  return { meetingTime, meetingPlace, found: true };
}

module.exports = {
  formatMeetingStartsAtKst,
  resolveMatchMeetingDisplay,
};
