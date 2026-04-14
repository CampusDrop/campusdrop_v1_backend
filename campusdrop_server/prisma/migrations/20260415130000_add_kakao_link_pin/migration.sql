-- AlterTable
ALTER TABLE "identities" ADD COLUMN "kakao_link_pin" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "identities_kakao_link_pin_key" ON "identities"("kakao_link_pin");
