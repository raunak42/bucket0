import { signMultipartPartUrl } from "@/utils/s3";
import { z } from "zod";
import {
  getAuthenticatedUploadUser,
  getStorageContextForUploadId,
} from "../_shared";
import { prisma } from "@/utils/prisma";

export const runtime = "nodejs";

const partUrlSchema = z.object({
  uploadId: z.string().min(1),
  partNumber: z.coerce.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUploadUser(request);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = partUrlSchema.parse(await request.json());
    const context = await getStorageContextForUploadId({
      userId: user.userId,
      uploadId: body.uploadId,
    });

    if (!context) {
      return Response.json({ error: "Upload not found" }, { status: 404 });
    }

    await prisma.uploadSession.update({
      where: { id: context.uploadSession.id },
      data: { status: "uploading" },
    });

    const uploadUrl = await signMultipartPartUrl({
      client: context.s3Client,
      bucket: context.bucketName,
      key: context.uploadSession.key,
      uploadId: context.uploadSession.uploadId,
      partNumber: body.partNumber,
    });

    return Response.json({
      ok: true,
      uploadUrl,
      key: context.uploadSession.key,
      partNumber: body.partNumber,
      partSize: context.uploadSession.partSize,
    });
  } catch (error) {
    console.error("uploads/part-url route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Part URL failed" },
      { status: 500 },
    );
  }
}
