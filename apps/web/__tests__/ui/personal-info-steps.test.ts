// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 9c PR 6d: the steps of "Actualizar información personal" in a DOM. The
 * focus goes to each step's title on a step change (not on open), a step only
 * goes forward with valid fields, the errors are announced and shown next to
 * each field, and the server's errors take the form back to their step. The
 * keyboard, the native <dialog> and reduced motion are checked in Chromium on
 * the production image (e2e).
 */

const mockSave = vi.fn();
vi.mock("@/app/(protected)/employees/[id]/actions", () => ({
  createPersonalInfoChange: (...args: unknown[]) => mockSave(...args),
}));

import { PersonalInfoSteps } from "@/components/personal-info-steps";
import { messages } from "@/lib/i18n/es-MX";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const t = messages.personalInfoForm;

let container: HTMLElement;
let root: Root;
const onDone = vi.fn();

async function renderSteps(current: { firstName: string; lastName: string } | null = { firstName: "Ana", lastName: "López" }) {
  await act(async () =>
    root.render(createElement(PersonalInfoSteps, { employeeId: "e1", today: "2026-11-27", current, blocked: false, onDone })),
  );
}
const visibleStep = () => container.querySelector<HTMLElement>("[data-step]:not([hidden])")!;
const input = (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const submit = async () => act(async () => container.querySelector("form")!.requestSubmit());
const primaryButtons = () =>
  [...container.querySelectorAll("button")].filter((b) => b.className.includes("bg-accent") && b.className.includes("text-on-accent"));

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PersonalInfoSteps (9c PR 6d)", () => {
  it("opens on step 1 without moving the focus, with one primary button", async () => {
    await renderSteps();
    expect(visibleStep().dataset.step).toBe("nombre");
    expect(visibleStep().querySelector("h3")!.textContent).toBe(t.stepTitle(1, 3, t.steps.name));
    expect(document.activeElement).toBe(document.body);
    expect(primaryButtons().map((b) => b.textContent)).toEqual([t.next]);
    expect(container.querySelectorAll("[data-step]")).toHaveLength(3);
  });

  it("stays on a step with an empty required field, announces it and marks the field", async () => {
    await renderSteps({ firstName: "", lastName: "López" });
    await submit();
    expect(visibleStep().dataset.step).toBe("nombre");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(t.stepErrors(1));
    expect(input("firstName").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input("firstName").getAttribute("aria-describedby")!)!.textContent).toBe(t.required);
    expect(document.activeElement).toBe(input("firstName"));
  });

  it("moves to the next step and focuses its title, keeping what was typed", async () => {
    await renderSteps();
    input("middleName").value = "María";
    await submit();
    expect(visibleStep().dataset.step).toBe("contacto");
    expect(document.activeElement).toBe(visibleStep().querySelector("h3"));
    expect(document.activeElement!.textContent).toBe(t.stepTitle(2, 3, t.steps.contact));
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === t.back)!.click());
    expect(visibleStep().dataset.step).toBe("nombre");
    expect(document.activeElement).toBe(visibleStep().querySelector("h3"));
    expect(input("middleName").value).toBe("María");
  });

  it("rejects a malformed email on its step with the form's own message", async () => {
    await renderSteps();
    await submit();
    input("personalEmail").value = "no-es-correo";
    await submit();
    expect(visibleStep().dataset.step).toBe("contacto");
    expect(document.getElementById(input("personalEmail").getAttribute("aria-describedby")!)!.textContent).toBe(t.invalidEmail);
  });

  it("sends the whole object on the last step and goes back to the step of a server error", async () => {
    mockSave.mockResolvedValue({ success: false, error: t.fixFields, fieldErrors: { personalEmail: t.invalidEmail } });
    await renderSteps();
    await submit();
    input("personalEmail").value = "a@b";
    await submit();
    input("eventReason").value = "Cambio de domicilio";
    expect(primaryButtons().map((b) => b.textContent)).toEqual([t.save]);
    await submit();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toMatchObject({ userId: "e1", firstName: "Ana", lastName: "López", personalEmail: "a@b", eventReason: "Cambio de domicilio", country: "MX" });
    expect(visibleStep().dataset.step).toBe("contacto");
    expect(document.activeElement).toBe(visibleStep().querySelector("h3"));
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(t.fixFields);
    expect(input("personalEmail").getAttribute("aria-invalid")).toBe("true");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows a failure that no field explains, or an action that throws, and stays open", async () => {
    mockSave.mockResolvedValueOnce({ success: false, error: "Demasiadas solicitudes." });
    await renderSteps();
    await submit();
    await submit();
    input("eventReason").value = "Cambio de domicilio";
    await submit();
    const failure = () => container.querySelectorAll('[role="alert"]')[1]!.textContent;
    expect(failure()).toBe("Demasiadas solicitudes.");
    expect(visibleStep().dataset.step).toBe("domicilio");
    mockSave.mockRejectedValueOnce(new Error("network"));
    await submit();
    expect(failure()).toBe(t.saveFailed);
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("sends nothing more after a save, and a closed dialog's timer never calls onDone", async () => {
    vi.useFakeTimers();
    mockSave.mockResolvedValue({ success: true, data: { id: "rec-1" } });
    await renderSteps();
    await submit();
    await submit();
    input("eventReason").value = "Cambio de domicilio";
    await submit();
    await submit();
    expect(mockSave).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => vi.advanceTimersByTime(1200));
    expect(onDone).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("clears the error count when going back", async () => {
    await renderSteps();
    await submit();
    input("personalEmail").value = "no-es-correo";
    await submit();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(t.stepErrors(1));
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === t.back)!.click());
    expect(visibleStep().dataset.step).toBe("nombre");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("");
  });

  it("shows the saved message and closes after a successful save", async () => {
    vi.useFakeTimers();
    mockSave.mockResolvedValue({ success: true, data: { id: "rec-1" } });
    await renderSteps();
    await submit();
    await submit();
    input("eventReason").value = "Cambio de domicilio";
    await submit();
    expect(container.querySelector('[role="status"]')!.textContent).toBe(t.saved);
    await act(async () => vi.advanceTimersByTime(1200));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
