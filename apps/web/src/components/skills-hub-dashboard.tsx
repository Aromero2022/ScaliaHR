"use client";

import { useState, useTransition } from "react";
import { clsx } from "clsx";
import {
  updateSelfAssessment,
  setManagerAssessment,
} from "@/app/(protected)/skills-hub/actions";

interface OntologySkill {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  is_active: boolean;
}

interface MySkill {
  skill_id: string;
  self_assessed_level: number;
  manager_assessed_level: number | null;
  skill_name: string;
  skill_code: string;
  skill_category: string;
}

interface RoleSkill {
  skill_id: string;
  required_level: number;
  skill_name: string;
  skill_code: string;
  skill_category: string;
}

interface TeamMemberSkill {
  skill_id: string;
  skill_name: string;
  skill_category: string;
  self_assessed_level: number;
  manager_assessed_level: number | null;
}

interface TeamMember {
  user_id: string;
  full_name: string;
  skills: TeamMemberSkill[];
}

interface Props {
  ontology: OntologySkill[];
  mySkills: MySkill[];
  roleSkills: RoleSkill[];
  teamMembers?: TeamMember[];
  isManager?: boolean;
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  technical: { label: "Técnica", color: "text-category-1-fg", bg: "bg-category-1-subtle border-category-1-line" },
  soft: { label: "Interpersonal", color: "text-category-2-fg", bg: "bg-category-2-subtle border-category-2-line" },
  language: { label: "Idioma", color: "text-category-3-fg", bg: "bg-category-3-subtle border-category-3-line" },
};


type TabKey = "radar" | "catalog" | "team";

