import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import {
  createS3ClientForConnection,
  GetObjectCommand,
} from "@/utils/s3";
import {
  getObjectNameFromKey,
  getStorageConnectionWithCredentialsForUser,
} from "@/utils/storage";

export const runtime = "nodejs";

function escapeFileName(fileName: string) {
  return fileName.replace(/"/g, "");
}

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
    const disposition = searchParams.get("disposition") === "attachment"
      ? "attachment"
      : "inline";

    let key: string;
    let name: string;
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
    }

    const object = await createS3ClientForConnection(connection).send(
      new GetObjectCommand({
        Bucket: connection.bucketName,
        Key: key,
        Range: request.headers.get("range") ?? undefined,
      }),
    );

    if (!object.Body) {
      return Response.json({ error: "File body not found" }, { status: 404 });
    }

    const stream = object.Body.transformToWebStream();
    const headers = new Headers();
    headers.set("Cache-Control", "private, no-store");
    headers.set(
      "Content-Disposition",
      `${disposition}; filename="${escapeFileName(name)}"`,
    );

    if (object.ContentType) {
      headers.set("Content-Type", object.ContentType);
    }

    if (typeof object.ContentLength === "number") {
      headers.set("Content-Length", String(object.ContentLength));
    }

    if (object.ETag) {
      headers.set("ETag", object.ETag);
    }

    if (object.AcceptRanges) {
      headers.set("Accept-Ranges", object.AcceptRanges);
    }

    if (object.ContentRange) {
      headers.set("Content-Range", object.ContentRange);
    }

    if (object.LastModified) {
      headers.set("Last-Modified", object.LastModified.toUTCString());
    }

    return new Response(stream, {
      status: object.ContentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    console.error("file content route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load file content" },
      { status: 500 },
    );
  }
}
