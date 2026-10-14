export function PagePlaceholder({ title, step }: { title: string; step: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
        This section is built in <span className="font-medium text-brand-navy">{step}</span>.
      </div>
    </div>
  );
}
