import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import {
  createS3ClientForConnection,
  HeadObjectCommand,
  S3_SIGNED_URL_TTL_SECONDS,
  signGetObjectUrl,
} from "@/utils/s3";
import {
  getObjectNameFromKey,
  getStorageConnectionWithCredentialsForUser,
} from "@/utils/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const connectionId = searchParams.get("connectionId");
    const rawKey = searchParams.get("key");

    let key: string;
    let name: string;
    let mimeType: string | null = null;
    let size = "0";
    let updatedAt = new Date().toISOString();
    let connection;

    if (id) {
      const object = await prisma.driveObject.findFirst({
        where: {
          id,
          ownerId: session.user.id,
          type: "file",
        },
      });

      if (!object) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      connection = await getStorageConnectionWithCredentialsForUser(
        session.user.id,
        object.connectionId,
      );
      key = object.key;
      name = object.name;
      mimeType = object.mimeType;
      size = object.size.toString();
      updatedAt = object.updatedAt.toISOString();
    } else {
      if (!connectionId || !rawKey) {
        return Response.json(
          { error: "Missing file reference" },
          { status: 400 },
        );
      }

      connection = await getStorageConnectionWithCredentialsForUser(
        session.user.id,
        connectionId,
      );
      key = rawKey;
      name = searchParams.get("name") || getObjectNameFromKey(rawKey);

      const client = createS3ClientForConnection(connection);
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: connection.bucketName,
          Key: rawKey,
        }),
      );

      mimeType = head.ContentType ?? null;
      size = String(head.ContentLength ?? 0);
      updatedAt = (head.LastModified ?? new Date()).toISOString();
    }

    const client = createS3ClientForConnection(connection);

    const previewUrl = await signGetObjectUrl({
      client,
      bucket: connection.bucketName,
      key,
      fileName: name,
      contentDisposition: "inline",
    });

    const downloadUrl = await signGetObjectUrl({
      client,
      bucket: connection.bucketName,
      key,
      fileName: name,
      contentDisposition: "attachment",
    });

    return Response.json({
      ok: true,
      file: {
        id: id ?? `file:${connection.id}:${key}`,
        name,
        key,
        mimeType,
        size,
        updatedAt,
        previewUrl,
        downloadUrl,
        expiresAt: new Date(
          Date.now() + S3_SIGNED_URL_TTL_SECONDS * 1000,
        ).toISOString(),
      },
    });
  } catch (error) {
    console.error("file preview route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load preview" },
      { status: 500 },
    );
  }
}
