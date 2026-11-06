"use client";

import { useEffect, useState } from "react";

// D38: pick a person of the tenant by searching (/api/colleagues: at least 2
// letters, at most 20 matches) instead of a <select> with every employee.
// The chosen id goes in a hidden input called `name`, so forms read it as before.

export interface PersonOption {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
}

function usePeopleSearch(query: string, includeSelf: boolean): PersonOption[] {
  const [results, setResults] = useState<PersonOption[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q, ...(includeSelf ? { self: "1" } : {}) });
      fetch(`/api/colleagues?${params}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { colleagues: [] }))
        .then((body: { colleagues?: PersonOption[] }) => setResults(body.colleagues ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, includeSelf]);
  return results;
}

export default function PersonSearch({
  name,
  label,
  includeSelf = false,
  showEmail = false,
}: {
  name: string;
  label: string;
  includeSelf?: boolean;
  showEmail?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<PersonOption | null>(null);
  const results = usePeopleSearch(person ? "" : query, includeSelf);
  const describe = (p: PersonOption) => `${p.first_name} ${p.last_name}${showEmail && p.email ? ` (${p.email})` : ""}`;

  return (
    <div>
      <input type="hidden" name={name} value={person?.id ?? ""} />
      {person ? (
        <div className="mt-1 flex items-center justify-between rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-fg">
          <span>{describe(person)}</span>
          <button type="button" onClick={() => setPerson(null)} className="text-xs text-fg-muted hover:text-fg">
            Cambiar
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Escribe al menos 2 letras del nombre o correo"
            aria-label={label}
            className="mt-1 w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          />
          {results.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-surface-raised">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setPerson(p)}
                    className="w-full px-3 py-2 text-left text-sm text-fg hover:bg-surface-hover"
                  >
                    {describe(p)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
