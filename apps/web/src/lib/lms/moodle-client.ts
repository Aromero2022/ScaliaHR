// D30: holds MOODLE_WS_TOKEN; importing it from a client component fails the build.
import "server-only";
import { z } from "zod";

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL;
const MOODLE_WS_TOKEN = process.env.MOODLE_WS_TOKEN;

function getConfig() {
  if (!MOODLE_BASE_URL || !MOODLE_WS_TOKEN) {
    throw new Error("MOODLE_BASE_URL and MOODLE_WS_TOKEN must be configured");
  }
  return { baseUrl: MOODLE_BASE_URL, token: MOODLE_WS_TOKEN };
}

async function callMoodle<T>(
  wsfunction: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const { baseUrl, token } = getConfig();

  const body = new URLSearchParams();
  body.append("wstoken", token);
  body.append("wsfunction", wsfunction);
  body.append("moodlewsrestformat", "json");

  flattenParams(params, body);

  const res = await fetch(`${baseUrl}/webservice/rest/server.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Moodle HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  if (data?.exception) {
    throw new Error(`Moodle WS error [${data.errorcode}]: ${data.message}`);
  }

  return data as T;
}

function flattenParams(
  obj: Record<string, unknown>,
  params: URLSearchParams,
  prefix = ""
): void {
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (val === null || val === undefined) continue;
    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          flattenParams(item as Record<string, unknown>, params, `${fullKey}[${i}]`);
        } else {
          params.append(`${fullKey}[${i}]`, String(item));
        }
      });
    } else if (typeof val === "object") {
      flattenParams(val as Record<string, unknown>, params, fullKey);
    } else {
      params.append(fullKey, String(val));
    }
  }
}

// ── User Management ─────────────────────────────────────────────────

const moodleUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
});

type MoodleUser = z.infer<typeof moodleUserSchema>;

export async function createUser(input: {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<MoodleUser> {
  const result = await callMoodle<MoodleUser[]>("core_user_create_users", {
    users: [
      {
        username: input.username,
        email: input.email,
        firstname: input.firstName,
        lastname: input.lastName,
        password: `Scalia_${Date.now()}!`,
        auth: "userkey",
        createpassword: 0,
      },
    ],
  });
  return moodleUserSchema.parse(result[0]);
}

export async function getUser(
  field: "username" | "email",
  value: string
): Promise<MoodleUser | null> {
  const result = await callMoodle<{ users: MoodleUser[] }>(
    "core_user_get_users",
    { criteria: [{ key: field, value }] }
  );
  if (!result.users?.length) return null;
  return moodleUserSchema.parse(result.users[0]);
}

export async function updateUser(
  moodleUserId: number,
  updates: { suspended?: number; firstname?: string; lastname?: string; email?: string }
): Promise<void> {
  await callMoodle("core_user_update_users", {
    users: [{ id: moodleUserId, ...updates }],
  });
}

// ── SSO (auth_userkey) ──────────────────────────────────────────────

export async function requestLoginUrl(username: string): Promise<string> {
  const result = await callMoodle<{ loginurl: string }>(
    "auth_userkey_request_login_url",
    { user: { username } }
  );
  return result.loginurl;
}

// ── Enrolment ───────────────────────────────────────────────────────

export async function enrolUser(
  moodleUserId: number,
  courseId: number,
  roleId = 5
): Promise<void> {
  await callMoodle("enrol_manual_enrol_users", {
    enrolments: [{ roleid: roleId, userid: moodleUserId, courseid: courseId }],
  });
}

// ── Categories ──────────────────────────────────────────────────────

type MoodleCategory = { id: number; name: string };

export async function createCategory(
  name: string,
  parentId = 0
): Promise<MoodleCategory> {
  const result = await callMoodle<MoodleCategory[]>(
    "core_course_create_categories",
    { categories: [{ name, parent: parentId }] }
  );
  return result[0];
}

export async function getCategories(): Promise<MoodleCategory[]> {
  return callMoodle<MoodleCategory[]>("core_course_get_categories", {});
}

// ── Cohorts ─────────────────────────────────────────────────────────

type MoodleCohort = { id: number; name: string };

export async function createCohort(
  name: string,
  idnumber: string,
  description = ""
): Promise<MoodleCohort> {
  const result = await callMoodle<MoodleCohort[]>(
    "core_cohort_create_cohorts",
    {
      cohorts: [
        {
          categorytype: { type: "system", value: "" },
          name,
          idnumber,
          description,
        },
      ],
    }
  );
  return result[0];
}

export async function addCohortMembers(
  cohortId: number,
  userIds: number[]
): Promise<void> {
  await callMoodle("core_cohort_add_cohort_members", {
    members: userIds.map((uid) => ({ cohortid: cohortId, userid: uid })),
  });
}

export async function removeCohortMembers(
  cohortId: number,
  userIds: number[]
): Promise<void> {
  await callMoodle("core_cohort_delete_cohort_members", {
    members: userIds.map((uid) => ({ cohortid: cohortId, userid: uid })),
  });
}

// ── Completion ──────────────────────────────────────────────────────

type ActivityCompletion = {
  cmid: number;
  modname: string;
  state: number;
  timecompleted: number;
};

export async function getActivitiesCompletion(
  courseId: number,
  moodleUserId: number
): Promise<ActivityCompletion[]> {
  const result = await callMoodle<{ statuses: ActivityCompletion[] }>(
    "core_completion_get_activities_completion_status",
    { courseid: courseId, userid: moodleUserId }
  );
  return result.statuses ?? [];
}
