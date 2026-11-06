// D41 — keeps Tab and Shift+Tab inside a modal dialog: from the last focusable
// element back to the first, and the other way round.

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("inert"));
}

/** Handles a Tab keydown inside `container`; returns true when it moved the focus itself. */
export function trapTab(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, container: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const items = focusableIn(container);
  if (items.length === 0) {
    event.preventDefault();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = container.ownerDocument.activeElement;
  const outside = !active || !container.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
