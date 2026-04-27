ALTER TABLE "traits" ADD COLUMN "survey_submitted_at" TIMESTAMP(3);

UPDATE "traits"
SET "survey_submitted_at" = "updatedAt"
WHERE "surveyData" IS NOT NULL;

CREATE INDEX "traits_survey_submitted_at_idx" ON "traits"("survey_submitted_at");

CREATE TABLE "weekly_survey_submissions" (
    "id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "target_period_start" TIMESTAMP(3) NOT NULL,
    "target_period_end" TIMESTAMP(3) NOT NULL,
    "gender" TEXT,
    "survey_data" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_survey_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "weekly_survey_submissions_identity_id_target_period_start_key"
ON "weekly_survey_submissions"("identity_id", "target_period_start");

CREATE INDEX "weekly_survey_submissions_target_period_start_submitted_at_idx"
ON "weekly_survey_submissions"("target_period_start", "submitted_at");

ALTER TABLE "weekly_survey_submissions"
ADD CONSTRAINT "weekly_survey_submissions_identity_id_fkey"
FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH source AS (
    SELECT
        "id" AS "identity_id",
        "gender",
        "surveyData" AS "survey_data",
        "survey_submitted_at" AS "submitted_at",
        GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM ("survey_submitted_at" - TIMESTAMP '2026-04-13 15:00:00')) / 604800)
        )::INTEGER AS "application_week_offset"
    FROM "traits"
    WHERE "surveyData" IS NOT NULL
      AND "survey_submitted_at" IS NOT NULL
),
periodized AS (
    SELECT
        "identity_id",
        "gender",
        "survey_data",
        "submitted_at",
        TIMESTAMP '2026-04-13 15:00:00' + ("application_week_offset" + 1) * INTERVAL '7 days' AS "target_period_start"
    FROM source
)
INSERT INTO "weekly_survey_submissions" (
    "id",
    "identity_id",
    "target_period_start",
    "target_period_end",
    "gender",
    "survey_data",
    "submitted_at",
    "created_at",
    "updated_at"
)
SELECT
    (
        SUBSTR(MD5("identity_id"::TEXT || "target_period_start"::TEXT), 1, 8) || '-' ||
        SUBSTR(MD5("identity_id"::TEXT || "target_period_start"::TEXT), 9, 4) || '-' ||
        SUBSTR(MD5("identity_id"::TEXT || "target_period_start"::TEXT), 13, 4) || '-' ||
        SUBSTR(MD5("identity_id"::TEXT || "target_period_start"::TEXT), 17, 4) || '-' ||
        SUBSTR(MD5("identity_id"::TEXT || "target_period_start"::TEXT), 21, 12)
    )::UUID,
    "identity_id",
    "target_period_start",
    "target_period_start" + INTERVAL '7 days',
    "gender",
    "survey_data",
    "submitted_at",
    "submitted_at",
    "submitted_at"
FROM periodized
ON CONFLICT ("identity_id", "target_period_start") DO UPDATE SET
    "gender" = EXCLUDED."gender",
    "survey_data" = EXCLUDED."survey_data",
    "submitted_at" = EXCLUDED."submitted_at",
    "updated_at" = EXCLUDED."updated_at";
