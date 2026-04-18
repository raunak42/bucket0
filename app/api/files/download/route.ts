import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import { signGetObjectUrl } from "@/utils/s3";
import { getOrCreateManagedConnection } from "@/utils/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({ error: "Missing file id" }, { status: 400 });
    }

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

    const connection = await getOrCreateManagedConnection(session.user.id);

    if (connection.id !== object.connectionId) {
      return Response.json({ error: "Unsupported storage connection" }, { status: 400 });
    }

    const downloadUrl = await signGetObjectUrl({
      bucket: connection.bucketName,
      key: object.key,
      fileName: object.name,
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
