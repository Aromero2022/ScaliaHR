import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mask } from "../src/log.js";
import { redactString } from "../../web/src/lib/log/redact.js";

/**
 * D53: the web app and the worker mask free text with one list,
 * @scaliahr/email/log-masks. Neither may keep a copy of its own.
 */

const REPO = path.resolve(__dirname, "../../..");
const SOURCES = ["apps/worker/src/log.ts", "apps/web/src/lib/log/redact.ts"];

describe("one list of log masks for the web app and the worker (D53)", () => {
  it.each(SOURCES)("%s imports the shared list and defines no mask of its own", (file) => {
    const source = readFileSync(path.join(REPO, file), "utf-8");
    expect(source).toMatch(/^import \{ maskText \} from "@scaliahr\/email\/log-masks";$/m);
    // A mask is a [regex literal, "[LABEL]"] pair or a new RegExp.
    expect(source).not.toMatch(/\[\/.*\/[a-z]*,\s*"[^"]*\[[A-Z]+\]"\]/);
    expect(source).not.toMatch(/new RegExp\(/);
  });

  it.each([
    "550 5.1.1 <ana.lopez@acme.dev>: user unknown",
    "Authorization: Bearer abc.def.ghi and Basic dXNlcjpwYXNz",
    "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
    "Key (rfc)=(GODE561231GR8) already exists; curp GODE561231HDFRRN09",
    "clabe 012180001234567891, card 4111111111111111, nss 12345678901, 12345678901@acme.dev",
    "job 3f2b1c9e-8d7a-4b6c-9e5f-1a2b3c4d5e6f failed on 2026-11-19",
  ])("the worker and the web app mask %s the same way", (text) => {
    expect(mask(text)).toBe(redactString(text));
  });
});
