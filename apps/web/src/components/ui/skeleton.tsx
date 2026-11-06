import { clsx } from "clsx";
import { messages } from "@/lib/i18n/es-MX";

// D43: a placeholder while a page loads. It appears only after 400 ms, with
// CSS alone (.skeleton-region starts at opacity 0 and an animation-delay shows
// it), so no script runs and the nonce CSP of D29 is untouched. The shimmer
// stops with prefers-reduced-motion (globals.css).

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx("skeleton-block rounded-md", className)} />;
}

export function SkeletonPage() {
  return (
    <div role="status" className="skeleton-region space-y-6">
      <span className="sr-only">{messages.common.loading}</span>
      <Skeleton className="h-8 w-64 max-w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-32" />
    </div>
  );
}
