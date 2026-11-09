import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { redirect, notFound } from "next/navigation";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import { can } from "@/lib/authz/can";
import AccessDenied from "@/components/access-denied";
import SkillsHubDashboard from "@/components/skills-hub-dashboard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { firstError, queryErrorMessage } from "@/lib/errors/query-error";

interface SkillOntologyRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  is_active: boolean;
}

interface EmployeeSkillRow {
  skill_id: string;
  self_assessed_level: number;
  manager_assessed_level: number | null;
  skill: { name: string; code: string; category: string }[] | { name: string; code: string; category: string } | null;
}

interface JobRoleSkillRow {
  skill_id: string;
  required_proficiency_level: number;
  skill: { name: string; code: string; category: string }[] | { name: string; code: string; category: string } | null;
}

interface DirectReportSkillRow {
  user_id: string;
  skill_id: string;
  self_assessed_level: number;
  manager_assessed_level: number | null;
  skill: { name: string; code: string; category: string }[] | { name: string; code: string; category: string } | null;
}

export default async function SkillsHubPage() {
  const claims = await requireAuth();
  if (!claims.tenantId) redirect("/login");

  const supabase = await createClient();
  const bizUser = await getCurrentUser();

  if (!bizUser) redirect("/login");

  const flags = await getModuleFlags(claims.tenantId);
  if (isModuleRouteBlocked("/skills-hub", flags)) {
    notFound();
  }

  // D41: the menu hides Talent Hub without this permission, so the page refuses
  // it too, like every other module page; the menu is never the guard.
  const { allowed } = await can(bizUser.id, "tih.employee_skills", "view");
  if (!allowed) return <AccessDenied />;

  // D45: maybeSingle: a position without a classification, or one the person
  // cannot read, means no required skills (the radar says so); a failed read is
  // the radar's error.
  let jobRoleId: string | null = null;
  let jobRoleError: unknown = null;
  if (bizUser.position_id) {
    const { data: pos, error: posError } = await supabase
      .from("positions")
      .select("job_classification_id")
      .eq("id", bizUser.position_id)
      .maybeSingle();
    jobRoleError = posError;
    if (pos?.job_classification_id) {
      const { data: jc, error: jcError } = await supabase
        .from("job_classifications")
        .select("job_role_id")
        .eq("id", pos.job_classification_id)
        .maybeSingle();
      jobRoleError = jcError;
      jobRoleId = jc?.job_role_id ?? null;
    }
  }

  const canViewTeam = await can(bizUser.id, "tih.employee_skills", "view", "check-any");
  const isManager = canViewTeam.allowed;

  const [ontologyRes, mySkillsRes, roleSkillsRes] = await Promise.all([
    supabase
      .from("skill_ontology")
      .select("id, code, name, description, category, is_active")
      .eq("is_active", true)
      .order("category")
      .order("name"),
    supabase
      .from("employee_skills")
      .select(
        "skill_id, self_assessed_level, manager_assessed_level, skill:skill_ontology!es_skill_fk(name, code, category)"
      )
      .eq("user_id", bizUser.id),
    jobRoleId
      ? supabase
          .from("job_role_skills")
          .select(
            "skill_id, required_proficiency_level, skill:skill_ontology!jrs_skill_fk(name, code, category)"
          )
          .eq("job_role_id", jobRoleId)
      : Promise.resolve({ data: [] as JobRoleSkillRow[], error: null }),
  ]);

  const ontology: SkillOntologyRow[] = (ontologyRes.data ?? []).map((s) => ({
    id: s.id as string,
    code: s.code as string,
    name: s.name as string,
    description: s.description as string | null,
    category: s.category as string,
    is_active: s.is_active as boolean,
  }));

  const mySkills = (mySkillsRes.data ?? []).map((es: unknown) => {
    const row = es as EmployeeSkillRow;
    const skill = Array.isArray(row.skill) ? row.skill[0] : row.skill;
    return {
      skill_id: row.skill_id,
      self_assessed_level: row.self_assessed_level,
      manager_assessed_level: row.manager_assessed_level,
      skill_name: skill?.name ?? "",
      skill_code: skill?.code ?? "",
      skill_category: skill?.category ?? "",
    };
  });

  const roleSkills = ((roleSkillsRes.data ?? []) as unknown[]).map((jrs) => {
    const row = jrs as JobRoleSkillRow;
    const skill = Array.isArray(row.skill) ? row.skill[0] : row.skill;
    return {
      skill_id: row.skill_id,
      required_level: row.required_proficiency_level,
      skill_name: skill?.name ?? "",
      skill_code: skill?.code ?? "",
      skill_category: skill?.category ?? "",
    };
  });

  type TeamMember = {
    user_id: string;
    full_name: string;
    skills: {
      skill_id: string;
      skill_name: string;
      skill_category: string;
      self_assessed_level: number;
      manager_assessed_level: number | null;
    }[];
  };
  let teamMembers: TeamMember[] = [];
  let teamQueryError: unknown = null;

  if (isManager) {
    const { data: directReports, error: reportsError } = await supabase.rpc("get_direct_reports", {});
    teamQueryError = reportsError;
    const reportIds: string[] = (directReports ?? []).map(
      (r: { user_id: string }) => r.user_id
    );

    if (reportIds.length > 0) {
      const { data: reportUsers, error: reportUsersError } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", reportIds);

      const { data: reportSkills, error: reportSkillsError } = await supabase
        .from("employee_skills")
        .select(
          "user_id, skill_id, self_assessed_level, manager_assessed_level, skill:skill_ontology!es_skill_fk(name, code, category)"
        )
        .in("user_id", reportIds);
      teamQueryError = firstError(reportUsersError, reportSkillsError);

      const userMap = new Map(
        (reportUsers ?? []).map((u: { id: string; first_name: string | null; last_name: string | null }) => [
          u.id,
          `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "Sin nombre",
        ])
      );

      const skillsByUser = new Map<string, TeamMember["skills"]>();
      for (const es of (reportSkills ?? []) as unknown[]) {
        const row = es as DirectReportSkillRow;
        const skill = Array.isArray(row.skill) ? row.skill[0] : row.skill;
        const list = skillsByUser.get(row.user_id) ?? [];
        list.push({
          skill_id: row.skill_id,
          skill_name: skill?.name ?? "",
          skill_category: skill?.category ?? "",
          self_assessed_level: row.self_assessed_level,
          manager_assessed_level: row.manager_assessed_level,
        });
        skillsByUser.set(row.user_id, list);
      }

      teamMembers = reportIds.map((uid) => ({
        user_id: uid,
        full_name: userMap.get(uid) ?? "Sin nombre",
        skills: skillsByUser.get(uid) ?? [],
      }));
    }
  }

  // D45: each tab shows the error of the queries that feed it; the others still work.
  const [radarError, catalogError, teamError] = await Promise.all([
    queryErrorMessage("skills_hub.radar", firstError(jobRoleError, roleSkillsRes.error, mySkillsRes.error)),
    queryErrorMessage("skills_hub.catalog", firstError(ontologyRes.error, mySkillsRes.error)),
    queryErrorMessage("skills_hub.team", teamQueryError),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Talent Intelligence Hub</h1>
        <p className="mt-1 text-sm text-fg-muted">
          TIH — Gestiona tus competencias, compara tu perfil y explora la ontología de habilidades
        </p>
      </div>
      <SkillsHubDashboard
        ontology={ontology}
        mySkills={mySkills}
        roleSkills={roleSkills}
        teamMembers={teamMembers}
        isManager={isManager}
        errors={{ radar: radarError, catalog: catalogError, team: teamError }}
      />
    </div>
  );
}
