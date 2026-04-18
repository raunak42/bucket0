import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/utils/prisma";
import { HeadObjectCommand } from "@/utils/s3";
import { z } from "zod";
import {
  getAuthenticatedUploadUser,
  getStorageContextForUploadId,
} from "../_shared";

export const runtime = "nodejs";

const completeSimpleSchema = z.object({
  uploadId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUploadUser(request);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = completeSimpleSchema.parse(await request.json());
    const context = await getStorageContextForUploadId({
      userId: user.userId,
      uploadId: body.uploadId,
    });

    if (!context) {
      return Response.json({ error: "Upload not found" }, { status: 404 });
    }

    const head = await context.s3Client.send(
      new HeadObjectCommand({
        Bucket: context.bucketName,
        Key: context.uploadSession.key,
      }),
    );

    if (context.connection.type === "managed") {
      await prisma.driveObject.create({
        data: {
          ownerId: context.userId,
          connectionId: context.connection.id,
          key: context.uploadSession.key,
          name: context.uploadSession.fileName,
          type: "file",
          mimeType: context.uploadSession.mimeType,
          size: context.uploadSession.size,
          etag: head.ETag ?? null,
          path: context.uploadSession.folderPath,
        },
      });
    }

    await prisma.uploadSession.delete({ where: { id: context.uploadSession.id } });

    return Response.json({
      ok: true,
      key: context.uploadSession.key,
      name: context.uploadSession.fileName,
    });
  } catch (error) {
    console.error("uploads/complete-simple route error", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json(
        { error: "A file with that name already exists in this folder" },
        { status: 409 },
      );
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Complete simple failed" },
      { status: 500 },
    );
  }
}
