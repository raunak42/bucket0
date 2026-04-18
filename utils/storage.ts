import type { StorageConnection } from "@/app/generated/prisma/client";
import { prisma } from "@/utils/prisma";
import {
  decryptStorageSecret,
  encryptStorageSecret,
} from "@/utils/storage-credentials";

export const MANAGED_ROOT = "managed";
export const SIMPLE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024; // 8 MiB

export type StorageConnectionWithCredentials = StorageConnection & {
  accessKeyId: string | null;
  secretAccessKey: string | null;
};

export type PublicStorageConnection = {
  id: string;
  name: string;
  type: StorageConnection["type"];
  provider: StorageConnection["provider"];
  bucketName: string;
  region: string | null;
  endpoint: string | null;
  rootPrefix: string;
  isDefault: boolean;
  reconnectRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function stripSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function joinKeySegments(...segments: Array<string | null | undefined>) {
  return segments
    .map((segment) => stripSlashes(segment ?? ""))
    .filter(Boolean)
    .join("/");
}

export function normalizeFolderPath(folderPath?: string | null) {
  if (!folderPath) return "";

  return stripSlashes(folderPath.replace(/\\/g, "/"));
}

export function normalizeFileName(fileName: string) {
  const baseName = fileName
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  return stripSlashes(baseName ?? fileName);
}

export function getObjectNameFromKey(key: string) {
  return key.split("/").filter(Boolean).pop() ?? key;
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
  return joinKeySegments(
    rootPrefix,
    MANAGED_ROOT,
    ownerId,
    normalizeFolderPath(folderPath),
    normalizeFileName(fileName),
  );
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
  return joinKeySegments(
    rootPrefix,
    MANAGED_ROOT,
    ownerId,
    normalizeFolderPath(folderPath),
  );
}

export function buildConnectionObjectKey({
  connection,
  ownerId,
  folderPath,
  fileName,
}: {
  connection: Pick<StorageConnection, "type" | "rootPrefix">;
  ownerId: string;
  folderPath?: string | null;
  fileName: string;
}) {
  if (connection.type === "managed") {
    return buildManagedObjectKey({
      ownerId,
      rootPrefix: connection.rootPrefix,
      folderPath,
      fileName,
    });
  }

  return joinKeySegments(
    connection.rootPrefix,
    normalizeFolderPath(folderPath),
    normalizeFileName(fileName),
  );
}

export function buildConnectionFolderKey({
  connection,
  ownerId,
  folderPath,
}: {
  connection: Pick<StorageConnection, "type" | "rootPrefix">;
  ownerId: string;
  folderPath?: string | null;
}) {
  if (connection.type === "managed") {
    return buildFolderKey({
      ownerId,
      rootPrefix: connection.rootPrefix,
      folderPath,
    });
  }

  return joinKeySegments(connection.rootPrefix, normalizeFolderPath(folderPath));
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

export async function listUserStorageConnections(ownerId: string) {
  const managedConnection = await getOrCreateManagedConnection(ownerId);
  const externalConnections = await prisma.storageConnection.findMany({
    where: {
      ownerId,
      type: "external",
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return [managedConnection, ...externalConnections];
}

export async function getStorageConnectionForUser(
  ownerId: string,
  connectionId?: string | null,
) {
  const managedConnection = await getOrCreateManagedConnection(ownerId);

  if (!connectionId || connectionId === managedConnection.id) {
    return managedConnection;
  }

  const connection = await prisma.storageConnection.findFirst({
    where: {
      id: connectionId,
      ownerId,
    },
  });

  if (!connection) {
    throw new Error("Storage connection not found");
  }

  return connection;
}

export async function getStorageConnectionWithCredentialsForUser(
  ownerId: string,
  connectionId?: string | null,
): Promise<StorageConnectionWithCredentials> {
  const connection = await getStorageConnectionForUser(ownerId, connectionId);

  if (connection.type === "managed") {
    return {
      ...connection,
      accessKeyId: null,
      secretAccessKey: null,
    };
  }

  if (connection.credentialsClientEncrypted) {
    throw new Error(
      "This bucket still uses the local-keys flow. Reconnect it to switch back to the server-backed flow.",
    );
  }

  if (!connection.accessKeyEnc || !connection.secretKeyEnc) {
    throw new Error("Storage connection credentials are incomplete");
  }

  return {
    ...connection,
    accessKeyId: decryptStorageSecret(connection.accessKeyEnc),
    secretAccessKey: decryptStorageSecret(connection.secretKeyEnc),
  };
}

export function encryptConnectionCredentials({
  accessKeyId,
  secretAccessKey,
}: {
  accessKeyId: string;
  secretAccessKey: string;
}) {
  return {
    accessKeyEnc: encryptStorageSecret(accessKeyId),
    secretKeyEnc: encryptStorageSecret(secretAccessKey),
  };
}

export function getManagedBucketDetails() {
  return getManagedBucketConfig();
}

export function toPublicStorageConnection(
  connection: Pick<
    StorageConnection,
    | "id"
    | "name"
    | "type"
    | "provider"
    | "bucketName"
    | "region"
    | "endpoint"
    | "rootPrefix"
    | "isDefault"
    | "credentialsClientEncrypted"
    | "createdAt"
    | "updatedAt"
  >,
): PublicStorageConnection {
  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    provider: connection.provider,
    bucketName: connection.bucketName,
    region: connection.region,
    endpoint: connection.endpoint,
    rootPrefix: connection.rootPrefix,
    isDefault: connection.isDefault,
    reconnectRequired: connection.credentialsClientEncrypted,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}
