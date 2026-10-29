import type { Metadata } from "next";
import { ImproveHub } from "@/components/improve/improve-hub";

export const metadata: Metadata = { title: "Improve" };

export default function Page() {
  return <ImproveHub />;
}
