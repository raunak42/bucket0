ALTER TABLE "StorageConnection"
DROP COLUMN IF EXISTS "credentialSalt",
DROP COLUMN IF EXISTS "credentialUnlockMode";
