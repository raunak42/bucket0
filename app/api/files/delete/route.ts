import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/utils/prisma";
import { normalizeFolderPath } from "@/utils/storage";
import { z } from "zod";
import { getManagedUploadContext } from "../../uploads/_shared";

export const runtime = "nodejs";

const deleteSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    id: z.string().min(1),
  }),
  z.object({
    type: z.literal("folder"),
    fullPath: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  try {
    const context = await getManagedUploadContext(request);

    if (!context) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = deleteSchema.parse(await request.json());

    if (body.type === "file") {
      const object = await prisma.driveObject.findFirst({
        where: {
          id: body.id,
          ownerId: context.userId,
          connectionId: context.managedConnection.id,
          type: "file",
        },
      });

      if (!object) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      await context.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: context.bucketName,
          Delete: {
            Objects: [{ Key: object.key }],
            Quiet: true,
          },
        }),
      );

      await prisma.driveObject.delete({ where: { id: object.id } });

      return Response.json({ ok: true });
    }

    const fullPath = normalizeFolderPath(body.fullPath);
    if (!fullPath) {
      return Response.json({ error: "Cannot delete root folder" }, { status: 400 });
    }

    const segments = fullPath.split("/").filter(Boolean);
    const folderName = segments.at(-1);
    const parentPath = segments.slice(0, -1).join("/");

    if (!folderName) {
      return Response.json({ error: "Invalid folder path" }, { status: 400 });
    }

    const objects = await prisma.driveObject.findMany({
      where: {
        ownerId: context.userId,
        connectionId: context.managedConnection.id,
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

    if (keys.length > 0) {
      for (let index = 0; index < keys.length; index += 1000) {
        const chunk = keys.slice(index, index + 1000);

        await context.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: context.bucketName,
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
  } catch (error) {
    console.error("file delete route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete item" },
      { status: 500 },
    );
  }
}
