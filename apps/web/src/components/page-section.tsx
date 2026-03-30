import type { PropsWithChildren } from 'react';

interface PageSectionProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
}

export function PageSection({ title, subtitle, children }: PageSectionProps) {
  return (
    <section className="card">
      <header className="card__header">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div className="card__body">{children}</div>
    </section>
  );
}
