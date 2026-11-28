import type { ReactNode } from "react";

// D43: each row is rendered once, in one markup for both layouts (D36, the
// user's decision of 2026-11-28). From 768 px it lays out as a table
// (display: table-*); under 768 px each row is a card with each label above
// its value, meant to keep a 320 px page from scrolling sideways (WCAG 1.4.10;
// the e2e checks it). The roles are explicit (table, rowgroup, row,
// columnheader, cell) because a change of display can take the native table
// semantics away.
// - The header row stays in the accessibility tree at every width: visually
//   hidden under 768 px, visible from 768 px.
// - Each card shows its labels under 768 px, readable in a linear reading
//   too; from 768 px they are display:none and the header row names the cells.
// - Columns marked `action` (a link per row) get a header for screen readers
//   only and no card label. Table keeps the order of `columns`: declare them
//   last so they sit at the foot of each card.
// - A column's `className` is for the table layout: under 768 px its padding
//   and text alignment are reset for the card.

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
  if (rows.length === 0) {
    return <p className="px-6 py-12 text-center text-sm text-fg-subtle">{empty}</p>;
  }

  return (
    // relative: visually hidden text (absolute) is contained here instead of widening the page; the scroller exists from 768 px.
    <div className="relative md:overflow-x-auto">
      <div role="table" aria-label={caption} className="w-full text-left text-sm md:table md:border-collapse">
        <div role="rowgroup" className="sr-only md:not-sr-only md:table-header-group">
          <div role="row" className="text-xs font-medium uppercase tracking-wider text-fg-subtle md:table-row md:border-b md:border-line">
            {columns.map((c) => (
              <div key={c.key} role="columnheader" className="md:table-cell md:px-6 md:py-3 md:align-middle">
                {c.action ? <span className="sr-only">{c.header}</span> : c.header}
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup" className="divide-y divide-line md:table-row-group">
          {rows.map((row) => (
            <div key={rowKey(row)} role="row" className="relative space-y-3 px-4 py-4 md:table-row md:p-0 md:transition md:hover:bg-surface-hover">
              {columns.map((c) => (
                <div
                  key={c.key}
                  role="cell"
                  className={`block md:table-cell md:align-middle ${c.className ?? "px-6 py-4 text-fg-muted"} max-md:min-w-0 max-md:break-words max-md:p-0 max-md:text-left max-md:empty:hidden`}
                >
                  {!c.action && (
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle md:hidden">{c.header}</span>
                  )}
                  {c.cell(row)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
