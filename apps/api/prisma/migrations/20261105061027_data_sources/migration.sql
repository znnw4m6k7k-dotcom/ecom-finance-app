-- AlterTable
ALTER TABLE "ExternalIdentity" ADD COLUMN     "unionId" TEXT;

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "ref" JSONB NOT NULL,
    "tableId" TEXT,
    "mapping" JSONB,
    "mappingBy" JSONB,
    "mappingStatus" TEXT NOT NULL DEFAULT 'draft',
    "mappingConfirmedById" TEXT,
    "mappingConfirmedAt" TIMESTAMP(3),
    "fromTemplate" BOOLEAN NOT NULL DEFAULT false,
    "knowledgeMode" TEXT,
    "syncIntervalMin" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL,
    "read" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "missingAtSource" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRow" (
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "dataSourceId" TEXT,
    "hash" TEXT NOT NULL,
    "deletedAtSource" BOOLEAN NOT NULL DEFAULT false,
    "deletedDetectedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRow_pkey" PRIMARY KEY ("tenantId","tableId","rowKey")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "existingOwner" TEXT,
    "existing" JSONB NOT NULL,
    "incoming" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "url" TEXT,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "content" TEXT,
    "contentChars" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "updatedAtSource" TEXT,
    "deletedAtSource" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataSource_tenantId_kind_idx" ON "DataSource"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "SyncRun_tenantId_dataSourceId_createdAt_idx" ON "SyncRun"("tenantId", "dataSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceRow_tenantId_dataSourceId_idx" ON "SourceRow"("tenantId", "dataSourceId");

-- CreateIndex
CREATE INDEX "SyncConflict_tenantId_status_idx" ON "SyncConflict"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SyncConflict_tenantId_dataSourceId_tableId_rowKey_idx" ON "SyncConflict"("tenantId", "dataSourceId", "tableId", "rowKey");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_tenantId_mode_idx" ON "KnowledgeDoc"("tenantId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDoc_tenantId_dataSourceId_externalId_key" ON "KnowledgeDoc"("tenantId", "dataSourceId", "externalId");
