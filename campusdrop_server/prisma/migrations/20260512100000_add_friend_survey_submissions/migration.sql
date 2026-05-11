-- 친구 매칭용 취미 설문(메인·세부 택1). 주차는 weekly_survey_submissions 와 동일한 target_period_* 로 정렬합니다.

CREATE TABLE "friend_survey_submissions" (
    "id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "target_period_start" TIMESTAMP(3) NOT NULL,
    "target_period_end" TIMESTAMP(3) NOT NULL,
    "main_category" INTEGER NOT NULL,
    "detail_choice" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friend_survey_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "friend_survey_submissions_identity_id_target_period_start_key"
ON "friend_survey_submissions"("identity_id", "target_period_start");

CREATE INDEX "friend_survey_submissions_identity_id_submitted_at_idx"
ON "friend_survey_submissions"("identity_id", "submitted_at");

ALTER TABLE "friend_survey_submissions"
ADD CONSTRAINT "friend_survey_submissions_identity_id_fkey"
FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
