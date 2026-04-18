import { prisma } from "@/utils/prisma";
import { CompleteMultipartUploadCommand } from "@/utils/s3";
import { z } from "zod";
import { getManagedUploadContext } from "../_shared";

export const runtime = "nodejs";

const completePartSchema = z.object({
  etag: z.string().min(1),
  partNumber: z.number().int().positive(),
});

const completeSchema = z.object({
  uploadId: z.string().min(1),
  parts: z.array(completePartSchema).min(1),
});

export async function POST(request: Request) {
  try {
    const context = await getManagedUploadContext(request);

    if (!context) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = completeSchema.parse(await request.json());

    const uploadSession = await prisma.uploadSession.findFirst({
      where: {
        ownerId: context.userId,
        uploadId: body.uploadId,
      },
    });

    if (!uploadSession) {
      return Response.json({ error: "Upload not found" }, { status: 404 });
    }

    const sortedParts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);

    const completedUpload = await context.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: context.bucketName,
        Key: uploadSession.key,
        UploadId: uploadSession.uploadId,
        MultipartUpload: {
          Parts: sortedParts.map((part) => ({
            ETag: part.etag,
            PartNumber: part.partNumber,
          })),
        },
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
        etag: completedUpload.ETag ?? null,
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
    console.error("uploads/complete route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Complete upload failed" },
      { status: 500 },
    );
  }
}
