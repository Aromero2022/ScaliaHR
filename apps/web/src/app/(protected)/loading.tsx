import { SkeletonPage } from "@/components/ui/skeleton";

// D43: one loading state for every protected page, inside the shell (the
// navigation stays). The skeleton appears only after 400 ms.
export default function Loading() {
  return <SkeletonPage />;
}
