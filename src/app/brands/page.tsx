import type { Metadata } from "next";
import { BrandsView } from "@/components/brands/brands-view";

export const metadata: Metadata = { title: "Brand Library" };

export default function Page() {
  return <BrandsView />;
}
