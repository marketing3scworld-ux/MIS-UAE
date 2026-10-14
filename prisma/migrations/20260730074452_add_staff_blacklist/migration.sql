-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "blacklistReason" TEXT,
ADD COLUMN     "blacklisted" BOOLEAN NOT NULL DEFAULT false;
