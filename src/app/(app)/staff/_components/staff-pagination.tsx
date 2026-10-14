"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function StaffPagination({
  page,
  totalPages,
  total,
  pageSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const go = (pg: number) => {
    const usp = new URLSearchParams(sp.toString());
    if (pg <= 1) usp.delete("page");
    else usp.set("page", String(pg));
    const qs = usp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        <button
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-muted-foreground">Page {page} / {totalPages}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => go(page + 1)}
          className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
