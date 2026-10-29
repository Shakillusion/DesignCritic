import type { Metadata } from "next";
import { ResearchView } from "@/components/research/research-view";

export const metadata: Metadata = { title: "Research" };

export default async function Page({ searchParams }: PageProps<"/research">) {
  const { projectId } = await searchParams;
  return <ResearchView initialProjectId={typeof projectId === "string" ? projectId : undefined} />;
}
