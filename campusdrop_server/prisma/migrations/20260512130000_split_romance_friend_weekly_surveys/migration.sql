-- 로맨스 주간 설문: match_type 제거(FRIEND 행 삭제 후). 친구 주간 테이블 신설. Trait에 friend 설문 컬럼. 레거시 friend_survey_submissions 드롭.

DELETE FROM "weekly_survey_submissions" WHERE "match_type" = 'FRIEND';

DROP INDEX IF EXISTS "weekly_survey_submissions_match_type_target_period_start_submitted_at_idx";

ALTER TABLE "weekly_survey_submissions" DROP CONSTRAINT "weekly_survey_submissions_identity_id_match_type_target_period_start_key";

ALTER TABLE "weekly_survey_submissions" DROP COLUMN "match_type";

CREATE UNIQUE INDEX "weekly_survey_submissions_identity_id_target_period_start_key" ON "weekly_survey_submissions"("identity_id", "target_period_start");

ALTER TABLE "traits" ADD COLUMN "friend_survey_data" JSONB;
ALTER TABLE "traits" ADD COLUMN "friend_survey_submitted_at" TIMESTAMP(3);

CREATE TABLE "friend_weekly_survey_submissions" (
    "id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "target_period_start" TIMESTAMP(3) NOT NULL,
    "target_period_end" TIMESTAMP(3) NOT NULL,
    "gender" TEXT,
    "survey_data" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friend_weekly_survey_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "friend_weekly_survey_submissions_identity_id_target_period_start_key" ON "friend_weekly_survey_submissions"("identity_id", "target_period_start");

CREATE INDEX "friend_weekly_survey_submissions_target_period_start_submitted_at_idx" ON "friend_weekly_survey_submissions"("target_period_start", "submitted_at");

ALTER TABLE "friend_weekly_survey_submissions"
ADD CONSTRAINT "friend_weekly_survey_submissions_identity_id_fkey"
FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE IF EXISTS "friend_survey_submissions";
