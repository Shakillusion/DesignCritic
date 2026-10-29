import type { Metadata } from "next";
import { CreateView } from "@/components/studio/create-view";

export const metadata: Metadata = { title: "Create" };

export default async function Page({ searchParams }: PageProps<"/create">) {
  const { projectId, directionId } = await searchParams;
  return <CreateView initialProjectId={typeof projectId === "string" ? projectId : undefined} initialDirectionId={typeof directionId === "string" ? directionId : undefined} />;
}
