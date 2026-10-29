import type { Metadata } from "next";
import { NewCritique } from "@/components/critique/new-critique";

export const metadata: Metadata = { title: "Critique" };

export default async function Page({ searchParams }: PageProps<"/critique">) {
  const { projectId } = await searchParams;
  return <NewCritique initialProjectId={typeof projectId === "string" ? projectId : undefined} />;
}
