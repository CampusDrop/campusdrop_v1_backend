-- 친구 소그룹 참석 마감·확정 안내 스케줄
ALTER TABLE "friend_group_matchings" ADD COLUMN IF NOT EXISTS "attendance_due_at" TIMESTAMP(3);
ALTER TABLE "friend_group_matchings" ADD COLUMN IF NOT EXISTS "attendance_resolved_at" TIMESTAMP(3);
ALTER TABLE "friend_group_matchings" ADD COLUMN IF NOT EXISTS "match_success_scheduled_send_at" TIMESTAMP(3);
