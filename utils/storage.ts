import { prisma } from "@/utils/prisma";

export const MANAGED_ROOT = "managed";
export const SIMPLE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024; // 8 MiB

function stripSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

export function normalizeFolderPath(folderPath?: string | null) {
  if (!folderPath) return "";

  return stripSlashes(folderPath.replace(/\\/g, "/"));
}

export function normalizeFileName(fileName: string) {
  const baseName = fileName.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return stripSlashes(baseName ?? fileName);
}

export function buildManagedObjectKey({
  ownerId,
  rootPrefix = "",
  folderPath,
  fileName,
}: {
  ownerId: string;
  rootPrefix?: string | null;
  folderPath?: string | null;
  fileName: string;
}) {
  const segments = [
    stripSlashes(rootPrefix ?? ""),
    MANAGED_ROOT,
    ownerId,
    normalizeFolderPath(folderPath),
    normalizeFileName(fileName),
  ].filter(Boolean);

  return segments.join("/");
}

export function buildFolderKey({
  ownerId,
  rootPrefix = "",
  folderPath,
}: {
  ownerId: string;
  rootPrefix?: string | null;
  folderPath?: string | null;
}) {
  const segments = [
    stripSlashes(rootPrefix ?? ""),
    MANAGED_ROOT,
    ownerId,
    normalizeFolderPath(folderPath),
  ].filter(Boolean);

  return segments.join("/");
}

function getManagedBucketConfig() {
  const bucketName = process.env.S3_BUCKET_NAME;
  const region = process.env.S3_REGION ?? process.env.AWS_REGION;
  const endpoint = process.env.S3_ENDPOINT;

  if (!bucketName) {
    throw new Error("Missing S3_BUCKET_NAME");
  }

  if (!region) {
    throw new Error("Missing S3_REGION or AWS_REGION");
  }

  return { bucketName, region, endpoint };
}

export async function getOrCreateManagedConnection(ownerId: string) {
  const bucket = getManagedBucketConfig();

  const existingConnection = await prisma.storageConnection.findFirst({
    where: {
      ownerId,
      type: "managed",
    },
  });

  if (existingConnection) {
    return existingConnection;
  }

  return prisma.storageConnection.create({
    data: {
      ownerId,
      name: "My Drive",
      type: "managed",
      provider: "s3",
      bucketName: bucket.bucketName,
      region: bucket.region,
      endpoint: bucket.endpoint ?? null,
      rootPrefix: "",
      isDefault: true,
    },
  });
}

export function getManagedBucketDetails() {
  return getManagedBucketConfig();
}
