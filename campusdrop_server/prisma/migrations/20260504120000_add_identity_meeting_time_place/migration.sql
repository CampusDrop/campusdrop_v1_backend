-- 만남 일정·장소(카카오 리마인드 문구 변수용)
ALTER TABLE "identities" ADD COLUMN IF NOT EXISTS "meeting_time" TEXT;
ALTER TABLE "identities" ADD COLUMN IF NOT EXISTS "meeting_place" TEXT;
