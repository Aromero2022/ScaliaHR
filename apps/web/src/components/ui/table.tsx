import { Fragment, type ReactNode } from "react";

// D43: a table from 768 px; under 768 px the same rows as cards, one <dl> per
// row (each label above its value), so a 320 px page never scrolls sideways (WCAG 1.4.10). The variant that
// does not fit is display:none and out of the accessibility tree. Columns
// marked `action` (a link per row) go at the foot of each card.

export type Column<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  className?: string;
  action?: boolean;
};

export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty: ReactNode;
}) {
  const fields = columns.filter((c) => !c.action);
  const actions = columns.filter((c) => c.action);

  if (rows.length === 0) {
    return <p className="px-6 py-12 text-center text-sm text-fg-subtle">{empty}</p>;
  }

  return (
    <>
      {/* relative: visually hidden text (absolute) stays inside the scroller instead of widening the page. */}
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-xs font-medium uppercase tracking-wider text-fg-subtle">
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-6 py-3">
                  {c.action ? <span className="sr-only">{c.header}</span> : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="transition hover:bg-surface-hover">
                {columns.map((c) => (
                  <td key={c.key} className={c.className ?? "px-6 py-4 text-fg-muted"}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="relative px-4 py-4">
            {/* Each label above its value, full width: at 320 px a side column of labels leaves no room for the values. */}
            <dl className="space-y-3 text-sm">
              {fields.map((c) => (
                <div key={c.key}>
                  <dt className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{c.header}</dt>
                  <dd className="mt-1 min-w-0 break-words text-fg-muted">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-3">
                {actions.map((c) => (
                  <Fragment key={c.key}>{c.cell(row)}</Fragment>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
