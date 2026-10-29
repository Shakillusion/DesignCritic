import type { Metadata } from "next";
import { CritiqueWorkspace } from "@/components/critique/critique-workspace";

export const metadata: Metadata = { title: "Critique report" };

export default async function Page({ params, searchParams }: PageProps<"/critiques/[id]">) {
  const { id } = await params;
  const { job } = await searchParams;
  return <CritiqueWorkspace key={id} id={id} initialJobId={typeof job === "string" ? job : undefined} />;
}
