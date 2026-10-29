import { getPreferences, setPreferences, usageSummary } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { PreferencesUpdate } from "@/lib/validation/api";

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ preferences: getPreferences(user.id), usage: usageSummary(user.id) });
});

export const PATCH = handle(async (req: Request) => {
  const user = await requireUser();
  const patch = await parseBody(req, PreferencesUpdate);
  return json({ preferences: setPreferences(user.id, patch) });
});
