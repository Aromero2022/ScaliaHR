import { z } from "zod";
import { CurrentUserUnavailable, getCurrentUser } from "@/lib/auth/current-user";
import { safeError } from "@/lib/errors/safe-error";
import { reportError } from "@/lib/log/report";
import { requestContext } from "@/lib/log/request-context";
import { ilikeAnyOf } from "@/lib/postgrest/filters";
import { limitApi } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// D38: the feedback form searches colleagues here instead of receiving the
// whole tenant (1,000 names in a <select>). At most COLLEAGUES_LIMIT active
// people of the caller's own tenant, read under RLS with the caller's session.
// 9c PR 6c: a POST with the search in a JSON body, so what a person types in
// PersonSearch or ⌘K never sits in a URL, a browser history or an access log.
// After the limiter and the session, the request must be JSON (415) and come
// from a page of this same host (403): a browser always sends Origin on a
// POST, and another site can neither set it to ours nor send JSON here
// without a CORS preflight this route never approves.

export const dynamic = "force-dynamic";
const COLLEAGUES_LIMIT = 20;
const NO_STORE = { "Cache-Control": "private, no-store" };

const Query = z.object({
  q: z.string().trim().min(2).max(60),
  // ARCO's form may pick the admin themself; the feedback form may not.
  self: z.boolean().optional(),
});

/** application/json, with or without parameters such as charset. */
function isJson(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  return type.split(";")[0].trim().toLowerCase() === "application/json";
}

/** Why the request's Origin is not this host's (the same Host header D21 reads), or null when it is. */
function originRefusal(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return "missing origin";
  const host = request.headers.get("host")?.toLowerCase();
  try {
    return host && new URL(origin).host === host ? null : "foreign origin";
  } catch {
    return "foreign origin";
  }
}

// A GET would carry the search in the URL: refused like any method this route does not serve.
export async function GET(): Promise<Response> {
  const limited = await limitApi();
  if (limited) return limited;
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request): Promise<Response> {
  const limited = await limitApi();
  if (limited) return limited;

  let me;
  try {
    me = await getCurrentUser();
  } catch (error) {
    // D45: the caller's employee row could not be read (already logged with the request id).
    if (error instanceof CurrentUserUnavailable) return Response.json({ error: "unavailable" }, { status: 500 });
    throw error;
  }
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (!isJson(request)) return Response.json({ error: "unsupported_media_type" }, { status: 415, headers: NO_STORE });

  const refusal = originRefusal(request);
  if (refusal) {
    return Response.json({ error: await safeError("colleagues.origin", new Error(refusal)) }, { status: 403, headers: NO_STORE });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = Query.safeParse(body);
  if (!parsed.success) return Response.json({ colleagues: [] }, { status: 400, headers: NO_STORE });

  const supabase = await createClient();
  let query = supabase
    .from("users")
    .select("id, first_name, last_name, email")
    .eq("tenant_id", me.tenant_id)
    .eq("status", "ACTIVE")
    .is("deleted_at", null)
    .or(ilikeAnyOf(["first_name", "last_name", "email"], parsed.data.q))
    .order("first_name")
    .order("last_name")
    .limit(COLLEAGUES_LIMIT);
  if (!parsed.data.self) query = query.neq("id", me.id);
  const { data, error } = await query;

  if (error) {
    reportError("colleagues.search", error, await requestContext());
    return Response.json({ error: "unavailable" }, { status: 500 });
  }
  return Response.json({ colleagues: data ?? [] }, { headers: NO_STORE });
}
