import { prisma } from "@/utils/prisma";
import { UploadPartCommand } from "@/utils/s3";
import { z } from "zod";
import {
  getAuthenticatedUploadUser,
  getStorageContextForUploadId,
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

    await prisma.uploadSession.update({
      where: { id: context.uploadSession.id },
      data: { status: "uploading" },
    });

    const bytes = Buffer.from(await request.arrayBuffer());

    const result = await context.s3Client.send(
      new UploadPartCommand({
        Bucket: context.bucketName,
        Key: context.uploadSession.key,
        UploadId: context.uploadSession.uploadId,
        PartNumber: body.partNumber,
        Body: bytes,
        ContentLength: bytes.byteLength,
      }),
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
