-- CreateEnum
CREATE TYPE "MedicationKind" AS ENUM ('medication', 'supplement');

-- AlterTable
ALTER TABLE "medications" ADD COLUMN "kind" "MedicationKind" NOT NULL DEFAULT 'medication';

-- AlterTable
ALTER TABLE "symptom_notes" ADD COLUMN "mood" INTEGER,
ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "symptom_notes_person_profile_id_kind_started_at_idx" ON "symptom_notes"("person_profile_id", "kind", "started_at");
