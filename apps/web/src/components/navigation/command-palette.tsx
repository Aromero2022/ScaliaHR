"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { clsx } from "clsx";
import { Dialog } from "@/components/ui/dialog";
import { messages } from "@/lib/i18n/es-MX";
import { usePeopleSearch, useSettledAnnouncement } from "@/components/person-search";
import type { ShellNavItem } from "./app-navigation";

// 9c PR 6b: ⌘K (Ctrl+K) and the header's "Buscar" open a Dialog (D43) with an
// ARIA 1.2 combobox over two groups: the destinations of the menu (the same
// list, already filtered by module and RBP) and, with 2 letters or more, people
// of the tenant (/api/colleagues, rate limited). A person opens the employee
// directory on that person, whose row opens the profile only if the person is
// in the reader's population (D47). Actions ("Tomar Acción para…") come with
// the workflow engine (Phase 10) or the Admin Center (Phase 11).

const t = messages.commandPalette;

type Option = { id: string; label: string; detail?: string; href: string };

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-MX");

export function CommandPalette({ items, people }: { items: ShellNavItem[]; people: boolean }) {
  const [open, setOpen] = useState(false);
  const [shortcut, setShortcut] = useState<string>(t.shortcut);

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("⌘ K");
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-control px-3 text-sm text-fg-muted transition hover:bg-surface-hover hover:text-fg"
      >
        <svg aria-hidden="true" focusable="false" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <span className="sr-only sm:not-sr-only">{t.open}</span>
        <kbd aria-hidden="true" className="hidden rounded-md border border-line px-1.5 font-sans text-xs text-fg-subtle lg:inline">
          {shortcut}
        </kbd>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t.title}>
        <PaletteBody items={items} people={people} onGo={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function PaletteBody({ items, people, onGo }: { items: ShellNavItem[]; people: boolean; onGo: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const search = usePeopleSearch(people ? query : "", true);
  const listId = useId();

  const q = normalize(query.trim());
  const destinations: Option[] = items
    .filter((item) => !q || normalize(item.label).includes(q))
    .map((item) => ({ id: `nav-${item.href}`, label: item.label, href: item.href }));
  const persons: Option[] =
    search.status === "done"
      ? search.results.map((p) => ({
          id: `person-${p.id}`,
          label: `${p.first_name} ${p.last_name}`,
          detail: p.email,
          href: `/employees?q=${encodeURIComponent(p.email ?? p.last_name)}`,
        }))
      : [];
  const options = [...destinations, ...persons];
  const optionId = (option: Option) => `${listId}-${option.id}`;
  const current = options[Math.min(active, options.length - 1)];

  const showPeople = people && query.trim().length >= 2;
  const peopleNote =
    search.status === "error" ? search.notice : search.status === "done" && persons.length === 0 ? messages.peopleSearch.none : "";
  const announcement = useSettledAnnouncement(
    query.trim() ? [t.found(options.length), search.status === "error" ? search.notice : ""].filter(Boolean).join(". ") : "",
  );

  useEffect(() => setActive(0), [query, search]);
  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  });

  function go(option: Option) {
    onGo();
    router.push(option.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (options.length === 0) return;
    if (e.key === "ArrowDown") setActive((i) => (i + 1) % options.length);
    else if (e.key === "ArrowUp") setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    else if (e.key === "Enter" && current) go(current);
    else return;
    e.preventDefault();
  }

  const renderOption = (option: Option) => (
    <li
      key={option.id}
      id={optionId(option)}
      role="option"
      aria-selected={option === current}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => go(option)}
      className={clsx(
        "flex min-h-11 cursor-pointer flex-col justify-center rounded-lg px-3 text-sm text-fg",
        option === current ? "bg-surface-hover" : "hover:bg-surface-hover",
      )}
    >
      <span className="wrap-anywhere">{option.label}</span>
      {option.detail && <span className="text-xs text-fg-muted wrap-anywhere">{option.detail}</span>}
    </li>
  );

  return (
    <div>
      <input
        // The Dialog's showModal() focuses the first [autofocus] element, in the same step that opens it, so no
        // key typed right after opening is lost. React does not write autoFocus as an attribute, hence the ref.
        ref={(el) => {
          el?.setAttribute("autofocus", "");
        }}
        type="search"
        role="combobox"
        aria-label={t.inputLabel}
        aria-autocomplete="list"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-activedescendant={current ? optionId(current) : undefined}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t.placeholder}
        className="min-h-11 w-full rounded-lg border border-control bg-surface-raised px-3 text-sm text-fg outline-none focus:border-focus focus:ring-1 focus:ring-focus"
      />
      <div id={listId} role="listbox" aria-label={t.title} className="mt-3 max-h-[50dvh] space-y-3 overflow-y-auto">
        <ul role="group" aria-labelledby={`${listId}-destinations`} className="space-y-1">
          <li role="presentation" id={`${listId}-destinations`} className="px-3 text-xs font-semibold tracking-wider text-fg-subtle uppercase">
            {t.destinations}
          </li>
          {destinations.map(renderOption)}
          {destinations.length === 0 && (
            <li role="presentation" className="px-3 text-sm text-fg-muted">
              {t.noDestinations}
            </li>
          )}
        </ul>
        {showPeople && (
          <ul role="group" aria-labelledby={`${listId}-people`} className="space-y-1">
            <li role="presentation" id={`${listId}-people`} className="px-3 text-xs font-semibold tracking-wider text-fg-subtle uppercase">
              {t.people}
            </li>
            {persons.map(renderOption)}
            {peopleNote && (
              <li role="presentation" className={clsx("px-3 text-sm", search.status === "error" ? "text-danger-fg" : "text-fg-muted")}>
                {peopleNote}
              </li>
            )}
          </ul>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
