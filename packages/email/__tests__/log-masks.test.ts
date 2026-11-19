import { describe, expect, it } from "vitest";
import { maskText } from "../src/log-masks.js";

/** D53: the one list of masks for free text in the logs of the web app and the worker. */
describe("maskText (D53)", () => {
  it.each([
    ["550 5.1.1 <ana.lopez@acme.dev>: user unknown", "550 5.1.1 <[EMAIL]>: user unknown"],
    ["Authorization: Bearer abc.def.ghi", "Authorization: Bearer [REDACTED]"],
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: Basic [REDACTED]"],
    // A JWT is masked first, so the Bearer mask finds nothing left to cover.
    ["Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "Authorization: Bearer [JWT]"],
    // An address goes before the number and RFC masks, which would split it.
    ["12345678901@acme.dev", "[EMAIL]"],
    ["GODE561231GR8@acme.dev", "[EMAIL]"],
    ["rfc GODE561231GR8, curp GODE561231HDFRRN09", "rfc [RFC], curp [CURP]"],
    ["clabe 012180001234567891, card 4111111111111111, nss 12345678901", "clabe [CLABE], card [NUMBER], nss [NSS]"],
  ])("masks %s", (input, output) => {
    expect(maskText(input)).toBe(output);
  });

  it("leaves ordinary text, ids and dates alone", () => {
    const text = "job 3f2b1c9e-8d7a-4b6c-9e5f-1a2b3c4d5e6f failed on 2026-11-19 with code 23505";
    expect(maskText(text)).toBe(text);
  });

  it("gives the same output on repeated calls (the g-flag patterns keep no state)", () => {
    const text = "ana.lopez@acme.dev Bearer abc.def nss 12345678901";
    expect([maskText(text), maskText(text), maskText(text)]).toEqual(Array(3).fill("[EMAIL] Bearer [REDACTED] nss [NSS]"));
  });
});
