import { prisma } from "@/utils/prisma";
import {
  buildManagedObjectKey,
  MULTIPART_PART_SIZE,
  normalizeFileName,
  normalizeFolderPath,
  SIMPLE_UPLOAD_MAX_BYTES,
} from "@/utils/storage";
import {
  CreateMultipartUploadCommand,
  signPutObjectUploadUrl,
} from "@/utils/s3";
import { z } from "zod";
import { getManagedUploadContext } from "../_shared";

export const runtime = "nodejs";

const initSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.coerce.number().int().nonnegative(),
  folderPath: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const context = await getManagedUploadContext(request);

    if (!context) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = initSchema.parse(await request.json());
    const folderPath = normalizeFolderPath(body.folderPath);
    const fileName = normalizeFileName(body.fileName);
    const key = buildManagedObjectKey({
      ownerId: context.userId,
      rootPrefix: context.managedConnection.rootPrefix,
      folderPath,
      fileName,
    });

    if (body.size <= SIMPLE_UPLOAD_MAX_BYTES) {
      const uploadId = `simple_${crypto.randomUUID()}`;
      const uploadUrl = await signPutObjectUploadUrl({
        bucket: context.bucketName,
        key,
        contentType: body.mimeType,
      });

      await prisma.uploadSession.create({
        data: {
          ownerId: context.userId,
          connectionId: context.managedConnection.id,
          key,
          folderPath,
          fileName,
          mimeType: body.mimeType,
          size: BigInt(body.size),
          uploadId,
          partSize: 0,
          status: "initiated",
        },
      });

      return Response.json({
        ok: true,
        mode: "simple",
        uploadId,
        key,
        bucketName: context.bucketName,
        uploadUrl,
      });
    }

    const upload = await context.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: context.bucketName,
        Key: key,
        ContentType: body.mimeType,
      }),
    );

    if (!upload.UploadId) {
      return Response.json(
        { error: "Could not start multipart upload" },
        { status: 500 },
      );
    }

    await prisma.uploadSession.create({
      data: {
        ownerId: context.userId,
        connectionId: context.managedConnection.id,
        key,
        folderPath,
        fileName,
        mimeType: body.mimeType,
        size: BigInt(body.size),
        uploadId: upload.UploadId,
        partSize: MULTIPART_PART_SIZE,
        status: "initiated",
      },
    });

    return Response.json({
      ok: true,
      mode: "multipart",
      uploadId: upload.UploadId,
      key,
      bucketName: context.bucketName,
      partSize: MULTIPART_PART_SIZE,
    });
  } catch (error) {
    console.error("uploads/init route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload init failed" },
      { status: 500 },
    );
  }
}
