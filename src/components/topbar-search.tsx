"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

// Global staff search. Submitting (Enter or the icon) navigates to the staff list
// filtered by the query (?q=), matching name / EID / mobile.
export function TopbarSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/staff?q=${encodeURIComponent(query)}` : "/staff");
  }

  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-xs">
      <button
        type="submit"
        aria-label="Search staff"
        className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-white"
      >
        <Search className="h-4 w-4" />
      </button>
      <input
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
        placeholder={placeholder}
        className="w-full rounded-lg border border-input py-2.5 pe-3 ps-9 text-sm text-white placeholder:text-white/55 outline-none focus:border-brand-gold focus:ring-2 focus:ring-ring/30"
      />
    </form>
  );
}
