-- NOC document slot.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'NOC';

-- Admin override of the document-derived Active/Inactive status (NULL = follow documents).
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "statusOverride" "EmploymentStatus";
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "statusNote" TEXT;

-- The venue's printed timesheet number for a shift.
ALTER TABLE "Deployment" ADD COLUMN IF NOT EXISTS "timesheetNo" INTEGER;
