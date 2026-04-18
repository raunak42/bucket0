import { prisma } from "@/utils/prisma";
import { AbortMultipartUploadCommand, DeleteObjectsCommand } from "@/utils/s3";
import { z } from "zod";
import {
  getAuthenticatedUploadUser,
  getStorageContextForUploadId,
} from "../_shared";

export const runtime = "nodejs";

const abortSchema = z.object({
  uploadId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUploadUser(request);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = abortSchema.parse(await request.json());
    const context = await getStorageContextForUploadId({
      userId: user.userId,
      uploadId: body.uploadId,
    });

    if (!context) {
      return Response.json({ error: "Upload not found" }, { status: 404 });
    }

    if (context.uploadSession.partSize > 0) {
      await context.s3Client.send(
        new AbortMultipartUploadCommand({
          Bucket: context.bucketName,
          Key: context.uploadSession.key,
          UploadId: context.uploadSession.uploadId,
        }),
      );
    } else {
      await context.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: context.bucketName,
          Delete: {
            Objects: [{ Key: context.uploadSession.key }],
            Quiet: true,
          },
        }),
      );
    }

    await prisma.uploadSession.delete({ where: { id: context.uploadSession.id } });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("uploads/abort route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Abort upload failed" },
      { status: 500 },
    );
  }
}
