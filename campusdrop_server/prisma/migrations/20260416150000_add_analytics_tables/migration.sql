-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_uuid" UUID,
    "app" TEXT NOT NULL,
    "release" TEXT,
    "client_ts" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "event_ts" TIMESTAMP(3) NOT NULL,
    "props" JSONB,
    "client_event_id" UUID,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_session_heartbeats" (
    "session_id" UUID NOT NULL,
    "user_uuid" UUID,
    "last_meaningful_activity_at" TIMESTAMP(3) NOT NULL,
    "visibility" TEXT,
    "context" JSONB,
    "client_ts" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_session_heartbeats_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "analytics_interactions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_uuid" UUID,
    "type" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "x_norm" DOUBLE PRECISION NOT NULL,
    "y_norm" DOUBLE PRECISION NOT NULL,
    "nearest_region" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_session_user_links" (
    "session_id" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_session_user_links_pkey" PRIMARY KEY ("session_id")
);

-- CreateIndex
CREATE INDEX "analytics_events_session_id_received_at_idx" ON "analytics_events"("session_id", "received_at");

-- CreateIndex
CREATE INDEX "analytics_events_app_event_ts_idx" ON "analytics_events"("app", "event_ts");

-- CreateIndex
CREATE INDEX "analytics_events_received_at_idx" ON "analytics_events"("received_at");

-- CreateIndex
CREATE INDEX "analytics_session_heartbeats_last_meaningful_activity_at_idx" ON "analytics_session_heartbeats"("last_meaningful_activity_at");

-- CreateIndex
CREATE INDEX "analytics_interactions_session_id_ts_idx" ON "analytics_interactions"("session_id", "ts");

-- CreateIndex
CREATE INDEX "analytics_interactions_type_received_at_idx" ON "analytics_interactions"("type", "received_at");

-- CreateIndex
CREATE INDEX "analytics_session_user_links_user_uuid_idx" ON "analytics_session_user_links"("user_uuid");
