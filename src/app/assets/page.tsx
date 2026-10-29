import type { Metadata } from "next";
import { AssetsView } from "@/components/assets/assets-view";

export const metadata: Metadata = { title: "Assets" };

export default async function Page({ searchParams }: PageProps<"/assets">) {
  const { projectId } = await searchParams;
  return <AssetsView initialProjectId={typeof projectId === "string" ? projectId : undefined} />;
}
