-- CreateTable
CREATE TABLE "admin_batch_match_runs" (
    "id" UUID NOT NULL,
    "match_type" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "pair_count" INTEGER NOT NULL DEFAULT 0,
    "eligible_count" INTEGER NOT NULL DEFAULT 0,
    "batch_traits_count" INTEGER NOT NULL DEFAULT 0,
    "skip_reason" TEXT,
    "error_message" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "metadata" JSONB,

    CONSTRAINT "admin_batch_match_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_runtime_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_admin_id" UUID,

    CONSTRAINT "admin_runtime_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "admin_batch_match_runs_match_type_started_at_idx" ON "admin_batch_match_runs"("match_type", "started_at" DESC);

-- CreateIndex
CREATE INDEX "admin_batch_match_runs_period_start_match_type_idx" ON "admin_batch_match_runs"("period_start", "match_type");
