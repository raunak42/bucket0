-- CreateEnum
CREATE TYPE "DriveObjectType" AS ENUM ('file', 'folder');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('initiated', 'uploading', 'completed', 'aborted');

-- CreateTable
CREATE TABLE "DriveObject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DriveObjectType" NOT NULL,
    "mimeType" TEXT,
    "size" BIGINT NOT NULL DEFAULT 0,
    "etag" TEXT,
    "path" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "partSize" INTEGER NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'initiated',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriveObject_ownerId_idx" ON "DriveObject"("ownerId");

-- CreateIndex
CREATE INDEX "DriveObject_connectionId_idx" ON "DriveObject"("connectionId");

-- CreateIndex
CREATE INDEX "DriveObject_connectionId_key_idx" ON "DriveObject"("connectionId", "key");

-- CreateIndex
CREATE INDEX "DriveObject_ownerId_path_idx" ON "DriveObject"("ownerId", "path");

-- CreateIndex
CREATE INDEX "UploadSession_ownerId_idx" ON "UploadSession"("ownerId");

-- CreateIndex
CREATE INDEX "UploadSession_connectionId_idx" ON "UploadSession"("connectionId");

-- CreateIndex
CREATE INDEX "UploadSession_uploadId_idx" ON "UploadSession"("uploadId");

-- CreateIndex
CREATE INDEX "UploadSession_ownerId_status_idx" ON "UploadSession"("ownerId", "status");
