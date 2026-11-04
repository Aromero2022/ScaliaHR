import { z } from "zod";

const InternalUrl = z.url({ protocol: /^https?$/ }).optional();

export interface SupabaseServerTarget {
  url: string;
  cookieName: string;
}

// Inside a container, NEXT_PUBLIC_SUPABASE_URL (what the browser uses) points
// at the container itself. The server then reaches Supabase through
// SUPABASE_INTERNAL_URL, but must keep the cookie name the browser derives from
// the public URL or the session would be lost between the two.
// The defaults must stay literal `process.env.NEXT_PUBLIC_*` reads: Next.js only
// inlines those at build time.
export function supabaseServerTarget(
  publicUrl: string = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  internalUrl: string | undefined = process.env.SUPABASE_INTERNAL_URL,
): SupabaseServerTarget {
  const serverUrl = InternalUrl.parse(internalUrl || undefined);
  return {
    url: serverUrl ?? publicUrl,
    // Same formula supabase-js uses for its default storage key.
    cookieName: `sb-${new URL(publicUrl).hostname.split(".")[0]}-auth-token`,
  };
}
