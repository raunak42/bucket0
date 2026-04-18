import { auth } from "@/utils/auth";
import { deleteUserAndManagedStorage } from "@/utils/user-cleanup";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await deleteUserAndManagedStorage(session.user.id);

    return Response.json({ ok: true });
  } catch (error) {
    console.error("account delete route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete account" },
      { status: 500 },
    );
  }
}
