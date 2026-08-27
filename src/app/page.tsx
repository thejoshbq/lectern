import { redirect } from "next/navigation";

import { Chat } from "@/components/Chat";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Chat />;
}
