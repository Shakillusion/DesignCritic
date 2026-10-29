import { importCandidate } from "@/agents/asset-agent";
import { getProject } from "@/lib/database/repo";
import { handle, HttpError, json, parseBody, requireUser } from "@/lib/http";
import { searchAssets } from "@/lib/integrations/assets";
import { AssetImport } from "@/lib/validation/api";

/**
 * Download a search result into a project's library. The candidate is looked
 * up again server-side, so licence data and the download URL never come from the client.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, AssetImport);
  getProject(user.id, body.projectId);
  const { candidates } = await searchAssets(body.query, { providers: [body.candidate.provider], perPage: 30 });
  const candidate = candidates.find((c) => c.providerId === body.candidate.providerId);
  if (!candidate) throw new HttpError(404, "That result is no longer returned by the provider. Search again.");
  const asset = await importCandidate({ userId: user.id, projectId: body.projectId, candidate });
  return json({ asset }, { status: 201 });
});
