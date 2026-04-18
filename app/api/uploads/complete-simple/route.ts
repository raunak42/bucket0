import { prisma } from "@/utils/prisma";
import { HeadObjectCommand } from "@/utils/s3";
import { z } from "zod";
import { getManagedUploadContext } from "../_shared";

export const runtime = "nodejs";

const completeSimpleSchema = z.object({
  uploadId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const context = await getManagedUploadContext(request);

    if (!context) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = completeSimpleSchema.parse(await request.json());

    const uploadSession = await prisma.uploadSession.findFirst({
      where: {
        ownerId: context.userId,
        uploadId: body.uploadId,
      },
    });

    if (!uploadSession) {
      return Response.json({ error: "Upload not found" }, { status: 404 });
    }

    const head = await context.s3Client.send(
      new HeadObjectCommand({
        Bucket: context.bucketName,
        Key: uploadSession.key,
      }),
    );

    await prisma.driveObject.create({
      data: {
        ownerId: context.userId,
        connectionId: context.managedConnection.id,
        key: uploadSession.key,
        name: uploadSession.fileName,
        type: "file",
        mimeType: uploadSession.mimeType,
        size: uploadSession.size,
        etag: head.ETag ?? null,
        path: uploadSession.folderPath,
      },
    });

    await prisma.uploadSession.delete({ where: { id: uploadSession.id } });

    return Response.json({
      ok: true,
      key: uploadSession.key,
      name: uploadSession.fileName,
    });
  } catch (error) {
    console.error("uploads/complete-simple route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Complete simple failed" },
      { status: 500 },
    );
  }
}
