-- 축제: festival_users 및 user_id 제거, (phone, applied_local_date) 유니크

DELETE FROM "festival_applications" AS a
USING "festival_applications" AS b
WHERE a.id > b.id
  AND a.phone = b.phone
  AND a.applied_local_date = b.applied_local_date;

ALTER TABLE "festival_applications" DROP CONSTRAINT IF EXISTS "festival_applications_user_id_fkey";

ALTER TABLE "festival_applications" DROP COLUMN IF EXISTS "user_id";

DROP TABLE IF EXISTS "festival_users";

CREATE UNIQUE INDEX "festival_applications_phone_applied_local_date_key"
  ON "festival_applications"("phone", "applied_local_date");
