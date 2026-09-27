import clsx from "clsx";
import type { ReactNode } from "react";

/** Classes for one tab; also usable on a react-router <NavLink className={({isActive}) => tabClasses(isActive)}>. */
export function tabClasses(active: boolean) {
  return clsx(
    "whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-sm font-medium no-underline transition-colors hover:no-underline",
    active
      ? "border-pcgreen-300 text-gray-900 dark:text-gray-100"
      : "border-transparent text-gray-500 hover:border-pcgreen-300/50 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
  );
}

/** Wrapper for a row of tabs (buttons or NavLinks styled with tabClasses). */
export function TabList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx("border-b border-gray-200 dark:border-gray-800", className)}>
      <nav className="-mb-px flex gap-6 overflow-x-auto">{children}</nav>
    </div>
  );
}

/** Controlled tabs for in-page state. For URL-based tabs, use <TabList> with NavLinks + tabClasses. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <TabList className={className}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={tabClasses(tab.id === value)}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </TabList>
  );
}
