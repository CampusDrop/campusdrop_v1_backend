-- AlterTable
ALTER TABLE "matching_friend_talk_rsvps"
  ADD COLUMN "monday_outcome" TEXT,
  ADD COLUMN "monday_outcome_sent_at" TIMESTAMP(3);
