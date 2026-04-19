import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import { getStorageConnectionWithCredentialsForUser } from "@/utils/storage";
import { createManagedS3Client, createS3Client } from "@/utils/s3";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export async function getAuthenticatedUploadUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user?.id) {
    return null;
  }

  return {
    userId: session.user.id,
  };
}

export async function getStorageContextForConnection({
  userId,
  connectionId,
}: {
  userId: string;
  connectionId?: string | null;
}) {
  const connection = await getStorageConnectionWithCredentialsForUser(
    userId,
    connectionId,
  );

  return {
    userId,
    connection,
    bucketName: connection.bucketName,
    s3Client:
      connection.type === "managed"
        ? createManagedS3Client()
        : createS3Client({
            provider: connection.provider,
            region: connection.region,
            endpoint: connection.endpoint,
            accessKeyId: connection.accessKeyId,
            secretAccessKey: connection.secretAccessKey,
          }),
  };
}

export async function getStorageContextForUploadId({
  userId,
  uploadId,
}: {
  userId: string;
  uploadId: string;
}) {
  const uploadSession = await prisma.uploadSession.findFirst({
    where: {
      ownerId: userId,
      uploadId,
    },
  });

  if (!uploadSession) {
    return null;
  }

  const context = await getStorageContextForConnection({
    userId,
    connectionId: uploadSession.connectionId,
  });

  return {
    ...context,
    uploadSession,
  };
}

export async function getUploadRequestBody(
  request: Request,
  options?: { buffer?: boolean },
) {
  if (!request.body) {
    throw new Error("Missing upload body");
  }

  if (options?.buffer) {
    return Buffer.from(await request.arrayBuffer());
  }

  return Readable.fromWeb(
    request.body as NodeReadableStream<Uint8Array>,
  );
}

export function getRequestContentLength(request: Request) {
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return undefined;
  }

  const parsed = Number.parseInt(rawContentLength, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

export function getExpectedUploadPartSize({
  totalSize,
  partSize,
  partNumber,
}: {
  totalSize: number;
  partSize: number;
  partNumber: number;
}) {
  const start = (partNumber - 1) * partSize;

  if (start >= totalSize) {
    return null;
  }

  const end = Math.min(start + partSize, totalSize);
  return end - start;
}
