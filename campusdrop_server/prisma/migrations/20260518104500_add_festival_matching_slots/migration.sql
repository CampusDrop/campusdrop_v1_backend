-- 축제 14시/17시 회차 분리 및 정원 카운트용 날짜·슬롯 컬럼
ALTER TABLE "festival_configs" ADD COLUMN "slot1_match_hour" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "festival_configs" ADD COLUMN "slot2_match_hour" INTEGER NOT NULL DEFAULT 17;

ALTER TABLE "festival_applications" ADD COLUMN "matching_slot" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "festival_applications" ADD COLUMN "applied_local_date" DATE;

UPDATE "festival_applications"
SET "applied_local_date" = (created_at AT TIME ZONE 'Asia/Seoul')::date
WHERE "applied_local_date" IS NULL;

ALTER TABLE "festival_applications" ALTER COLUMN "applied_local_date" SET NOT NULL;

CREATE INDEX "festival_applications_slot_day_idx" ON "festival_applications" ("gender","status","matching_slot","applied_local_date");
