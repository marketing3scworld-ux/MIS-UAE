-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "eidDigits" TEXT,
ADD COLUMN     "residenceLocation" TEXT;

-- CreateIndex
CREATE INDEX "Staff_eidDigits_idx" ON "Staff"("eidDigits");
