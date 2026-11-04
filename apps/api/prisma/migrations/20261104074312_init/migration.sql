-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'FINANCE', 'VIEWER');

-- CreateEnum
CREATE TYPE "BriefingStatus" AS ENUM ('DRAFT', 'FAILED', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commission_rate" DECIMAL(8,6) NOT NULL,
    "tech_fee_rate" DECIMAL(8,6) NOT NULL,
    "payment_fee_rate" DECIMAL(8,6) NOT NULL,
    "insurance_rate" DECIMAL(8,6) NOT NULL,
    "settlement_days" INTEGER NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_rate" DECIMAL(8,6),
    "terms" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "spec" TEXT,
    "list_price" DECIMAL(14,2),
    "supplier_id" TEXT,
    "launch_month" TEXT,
    "status" TEXT,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "base_salary" DECIMAL(14,2) NOT NULL,
    "allowance" DECIMAL(14,2) NOT NULL,
    "deduction" DECIMAL(14,2) NOT NULL,
    "basis" TEXT,
    "store_ids" TEXT[],
    "commission_share" DECIMAL(8,6),
    "joined_at" DATE,
    "active" BOOLEAN,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "OpeningInventory" (
    "tenantId" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "OpeningInventory_pkey" PRIMARY KEY ("tenantId","sku_id")
);

-- CreateTable
CREATE TABLE "Order" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "order_date" DATE NOT NULL,
    "status" TEXT,
    "paid_amount" DECIMAL(14,2) NOT NULL,
    "refund_amount" DECIMAL(14,2) NOT NULL,
    "refund_date" DATE,
    "ship_date" DATE,
    "carrier" TEXT,
    "province" TEXT,
    "returned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "pk" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "refund_amount" DECIMAL(14,2) NOT NULL,
    "refund_qty" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "carrier" TEXT,
    "province" TEXT,
    "weight_kg" DECIMAL(10,3),
    "base_fee" DECIMAL(14,2) NOT NULL,
    "overweight_fee" DECIMAL(14,2) NOT NULL,
    "surcharge" DECIMAL(14,2) NOT NULL,
    "return_fee" DECIMAL(14,2) NOT NULL,
    "shipped_at" DATE,
    "returned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT,
    "invoice_no" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "pk" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "PlatformBill" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "gmv" DECIMAL(14,2) NOT NULL,
    "refund_amount" DECIMAL(14,2) NOT NULL,
    "commission" DECIMAL(14,2) NOT NULL,
    "tech_service_fee" DECIMAL(14,2) NOT NULL,
    "payment_fee" DECIMAL(14,2) NOT NULL,
    "promotion_fee" DECIMAL(14,2) NOT NULL,
    "freight_insurance" DECIMAL(14,2) NOT NULL,
    "subsidy" DECIMAL(14,2) NOT NULL,
    "other_deduction" DECIMAL(14,2) NOT NULL,
    "settled_amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT,
    "payout_date" DATE,
    "note" TEXT,

    CONSTRAINT "PlatformBill_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "bill_id" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bank_ref" TEXT,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "store_id" TEXT,
    "vendor" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "invoice_no" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "number" TEXT,
    "date" DATE NOT NULL,
    "seller" TEXT,
    "buyer" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "related_type" TEXT,
    "related_id" TEXT,
    "note" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "written" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "errors" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Briefing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "BriefingStatus" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "facts" JSONB NOT NULL,
    "draft" JSONB,
    "unverified" TEXT[],
    "promptVersion" TEXT NOT NULL,
    "modelProvider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelIsMock" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "approvedVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Briefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefingVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "briefingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "refId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL,
    "attempt" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costCny" DECIMAL(12,4),
    "errorKind" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "briefingId" TEXT,
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recipients" TEXT[],
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "externalId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_username_key" ON "User"("tenantId", "username");

-- CreateIndex
CREATE INDEX "ExternalIdentity_tenantId_userId_idx" ON "ExternalIdentity"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_tenantId_provider_externalUserId_key" ON "ExternalIdentity"("tenantId", "provider", "externalUserId");

-- CreateIndex
CREATE INDEX "Order_tenantId_store_id_order_date_idx" ON "Order"("tenantId", "store_id", "order_date");

-- CreateIndex
CREATE INDEX "OrderItem_tenantId_order_id_idx" ON "OrderItem"("tenantId", "order_id");

-- CreateIndex
CREATE INDEX "Shipment_tenantId_order_id_idx" ON "Shipment"("tenantId", "order_id");

-- CreateIndex
CREATE INDEX "PurchaseItem_tenantId_po_id_idx" ON "PurchaseItem"("tenantId", "po_id");

-- CreateIndex
CREATE INDEX "ImportBatch_tenantId_createdAt_idx" ON "ImportBatch"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Briefing_tenantId_month_idx" ON "Briefing"("tenantId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingVersion_briefingId_version_key" ON "BriefingVersion"("briefingId", "version");

-- CreateIndex
CREATE INDEX "AiCall_tenantId_createdAt_idx" ON "AiCall"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_idempotencyKey_key" ON "NotificationDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_tenantId_createdAt_idx" ON "NotificationDelivery"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingVersion" ADD CONSTRAINT "BriefingVersion_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "Briefing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "Briefing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
