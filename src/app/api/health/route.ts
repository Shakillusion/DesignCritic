import { getDb } from "@/lib/database/db";
import { handle, json } from "@/lib/http";

/** Public liveness check for Docker and uptime monitors. Reveals nothing beyond "up". */
export const GET = handle(async () => {
  await getDb().prepare("SELECT 1").get();
  return json({ status: "ok" });
});
