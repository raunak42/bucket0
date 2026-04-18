ALTER TABLE "StorageConnection"
ADD COLUMN "credentialUnlockMode" TEXT NOT NULL DEFAULT 'passphrase';
