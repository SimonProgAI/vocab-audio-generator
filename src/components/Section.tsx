import { useId, type ReactNode } from "react";

interface SectionProps {
  step: number;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function Section({ step, title, description, actions, children }: SectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700"
          >
            {step}
          </span>
          <div>
            <h2 id={headingId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
