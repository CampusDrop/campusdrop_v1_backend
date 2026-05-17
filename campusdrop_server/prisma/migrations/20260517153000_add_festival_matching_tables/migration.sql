-- 축제 이벤트 전용 유저·신청·설정(메인 `identities`와 분리)
CREATE TABLE "festival_users" (
    "id" BIGSERIAL NOT NULL,
    "uuid" UUID NOT NULL,
    "kakao_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "festival_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "festival_users_uuid_key" ON "festival_users"("uuid");
CREATE UNIQUE INDEX "festival_users_kakao_id_key" ON "festival_users"("kakao_id");

CREATE TABLE "festival_applications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "reception_id" TEXT NOT NULL,
    "people_count" INTEGER NOT NULL,
    "vibe" TEXT NOT NULL,
    "gender" CHAR(1) NOT NULL,
    "phone" TEXT NOT NULL,
    "instagram" TEXT,
    "contact_preference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "festival_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "festival_applications_user_id_key" ON "festival_applications"("user_id");
CREATE UNIQUE INDEX "festival_applications_reception_id_key" ON "festival_applications"("reception_id");
CREATE INDEX "festival_applications_gender_status_idx" ON "festival_applications"("gender", "status");

ALTER TABLE "festival_applications" ADD CONSTRAINT "festival_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "festival_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "festival_configs" (
    "id" SERIAL NOT NULL,
    "match_target_time" TIMESTAMP(3) NOT NULL,
    "max_capacity_per_gender" INTEGER NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "festival_configs_pkey" PRIMARY KEY ("id")
);

INSERT INTO "festival_configs" ("match_target_time", "max_capacity_per_gender", "is_active", "updated_at")
VALUES ('2099-12-31 15:00:00'::timestamp AT TIME ZONE 'UTC', 50, true, CURRENT_TIMESTAMP);
