-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('SCHEDULED', 'DEPLOYED', 'TIMESHEET_SUBMITTED', 'TIMESHEET_VERIFIED', 'APPROVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" INTEGER NOT NULL,
    "location" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "shift" TEXT,
    "duty" TEXT,
    "category" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "actualIn" TIMESTAMP(3),
    "actualOut" TIMESTAMP(3),
    "actualBreakMinutes" INTEGER,
    "noShow" BOOLEAN NOT NULL DEFAULT false,
    "replacementStaffId" INTEGER,
    "notes" TEXT,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentAudit" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftOption" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShiftOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_clientId_name_key" ON "Project"("clientId", "name");

-- CreateIndex
CREATE INDEX "Deployment_eventDate_idx" ON "Deployment"("eventDate");

-- CreateIndex
CREATE INDEX "Deployment_staffId_eventDate_idx" ON "Deployment"("staffId", "eventDate");

-- CreateIndex
CREATE INDEX "Deployment_projectId_eventDate_idx" ON "Deployment"("projectId", "eventDate");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE INDEX "DeploymentAudit_deploymentId_at_idx" ON "DeploymentAudit"("deploymentId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftOption_value_key" ON "ShiftOption"("value");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_replacementStaffId_fkey" FOREIGN KEY ("replacementStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentAudit" ADD CONSTRAINT "DeploymentAudit_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentAudit" ADD CONSTRAINT "DeploymentAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Double-booking guard, enforced by the database ──────────────────────────
-- The server action checks for overlaps before inserting, but two Operations
-- users scheduling the same person at the same moment would both pass that check
-- and both insert. An exclusion constraint makes the overlap impossible at the
-- storage layer, so the race cannot produce bad data no matter what the app does.
--
-- btree_gist is required to mix an equality test (staffId) with a range overlap
-- test in one GiST index. It is a trusted extension on PostgreSQL 13+, so a plain
-- database owner can install it without superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Deployment"
  ADD CONSTRAINT "Deployment_no_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("status" <> 'CANCELLED');

-- Seed the shift list so the scheduling form has something to offer on day one.
INSERT INTO "ShiftOption" ("value", "startTime", "endTime", "sortOrder") VALUES
  ('MORNING',   '06:00', '14:00', 0),
  ('AFTERNOON', '14:00', '22:00', 1),
  ('NIGHT',     '22:00', '06:00', 2),
  ('DAY',       '09:00', '18:00', 3),
  ('SPLIT',     NULL,    NULL,    4)
ON CONFLICT ("value") DO NOTHING;
