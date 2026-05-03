-- AlterTable
ALTER TABLE "matchings" ADD COLUMN "meeting_starts_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "matchings" ADD COLUMN "meeting_venue_name" TEXT;

-- CreateIndex
CREATE INDEX "matchings_meeting_starts_at_idx" ON "matchings"("meeting_starts_at");

-- CreateTable
CREATE TABLE "meeting_chat_messages" (
    "id" UUID NOT NULL,
    "matching_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_chat_messages_matching_id_created_at_idx" ON "meeting_chat_messages"("matching_id", "created_at");

-- AddForeignKey
ALTER TABLE "meeting_chat_messages" ADD CONSTRAINT "meeting_chat_messages_matching_id_fkey" FOREIGN KEY ("matching_id") REFERENCES "matchings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_chat_messages" ADD CONSTRAINT "meeting_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
