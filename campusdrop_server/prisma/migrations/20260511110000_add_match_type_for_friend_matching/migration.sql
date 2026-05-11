ALTER TABLE "matchings"
ADD COLUMN "match_type" TEXT NOT NULL DEFAULT 'ROMANCE';

ALTER TABLE "weekly_survey_submissions"
ADD COLUMN "match_type" TEXT NOT NULL DEFAULT 'ROMANCE';

DROP INDEX IF EXISTS "weekly_survey_submissions_identity_id_target_period_start_key";
DROP INDEX IF EXISTS "weekly_survey_submissions_target_period_start_submitted_at_idx";

CREATE UNIQUE INDEX "weekly_survey_submissions_identity_id_match_type_target_period_start_key"
ON "weekly_survey_submissions"("identity_id", "match_type", "target_period_start");

CREATE INDEX "weekly_survey_submissions_match_type_target_period_start_submitted_at_idx"
ON "weekly_survey_submissions"("match_type", "target_period_start", "submitted_at");

CREATE INDEX "matchings_match_type_period_start_idx"
ON "matchings"("match_type", "period_start");
