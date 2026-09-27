import clsx from "clsx";
import type { ComponentProps } from "react";

export type BadgeTone = "gray" | "green" | "red" | "amber" | "blue";

const tones: Record<BadgeTone, string> = {
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  green: "bg-pcgreen-100/20 text-pcgreen-300 dark:bg-pcgreen-300/30 dark:text-pcgreen-100",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  blue: "bg-pcblue/10 text-pcblue dark:bg-pcblue/25 dark:text-violet-300",
};

export function Badge({ tone = "gray", className, ...props }: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
