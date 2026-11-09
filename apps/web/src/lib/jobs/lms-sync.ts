import { createClient } from "@/lib/supabase/server";
import * as moodle from "@/lib/lms/moodle-client";
import { reportError } from "@/lib/log/report";
import { requestContext } from "@/lib/log/request-context";

type SyncResult = {
  provisioned: number;
  suspended: number;
  anonymized: number;
  errors: string[];
};

export async function syncLmsUsers(tenantId: string): Promise<SyncResult> {
  const supabase = await createClient();
  const result: SyncResult = { provisioned: 0, suspended: 0, anonymized: 0, errors: [] };

  // D45: a read that fails is reported and ends the sync with an error; it is
  // never taken for "no tenant map", "no employees" or "no Moodle accounts yet"
  // (that last one would create every account again).
  const failed = async (event: string, error: unknown, message: string) => {
    reportError(event, error, { ...(await requestContext()), tenantId });
    result.errors.push(message);
    return result;
  };

  const { data: tenantMap, error: tenantMapError } = await supabase
    .from("lms_tenant_map")
    .select("moodle_category_id, moodle_cohort_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (tenantMapError) return failed("lms.sync_tenant_map_failed", tenantMapError, "LMS tenant map could not be read");
  if (!tenantMap) {
    result.errors.push("Tenant not provisioned in LMS");
    return result;
  }

  const { data: employees, error: employeesError } = await supabase
    .from("users")
    .select("id, auth_uid, email, first_name, last_name, status, is_anonymized")
    .eq("tenant_id", tenantId);

  if (employeesError) return failed("lms.sync_employees_failed", employeesError, "Employees could not be read");
  if (!employees?.length) return result;

  const { data: existingMaps, error: mapsError } = await supabase
    .from("lms_user_map")
    .select("user_id, moodle_user_id")
    .eq("tenant_id", tenantId);

  if (mapsError) return failed("lms.sync_user_maps_failed", mapsError, "LMS user maps could not be read");

  const mapByUserId = new Map(
    (existingMaps ?? []).map((m) => [m.user_id, m.moodle_user_id])
  );

  for (const emp of employees) {
    try {
      const username = emp.auth_uid ?? emp.id;
      const moodleUserId = mapByUserId.get(emp.id);

      if (emp.is_anonymized && moodleUserId) {
        await moodle.updateUser(moodleUserId, {
          suspended: 1,
          firstname: "Usuario",
          lastname: "Anonimizado",
          email: `anon_${emp.id}@scalia.local`,
        });
        result.anonymized++;
        continue;
      }

      if (emp.status === "TERMINATED" && moodleUserId) {
        await moodle.updateUser(moodleUserId, { suspended: 1 });
        result.suspended++;
        continue;
      }

      if (emp.status === "ACTIVE" && !moodleUserId) {
        let mUser = await moodle.getUser("username", username);

        if (!mUser) {
          mUser = await moodle.createUser({
            username,
            email: emp.email,
            firstName: emp.first_name,
            lastName: emp.last_name,
          });
        }

        const { error: mapInsertError } = await supabase.from("lms_user_map").insert({
          tenant_id: tenantId,
          user_id: emp.id,
          moodle_user_id: mUser.id,
        });
        // Reported below as this user's failure; without the map the next sync would not know the account.
        if (mapInsertError) throw mapInsertError;

        await moodle.addCohortMembers(tenantMap.moodle_cohort_id, [mUser.id]);
        result.provisioned++;
      }

      if (emp.status === "ACTIVE" && moodleUserId) {
        await moodle.updateUser(moodleUserId, { suspended: 0 });
      }
    } catch (err) {
      // D27: the Moodle or database detail goes to the logs, not to the caller.
      reportError("lms.sync_user_failed", err, { ...(await requestContext()), tenantId }, { userId: emp.id });
      result.errors.push(`User ${emp.id}: sync failed`);
    }
  }

  return result;
}

export async function getEmployeeCompletions(
  tenantId: string,
  userId: string,
  courseId: number
) {
  const supabase = await createClient();

  // D45: maybeSingle: a person without a Moodle account has no completions; a
  // failed read throws instead of looking like that.
  const { data: userMap, error } = await supabase
    .from("lms_user_map")
    .select("moodle_user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read LMS user map: ${error.message}`);
  if (!userMap) return [];

  return moodle.getActivitiesCompletion(courseId, userMap.moodle_user_id);
}
