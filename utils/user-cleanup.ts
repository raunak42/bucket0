import { prisma } from "@/utils/prisma";
import {
  AbortMultipartUploadCommand,
  createManagedS3Client,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@/utils/s3";
import { buildFolderKey } from "@/utils/storage";

async function deleteManagedS3ObjectsForUser(ownerId: string) {
  const managedConnections = await prisma.storageConnection.findMany({
    where: {
      ownerId,
      type: "managed",
    },
  });

  if (managedConnections.length === 0) {
    return;
  }

  const client = createManagedS3Client();

  for (const connection of managedConnections) {
    const uploadSessions = await prisma.uploadSession.findMany({
      where: {
        ownerId,
        connectionId: connection.id,
      },
    });

    for (const session of uploadSessions) {
      if (session.partSize <= 0) {
        continue;
      }

      try {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: connection.bucketName,
            Key: session.key,
            UploadId: session.uploadId,
          }),
        );
      } catch (error) {
        console.error("managed multipart abort cleanup error", error);
      }
    }

    const managedPrefix = buildFolderKey({
      ownerId,
      rootPrefix: connection.rootPrefix,
      folderPath: "",
    });

    let continuationToken: string | undefined;
    const keys: string[] = [];

    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: connection.bucketName,
          Prefix: managedPrefix ? `${managedPrefix}/` : undefined,
          ContinuationToken: continuationToken,
        }),
      );

      for (const object of page.Contents ?? []) {
        if (object.Key) {
          keys.push(object.Key);
        }
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    for (let index = 0; index < keys.length; index += 1000) {
      const chunk = keys.slice(index, index + 1000);

      await client.send(
        new DeleteObjectsCommand({
          Bucket: connection.bucketName,
          Delete: {
            Objects: chunk.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
    }
  }
}

export async function deleteUserAndManagedStorage(userId: string) {
  await deleteManagedS3ObjectsForUser(userId);

  await prisma.user.delete({
    where: {
      id: userId,
    },
  });
}
