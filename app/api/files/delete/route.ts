import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import {
  createS3ClientForConnection,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@/utils/s3";
import {
  buildConnectionFolderKey,
  getStorageConnectionWithCredentialsForUser,
  normalizeFolderPath,
} from "@/utils/storage";
import { z } from "zod";

export const runtime = "nodejs";

const deleteSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    id: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
  }).refine((value) => Boolean(value.id || (value.key && value.connectionId)), {
    message: "File delete requires either id or connectionId + key",
  }),
  z.object({
    type: z.literal("folder"),
    fullPath: z.string().min(1),
    connectionId: z.string().min(1).optional(),
  }),
]);

async function deleteExternalFolder({
  userId,
  connection,
  fullPath,
}: {
  userId: string;
  connection: Awaited<ReturnType<typeof getStorageConnectionWithCredentialsForUser>>;
  fullPath: string;
}) {
  const client = createS3ClientForConnection(connection);
  const folderKey = buildConnectionFolderKey({
    connection,
    ownerId: userId,
    folderPath: fullPath,
  });
  const prefix = folderKey ? `${folderKey}/` : undefined;
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: connection.bucketName,
        Prefix: prefix,
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

  if (keys.length === 0) {
    return { ok: false as const, status: 404, error: "Folder not found" };
  }

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

  return { ok: true as const, deletedCount: keys.length };
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = deleteSchema.parse(await request.json());

    if (body.type === "file") {
      if (body.id) {
        const object = await prisma.driveObject.findFirst({
          where: {
            id: body.id,
            ownerId: session.user.id,
            type: "file",
          },
        });

        if (!object) {
          return Response.json({ error: "File not found" }, { status: 404 });
        }

        const connection = await getStorageConnectionWithCredentialsForUser(
          session.user.id,
          object.connectionId,
        );
        const client = createS3ClientForConnection(connection);

        await client.send(
          new DeleteObjectsCommand({
            Bucket: connection.bucketName,
            Delete: {
              Objects: [{ Key: object.key }],
              Quiet: true,
            },
          }),
        );

        await prisma.driveObject.delete({ where: { id: object.id } });

        return Response.json({ ok: true });
      }

      const connection = await getStorageConnectionWithCredentialsForUser(
        session.user.id,
        body.connectionId,
      );
      const client = createS3ClientForConnection(connection);

      await client.send(
        new DeleteObjectsCommand({
          Bucket: connection.bucketName,
          Delete: {
            Objects: [{ Key: body.key! }],
            Quiet: true,
          },
        }),
      );

      return Response.json({ ok: true });
    }

    const fullPath = normalizeFolderPath(body.fullPath);
    if (!fullPath) {
      return Response.json({ error: "Cannot delete root folder" }, { status: 400 });
    }

    const targetConnection = await getStorageConnectionWithCredentialsForUser(
      session.user.id,
      body.connectionId,
    );

    if (targetConnection.type === "managed") {
      const segments = fullPath.split("/").filter(Boolean);
      const folderName = segments.at(-1);
      const parentPath = segments.slice(0, -1).join("/");

      if (!folderName) {
        return Response.json({ error: "Invalid folder path" }, { status: 400 });
      }

      const objects = await prisma.driveObject.findMany({
        where: {
          ownerId: session.user.id,
          connectionId: targetConnection.id,
          OR: [
            {
              type: "folder",
              path: parentPath,
              name: folderName,
            },
            { path: fullPath },
            { path: { startsWith: `${fullPath}/` } },
          ],
        },
      });

      if (objects.length === 0) {
        return Response.json({ error: "Folder not found" }, { status: 404 });
      }

      const keys = [...new Set(objects.map((object) => object.key).filter(Boolean))];
      const client = createS3ClientForConnection(targetConnection);

      if (keys.length > 0) {
        for (let index = 0; index < keys.length; index += 1000) {
          const chunk = keys.slice(index, index + 1000);

          await client.send(
            new DeleteObjectsCommand({
              Bucket: targetConnection.bucketName,
              Delete: {
                Objects: chunk.map((key) => ({ Key: key })),
                Quiet: true,
              },
            }),
          );
        }
      }

      await prisma.driveObject.deleteMany({
        where: {
          id: { in: objects.map((object) => object.id) },
        },
      });

      return Response.json({ ok: true, deletedCount: objects.length });
    }

    const result = await deleteExternalFolder({
      userId: session.user.id,
      connection: targetConnection,
      fullPath,
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error("file delete route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete item" },
      { status: 500 },
    );
  }
}
