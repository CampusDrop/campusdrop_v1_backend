-- 친구 소그룹: 참석 RSVP·초대 발송 시각·전날 리마인드(6번) 일시
ALTER TABLE "friend_group_members" ADD COLUMN IF NOT EXISTS "attendance_rsvp" TEXT;
ALTER TABLE "friend_group_members" ADD COLUMN IF NOT EXISTS "attendance_invite_sent_at" TIMESTAMP(3);

ALTER TABLE "friend_group_matchings" ADD COLUMN IF NOT EXISTS "day_eve_reminder_sent_at" TIMESTAMP(3);
