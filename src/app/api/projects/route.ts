import { createProject, listProjects } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { ProjectCreate } from "@/lib/validation/api";

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ projects: listProjects(user.id) });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, ProjectCreate);
  return json({ project: createProject(user.id, body) }, { status: 201 });
});
