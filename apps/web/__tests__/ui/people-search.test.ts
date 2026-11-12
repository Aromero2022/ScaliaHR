// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonSearch from "@/components/person-search";
import { messages } from "@/lib/i18n/es-MX";

/**
 * 9c PR 6c: /api/colleagues refuses a bad request with 400 (body), 403
 * (Origin) or 415 (Content-Type). PersonSearch shows its own safe message for
 * any of them, as for any other failure, never the text the route answered and
 * never "no results".
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function search(text: string) {
  act(() => root.render(createElement(PersonSearch, { name: "subject_id", label: "Buscar destinatario" })));
  const input = container.querySelector<HTMLInputElement>("input[role=combobox]")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // 250 ms of debounce before the request, 600 ms more before the live region reads it.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

describe("PersonSearch when /api/colleagues refuses the request (9c PR 6c)", () => {
  it("sends the search as a JSON POST body", async () => {
    fetchMock.mockResolvedValue(Response.json({ colleagues: [] }));
    await search("ana");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/colleagues");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ q: "ana" });
  });

  it.each([
    [400, { colleagues: [] }],
    [403, { error: "No se pudo completar la operación. Intenta de nuevo. Código: req-6c-403" }],
    [415, { error: "unsupported_media_type" }],
  ])("a %i shows the safe search error, not the route's text nor 'no results'", async (status, body) => {
    fetchMock.mockResolvedValue(Response.json(body, { status }));
    await search("ana");
    const text = container.textContent ?? "";
    expect(container.querySelector(".text-danger-fg")?.textContent).toBe(messages.peopleSearch.error);
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe(messages.peopleSearch.error);
    expect(text).not.toContain(messages.peopleSearch.none);
    expect(text).not.toContain("Código");
    expect(text).not.toContain("unsupported_media_type");
    expect(container.querySelector("[role=listbox]")?.hasAttribute("hidden")).toBe(true);
  });
});
