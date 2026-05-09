-- 매칭 카페 마스터 테이블
CREATE TABLE "cafes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "naver_place_url" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafes_pkey" PRIMARY KEY ("id")
);

-- 동일 카페 이름 중복 방지
CREATE UNIQUE INDEX "cafes_name_key" ON "cafes"("name");

-- 활성 카페 정렬 조회용
CREATE INDEX "cafes_is_active_display_order_idx" ON "cafes"("is_active", "display_order");

-- matchings.cafe_id FK (SetNull → 카페 삭제 시 매칭 행은 보존, 이름 스냅샷만 남음)
ALTER TABLE "matchings" ADD COLUMN "cafe_id" UUID;

ALTER TABLE "matchings"
  ADD CONSTRAINT "matchings_cafe_id_fkey"
  FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "matchings_cafe_id_idx" ON "matchings"("cafe_id");

-- 초기 카페 시드(제주몰빵, 트레비커피로스터스). 이미 존재하면 건너뜀.
INSERT INTO "cafes" ("id", "name", "naver_place_url", "is_active", "display_order", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), '제주몰빵', 'https://naver.me/GbDneBEr', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '트레비커피로스터스', 'https://naver.me/xxY2b5Iz', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
