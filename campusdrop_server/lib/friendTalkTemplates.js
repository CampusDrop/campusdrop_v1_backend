/** 친구톡(알림·RSVP·후속) 문구 */

exports.WAITLIST_AND_QUEUE_TEXT = `✅ 대기열 등록이 완료되었습니다

매칭 성공 시, 월요일 오후 6시에 이 채팅방을 통해 전달해 드릴 예정입니다. 두근거리는 마음으로 조금만 기다려 주세요! 😊`;

exports.FIRST_SURVEY_ACQUISITION_TAIL = `앗, 기다리시는 동안 딱 한 가지만 여쭤봐도 될까요? 👀
캠퍼스 드랍을 어떻게 알고 찾아오셨는지 아래 버튼을 눌러 알려주시면, 더 좋은 서비스를 만드는 데 아주 큰 도움이 됩니다! 👇`;

/** 관리자·match-complete: 7번(참석 확인) */
exports.MATCH_COMPLETE_INTRO_TEXT = `[Campus Drop] 매칭 완료 및 참석 확인 🎉

안녕하세요! 
기다리시던 이번 주 매칭이 드디어 성사되었습니다! 
두 분의 설레는 만남을 위해 일정을 먼저 안내해 드립니다.

📍 일시: #{미팅일시}
📍 장소: #{미팅장소}

아래 버튼을 눌러 참석 여부를 확정해 주세요. 양측 모두 수락하시면 매칭이 '최종 확정'됩니다.

⚠️ 노쇼(No-show) 방지 안내
참석을 확정하신 후 일방적으로 만남을 취소하시거나 당일 나타나지 않으실 경우, 향후 서비스 이용이 영구적으로 제한될 수 있습니다. 신중하게 일정을 확인해 주세요! 😊`;

exports.buildMatchCompleteText = function buildMatchCompleteText(meetingTime, meetingPlace) {
  return exports.MATCH_COMPLETE_INTRO_TEXT.replace('#{미팅일시}', meetingTime).replace(
    '#{미팅장소}',
    meetingPlace,
  );
};

/** 7번 RSVP — 양쪽 수락 후속 (1-1) */
exports.MATCH_MONDAY_BOTH_CONFIRMED_TEXT = `🎉 최종 매칭이 확정되었습니다 🎉

두 분 모두 참석을 수락하셔서 매칭이 최종 확정되었습니다! 
약속 일정에 맞춰 늦지 않게 장소에 도착해 주세요. 좋은 인연을 만들어가시길 진심으로 응원합니다! 💘`;

/** 7번 RSVP — 내가 수락, 상대 거절 시 수락자에게 (1-2) */
exports.MATCH_MONDAY_ACCEPTOR_PARTNER_DECLINED_TEXT = `[Campus Drop] 매칭 취소 안내 😢

안녕하세요, 아쉬운 소식을 전해드려요.
회원님은 참석을 수락해 주셨지만, 아쉽게도 상대방의 부득이한 사정으로 인해 이번 매칭이 취소되었습니다. 

설레는 마음으로 기다려주셨을 텐데 정말 죄송합니다. 다음 매칭에서는 꼭 더 좋은 인연을 찾아드릴 수 있도록 최선을 다하겠습니다! 💪`;

/** 7번 RSVP — 거절한 당사자 또는 양쪽 거절 시 (1-3 등) */
exports.MATCH_MONDAY_SELF_DECLINE_ACK_TEXT = `✅ 매칭 거절 응답이 접수되었습니다.

아쉽지만 이번 만남은 취소 처리되었습니다.
다음 주에는 일정이 맞으실 때 꼭 다시 참여해 주세요! 더 꼭 맞는 인연을 준비해 두고 있겠습니다. 😊`;

/** 배치 실패(미매칭) 일괄 안내 */
exports.NO_MATCH_THIS_WEEK_TEXT = `Campus Drop을 이용해 주셔서 감사합니다 💌

▶ 매칭 결과 안내
아쉽게도 이번 주에는 꼭 맞는 인연을 찾지 못했어요 😢

▶ 매칭 TIP
🕛만남이 가능한 시간대를 더 많이 선택해 주시면 매칭 성공률이 올라가요.

▶ 다음 주 매칭 안내
Campus Drop은 더 잘 맞는 인연을 연결해 드리기 위해 매주 새로운 매칭을 진행하고 있어요.
아쉬움은 미뤄두고, 다음 주 매칭에 참여해 보세요 🔥`;

/**
 * 6번 — 매칭 전날(버튼 없음)
 * `#{미팅일시}` / `#{미팅장소}` 치환은 buildMatchDayEveReminderText 참고.
 */
exports.MATCH_DAY_EVE_REMINDER_TEXT = `[Campus Drop] 내일은 기다리던 매칭 날이에요. 두근두근 😎

📍 일시: #{미팅일시}
📍 장소: #{미팅장소}

상대방도 설레는 마음으로 내일 만남을 기대하고 있어요!
즐거운 시간을 위해 약속 시간에 늦지 않게 도착해 주시는 센스, 잊지 않으셨죠? ✨ 

(⚠️ 혹시 피치 못할 사정으로 내일 참석이 불가능해졌다면, 상대방이 헛걸음하지 않도록 즉시 채팅을 통해 꼭! 알려주세요.)`;

exports.buildMatchDayEveReminderText = function buildMatchDayEveReminderText(params) {
  const meetingTime = (params?.meetingTime ?? '').trim();
  const meetingPlace = (params?.meetingPlace ?? '').trim();
  const tpl = exports.MATCH_DAY_EVE_REMINDER_TEXT;
  if (meetingTime && meetingPlace) {
    return tpl.replace('#{미팅일시}', meetingTime).replace('#{미팅장소}', meetingPlace);
  }
  return tpl
    .replace(/\n📍 일시: #\{미팅일시\}\n📍 장소: #\{미팅장소\}\n/, '\n')
    .replace(/\n{3,}/g, '\n\n');
};

/** 만남 당일 후기(4단계) — `#{미팅장소}` 치환 */
exports.MEETING_DAY_FEEDBACK_TEXT = `[Campus Drop] 오늘 만남은 어떠셨나요? 👀

오늘 #{미팅장소}에서의 만남은 즐거우셨나요? 
채팅방 안에서 아래 버튼을 눌러 오늘의 후기를 1초 만에 남겨주세요!

남겨주신 소중한 피드백은 회원님의 취향을 정교하게 파악하여, 다음 번에 '더 꼭 맞는 인연'을 매칭하는 데 가장 중요한 기준으로 반영됩니다. 💘

👇 오늘 만남, 어떠셨나요? (하나만 선택해 주세요)`;

exports.buildMeetingDayFeedbackText = function buildMeetingDayFeedbackText(meetingPlaceRaw) {
  const place = (meetingPlaceRaw ?? '').trim() || '만남 장소';
  return exports.MEETING_DAY_FEEDBACK_TEXT.replace('#{미팅장소}', place);
};
