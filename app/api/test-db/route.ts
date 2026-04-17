import { prisma } from "../../../utils/prisma";

export async function GET() {
  try {
    const connections = await prisma.storageConnection.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
    });

    return Response.json({
      ok: true,
      count: connections.length,
      connections,
    });
  } catch (error) {
    console.error("test-db error", error);

    return Response.json(
      {
        ok: false,
        error: "Failed to query database",
      },
      { status: 500 }
    );
  }
}
