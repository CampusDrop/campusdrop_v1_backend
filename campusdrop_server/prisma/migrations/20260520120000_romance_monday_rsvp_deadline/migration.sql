-- 로맨스 7번 RSVP: 초대 당일 KST 23:00 마감, 결과 친구톡 20:30 분기·익일 08:01 예약
ALTER TABLE "matching_friend_talk_rsvps"
ADD COLUMN "monday_rsvp_due_at" TIMESTAMP(3),
ADD COLUMN "monday_outcome_scheduled_send_at" TIMESTAMP(3);

CREATE INDEX "matching_friend_talk_rsvps_monday_outcome_scheduled_send_at_idx"
ON "matching_friend_talk_rsvps"("monday_outcome_scheduled_send_at");
