ALTER TABLE "identities"
ADD COLUMN "nickname" TEXT;

CREATE UNIQUE INDEX "identities_nickname_key" ON "identities"("nickname");
