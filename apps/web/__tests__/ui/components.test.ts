// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** D43: the base components in a DOM. */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children),
}));

import { Button, ButtonLink } from "@/components/ui/button";
import { InputField, SelectField, TextareaField } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { StatCard } from "@/components/ui/stat-card";
import { BADGE_TONES, Badge, ENUM_TONES, badgeTone } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { TOAST_MS, ToastProvider, useToast } from "@/components/ui/toast";
import { SkeletonPage } from "@/components/ui/skeleton";
import { ENUM_LABELS, type EnumName } from "@/lib/i18n/es-MX";
import { contrastPairs } from "@/lib/theme/contrast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
const render = (element: React.ReactElement) => act(() => root.render(element));

beforeAll(() => {
  // jsdom has no <dialog>: the browser behavior (focus trap, Esc, focus return)
  // is checked in Chromium on the production image. Here, open and close.
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  proto.close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Button (D43)", () => {
  it("is a primary 44 px button by default, of type button", async () => {
    await render(createElement(Button, null, "Guardar"));
    const b = container.querySelector("button")!;
    expect(b.type).toBe("button");
    expect(b.className).toContain("min-h-11");
    expect(b.className).toContain("bg-accent text-on-accent");
  });

  it("disables itself and sets aria-busy while loading; other variants are not primary", async () => {
    await render(
      createElement("div", null, createElement(Button, { loading: true }, "Enviando"), createElement(Button, { variant: "secondary" }, "Cancelar")),
    );
    const [busy, secondary] = [...container.querySelectorAll("button")];
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(secondary.className).not.toContain("bg-accent ");
    expect(secondary.hasAttribute("aria-busy")).toBe(false);
  });

  it("ButtonLink is a link with the same look", async () => {
    await render(createElement(ButtonLink, { href: "/x", variant: "secondary" }, "Ir"));
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/x");
    expect(a.className).toContain("min-h-11");
  });
});

describe("Field (D43)", () => {
  it("ties a visible label, the hint and the error to the control", async () => {
    await render(createElement(InputField, { label: "Correo", name: "email", required: true, hint: "Tu correo de trabajo", error: "Correo inválido" }));
    const input = container.querySelector("input")!;
    const label = container.querySelector("label")!;
    expect(label.getAttribute("for")).toBe(input.id);
    expect(label.textContent).toContain("Correo");
    expect(label.querySelector("[aria-hidden='true']")?.textContent).toContain("*");
    const described = input.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)!.textContent);
    expect(described).toEqual(["Tu correo de trabajo", "Correo inválido"]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.required).toBe(true);
  });

  it("has no aria-describedby or aria-invalid without hint or error, for select and textarea too", async () => {
    await render(
      createElement("form", null,
        createElement(SelectField, { label: "Tipo", name: "t" }, createElement("option", { value: "a" }, "A")),
        createElement(TextareaField, { label: "Notas", name: "n" }),
      ),
    );
    for (const control of container.querySelectorAll("select, textarea")) {
      expect(control.hasAttribute("aria-describedby")).toBe(false);
      expect(control.hasAttribute("aria-invalid")).toBe(false);
      expect(container.querySelector(`label[for='${control.id}']`)).not.toBeNull();
    }
  });
});

describe("Dialog (D43)", () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return createElement(
      "div",
      null,
      createElement("button", { id: "opener", onClick: () => setOpen(true) }, "Abrir"),
      createElement(
        Dialog,
        {
          open,
          title: "Nuevo objetivo",
          onClose: () => {
            onClose();
            setOpen(false);
          },
        } as React.ComponentProps<typeof Dialog>,
        createElement("input", { name: "x" }),
      ),
    );
  }

  it("opens with showModal, is named by its title, and renders content only while open", async () => {
    const onClose = vi.fn();
    await render(createElement(Harness, { onClose }));
    const dialog = container.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(dialog.querySelector("input")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("#opener")!.click());
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.textContent).toBe("Nuevo objetivo");
    expect(dialog.querySelector("input")).not.toBeNull();
  });

  it("the close button and Esc (the native close event) both close it", async () => {
    const onClose = vi.fn();
    await render(createElement(Harness, { onClose }));
    const dialog = container.querySelector("dialog")!;
    await act(async () => container.querySelector<HTMLButtonElement>("#opener")!.click());
    const close = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cerrar")!;
    expect(close.className).toContain("h-11 w-11");
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(dialog.querySelector("input")).toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>("#opener")!.click());
    await act(async () => dialog.close()); // what the browser does on Esc
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(dialog.querySelector("input")).toBeNull();
  });
});

describe("Badge (D43)", () => {
  it("always shows the enumLabel() text, never color alone (WCAG 1.4.1)", async () => {
    await render(createElement(Badge, { enumName: "GoalStatus", value: "ON_TRACK" }));
    const badge = container.querySelector("span")!;
    expect(badge.textContent).toBe("En curso");
    expect(badge.className).toContain("bg-success-subtle text-success-fg");
  });

  it("every tone is a D40 contrast pair (checked in light, dark and high contrast by the contrast test)", () => {
    const pairs = contrastPairs().filter((p) => p.kind === "text");
    for (const [tone, { fg, bg, className }] of Object.entries(BADGE_TONES)) {
      expect(pairs.some((p) => p.fg === fg && p.bg === bg && p.min >= 4.5), `${tone}: ${fg} on ${bg}`).toBe(true);
      expect(className.split(" ").sort(), tone).toEqual([`bg-${bg}`, `text-${fg}`].sort());
    }
  });

  it("maps only real enum values, and anything else to neutral", () => {
    for (const [name, tones] of Object.entries(ENUM_TONES)) {
      const labels = ENUM_LABELS[name as EnumName] as Record<string, string>;
      for (const [value, tone] of Object.entries(tones!)) {
        expect(labels[value], `${name}.${value}`).toBeDefined();
        expect(BADGE_TONES[tone]).toBeDefined();
      }
    }
    expect(badgeTone("GoalStatus", "SOMETHING_NEW")).toBe("neutral");
    expect(badgeTone("pay_frequency", "monthly")).toBe("neutral");
  });
});

