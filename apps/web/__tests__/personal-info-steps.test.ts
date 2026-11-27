import { describe, expect, it } from "vitest";
import {
  PERSONAL_INFO_FIELDS,
  PERSONAL_INFO_STEPS,
  firstStepWithError,
  isPersonalInfoField,
} from "@/lib/personal-info-steps";
import { toFieldErrors } from "@/lib/validations/field-errors";

/** 9c PR 6d: the steps of "Actualizar información personal" and the errors by field. */

describe("the steps of the personal information form", () => {
  it("put every field of the form in exactly one step", () => {
    const placed = PERSONAL_INFO_STEPS.flatMap((step) => step.fields);
    expect([...placed].sort()).toEqual([...PERSONAL_INFO_FIELDS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("go back to the first step with an error, or none", () => {
    expect(firstStepWithError({})).toBeNull();
    expect(firstStepWithError({ eventReason: "x" })).toBe(2);
    expect(firstStepWithError({ personalEmail: "x", eventReason: "y" })).toBe(1);
    expect(firstStepWithError({ firstName: "x", personalEmail: "y" })).toBe(0);
  });

  it("know which keys are form fields", () => {
    expect(isPersonalInfoField("personalEmail")).toBe(true);
    expect(isPersonalInfoField("userId")).toBe(false);
  });
});

describe("toFieldErrors", () => {
  it("keys each error by the first segment of its path, the first message winning", () => {
    expect(
      toFieldErrors([
        { path: ["firstName"], message: "uno" },
        { path: ["firstName"], message: "dos" },
        { path: ["address", "city"], message: "tres" },
        { path: [], message: "sin campo" },
        { path: [0], message: "índice" },
        { path: ["constructor"], message: "cuatro" },
      ]),
    ).toEqual({ firstName: "uno", address: "tres", constructor: "cuatro" });
  });
});
