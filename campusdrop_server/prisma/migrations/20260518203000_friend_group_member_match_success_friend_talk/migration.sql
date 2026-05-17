-- 친구 소그룹 매칭 성공 친구톡(월요일 크론) 멤버별 중복 방지
ALTER TABLE "friend_group_members" ADD COLUMN IF NOT EXISTS "match_success_friend_talk_sent_at" TIMESTAMP(3);
