import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, string> = {
  info: "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200",
  success:
    "border-pcgreen-100/50 bg-pcgreen-100/10 text-pcgreen-300 dark:border-pcgreen-300/50 dark:bg-pcgreen-300/20 dark:text-pcgreen-100",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  danger: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

/** Inline notice for empty/error/not-connected states. Use instead of alert(). */
export function Alert({
  tone = "info",
  title,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { tone?: AlertTone; title?: ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx("rounded-md border p-3 text-sm", tones[tone], className)}
      {...props}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={clsx(title && "mt-1")}>{children}</div>}
    </div>
  );
}
