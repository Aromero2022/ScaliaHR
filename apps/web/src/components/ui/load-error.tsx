// D45: what a section or a page shows in place of its content when the query
// that feeds it fails. The message comes from safeError() (D27): a generic text
// and the request id, never the database's error.
export function LoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-danger-line bg-danger-subtle p-6 text-center">
      <p className="text-sm text-danger-fg">{message}</p>
    </div>
  );
}

/** D45: the whole page, when its main query fails (the record of a detail page, the own profile). */
export function PageLoadError({ title, message }: { title: string; message: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-fg">{title}</h1>
      <LoadError message={message} />
    </div>
  );
}
