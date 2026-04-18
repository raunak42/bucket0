import { prisma } from "@/utils/prisma";
import { createManagedS3Client, createS3Client } from "@/utils/s3";
import { auth } from "@/utils/auth";
import { getStorageConnectionWithCredentialsForUser } from "@/utils/storage";

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
