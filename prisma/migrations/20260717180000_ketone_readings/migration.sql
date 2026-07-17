-- CreateEnum
CREATE TYPE "KetoneUnit" AS ENUM ('mmol_L', 'mg_dL');

-- CreateEnum
CREATE TYPE "KetoneContext" AS ENUM ('fasting', 'random', 'illness', 'exercise', 'other');

-- AlterEnum
ALTER TYPE "HealthMetricType" ADD VALUE 'ketone';

-- CreateTable
CREATE TABLE "ketone_readings" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "unit" "KetoneUnit" NOT NULL DEFAULT 'mmol_L',
    "context" "KetoneContext" NOT NULL DEFAULT 'random',
    "taken_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ketone_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ketone_readings_person_profile_id_taken_at_idx" ON "ketone_readings"("person_profile_id", "taken_at");

-- AddForeignKey
ALTER TABLE "ketone_readings" ADD CONSTRAINT "ketone_readings_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ketone_readings" ADD CONSTRAINT "ketone_readings_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ketone_readings" ADD CONSTRAINT "ketone_readings_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
