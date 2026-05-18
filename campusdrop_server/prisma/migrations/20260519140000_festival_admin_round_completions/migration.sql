-- CreateTable
CREATE TABLE "festival_match_round_completions" (
    "id" BIGSERIAL NOT NULL,
    "applied_local_date" DATE NOT NULL,
    "matching_slot" INTEGER NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "festival_match_round_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "festival_match_round_completions_date_slot_key" ON "festival_match_round_completions"("applied_local_date", "matching_slot");
