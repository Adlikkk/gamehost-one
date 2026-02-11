import type { ReactNode } from "react";

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-3xl bg-surface shadow-soft ring-1 ring-white/5">
      {title && (
        <div className="flex items-center justify-between gap-4 border-b border-white/5 px-6 py-4">
          <h3 className="font-display text-lg text-text">{title}</h3>
          {action}
        </div>
      )}
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}
