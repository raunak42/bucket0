import { auth } from "@/utils/auth";
import { createManagedS3Client } from "@/utils/s3";
import { getOrCreateManagedConnection } from "@/utils/storage";

export async function getManagedUploadContext(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user?.id) {
    return null;
  }

  const managedConnection = await getOrCreateManagedConnection(session.user.id);

  return {
    userId: session.user.id,
    managedConnection,
    bucketName: managedConnection.bucketName,
    s3Client: createManagedS3Client(),
  };
}
