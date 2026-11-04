import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseServerTarget } from "./server-url";

export async function createClient() {
  const cookieStore = await cookies();
  const target = supabaseServerTarget();

  return createServerClient(
    target.url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: target.cookieName },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — ignore
          }
        },
      },
    }
  );
}
