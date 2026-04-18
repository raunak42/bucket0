import { prisma } from "@/utils/prisma";
import { PutObjectCommand } from "@/utils/s3";
import { z } from "zod";
import {
  getAuthenticatedUploadUser,
  getRequestContentLength,
  getStorageContextForUploadId,
  getUploadRequestBodyStream,
} from "../_shared";

export const runtime = "nodejs";

const proxySimpleSchema = z.object({
  uploadId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUploadUser(request);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const params = proxySimpleSchema.parse({
      uploadId: searchParams.get("uploadId"),
    });

    const context = await getStorageContextForUploadId({
      userId: user.userId,
      uploadId: params.uploadId,
    });

    if (!context) {
      return Response.json({ error: "Upload not found" }, { status: 404 });
    }

    if (context.connection.type !== "external") {
      return Response.json(
        { error: "Proxy uploads are only used for external buckets" },
        { status: 400 },
      );
    }

    if (context.uploadSession.partSize > 0) {
      return Response.json(
        { error: "This upload expects multipart proxy parts" },
        { status: 400 },
      );
    }

    const expectedSize = Number(context.uploadSession.size);
    const requestContentLength = getRequestContentLength(request);

    if (
      requestContentLength !== undefined &&
      requestContentLength !== expectedSize
    ) {
      return Response.json(
        { error: "Upload size mismatch" },
        { status: 400 },
      );
    }

    const requestBody =
      expectedSize === 0
        ? new Uint8Array(0)
        : getUploadRequestBodyStream(request);

    await prisma.uploadSession.update({
      where: { id: context.uploadSession.id },
      data: { status: "uploading" },
    });

    await context.s3Client.send(
      new PutObjectCommand({
        Bucket: context.bucketName,
        Key: context.uploadSession.key,
        Body: requestBody,
        ContentLength: expectedSize,
        ContentType: context.uploadSession.mimeType,
      }),
      {
        abortSignal: request.signal,
      },
    );

    return Response.json({ ok: true });
  } catch (error) {
    console.error("uploads/proxy-simple route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Proxy upload failed" },
      { status: 500 },
    );
  }
}
