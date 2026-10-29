import { handle, json, parseBody, requireUser } from "@/lib/http";
import { searchAssets } from "@/lib/integrations/assets";
import { licenseVerdict } from "@/lib/integrations/assets/license";
import { AssetSearch } from "@/lib/validation/api";

/** Search configured providers. Nothing is downloaded here; previews are the providers' own thumbnails. */
export const POST = handle(async (req: Request) => {
  await requireUser();
  const body = await parseBody(req, AssetSearch);
  const { candidates, errors } = await searchAssets(body.query, { kinds: body.kinds, orientation: body.orientation, perPage: 18 });
  return json({ candidates: candidates.map((c) => ({ ...c, verdict: licenseVerdict(c.license) })), errors });
});
