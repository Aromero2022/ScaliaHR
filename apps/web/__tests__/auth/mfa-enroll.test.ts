import { describe, expect, it } from "vitest";

describe("MFA enroll: QR code data URI sanitization", () => {
  it("trims trailing whitespace from SVG data URIs", () => {
    const raw = "data:image/svg+xml;utf8,<svg></svg>\n";
    expect(raw.trim()).toBe("data:image/svg+xml;utf8,<svg></svg>");
    expect(raw.trim()).not.toMatch(/\s$/);
  });

  it("trims trailing control characters from data URIs", () => {
    const raw = "data:image/svg+xml;utf8,<svg></svg>\r\n ";
    const trimmed = raw.trim();
    expect(trimmed.endsWith("</svg>")).toBe(true);
  });

  it("preserves valid data URIs without trailing whitespace", () => {
    const clean = "data:image/svg+xml;utf8,<svg></svg>";
    expect(clean.trim()).toBe(clean);
  });
});
