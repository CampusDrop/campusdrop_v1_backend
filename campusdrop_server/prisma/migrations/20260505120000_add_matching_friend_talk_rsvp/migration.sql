-- CreateTable
CREATE TABLE "matching_friend_talk_rsvps" (
    "matching_id" UUID NOT NULL,
    "phone_user_a" TEXT NOT NULL,
    "phone_user_b" TEXT NOT NULL,
    "monday_rsvp_user_a" TEXT,
    "monday_rsvp_user_b" TEXT,
    "day_eve_rsvp_user_a" TEXT,
    "day_eve_rsvp_user_b" TEXT,
    "skip_day_eve_reminder" BOOLEAN NOT NULL DEFAULT false,
    "monday_outcome_sent" BOOLEAN NOT NULL DEFAULT false,
    "day_eve_outcome_sent" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matching_friend_talk_rsvps_pkey" PRIMARY KEY ("matching_id")
);

-- AddForeignKey
ALTER TABLE "matching_friend_talk_rsvps" ADD CONSTRAINT "matching_friend_talk_rsvps_matching_id_fkey" FOREIGN KEY ("matching_id") REFERENCES "matchings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
