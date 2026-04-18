import { prisma } from "@/utils/prisma";
import { UploadPartCommand } from "@/utils/s3";
import { z } from "zod";
import {
  getAuthenticatedUploadUser,
  getExpectedUploadPartSize,
  getRequestContentLength,
  getStorageContextForUploadId,
  getUploadRequestBodyStream,
} from "../_shared";

export const runtime = "nodejs";

const proxyPartSchema = z.object({
  uploadId: z.string().min(1),
  partNumber: z.coerce.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUploadUser(request);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const body = proxyPartSchema.parse({
      uploadId: searchParams.get("uploadId"),
      partNumber: searchParams.get("partNumber"),
    });

    const context = await getStorageContextForUploadId({
      userId: user.userId,
      uploadId: body.uploadId,
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

    if (context.uploadSession.partSize <= 0) {
      return Response.json(
        { error: "This upload does not use multipart proxy parts" },
        { status: 400 },
      );
    }

    const expectedPartSize = getExpectedUploadPartSize({
      totalSize: Number(context.uploadSession.size),
      partSize: context.uploadSession.partSize,
      partNumber: body.partNumber,
    });

    if (expectedPartSize === null || expectedPartSize <= 0) {
      return Response.json(
        { error: `Invalid part number ${body.partNumber}` },
        { status: 400 },
      );
    }

    const requestContentLength = getRequestContentLength(request);

    if (
      requestContentLength !== undefined &&
      requestContentLength !== expectedPartSize
    ) {
      return Response.json(
        { error: `Part ${body.partNumber} size mismatch` },
        { status: 400 },
      );
    }

    const bodyStream = getUploadRequestBodyStream(request);

    await prisma.uploadSession.update({
      where: { id: context.uploadSession.id },
      data: { status: "uploading" },
    });

    const result = await context.s3Client.send(
      new UploadPartCommand({
        Bucket: context.bucketName,
        Key: context.uploadSession.key,
        UploadId: context.uploadSession.uploadId,
        PartNumber: body.partNumber,
        Body: bodyStream,
        ContentLength: expectedPartSize,
      }),
      {
        abortSignal: request.signal,
      },
    );

    if (!result.ETag) {
      return Response.json(
        { error: `Missing ETag for part ${body.partNumber}` },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      etag: result.ETag,
      partNumber: body.partNumber,
    });
  } catch (error) {
    console.error("uploads/proxy-part route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Proxy upload part failed" },
      { status: 500 },
    );
  }
}
