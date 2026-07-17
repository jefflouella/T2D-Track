-- CreateEnum
CREATE TYPE "RefillWorkflowStatus" AS ENUM ('none', 'requested', 'ready', 'picked_up', 'cancelled', 'last_refill');

-- CreateEnum
CREATE TYPE "SupplyStatus" AS ENUM ('active', 'archived');

-- AlterEnum
ALTER TYPE "ScheduleType" ADD VALUE 'interval';

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "supply_item_id" TEXT,
ALTER COLUMN "medication_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "medication_schedules" ADD COLUMN     "interval_hours" INTEGER;

-- AlterTable
ALTER TABLE "medications" ADD COLUMN     "hold_until" TIMESTAMP(3),
ADD COLUMN     "refill_workflow_status" "RefillWorkflowStatus" NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enabled_at" TIMESTAMP(3),
ADD COLUMN     "totp_secret" TEXT;

-- CreateTable
CREATE TABLE "supply_items" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stock_unit" TEXT NOT NULL,
    "refill_threshold_days" INTEGER,
    "expected_daily_use" DECIMAL(18,6),
    "status" "SupplyStatus" NOT NULL DEFAULT 'active',
    "current_stock_cache" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "test_name" TEXT NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "taken_at" DATE NOT NULL,
    "laboratory" TEXT,
    "notes" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_catalog_entries" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "synonyms" TEXT[],
    "is_brand" BOOLEAN NOT NULL DEFAULT false,
    "generic_display_name" TEXT,
    "strengths_and_forms" JSONB NOT NULL,
    "source_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drug_catalog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "symptom_notes" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'symptom',
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "symptom_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "device_type" TEXT,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supply_items_person_profile_id_status_idx" ON "supply_items"("person_profile_id", "status");

-- CreateIndex
CREATE INDEX "lab_results_person_profile_id_taken_at_idx" ON "lab_results"("person_profile_id", "taken_at");

-- CreateIndex
CREATE INDEX "drug_catalog_entries_display_name_idx" ON "drug_catalog_entries"("display_name");

-- CreateIndex
CREATE INDEX "symptom_notes_person_profile_id_started_at_idx" ON "symptom_notes"("person_profile_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials"("user_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_supply_item_id_occurred_at_idx" ON "inventory_transactions"("supply_item_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_supply_item_id_fkey" FOREIGN KEY ("supply_item_id") REFERENCES "supply_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_items" ADD CONSTRAINT "supply_items_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symptom_notes" ADD CONSTRAINT "symptom_notes_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symptom_notes" ADD CONSTRAINT "symptom_notes_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
