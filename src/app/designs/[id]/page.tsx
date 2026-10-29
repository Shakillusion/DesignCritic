import type { Metadata } from "next";
import { DesignStudio } from "@/components/studio/design-studio";

export const metadata: Metadata = { title: "Design studio" };

export default async function Page({ params, searchParams }: PageProps<"/designs/[id]">) {
  const { id } = await params;
  const { version, compare } = await searchParams;
  return <DesignStudio key={`${id}-${typeof version === "string" ? version : ""}`} id={id} initialVersionId={typeof version === "string" ? version : undefined} openCompare={compare === "1"} />;
}
