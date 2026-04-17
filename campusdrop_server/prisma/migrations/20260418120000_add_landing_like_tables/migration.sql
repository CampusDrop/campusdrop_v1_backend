-- CreateTable
CREATE TABLE "landing_like_counters" (
    "key" TEXT NOT NULL,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_like_counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "landing_like_client_toggles" (
    "client_key" UUID NOT NULL,
    "liked" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_like_client_toggles_pkey" PRIMARY KEY ("client_key")
);

INSERT INTO "landing_like_counters" ("key", "like_count", "updated_at")
VALUES ('default', 0, CURRENT_TIMESTAMP);
