import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const S3_SIGNED_URL_TTL_SECONDS = 15 * 60;

export function createManagedS3Client() {
  const region = process.env.S3_REGION ?? process.env.AWS_REGION;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region) {
    throw new Error("Missing S3 region");
  }

  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: Boolean(endpoint),
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  });
}

export async function signPutObjectUploadUrl({
  bucket,
  key,
  contentType,
}: {
  bucket: string;
  key: string;
  contentType: string;
}) {
  const client = createManagedS3Client();

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
  bucket,
  key,
  uploadId,
  partNumber,
}: {
  bucket: string;
  key: string;
  uploadId: string;
  partNumber: number;
}) {
  const client = createManagedS3Client();

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
  bucket,
  key,
  fileName,
  contentDisposition = "inline",
}: {
  bucket: string;
  key: string;
  fileName?: string;
  contentDisposition?: "inline" | "attachment";
}) {
  const client = createManagedS3Client();

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
  HeadObjectCommand,
};