describe("StatCard (D43)", () => {
  it("shows the label and the figure; an icon is decorative", async () => {
    await render(createElement(StatCard, { label: "Pendientes", value: 3, tone: "warning", icon: createElement("svg") }));
    expect(container.textContent).toContain("Pendientes");
    expect(container.textContent).toContain("3");
    expect(container.querySelector("[aria-hidden='true'] svg")).not.toBeNull();
  });
});

describe("Table (D43)", () => {
  const columns = [
    { key: "name", header: "Empleado", cell: (r: { id: string; name: string }) => r.name },
    { key: "link", header: "Acciones", action: true, cell: (r: { id: string; name: string }) => createElement("a", { href: `/e/${r.id}` }, "Ver perfil") },
  ];

  it("is a table with a caption and column headers from 768 px, and cards under it", async () => {
    await render(createElement(Table<{ id: string; name: string }>, { caption: "Empleados", columns, rows: [{ id: "1", name: "Ana" }, { id: "2", name: "Luis" }], rowKey: (r) => r.id, empty: "Nadie" }));
    const table = container.querySelector("table")!;
    expect(table.parentElement!.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "md:block"]));
    expect(table.querySelector("caption")!.textContent).toBe("Empleados");
    expect([...table.querySelectorAll("th")].map((th) => th.getAttribute("scope"))).toEqual(["col", "col"]);
    expect(table.querySelector("th:last-child .sr-only")!.textContent).toBe("Acciones");

    const cards = container.querySelector("ul")!;
    expect(cards.className).toContain("md:hidden");
    expect(cards.getAttribute("aria-label")).toBe("Empleados");
    const first = cards.querySelector("li")!;
    expect([...first.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Empleado"]);
    expect(first.querySelector("dd")!.className).toContain("break-words");
    expect(first.querySelector("a")!.getAttribute("href")).toBe("/e/1");
  });

  it("shows the empty text without a table", async () => {
    await render(createElement(Table<{ id: string; name: string }>, { caption: "Empleados", columns, rows: [], rowKey: (r) => r.id, empty: "No hay empleados registrados." }));
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toBe("No hay empleados registrados.");
  });
});

describe("Toast (D43)", () => {
  function Sender() {
    const toast = useToast();
    return createElement("button", { id: "send", onClick: () => toast.success("Objetivo creado correctamente") }, "Enviar");
  }
  const send = () => act(async () => container.querySelector<HTMLButtonElement>("#send")!.click());
  const toast = () => container.querySelector<HTMLElement>("[data-toast]");

  it("announces in a polite status region and closes by itself after TOAST_MS", async () => {
    vi.useFakeTimers();
    await render(createElement(ToastProvider, null, createElement(Sender)));
    const region = container.querySelector("[role='status']")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.children).toHaveLength(0);
    await send();
    expect(region.textContent).toContain("Objetivo creado correctamente");
    await act(async () => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(toast()).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(toast()).toBeNull();
  });

  it("pauses while hovered or focused (WCAG 2.2.1), and Esc or its button closes it", async () => {
    vi.useFakeTimers();
    await render(createElement(ToastProvider, null, createElement(Sender)));
    await send();
    await act(async () => {
      toast()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(TOAST_MS * 3));
    expect(toast()).not.toBeNull();
    await act(async () => {
      toast()!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => vi.advanceTimersByTime(TOAST_MS));
    expect(toast()).toBeNull();

    await send();
    const close = toast()!.querySelector("button")!;
    await act(async () => close.focus());
    await act(async () => vi.advanceTimersByTime(TOAST_MS * 3));
    expect(toast()).not.toBeNull();
    await act(async () => {
      close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(toast()).toBeNull();

    await send();
    await act(async () => toast()!.querySelector("button")!.click());
    expect(toast()).toBeNull();
  });
});

describe("Skeleton (D43)", () => {
  it("announces loading once and draws decorative blocks", async () => {
    await render(createElement(SkeletonPage));
    const region = container.querySelector("[role='status']")!;
    expect(region.className).toContain("skeleton-region");
    expect(region.querySelector(".sr-only")!.textContent).toBe("Cargando…");
    expect(region.querySelectorAll(".skeleton-block[aria-hidden='true']").length).toBeGreaterThan(3);
  });

  it("appears after 400 ms with CSS alone, and has no shimmer with reduced motion", () => {
    const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf-8");
    const region = css.slice(css.indexOf(".skeleton-region {"), css.indexOf("}", css.indexOf(".skeleton-region {")));
    expect(region).toContain("opacity: 0;");
    expect(region).toMatch(/animation: skeleton-reveal [^;]* 400ms forwards;/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n    .skeleton-block"));
    expect(reduced).toMatch(/\.skeleton-block \{\s*background-image: none;\s*animation: none;/);
  });
});
