"use client";

export interface PositionNode {
  id: string;
  position_code: string;
  title: string;
  is_vacant: boolean;
  parent_position_id: string | null;
  department_name: string | null;
  occupant_name: string | null;
  occupant_email: string | null;
  job_classification_title: string | null;
}

interface TreeProps {
  positions: PositionNode[];
}

export default function OrgTree({ positions }: TreeProps) {
  const childrenMap = new Map<string | null, PositionNode[]>();
  for (const p of positions) {
    const key = p.parent_position_id;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(p);
  }

  const roots = childrenMap.get(null) ?? [];

  if (roots.length === 0) {
    return (
      <p className="text-sm text-fg-subtle">
        No hay datos de organigrama disponibles.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 overflow-x-auto pb-8">
      {roots.map((root) => (
        <Branch key={root.id} node={root} childrenMap={childrenMap} depth={0} />
      ))}
    </div>
  );
}

function Branch({
  node,
  childrenMap,
  depth,
}: {
  node: PositionNode;
  childrenMap: Map<string | null, PositionNode[]>;
  depth: number;
}) {
  const children = childrenMap.get(node.id) ?? [];

  return (
    <div className="flex flex-col items-center">
      <PositionCard node={node} depth={depth} />

      {children.length > 0 && (
        <>
          <div className="h-6 w-px bg-control" />
          <div className="relative flex gap-6">
            {children.length > 1 && (
              <div className="absolute top-0 left-[calc(50%-1px)] h-px w-[calc(100%-3rem)] -translate-x-1/2 bg-control" />
            )}
            {children.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="h-6 w-px bg-control" />
                <Branch node={child} childrenMap={childrenMap} depth={depth + 1} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PositionCard({ node, depth }: { node: PositionNode; depth: number }) {
  if (node.is_vacant) {
    return (
      <div className="w-52 rounded-xl border border-dashed border-warning-line bg-surface p-4 text-center shadow-lg">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-warning-subtle text-lg">
          ?
        </div>
        <p className="mt-2 text-sm font-semibold text-warning-fg">
          Vacante
        </p>
        <p className="text-xs text-fg-muted">{node.title}</p>
        <p className="text-xs text-fg-subtle">{node.department_name ?? ""}</p>
        <span className="mt-2 inline-block rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-medium text-warning-fg">
          To Be Hired
        </span>
      </div>
    );
  }

  const initials = node.occupant_name
    ? node.occupant_name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
    : "??";

  const ringColor =
    depth === 0
      ? "border-accent-line"
      : depth === 1
        ? "border-success-line"
        : "border-line";

  const avatarTone =
    depth === 0
      ? "bg-accent text-on-accent"
      : depth === 1
        ? "bg-success text-on-success"
        : "bg-surface-raised text-fg";

  return (
    <div
      className={`w-52 rounded-xl border bg-surface p-4 text-center shadow-lg ${ringColor}`}
    >
      <div
        className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${avatarTone}`}
      >
        {initials}
      </div>
      <p className="mt-2 text-sm font-semibold text-fg">
        {node.occupant_name ?? "—"}
      </p>
      <p className="text-xs text-fg-muted">{node.title}</p>
      <p className="text-xs text-fg-subtle">{node.department_name ?? ""}</p>
    </div>
  );
}
