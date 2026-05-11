-- CreateTable
CREATE TABLE "friend_talk_rsvp_links" (
    "code" TEXT NOT NULL,
    "matching_id" UUID,
    "identity_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friend_talk_rsvp_links_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "friend_talk_rsvp_links_expires_at_idx" ON "friend_talk_rsvp_links"("expires_at");

CREATE INDEX "friend_talk_rsvp_links_matching_id_idx" ON "friend_talk_rsvp_links"("matching_id");
