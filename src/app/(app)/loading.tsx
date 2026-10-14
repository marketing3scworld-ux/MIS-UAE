// Loading boundary for every signed-in page.
//
// This is not only cosmetic. Without a loading.tsx, Next prefetches the WHOLE page
// behind each <Link> in the viewport and keeps it in the browser's Client Cache for
// `staleTimes.static` (5 minutes by default) — and the sidebar links are always in
// the viewport. That is what made freshly added staff, edited profiles and new
// users fail to appear until a hard refresh or a re-login.
//
// With a loading boundary, prefetching stops at this skeleton and the page segment
// itself is governed by `staleTimes.dynamic` (0 — never reused), so every
// navigation re-reads the database. See next.config.ts.
export default function AppLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-48 rounded bg-slate-200/80" />
      <div className="mt-2 h-4 w-32 rounded bg-slate-200/60" />

      <div className="mt-6 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 w-36 rounded-md bg-slate-200/60" />
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="h-10 border-b border-border bg-slate-100/80" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
            <div className="h-4 w-8 rounded bg-slate-200/70" />
            <div className="h-4 flex-1 rounded bg-slate-200/70" />
            <div className="h-4 w-28 rounded bg-slate-200/50" />
            <div className="h-4 w-24 rounded bg-slate-200/50" />
            <div className="h-4 w-20 rounded bg-slate-200/50" />
          </div>
        ))}
      </div>
    </div>
  );
}
