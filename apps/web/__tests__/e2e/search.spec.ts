// 9c PR 6b: PersonSearch as an ARIA 1.2 combobox (in the feedback dialog) and
// the ⌘K search, with the keyboard alone, in the production image. 9c PR 6c:
// the search travels in a POST body and ⌘K opens the list on a person's id.
import { expect, test, type Page } from "@playwright/test";
import { expectNoWcagViolations } from "./support/axe";
import { storageStatePath } from "./support/env";
import { openProtected, watchPage } from "./support/pages";

async function openFeedbackDialog(page: Page) {
  await openProtected(page, "/performance");
  await page.getByRole("button", { name: /^Feedback Continuo/ }).click();
  await page.getByRole("button", { name: "+ Enviar Feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Enviar Feedback" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("PersonSearch como combobox (empleada)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("empleada")) });

  test("se recorre con el teclado, anuncia los resultados y Esc cierra primero la lista", async ({ page }) => {
    const problems = watchPage(page);
    const dialog = await openFeedbackDialog(page);
    const input = dialog.getByRole("combobox", { name: "Buscar destinatario" });
    const listbox = dialog.getByRole("listbox");

    await expect(input).toHaveAttribute("aria-expanded", "false");
    expect((await input.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(input).toHaveAttribute("aria-controls", (await dialog.locator("[role=listbox]").getAttribute("id")) ?? "missing id");

    await input.focus();
    // 9c PR 6c: the search goes in a POST body, never in the URL.
    const request = page.waitForRequest((r) => r.url().includes("/api/colleagues"));
    await page.keyboard.type("Patricia");
    const sent = await request;
    expect(sent.method()).toBe("POST");
    expect(new URL(sent.url()).search).toBe("");
    expect(sent.postDataJSON()).toEqual({ q: "Patricia" });
    // The browser's own Origin and Content-Type pass the route's checks.
    // allHeaders(): Chromium's network layer adds Origin after the request is created.
    const sentHeaders = await sent.allHeaders();
    expect(sentHeaders["origin"]).toBe(new URL(page.url()).origin);
    expect(sentHeaders["content-type"]).toBe("application/json");
    expect((await sent.response())?.status()).toBe(200);
    await expect(listbox).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "true");
    const option = listbox.getByRole("option", { name: "Patricia Castro" });
    await expect(option).toBeVisible();
    expect((await option.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The polite region reads the count once the typing settles.
    await expect(dialog.locator("[aria-live=polite]")).toHaveText(/^\d+ personas? encontradas?$/);

    // Down makes the first option active without moving the focus off the input.
    await page.keyboard.press("ArrowDown");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-activedescendant", (await listbox.getByRole("option").first().getAttribute("id")) ?? "missing id");
    await expect(listbox.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await expectNoWcagViolations(page, "personsearch con resultados");

    // Esc closes the list and leaves the dialog open; a second Esc would close the dialog.
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "false");

    // Down opens it again; Enter picks the active person and the focus goes to "Cambiar".
    await page.keyboard.press("ArrowDown");
    await expect(listbox).toBeVisible();
    await page.keyboard.press("Enter");
    const change = dialog.getByRole("button", { name: /^Cambiar Patricia Castro/ });
    await expect(change).toBeFocused();
    expect((await change.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await dialog.locator('input[type="hidden"][name="subject_id"]').inputValue()).not.toBe("");
    await expect(dialog).toBeVisible();

    // "Cambiar" brings the search back with the focus on it.
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("combobox", { name: "Buscar destinatario" })).toBeFocused();
    expect(problems()).toEqual([]);
  });

  test("/api/colleagues rechaza un GET, otro Content-Type, otro Origin y un cuerpo inválido", async ({ page }) => {
    await openProtected(page, "/performance");
    const url = new URL("/api/colleagues", page.url()).toString();
    const origin = new URL(page.url()).origin;
    const api = page.request;
    expect((await api.get(`${url}?q=Patricia`)).status()).toBe(405);
    expect((await api.post(url, { headers: { Origin: origin, "Content-Type": "text/plain" }, data: '{"q":"Patricia"}' })).status()).toBe(415);
    for (const foreign of ["https://evil.example", "http://otra-empresa.localhost:3000"]) {
      const refused = await api.post(url, { headers: { Origin: foreign }, data: { q: "Patricia" } });
      expect(refused.status()).toBe(403);
      const { error } = (await refused.json()) as { error: string };
      // The safe message carries the request id of that same response (D27).
      expect(error).toBe(`No se pudo completar la operación. Intenta de nuevo. Código: ${refused.headers()["x-request-id"]}`);
      expect(error).not.toContain("Patricia");
    }
    const invalid = await api.post(url, { headers: { Origin: origin }, data: { q: "P" } });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toEqual({ colleagues: [] });
    expect(invalid.headers()["cache-control"]).toBe("private, no-store");
    const ok = await api.post(url, { headers: { Origin: origin }, data: { q: "Patricia" } });
    expect(ok.status()).toBe(200);
  });

  test("un 429 de /api/colleagues muestra el mensaje seguro, no «sin resultados»", async ({ page }) => {
    const dialog = await openFeedbackDialog(page);
    await page.route("**/api/colleagues", (route) =>
      route.fulfill({ status: 429, headers: { "Retry-After": "30", "Content-Type": "application/json" }, body: '{"error":"too_many_requests"}' }),
    );
    await dialog.getByRole("combobox", { name: "Buscar destinatario" }).fill("Patricia");
    await expect(dialog.getByText("Demasiados intentos. Intenta de nuevo en 30 segundos.")).toBeVisible();
    await expect(dialog.getByText("No se encontraron personas.")).toHaveCount(0);
    await expect(dialog.locator("[aria-live=polite]")).toHaveText("Demasiados intentos. Intenta de nuevo en 30 segundos.");
  });
});

for (const role of ["empleada", "admin"] as const) {
  test.describe(`⌘K (${role})`, () => {
    test.use({ storageState: async ({}, provide) => provide(storageStatePath(role)) });

    test("Ctrl+K abre la búsqueda; se elige un destino con el teclado", async ({ page }) => {
      const problems = watchPage(page);
      await openProtected(page, "/dashboard");
      await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog", { name: "Buscar personas y secciones" });
      await expect(dialog).toBeVisible();
      const input = dialog.getByRole("combobox", { name: "Buscar personas y secciones" });
      await expect(input).toBeFocused();

      await page.keyboard.type("desemp");
      const target = dialog.getByRole("option", { name: "Desempeño" });
      await expect(target).toBeVisible();
      await expect(input).toHaveAttribute("aria-activedescendant", (await target.getAttribute("id")) ?? "missing id");
      await expect(dialog.locator("[aria-live=polite]")).toHaveText(/^\d+ resultados?$/);
      await expectNoWcagViolations(page, `cmdk ${role} destino`);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/performance$/);
      await expect(dialog).toBeHidden();
      expect(problems()).toEqual([]);
    });

    test("con 2 letras busca personas; una persona abre el directorio en ella", async ({ page }) => {
      const problems = watchPage(page);
      await openProtected(page, "/dashboard");
      const opener = page.getByRole("button", { name: "Buscar" });
      expect((await opener.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Buscar personas y secciones" });
      // The search box has the focus as soon as the dialog is open: nothing typed is lost.
      await expect(dialog.getByRole("combobox", { name: "Buscar personas y secciones" })).toBeFocused({ timeout: 100 });
      await page.keyboard.type("Patricia");
      const people = dialog.getByRole("group", { name: "Personas" });
      const person = people.getByRole("option", { name: /Patricia Castro/ });
      await expect(person).toBeVisible();
      // The destinations do not match "Patricia": the first option is the person.
      await expect(dialog.getByRole("combobox", { name: "Buscar personas y secciones" })).toHaveAttribute("aria-activedescendant", (await person.getAttribute("id")) ?? "missing id");
      await expectNoWcagViolations(page, `cmdk ${role} personas`);
      await page.keyboard.press("Enter");
      // 9c PR 6c: by id, never an email in the URL; the list shows that person only.
      await expect(page).toHaveURL(/\/employees\?person=[0-9a-f-]{36}$/);
      expect(page.url()).not.toContain("acme");
      await expect(page.getByText("Filtrado por persona")).toBeVisible();
      await expect(page.getByText("patricia.castro@acme.dev").first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Quitar filtro" })).toHaveAttribute("href", "/employees");

      // Esc closes it and gives the focus back to the button that opened it.
      await opener.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
      expect(problems()).toEqual([]);
    });
  });
}

test.describe("lista de empleados abierta en una persona (admin)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")) });

  test("un id inválido o un correo en ?person= no muestran a nadie, nunca la lista completa", async ({ page }) => {
    for (const person of ["no-es-un-id", "patricia.castro@acme.dev"]) {
      // openProtected() compares the pathname with the whole path, query included.
      const response = await page.goto(`/employees?person=${encodeURIComponent(person)}`);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe("/employees");
      await expect(page.getByText("No se encontró a esa persona.").first()).toBeVisible();
      await expect(page.getByText("patricia.castro@acme.dev")).toHaveCount(0);
    }
  });
});
