ALTER TABLE "StorageConnection"
ADD COLUMN "credentialSalt" TEXT,
ADD COLUMN "credentialsClientEncrypted" BOOLEAN NOT NULL DEFAULT false;
