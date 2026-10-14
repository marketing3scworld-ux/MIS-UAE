-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DATA_ENTRY', 'OPERATIONS', 'HR_ADMIN', 'FINANCE', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('EID_FRONT', 'EID_BACK', 'PASSPORT', 'OHC', 'BFHC', 'BANK_PROOF');

-- CreateEnum
CREATE TYPE "DocHandlingStatus" AS ENUM ('WITH_EMPLOYEE', 'WITH_HR', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('VALID', 'EXPIRING_SOON', 'EXPIRED', 'MISSING');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_SYSTEM', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationState" AS ENUM ('UNVIEWED', 'VIEWED', 'RESOLVED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'DATA_ENTRY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isOperationsHead" BOOLEAN NOT NULL DEFAULT false,
    "managerId" INTEGER,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "category" TEXT,
    "location" TEXT,
    "nationality" TEXT,
    "mobileNumber" TEXT,
    "eidNumber" TEXT NOT NULL,
    "eidExpiry" TIMESTAMP(3),
    "ohcExpiry" TIMESTAMP(3),
    "bfhcExpiry" TIMESTAMP(3),
    "passportNumber" TEXT,
    "passportExpiry" TIMESTAMP(3),
    "gender" "Gender",
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "bankAccountTitle" TEXT,
    "iban" TEXT,
    "bankName" TEXT,
    "handledById" INTEGER,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDocument" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "handlingStatus" "DocHandlingStatus" NOT NULL DEFAULT 'WITH_EMPLOYEE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "docStatus" "DocStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_SYSTEM',
    "state" "NotificationState" NOT NULL DEFAULT 'UNVIEWED',
    "cycleCount" INTEGER NOT NULL DEFAULT 1,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "lastNotifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryOption" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategoryOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationOption" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LocationOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NationalityOption" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NationalityOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankOption" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BankOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_eidNumber_key" ON "Staff"("eidNumber");

-- CreateIndex
CREATE INDEX "Staff_employmentStatus_idx" ON "Staff"("employmentStatus");

-- CreateIndex
CREATE INDEX "Staff_category_idx" ON "Staff"("category");

-- CreateIndex
CREATE INDEX "Staff_location_idx" ON "Staff"("location");

-- CreateIndex
CREATE INDEX "Staff_mobileNumber_idx" ON "Staff"("mobileNumber");

-- CreateIndex
CREATE INDEX "Staff_fullName_idx" ON "Staff"("fullName");

-- CreateIndex
CREATE INDEX "StaffDocument_staffId_type_isCurrent_idx" ON "StaffDocument"("staffId", "type", "isCurrent");

-- CreateIndex
CREATE INDEX "Notification_recipientId_state_idx" ON "Notification"("recipientId", "state");

-- CreateIndex
CREATE INDEX "Notification_staffId_documentType_idx" ON "Notification"("staffId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryOption_value_key" ON "CategoryOption"("value");

-- CreateIndex
CREATE UNIQUE INDEX "LocationOption_value_key" ON "LocationOption"("value");

-- CreateIndex
CREATE UNIQUE INDEX "NationalityOption_value_key" ON "NationalityOption"("value");

-- CreateIndex
CREATE UNIQUE INDEX "BankOption_value_key" ON "BankOption"("value");

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
