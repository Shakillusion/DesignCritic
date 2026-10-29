import type { Metadata } from "next";
import { MoodboardView } from "@/components/research/moodboard-view";

export const metadata: Metadata = { title: "Moodboard" };

export default async function Page({ params }: PageProps<"/research/boards/[id]">) {
  const { id } = await params;
  return <MoodboardView key={id} id={id} />;
}
