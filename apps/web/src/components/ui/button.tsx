import Link from "next/link";
import { clsx } from "clsx";
import type { ComponentProps } from "react";

// D43: one button for every action. A view has at most one primary (the
// static test in __tests__/static/one-primary-per-view.test.ts); `variant`
// omitted means primary. At least 44 px high (D19).

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-control bg-surface text-fg hover:bg-surface-hover",
  danger: "bg-danger text-on-danger hover:bg-danger-hover",
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
};

export function buttonClassName(variant: ButtonVariant = "primary", className?: string): string {
  return clsx(BASE, VARIANTS[variant], className);
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; loading?: boolean };

export function Button({ variant = "primary", loading = false, disabled, className, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName(variant, className)}
      {...rest}
    >
      {loading && (
        <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />
      )}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant };

/** A link that looks like a button (navigation, not an action on the page). */
export function ButtonLink({ variant = "primary", className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClassName(variant, className)} {...rest} />;
}
