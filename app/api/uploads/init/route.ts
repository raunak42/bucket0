import { prisma } from "@/utils/prisma";
import {
  buildConnectionObjectKey,
  MULTIPART_PART_SIZE,
  normalizeFileName,
  normalizeFolderPath,
  SIMPLE_UPLOAD_MAX_BYTES,
} from "@/utils/storage";
import {
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  signPutObjectUploadUrl,
} from "@/utils/s3";
import { z } from "zod";
import {
  getAuthenticatedUploadUser,
  getStorageContextForConnection,
} from "../_shared";

export const runtime = "nodejs";

const initSchema = z.object({
  connectionId: z.string().optional(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.coerce.number().int().nonnegative(),
  folderPath: z.string().optional(),
});

function splitFileNameParts(fileName: string) {
  const normalized = normalizeFileName(fileName);
  const lastDotIndex = normalized.lastIndexOf(".");

  if (lastDotIndex <= 0) {
    return {
      baseName: normalized,
      extension: "",
    };
  }

  return {
    baseName: normalized.slice(0, lastDotIndex),
    extension: normalized.slice(lastDotIndex),
  };
}

function buildAutoRenamedFileName(fileName: string, attempt: number) {
  const normalized = normalizeFileName(fileName);

  if (attempt <= 0) {
    return normalized;
  }

  const { baseName, extension } = splitFileNameParts(normalized);
  return `${baseName} (${attempt})${extension}`;
}

function isMissingObjectError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithMetadata = error as Error & {
    name?: string;
    $metadata?: {
      httpStatusCode?: number;
    };
  };

  return (
    errorWithMetadata.name === "NotFound" ||
    errorWithMetadata.name === "NoSuchKey" ||
    errorWithMetadata.$metadata?.httpStatusCode === 404
  );
}

async function resolveAvailableUploadTarget({
  context,
  folderPath,
  fileName,
}: {
  context: Awaited<ReturnType<typeof getStorageContextForConnection>>;
  folderPath: string;
  fileName: string;
}) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidateFileName = buildAutoRenamedFileName(fileName, attempt);
    const candidateKey = buildConnectionObjectKey({
      connection: context.connection,
      ownerId: context.userId,
      folderPath,
      fileName: candidateFileName,
    });

    const existingUploadSession = await prisma.uploadSession.findFirst({
      where: {
        connectionId: context.connection.id,
        key: candidateKey,
      },
      select: {
        id: true,
      },
    });

    if (existingUploadSession) {
      continue;
    }

    if (context.connection.type === "managed") {
      const existingObject = await prisma.driveObject.findFirst({
        where: {
          ownerId: context.userId,
          connectionId: context.connection.id,
          path: folderPath,
          name: candidateFileName,
        },
        select: {
          id: true,
        },
      });

      if (existingObject) {
        continue;
      }

      return {
        fileName: candidateFileName,
        key: candidateKey,
      };
    }

    try {
      await context.s3Client.send(
        new HeadObjectCommand({
          Bucket: context.bucketName,
          Key: candidateKey,
        }),
      );
      continue;
    } catch (error) {
      if (!isMissingObjectError(error)) {
        throw error;
      }
    }

    return {
      fileName: candidateFileName,
      key: candidateKey,
    };
  }

  throw new Error("Could not resolve a unique file name");
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUploadUser(request);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = initSchema.parse(await request.json());
    const context = await getStorageContextForConnection({
      userId: user.userId,
      connectionId: body.connectionId,
    });
    const folderPath = normalizeFolderPath(body.folderPath);
    const requestedFileName = normalizeFileName(body.fileName);
    const { fileName, key } = await resolveAvailableUploadTarget({
      context,
      folderPath,
      fileName: requestedFileName,
    });

    if (body.size <= SIMPLE_UPLOAD_MAX_BYTES) {
      const uploadId = `simple_${crypto.randomUUID()}`;
      const uploadUrl = await signPutObjectUploadUrl({
        client: context.s3Client,
        bucket: context.bucketName,
        key,
        contentType: body.mimeType,
      });

      await prisma.uploadSession.create({
        data: {
          ownerId: context.userId,
          connectionId: context.connection.id,
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
        fileName,
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
        connectionId: context.connection.id,
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
      fileName,
    });
  } catch (error) {
    console.error("uploads/init route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload init failed" },
      { status: 500 },
    );
  }
}
