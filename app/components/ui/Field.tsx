import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

/** Shared classes for text inputs, selects and textareas (Contactzilla's form style). */
export const controlClasses =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 shadow-sm " +
  "placeholder:text-gray-400 sm:text-sm " +
  "focus:border-pcgreen-100 focus:outline-none focus:ring-1 focus:ring-pcgreen-300 " +
  "disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 " +
  "aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500 " +
  "dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800";

type InvalidProp = {
  /** Marks the control invalid (red border, aria-invalid). */
  invalid?: boolean;
};

export function Input({ className, invalid, ...props }: ComponentProps<"input"> & InvalidProp) {
  return (
    <input
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={clsx(controlClasses, className)}
      {...props}
    />
  );
}

export function Select({ className, invalid, ...props }: ComponentProps<"select"> & InvalidProp) {
  return (
    <select
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={clsx(controlClasses, "pr-8", className)}
      {...props}
    />
  );
}

export function Textarea({ className, invalid, ...props }: ComponentProps<"textarea"> & InvalidProp) {
  return (
    <textarea
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={clsx(controlClasses, "min-h-20", className)}
      {...props}
    />
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={clsx(
        "size-4 rounded border-gray-300 accent-pcgreen-200 focus-visible:ring-2 focus-visible:ring-pcgreen-300",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={clsx("block text-sm font-medium text-gray-700 dark:text-gray-300", className)}
      {...props}
    />
  );
}

/**
 * Label + control + hint/error, stacked. Pass the control as children and give it the same `id`
 * as `htmlFor`, e.g. <Field label="Name" htmlFor="name" error={errors.name}><Input id="name" name="name" invalid={!!errors.name} /></Field>
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={clsx("space-y-1", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}
