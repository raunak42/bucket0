import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/dashboard-client";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <DashboardClient
      userName={session.user.name || session.user.email}
      userEmail={session.user.email}
      userImage={session.user.image ?? null}
    />
  );
}
