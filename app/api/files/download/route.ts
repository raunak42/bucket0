import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import { createS3ClientForConnection, signGetObjectUrl } from "@/utils/s3";
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

    if (connection.type === "external") {
      const contentUrl = new URL("/api/files/content", request.url);
      contentUrl.searchParams.set("connectionId", connection.id);
      contentUrl.searchParams.set("key", key);
      contentUrl.searchParams.set("name", name);
      contentUrl.searchParams.set("disposition", "attachment");
      return Response.redirect(contentUrl, 307);
    }

    const downloadUrl = await signGetObjectUrl({
      client: createS3ClientForConnection(connection),
      bucket: connection.bucketName,
      key,
      fileName: name,
      contentDisposition: "attachment",
    });

    return Response.redirect(downloadUrl, 307);
  } catch (error) {
    console.error("file download route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to prepare download" },
      { status: 500 },
    );
  }
}
