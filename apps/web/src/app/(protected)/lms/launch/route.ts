import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import * as moodle from "@/lib/lms/moodle-client";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const supabase = await createClient();
  // Verified JWT claims: tenant_id is written at the claim root by the hook.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const tenantId = typeof claims.tenant_id === "string" ? claims.tenant_id : null;
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant asignado" }, { status: 403 });
  }

  const flags = await getModuleFlags(tenantId);
  if (isModuleRouteBlocked("/lms/launch", flags)) {
    return new NextResponse(null, { status: 404 });
  }

  const supabaseUuid = claims.sub;
  const email = claims.email ?? "";
  const meta = claims.user_metadata ?? {};
  const firstName = (meta.first_name as string) ?? email.split("@")[0];
  const lastName = (meta.last_name as string) ?? "";

  let moodleUser = await moodle.getUser("username", supabaseUuid);

  if (!moodleUser) {
    moodleUser = await moodle.createUser({
      username: supabaseUuid,
      email,
      firstName,
      lastName,
    });

    const { data: tenantMap } = await supabase
      .from("lms_tenant_map")
      .select("moodle_cohort_id")
      .eq("tenant_id", tenantId)
      .single();

    if (tenantMap?.moodle_cohort_id) {
      await moodle.addCohortMembers(tenantMap.moodle_cohort_id, [moodleUser.id]);
    }
  }

  const loginUrl = await moodle.requestLoginUrl(supabaseUuid);

  return NextResponse.redirect(loginUrl);
}
