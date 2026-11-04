import type { Locale } from "./contract.js";

/** What the tenant has configured (company configuration). Every field is optional. */
export interface TenantBranding {
  tenantName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  locale?: string | null;
}

export interface ResolvedBranding {
  tenantName: string;
  logoUrl: string | null;
  primaryColor: string;
  buttonTextColor: string;
  locale: Locale | null;
}

export const DEFAULT_BRANDING = {
  tenantName: "ScaliaHR",
  primaryColor: "#4F46E5",
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function safeLogoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Applies the tenant's logo and primary color when they are valid, and the
 * ScaliaHR brand otherwise. The button text color is white or near-black,
 * whichever reaches 4.5:1 against the primary color; a color that reaches
 * neither falls back to the default brand color.
 */
export function resolveBranding(input?: TenantBranding | null): ResolvedBranding {
  const tenantName = input?.tenantName?.trim() || DEFAULT_BRANDING.tenantName;
  let primaryColor = input?.primaryColor && HEX.test(input.primaryColor) ? input.primaryColor : DEFAULT_BRANDING.primaryColor;

  const pickText = (bg: string) =>
    contrastRatio(bg, "#FFFFFF") >= 4.5 ? "#FFFFFF" : contrastRatio(bg, "#111827") >= 4.5 ? "#111827" : null;
  let buttonTextColor = pickText(primaryColor);
  if (!buttonTextColor) {
    primaryColor = DEFAULT_BRANDING.primaryColor;
    buttonTextColor = "#FFFFFF";
  }

  const locale = input?.locale === "es" || input?.locale === "en" ? input.locale : null;
  return { tenantName, logoUrl: safeLogoUrl(input?.logoUrl), primaryColor, buttonTextColor, locale };
}
