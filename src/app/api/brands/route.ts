import { createBrand, listBrands } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { BrandCreate } from "@/lib/validation/api";

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ brands: listBrands(user.id) });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, BrandCreate);
  return json({ brand: createBrand(user.id, body) }, { status: 201 });
});
