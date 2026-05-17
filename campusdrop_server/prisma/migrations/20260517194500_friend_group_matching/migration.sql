-- CreateTable
CREATE TABLE "friend_group_matchings" (
    "id" UUID NOT NULL,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_start" TIMESTAMP(3) NOT NULL,
    "meeting_starts_at" TIMESTAMP(3),
    "meeting_venue_name" TEXT,
    "cafe_id" UUID,
    "match_decision" JSONB NOT NULL,

    CONSTRAINT "friend_group_matchings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friend_group_members" (
    "friend_group_matching_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "friend_group_members_pkey" PRIMARY KEY ("friend_group_matching_id","identity_id")
);

-- CreateIndex
CREATE INDEX "friend_group_matchings_period_start_idx" ON "friend_group_matchings"("period_start");

-- CreateIndex
CREATE INDEX "friend_group_matchings_matched_at_idx" ON "friend_group_matchings"("matched_at");

-- CreateIndex
CREATE INDEX "friend_group_matchings_meeting_starts_at_idx" ON "friend_group_matchings"("meeting_starts_at");

-- CreateIndex
CREATE INDEX "friend_group_matchings_cafe_id_idx" ON "friend_group_matchings"("cafe_id");

-- CreateIndex
CREATE INDEX "friend_group_members_identity_id_idx" ON "friend_group_members"("identity_id");

-- AddForeignKey
ALTER TABLE "friend_group_matchings" ADD CONSTRAINT "friend_group_matchings_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_group_members" ADD CONSTRAINT "friend_group_members_friend_group_matching_id_fkey" FOREIGN KEY ("friend_group_matching_id") REFERENCES "friend_group_matchings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_group_members" ADD CONSTRAINT "friend_group_members_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
