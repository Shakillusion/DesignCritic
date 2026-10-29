import { ProjectDetail } from "@/components/projects/project-detail";

export default async function Page({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  return <ProjectDetail key={id} id={id} />;
}
