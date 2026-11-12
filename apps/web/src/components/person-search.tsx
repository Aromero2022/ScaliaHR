"use client";

import { useEffect, useId, useRef, useState } from "react";
import { clsx } from "clsx";
import { messages } from "@/lib/i18n/es-MX";
import { tooManyRequestsText } from "@/lib/rate-limit-message";

// D38: pick a person of the tenant by searching (/api/colleagues: at least 2
// letters, at most 20 matches) instead of a <select> with every employee.
// The chosen id goes in a hidden input called `name`, so forms read it as before.
// 9c PR 6b: an ARIA 1.2 combobox. The input owns a listbox (aria-controls,
// aria-expanded, aria-activedescendant); Down and Up move through the people,
// Enter picks one, Esc closes the list (a second Esc reaches the dialog). The
// number of people found is read by a polite live region once the typing
// settles, not on every key. A 429 or a failure shows a safe message, never
// "no results"; so does a refused request (400, 403, 415, 9c PR 6c), whatever
// text the route answered.

const t = messages.peopleSearch;

export interface PersonOption {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
}

export type PeopleSearch =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: PersonOption[] }
  | { status: "error"; notice: string };

/** /api/colleagues for a query of 2 letters or more, 250 ms after the last key. */
export function usePeopleSearch(query: string, includeSelf: boolean): PeopleSearch {
  const [search, setSearch] = useState<PeopleSearch>({ status: "idle" });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearch({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearch({ status: "loading" });
      try {
        // 9c PR 6c: the search goes in the body, never in the URL.
        const res = await fetch("/api/colleagues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, ...(includeSelf ? { self: true } : {}) }),
          signal: controller.signal,
        });
        if (res.status === 429) {
          setSearch({ status: "error", notice: tooManyRequestsText(Number(res.headers.get("Retry-After")) || 60) });
        } else if (!res.ok) {
          setSearch({ status: "error", notice: t.error });
        } else {
          const body = (await res.json()) as { colleagues?: PersonOption[] };
          setSearch({ status: "done", results: body.colleagues ?? [] });
        }
      } catch {
        if (!controller.signal.aborted) setSearch({ status: "error", notice: t.error });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, includeSelf]);
  return search;
}

/** The text a polite live region reads: set only once `text` has not changed for `delay` ms. */
export function useSettledAnnouncement(text: string, delay = 600): string {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), delay);
    return () => clearTimeout(timer);
  }, [text, delay]);
  return settled;
}

/** What the search says about itself: how many people, none, or why it could not search. */
export function searchAnnouncement(search: PeopleSearch): string {
  if (search.status === "done") return search.results.length > 0 ? t.found(search.results.length) : t.none;
  if (search.status === "error") return search.notice;
  return "";
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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const search = usePeopleSearch(person ? "" : query, includeSelf);
  const results = search.status === "done" ? search.results : [];
  const announcement = useSettledAnnouncement(searchAnnouncement(search));
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useRef<"input" | "change" | null>(null);
  const describe = (p: PersonOption) => `${p.first_name} ${p.last_name}${showEmail && p.email ? ` (${p.email})` : ""}`;
  const optionId = (index: number) => `${listId}-option-${index}`;

  // New results: the list opens if there are any, with no option active yet.
  useEffect(() => {
    setActive(-1);
    setOpen(search.status === "done" && search.results.length > 0);
  }, [search]);

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  });

  useEffect(() => {
    if (focusAfterRender.current === "change") changeRef.current?.focus();
    if (focusAfterRender.current === "input") inputRef.current?.focus();
    focusAfterRender.current = null;
  }, [person]);

  function choose(p: PersonOption) {
    focusAfterRender.current = "change";
    setPerson(p);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const count = results.length;
    if (e.key === "ArrowDown" && count > 0) {
      setOpen(true);
      setActive((i) => (i + 1) % count);
    } else if (e.key === "ArrowUp" && count > 0) {
      setOpen(true);
      setActive((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (e.key === "Enter" && open && active >= 0) {
      choose(results[active]);
    } else if (e.key === "Escape" && open) {
      setOpen(false);
      setActive(-1);
    } else {
      return;
    }
    e.preventDefault();
  }

  return (
    <div>
      <input type="hidden" name={name} value={person?.id ?? ""} />
      {person ? (
        <div className="mt-1 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised pl-3 text-sm text-fg">
          <span className="min-w-0 wrap-anywhere">{describe(person)}</span>
          <button
            ref={changeRef}
            type="button"
            aria-label={t.change(describe(person))}
            onClick={() => {
              focusAfterRender.current = "input";
              setPerson(null);
              setQuery("");
            }}
            className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-medium text-fg-muted hover:text-fg"
          >
            {t.changeLabel}
          </button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
            placeholder={t.placeholder}
            className="mt-1 min-h-11 w-full rounded-lg border border-control bg-surface-raised px-3 text-sm text-fg outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          />
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            hidden={!open}
            className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-surface-raised"
          >
            {results.map((p, index) => (
              <li
                key={p.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                // Keeps the focus on the input, which owns the list.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
                className={clsx(
                  "flex min-h-11 cursor-pointer items-center px-3 text-sm text-fg",
                  index === active ? "bg-surface-hover" : "hover:bg-surface-hover",
                )}
              >
                {describe(p)}
              </li>
            ))}
          </ul>
          {search.status === "error" && <p className="mt-1 text-sm text-danger-fg">{search.notice}</p>}
          {search.status === "done" && search.results.length === 0 && <p className="mt-1 text-sm text-fg-muted">{t.none}</p>}
        </>
      )}
      <p aria-live="polite" className="sr-only">
        {person ? "" : announcement}
      </p>
    </div>
  );
}