export default function SkillsHubDashboard({
  ontology,
  mySkills,
  roleSkills,
  teamMembers = [],
  isManager = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("radar");

  const assessedCount = mySkills.length;
  const gapCount = roleSkills.filter(
    (rs) => {
      const mine = mySkills.find((ms) => ms.skill_id === rs.skill_id);
      return !mine || mine.self_assessed_level < rs.required_level;
    }
  ).length;
  const avgLevel =
    assessedCount > 0
      ? (mySkills.reduce((sum, s) => sum + s.self_assessed_level, 0) / assessedCount).toFixed(1)
      : "—";

  const tabs: { key: TabKey; label: string }[] = [
    { key: "radar", label: "Radar de Competencias" },
    { key: "catalog", label: "Catálogo de Habilidades" },
  ];
  if (isManager) {
    tabs.push({ key: "team", label: "Mi Equipo" });
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className={clsx("grid gap-4", isManager ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        <StatTile label="Habilidades Evaluadas" value={assessedCount} />
        <StatTile label="Brechas Detectadas" value={gapCount} accent="amber" />
        <StatTile label="Nivel Promedio" value={avgLevel} accent="indigo" />
        {isManager && (
          <StatTile label="Reportes Directos" value={teamMembers.length} accent="emerald" />
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-surface-muted p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={clsx(
              "flex-1 rounded-md px-4 py-2 text-sm font-medium transition",
              activeTab === tab.key
                ? "bg-accent text-on-accent shadow-sm"
                : "text-fg-muted hover:text-fg"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "radar" ? (
        <SkillRadar mySkills={mySkills} roleSkills={roleSkills} />
      ) : activeTab === "team" ? (
        <TeamView members={teamMembers} />
      ) : (
        <SkillCatalog ontology={ontology} mySkills={mySkills} />
      )}
    </div>
  );
}

/* ─── Stat Tile ──────────────────────────────────────────────────── */

function StatTile({
  label,
  value,
  accent = "slate",
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  const ring =
    accent === "amber"
      ? "border-warning-line"
      : accent === "indigo"
        ? "border-accent-line"
        : accent === "emerald"
          ? "border-success-line"
          : "border-line";
  return (
    <div className={clsx("rounded-xl border bg-surface p-4", ring)}>
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="mt-1 text-2xl font-bold text-fg">{value}</p>
    </div>
  );
}

/* ─── Skill Radar / Comparison ───────────────────────────────────── */

function SkillRadar({ mySkills, roleSkills }: { mySkills: MySkill[]; roleSkills: RoleSkill[] }) {
  const [editingSkill, setEditingSkill] = useState<string | null>(null);

  const merged = roleSkills.map((rs) => {
    const mine = mySkills.find((ms) => ms.skill_id === rs.skill_id);
    return {
      skill_id: rs.skill_id,
      skill_name: rs.skill_name,
      skill_category: rs.skill_category,
      required_level: rs.required_level,
      self_level: mine?.self_assessed_level ?? 0,
      manager_level: mine?.manager_assessed_level ?? null,
      has_assessment: !!mine,
    };
  });

  const unmatched = mySkills.filter(
    (ms) => !roleSkills.some((rs) => rs.skill_id === ms.skill_id)
  );

  if (roleSkills.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <p className="text-fg-muted">
          No hay habilidades requeridas asociadas a tu puesto actual.
        </p>
        <p className="mt-2 text-sm text-fg-subtle">
          Contacta a tu administrador para configurar el perfil de competencias de tu rol.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Visual radar bars */}
      <div className="rounded-xl border border-line bg-surface p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Perfil vs. Requisitos del Puesto
        </h3>
        <div className="space-y-3">
          {merged.map((item) => {
            const gap = item.required_level - item.self_level;
            const isGap = gap > 0;
            return (
              <div key={item.skill_id} className="group">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg">{item.skill_name}</span>
                    {item.manager_level !== null && (
                      <span className="text-xs text-success-fg">✓ Manager</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {isGap && (
                      <span className="text-warning-fg">Brecha: {gap}</span>
                    )}
                    <button
                      onClick={() =>
                        setEditingSkill(
                          editingSkill === item.skill_id ? null : item.skill_id
                        )
                      }
                      className="text-accent-fg opacity-0 transition group-hover:opacity-100"
                    >
                      Evaluar
                    </button>
                  </div>
                </div>
                {/* Double bar */}
                <div className="relative h-5 overflow-hidden rounded-full bg-surface-raised">
                  {/* Required level background */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-surface-strong"
                    style={{ width: `${(item.required_level / 5) * 100}%` }}
                  />
                  {/* Self assessed level foreground */}
                  <div
                    className={clsx(
                      "absolute inset-y-0 left-0 rounded-full transition-all",
                      isGap ? "bg-warning" : "bg-success"
                    )}
                    style={{ width: `${(item.self_level / 5) * 100}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-2 text-xs font-medium text-fg">
                    <span>Tú: {item.self_level}/5</span>
                    <span className="text-fg-muted">Req: {item.required_level}/5</span>
                  </div>
                </div>
                {editingSkill === item.skill_id && (
                  <LevelSelector
                    skillId={item.skill_id}
                    currentLevel={item.self_level}
                    onDone={() => setEditingSkill(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-4 text-xs text-fg-subtle">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-success" /> Tu nivel
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-warning" /> Brecha
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-surface-strong" /> Requerido
          </span>
        </div>
      </div>

      {/* Skills not required by role but self-assessed */}
      {unmatched.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-fg-muted">
            Habilidades Adicionales (fuera del perfil del puesto)
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {unmatched.map((ms) => (
              <div
                key={ms.skill_id}
                className="flex items-center justify-between rounded-lg border border-line bg-surface-muted px-4 py-3"
              >
                <div>
                  <span className="text-sm font-medium text-fg">{ms.skill_name}</span>
                  <span
                    className={clsx(
                      "ml-2 text-xs",
                      CATEGORY_CONFIG[ms.skill_category]?.color ?? "text-fg-muted"
                    )}
                  >
                    {CATEGORY_CONFIG[ms.skill_category]?.label ?? ms.skill_category}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span
                      key={i}
                      className={clsx(
                        "h-2 w-2 rounded-full",
                        i < ms.self_assessed_level ? "bg-accent" : "bg-surface-strong"
                      )}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Level Selector ─────────────────────────────────────────────── */

function LevelSelector({
  skillId,
  currentLevel,
  onDone,
}: {
  skillId: string;
  currentLevel: number;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSelect(level: number) {
    setError(null);
    startTransition(async () => {
      const result = await updateSelfAssessment({ skillId, level });
      if ("error" in result) {
        setError(result.error);
      } else {
        onDone();
      }
    });
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-raised p-3">
      <span className="text-xs text-fg-muted">Auto-evaluación:</span>
      {[1, 2, 3, 4, 5].map((level) => (
        <button
          key={level}
          disabled={pending}
          onClick={() => handleSelect(level)}
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition",
            level === currentLevel
              ? "bg-accent text-on-accent"
              : "bg-surface-raised text-fg-muted hover:bg-surface-hover"
          )}
        >
          {level}
        </button>
      ))}
      <button
        onClick={onDone}
        className="ml-auto text-xs text-fg-subtle hover:text-fg"
      >
        Cancelar
      </button>
      {error && <span className="text-xs text-danger-fg">{error}</span>}
    </div>
  );
}

/* ─── Skill Catalog ──────────────────────────────────────────────── */

function SkillCatalog({
  ontology,
  mySkills,
}: {
  ontology: OntologySkill[];
  mySkills: MySkill[];
}) {
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const categories = Array.from(new Set(ontology.map((s) => s.category)));

  const filtered = ontology.filter((s) => {
    if (filter !== "ALL" && s.category !== filter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const grouped = filtered.reduce<Record<string, OntologySkill[]>>((acc, s) => {
    const cat = s.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar habilidad..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-focus"
        />
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilter("ALL")}
            className={clsx(
              "rounded-md px-3 py-1 text-xs font-medium transition",
              filter === "ALL"
                ? "bg-accent text-on-accent"
                : "bg-surface-raised text-fg-muted hover:text-fg"
            )}
          >
            Todas
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={clsx(
                "rounded-md px-3 py-1 text-xs font-medium transition",
                filter === cat
                  ? "bg-accent text-on-accent"
                  : "bg-surface-raised text-fg-muted hover:text-fg"
              )}
            >
              {CATEGORY_CONFIG[cat]?.label ?? cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped Skills */}
      {Object.entries(grouped).map(([cat, skills]) => (
        <div key={cat}>
          <h3
            className={clsx(
              "mb-3 text-sm font-semibold uppercase tracking-wider",
              CATEGORY_CONFIG[cat]?.color ?? "text-fg-muted"
            )}
          >
            {CATEGORY_CONFIG[cat]?.label ?? cat} ({skills.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {skills.map((skill) => {
              const mine = mySkills.find((ms) => ms.skill_id === skill.id);
              return (
                <SkillCard key={skill.id} skill={skill} myLevel={mine?.self_assessed_level} />
              );
            })}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <p className="text-fg-muted">No se encontraron habilidades.</p>
        </div>
      )}
    </div>
  );
}

/* ─── Skill Card (Catalog) ───────────────────────────────────────── */

function SkillCard({
  skill,
  myLevel,
}: {
  skill: OntologySkill;
  myLevel?: number;
}) {
  const [showAssess, setShowAssess] = useState(false);
  const catConf = CATEGORY_CONFIG[skill.category];

  return (
    <div
      className={clsx(
        "rounded-xl border p-4 transition hover:border-control",
        catConf?.bg ?? "bg-surface border-line"
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-sm font-semibold text-fg">{skill.name}</h4>
          <span className={clsx("text-xs", catConf?.color ?? "text-fg-muted")}>
            {catConf?.label ?? skill.category}
          </span>
        </div>
        {myLevel !== undefined && (
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={clsx(
                  "h-1.5 w-1.5 rounded-full",
                  i < myLevel ? "bg-accent" : "bg-surface-strong"
                )}
              />
            ))}
          </div>
        )}
      </div>
      {skill.description && (
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{skill.description}</p>
      )}
      <div className="mt-3 flex items-center justify-between">
        {myLevel !== undefined ? (
          <span className="text-xs text-fg-subtle">Tu nivel: {myLevel}/5</span>
        ) : (
          <span className="text-xs text-fg-subtle">Sin evaluar</span>
        )}
        <button
          onClick={() => setShowAssess(!showAssess)}
          className="text-xs text-accent-fg hover:text-fg"
        >
          {showAssess ? "Cerrar" : "Evaluar"}
        </button>
      </div>
      {showAssess && (
        <LevelSelector
          skillId={skill.id}
          currentLevel={myLevel ?? 0}
          onDone={() => setShowAssess(false)}
        />
      )}
    </div>
  );
}

/* ─── Team View (Manager) ───────────────────────────────────────── */

function TeamView({ members }: { members: TeamMember[] }) {
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  if (members.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <p className="text-fg-muted">No tienes reportes directos registrados.</p>
        <p className="mt-2 text-sm text-fg-subtle">
          Los reportes se determinan por la relación de manager en la información de puesto.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {members.map((member) => {
        const isExpanded = expandedMember === member.user_id;
        const skillCount = member.skills.length;
        const avgLevel =
          skillCount > 0
            ? (
                member.skills.reduce((s, sk) => s + sk.self_assessed_level, 0) /
                skillCount
              ).toFixed(1)
            : "—";
        const assessedByManager = member.skills.filter(
          (sk) => sk.manager_assessed_level !== null
        ).length;

        return (
          <div
            key={member.user_id}
            className="rounded-xl border border-line bg-surface overflow-hidden"
          >
            <button
              onClick={() =>
                setExpandedMember(isExpanded ? null : member.user_id)
              }
              className="flex w-full items-center justify-between p-4 text-left transition hover:bg-surface-hover"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-subtle text-sm font-semibold text-accent-fg">
                  {member.full_name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-fg">
                    {member.full_name}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {skillCount} habilidades · Promedio: {avgLevel} ·{" "}
                    {assessedByManager}/{skillCount} evaluadas por manager
                  </p>
                </div>
              </div>
              <span
                className={clsx(
                  "text-fg-muted transition",
                  isExpanded && "rotate-180"
                )}
              >
                ▾
              </span>
            </button>

            {isExpanded && (
              <div className="border-t border-line p-4">
                {member.skills.length === 0 ? (
                  <p className="text-sm text-fg-subtle">
                    Este colaborador aún no ha registrado habilidades.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {member.skills.map((skill) => (
                      <TeamSkillRow
                        key={skill.skill_id}
                        userId={member.user_id}
                        skill={skill}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Team Skill Row ────────────────────────────────────────────── */

function TeamSkillRow({
  userId,
  skill,
}: {
  userId: string;
  skill: TeamMemberSkill;
}) {
  const [showAssess, setShowAssess] = useState(false);
  const catConf = CATEGORY_CONFIG[skill.skill_category];

  return (
    <div className="rounded-lg border border-line bg-surface-muted p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg">
            {skill.skill_name}
          </span>
          <span className={clsx("text-xs", catConf?.color ?? "text-fg-muted")}>
            {catConf?.label ?? skill.skill_category}
          </span>
        </div>
        <button
          onClick={() => setShowAssess(!showAssess)}
          className="text-xs text-success-fg hover:text-fg"
        >
          {showAssess ? "Cerrar" : "Evaluar"}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-subtle">Auto:</span>
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={clsx(
                  "h-2 w-2 rounded-full",
                  i < skill.self_assessed_level
                    ? "bg-accent"
                    : "bg-surface-strong"
                )}
              />
            ))}
          </div>
          <span className="text-xs text-fg-muted">
            {skill.self_assessed_level}/5
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-subtle">Manager:</span>
          {skill.manager_assessed_level !== null ? (
            <>
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={clsx(
                      "h-2 w-2 rounded-full",
                      i < (skill.manager_assessed_level ?? 0)
                        ? "bg-success"
                        : "bg-surface-strong"
                    )}
                  />
                ))}
              </div>
              <span className="text-xs text-success-fg">
                {skill.manager_assessed_level}/5
              </span>
            </>
          ) : (
            <span className="text-xs text-fg-subtle">Sin evaluar</span>
          )}
        </div>
      </div>
      {showAssess && (
        <ManagerLevelSelector
          userId={userId}
          skillId={skill.skill_id}
          currentLevel={skill.manager_assessed_level ?? 0}
          onDone={() => setShowAssess(false)}
        />
      )}
    </div>
  );
}

/* ─── Manager Level Selector ────────────────────────────────────── */

function ManagerLevelSelector({
  userId,
  skillId,
  currentLevel,
  onDone,
}: {
  userId: string;
  skillId: string;
  currentLevel: number;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSelect(level: number) {
    setError(null);
    startTransition(async () => {
      const result = await setManagerAssessment({ userId, skillId, level });
      if ("error" in result) {
        setError(result.error);
      } else {
        onDone();
      }
    });
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-raised p-3">
      <span className="text-xs text-fg-muted">Evaluación manager:</span>
      {[1, 2, 3, 4, 5].map((level) => (
        <button
          key={level}
          disabled={pending}
          onClick={() => handleSelect(level)}
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition",
            level === currentLevel
              ? "bg-success text-on-success"
              : "bg-surface-raised text-fg-muted hover:bg-surface-hover"
          )}
        >
          {level}
        </button>
      ))}
      <button
        onClick={onDone}
        className="ml-auto text-xs text-fg-subtle hover:text-fg"
      >
        Cancelar
      </button>
      {error && <span className="text-xs text-danger-fg">{error}</span>}
    </div>
  );
}
