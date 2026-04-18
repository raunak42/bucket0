import { prisma } from "@/utils/prisma";
import { signMultipartPartUrl } from "@/utils/s3";
import { z } from "zod";
import { getManagedUploadContext } from "../_shared";

export const runtime = "nodejs";

const partUrlSchema = z.object({
  uploadId: z.string().min(1),
  partNumber: z.coerce.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const context = await getManagedUploadContext(request);

    if (!context) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = partUrlSchema.parse(await request.json());

    const uploadSession = await prisma.uploadSession.findFirst({
      where: {
        ownerId: context.userId,
        uploadId: body.uploadId,
      },
    });

    if (!uploadSession) {
      return Response.json({ error: "Upload not found" }, { status: 404 });
    }

    await prisma.uploadSession.update({
      where: { id: uploadSession.id },
      data: { status: "uploading" },
    });

    const uploadUrl = await signMultipartPartUrl({
      bucket: context.bucketName,
      key: uploadSession.key,
      uploadId: uploadSession.uploadId,
      partNumber: body.partNumber,
    });

    return Response.json({
      ok: true,
      uploadUrl,
      key: uploadSession.key,
      partNumber: body.partNumber,
      partSize: uploadSession.partSize,
    });
  } catch (error) {
    console.error("uploads/part-url route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Part URL failed" },
      { status: 500 },
    );
  }
}
