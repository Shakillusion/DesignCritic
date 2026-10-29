import { BrandEditor } from "@/components/brands/brand-editor";

export default async function Page({ params }: PageProps<"/brands/[id]">) {
  const { id } = await params;
  return <BrandEditor key={id} id={id} />;
}
