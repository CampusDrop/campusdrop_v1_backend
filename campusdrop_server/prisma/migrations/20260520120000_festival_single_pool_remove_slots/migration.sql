-- 단일 일자 풀: 회차(슬롯) 및 round completion 제거

DROP TABLE IF EXISTS "festival_match_round_completions";

DROP INDEX IF EXISTS "festival_applications_slot_day_idx";

ALTER TABLE "festival_applications" DROP COLUMN IF EXISTS "matching_slot";

CREATE INDEX IF NOT EXISTS "festival_applications_gender_status_day_idx" ON "festival_applications" ("gender", "status", "applied_local_date");
