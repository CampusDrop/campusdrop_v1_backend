/**
 * DB `meeting_time` 원문에서 알림 삽입용 시간 조각 추출 — 예: "이번 주 금요일 오후 6시" → "오후 6시"
 * @param {string | null | undefined} meetingTimeRaw
 * @returns {string | null}
 */
function extractTimeSnippetForReminder(meetingTimeRaw) {
  const s = typeof meetingTimeRaw === 'string' ? meetingTimeRaw.trim() : '';
  if (!s) {
    return null;
  }
  const m = s.match(/오전\s*\d{1,2}시|오후\s*\d{1,2}시/);
  if (m) {
    return m[0].replace(/\s+/g, ' ').trim();
  }
  return s;
}

/**
 * 장소 문자열 마지막 토큰 — 예: "세종대 후문 커피니" → "커피니"
 * @param {string | null | undefined} meetingPlaceRaw
 * @returns {string | null}
 */
function extractPlaceSnippetForReminder(meetingPlaceRaw) {
  const s = typeof meetingPlaceRaw === 'string' ? meetingPlaceRaw.trim() : '';
  if (!s) {
    return null;
  }
  const parts = s.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * 카카오 나에게 보내기용 만남 후기 확인 문구
 * @param {{ meetingTime?: string | null, meetingPlace?: string | null }} row
 */
function buildMeetingFeedbackKakaoReminder(row) {
  const timeFallback = String(process.env.DEFAULT_MEETING_TIME || '').trim().slice(0, 500);
  const placeFallback = String(process.env.DEFAULT_MEETING_PLACE || '').trim().slice(0, 500);

  const timePart =
    extractTimeSnippetForReminder(row?.meetingTime) ||
    extractTimeSnippetForReminder(timeFallback) ||
    '오후 6시';
  const placePart =
    extractPlaceSnippetForReminder(row?.meetingPlace) ||
    extractPlaceSnippetForReminder(placeFallback) ||
    '만남 장소';

  return `오늘 ${timePart} [${placePart}] 만남 어떠셌나요?`;
}

module.exports = {
  extractTimeSnippetForReminder,
  extractPlaceSnippetForReminder,
  buildMeetingFeedbackKakaoReminder,
};
