import clsx from "clsx";
import type { ComponentProps } from "react";

import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md border font-medium no-underline shadow-sm transition-colors hover:no-underline " +
  "focus:outline-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gray-300 dark:focus-visible:ring-gray-600 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-pcgreen-300 bg-pcgreen-200 text-white hover:bg-pcgreen-100 disabled:hover:bg-pcgreen-200",
  secondary:
    "border-gray-300 bg-white text-black hover:bg-gray-100 disabled:hover:bg-white " +
    "dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700",
  outline:
    "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 disabled:hover:bg-white " +
    "dark:border-gray-700 dark:bg-transparent dark:text-gray-100 dark:hover:bg-gray-800",
  ghost:
    "border-transparent bg-transparent text-gray-700 shadow-none hover:bg-gray-100 disabled:hover:bg-transparent " +
    "dark:text-gray-200 dark:hover:bg-gray-800",
  danger: "border-red-600 bg-red-500 text-white hover:bg-red-600 disabled:hover:bg-red-500",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

/** Class string for a button-styled element (e.g. a react-router <Link>). */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return clsx(base, variants[variant], sizes[size], className);
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button (e.g. while a fetcher is submitting). */
  loading?: boolean;
};

/**
 * Contactzilla-style button. Use `variant="primary"` (green) for the main action on a screen,
 * `secondary`/`outline` for everything else, `ghost` for toolbar/icon buttons and `danger` for
 * destructive actions (behind a ConfirmDialog).
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading && <Spinner className={size === "sm" ? "size-3" : "size-4"} />}
      {children}
    </button>
  );
}
