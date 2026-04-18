-- DropIndex
DROP INDEX "DriveObject_connectionId_key_idx";

-- DropIndex
DROP INDEX "UploadSession_uploadId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "DriveObject_connectionId_key_key" ON "DriveObject"("connectionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_uploadId_key" ON "UploadSession"("uploadId");
