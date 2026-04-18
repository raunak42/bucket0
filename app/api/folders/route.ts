import { prisma } from "@/utils/prisma";
import { buildFolderKey, normalizeFileName, normalizeFolderPath } from "@/utils/storage";
import { z } from "zod";
import { getManagedUploadContext } from "../uploads/_shared";

export const runtime = "nodejs";

const createFolderSchema = z.object({
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
    const context = await getManagedUploadContext(request);

    if (!context) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = createFolderSchema.parse(await request.json());
    const parentPath = normalizeFolderPath(body.path);
    const folderName = normalizeFileName(body.name);
    const fullPath = parentPath ? `${parentPath}/${folderName}` : folderName;
    const key = `${buildFolderKey({
      ownerId: context.userId,
      rootPrefix: context.managedConnection.rootPrefix,
      folderPath: fullPath,
    })}/`;

    const existingObject = await prisma.driveObject.findFirst({
      where: {
        ownerId: context.userId,
        connectionId: context.managedConnection.id,
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
        connectionId: context.managedConnection.id,
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
  } catch (error) {
    console.error("folders route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create folder" },
      { status: 500 },
    );
  }
}
