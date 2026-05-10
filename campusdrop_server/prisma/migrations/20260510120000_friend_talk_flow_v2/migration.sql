-- AlterTable
ALTER TABLE "identities" ADD COLUMN "acquisition_source" TEXT;

-- AlterTable
ALTER TABLE "matchings" ADD COLUMN "feedback_friend_talk_sent_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "matching_meeting_feedbacks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matching_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "choice" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matching_meeting_feedbacks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "matching_meeting_feedbacks_matching_id_identity_id_key" ON "matching_meeting_feedbacks"("matching_id", "identity_id");

CREATE INDEX "matching_meeting_feedbacks_matching_id_idx" ON "matching_meeting_feedbacks"("matching_id");

ALTER TABLE "matching_meeting_feedbacks" ADD CONSTRAINT "matching_meeting_feedbacks_matching_id_fkey" FOREIGN KEY ("matching_id") REFERENCES "matchings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "matching_meeting_feedbacks" ADD CONSTRAINT "matching_meeting_feedbacks_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
