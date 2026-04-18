import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const S3_SIGNED_URL_TTL_SECONDS = 15 * 60;

type S3Provider = "internal" | "s3" | "r2" | "wasabi";

export type S3ConnectionConfig = {
  provider: S3Provider;
  region: string | null;
  endpoint?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
};

function getResolvedConfig(config: S3ConnectionConfig) {
  if (config.provider === "r2") {
    const endpoint = config.endpoint?.trim();

    if (!endpoint) {
      throw new Error("Cloudflare R2 requires an endpoint");
    }

    return {
      region: config.region?.trim() || "auto",
      endpoint,
      forcePathStyle: true,
    };
  }

  if (config.provider === "wasabi") {
    const region = config.region?.trim();

    if (!region) {
      throw new Error("Wasabi requires a region");
    }

    return {
      region,
      endpoint: config.endpoint?.trim() || `https://s3.${region}.wasabisys.com`,
      forcePathStyle: true,
    };
  }

  const region = config.region?.trim();

  if (!region) {
    throw new Error("Missing S3 region");
  }

  const endpoint = config.endpoint?.trim();

  return {
    region,
    endpoint,
    forcePathStyle: Boolean(endpoint),
  };
}

export function createS3Client(config: S3ConnectionConfig) {
  const resolved = getResolvedConfig(config);

  return new S3Client({
    region: resolved.region,
    endpoint: resolved.endpoint || undefined,
    forcePathStyle: resolved.forcePathStyle,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
  });
}

export function createManagedS3Client() {
  return createS3Client({
    provider: "s3",
    region: process.env.S3_REGION ?? process.env.AWS_REGION ?? null,
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
}

export function createS3ClientForConnection(connection: {
  type: "managed" | "external";
  provider: S3Provider;
  region: string | null;
  endpoint: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
}) {
  if (connection.type === "managed") {
    return createManagedS3Client();
  }

  return createS3Client({
    provider: connection.provider,
    region: connection.region,
    endpoint: connection.endpoint,
    accessKeyId: connection.accessKeyId,
    secretAccessKey: connection.secretAccessKey,
  });
}

export async function signPutObjectUploadUrl({
  client = createManagedS3Client(),
  bucket,
  key,
  contentType,
}: {
  client?: S3Client;
  bucket: string;
  key: string;
  contentType: string;
}) {
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: S3_SIGNED_URL_TTL_SECONDS },
  );
}

export async function signMultipartPartUrl({
  client = createManagedS3Client(),
  bucket,
  key,
  uploadId,
  partNumber,
}: {
  client?: S3Client;
  bucket: string;
  key: string;
  uploadId: string;
  partNumber: number;
}) {
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: S3_SIGNED_URL_TTL_SECONDS },
  );
}

export async function signGetObjectUrl({
  client = createManagedS3Client(),
  bucket,
  key,
  fileName,
  contentDisposition = "inline",
}: {
  client?: S3Client;
  bucket: string;
  key: string;
  fileName?: string;
  contentDisposition?: "inline" | "attachment";
}) {
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: fileName
        ? `${contentDisposition}; filename="${fileName.replace(/"/g, "")}"`
        : contentDisposition,
    }),
    { expiresIn: S3_SIGNED_URL_TTL_SECONDS },
  );
}

export {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
};
