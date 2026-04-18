import { prisma } from "@/utils/prisma";
import { AbortMultipartUploadCommand } from "@/utils/s3";
import { z } from "zod";
import { getManagedUploadContext } from "../_shared";

export const runtime = "nodejs";

const abortSchema = z.object({
  uploadId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const context = await getManagedUploadContext(request);

    if (!context) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = abortSchema.parse(await request.json());

    const uploadSession = await prisma.uploadSession.findFirst({
      where: {
        ownerId: context.userId,
        uploadId: body.uploadId,
      },
    });

    if (!uploadSession) {
      return Response.json({ error: "Upload not found" }, { status: 404 });
    }

    if (uploadSession.partSize > 0) {
      await context.s3Client.send(
        new AbortMultipartUploadCommand({
          Bucket: context.bucketName,
          Key: uploadSession.key,
          UploadId: uploadSession.uploadId,
        }),
      );
    }

    await prisma.uploadSession.delete({ where: { id: uploadSession.id } });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("uploads/abort route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Abort upload failed" },
      { status: 500 },
    );
  }
}
