/** 친구톡(알림·RSVP 후속)에서 공통으로 쓰는 짧은 문구 */

exports.PARTNER_DECLINED_TEXT = `✅️ 보내주신 응답 확인했습니다.

하지만...상대분께서 내일 방문이 어려울 거 같다고 연락을 주셨어요 😭

매칭 실패에 심심한 사과의 말씀을 드립니다.

앞으로도 더 나은 서비스와 경험을 제공해드리기 위해 노력하겠습니다.`;

exports.PARTNER_CONFIRMED_TEXT = `✅️ 보내주신 응답 확인했습니다.

상대분도 내일 매칭에 참여 가능하시다고 수신해 주셨습니다 😃

만약 매칭 전에라도 사정상 만남이 어려우시다면 채팅으로 전달해주세요.`;

/** 7번(월요 일정 안내) 응답 — 둘 다 참여 가능 */
exports.MATCH_MONDAY_CONFIRMED_TEXT = '🎉 최종 매칭이 확정되었습니다. 🎉';

/** 7번 응답 — 그 외(한쪽 불가·둘 다 불가) */
exports.MATCH_MONDAY_CANCELLED_TEXT =
  '💔 상대방의 거절로 매칭이 취소되었습니다 💔';

/**
 * 6번 — 매칭 전날(노쇼 방지) 안내 본문 템플릿.
 * `#{미팅일시}` / `#{미팅장소}`가 있으면 sendDayEveReminderForMatching에서 DB 값으로 치환되어 발송됩니다.
 * 두 값 중 하나라도 없으면 일시·장소 라인이 통째로 제거됩니다(레거시 본문과 동일).
 */
exports.MATCH_DAY_EVE_REMINDER_TEXT = `[Campus Drop 보냄]

내일은 기다리던 매칭 날이에요. 두근두근 😎

📍 일시: #{미팅일시}
📍 장소: #{미팅장소}

Campus Drop은 당일 노쇼 방지를 위해 매칭 하루 전, 사용자 분들께 내일 매칭에 참여하실 수 있는지 여쭤보고 있어요.

만남을 주선한 Campus Drop과 매칭된 상대분을 위해, 내일 만남에 참여하실 수 있는지 알려주세요.

혹시 내일 만남이 어려우시다면, 채팅을 통해 전달해주세요.`;

/**
 * MATCH_DAY_EVE_REMINDER_TEXT의 `#{미팅일시}` · `#{미팅장소}` 치환.
 * 두 값이 모두 있으면 그대로 채워 넣고, 하나라도 비어 있으면 해당 라인을 통째로 제거(빈 줄 정리 포함).
 *
 * @param {{ meetingTime?: string | null, meetingPlace?: string | null }} [params]
 * @returns {string}
 */
exports.buildMatchDayEveReminderText = function buildMatchDayEveReminderText(params) {
  const meetingTime = (params?.meetingTime ?? '').trim();
  const meetingPlace = (params?.meetingPlace ?? '').trim();
  const tpl = exports.MATCH_DAY_EVE_REMINDER_TEXT;
  if (meetingTime && meetingPlace) {
    return tpl.replace('#{미팅일시}', meetingTime).replace('#{미팅장소}', meetingPlace);
  }
  // 일시·장소 라인을 통째로 제거 + 인접 빈 줄 정리.
  return tpl
    .replace(/\n📍 일시: #\{미팅일시\}\n📍 장소: #\{미팅장소\}\n/, '\n')
    .replace(/\n{3,}/g, '\n\n');
};
