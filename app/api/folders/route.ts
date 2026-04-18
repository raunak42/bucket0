import { prisma } from "@/utils/prisma";
import {
  buildConnectionFolderKey,
  buildConnectionObjectKey,
  normalizeFileName,
  normalizeFolderPath,
} from "@/utils/storage";
import {
  createS3ClientForConnection,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@/utils/s3";
import { z } from "zod";
import {
  getAuthenticatedUploadUser,
  getStorageContextForConnection,
} from "../uploads/_shared";

export const runtime = "nodejs";

const createFolderSchema = z.object({
  connectionId: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required")
    .max(255, "Folder name is too long")
    .refine((value) => !value.includes("/") && !value.includes("\\"), {
      message: "Folder name cannot contain slashes",
    })
    .refine((value) => value !== "." && value !== "..", {
      message: "Folder name is invalid",
    }),
  path: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUploadUser(request);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = createFolderSchema.parse(await request.json());
    const context = await getStorageContextForConnection({
      userId: user.userId,
      connectionId: body.connectionId,
    });
    const parentPath = normalizeFolderPath(body.path);
    const folderName = normalizeFileName(body.name);
    const fullPath = parentPath ? `${parentPath}/${folderName}` : folderName;

    if (context.connection.type === "managed") {
      const key = `${buildConnectionFolderKey({
        connection: context.connection,
        ownerId: context.userId,
        folderPath: fullPath,
      })}/`;

      const existingObject = await prisma.driveObject.findFirst({
        where: {
          ownerId: context.userId,
          connectionId: context.connection.id,
          OR: [
            { path: parentPath, name: folderName },
            { path: fullPath },
            { path: { startsWith: `${fullPath}/` } },
          ],
        },
      });

      if (existingObject) {
        return Response.json(
          { error: "An item with that folder name already exists" },
          { status: 409 },
        );
      }

      const folder = await prisma.driveObject.create({
        data: {
          ownerId: context.userId,
          connectionId: context.connection.id,
          key,
          name: folderName,
          type: "folder",
          mimeType: null,
          size: BigInt(0),
          path: parentPath,
        },
      });

      return Response.json({
        ok: true,
        folder: {
          id: folder.id,
          name: folder.name,
          path: folder.path,
          fullPath,
        },
      });
    }

    const client = createS3ClientForConnection(context.connection);
    const fileKey = buildConnectionObjectKey({
      connection: context.connection,
      ownerId: context.userId,
      folderPath: parentPath,
      fileName: folderName,
    });
    const folderKey = buildConnectionFolderKey({
      connection: context.connection,
      ownerId: context.userId,
      folderPath: fullPath,
    });
    const folderMarkerKey = `${folderKey}/`;

    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: context.bucketName,
          Key: fileKey,
        }),
      );

      return Response.json(
        { error: "An item with that folder name already exists" },
        { status: 409 },
      );
    } catch {
      // Ignore not found.
    }

    const existingFolder = await client.send(
      new ListObjectsV2Command({
        Bucket: context.bucketName,
        Prefix: folderMarkerKey,
        MaxKeys: 1,
      }),
    );

    if ((existingFolder.KeyCount ?? 0) > 0) {
      return Response.json(
        { error: "An item with that folder name already exists" },
        { status: 409 },
      );
    }

    await client.send(
      new PutObjectCommand({
        Bucket: context.bucketName,
        Key: folderMarkerKey,
        Body: "",
      }),
    );

    return Response.json({
      ok: true,
      folder: {
        id: `folder:${context.connection.id}:${fullPath}`,
        name: folderName,
        path: parentPath,
        fullPath,
      },
    });
  } catch (error) {
    console.error("folders route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create folder" },
      { status: 500 },
    );
  }
}
