-- CreateEnum
CREATE TYPE "StorageConnectionType" AS ENUM ('managed', 'external');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('internal', 's3');

-- CreateTable
CREATE TABLE "StorageConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StorageConnectionType" NOT NULL,
    "provider" "StorageProvider" NOT NULL,
    "bucketName" TEXT NOT NULL,
    "region" TEXT,
    "endpoint" TEXT,
    "rootPrefix" TEXT NOT NULL DEFAULT '',
    "accessKeyEnc" TEXT,
    "secretKeyEnc" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageConnection_ownerId_idx" ON "StorageConnection"("ownerId");
