"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { sendTestEmail, type TestEmailState } from "./actions";

export function TestEmailButton({ defaultTo }: { defaultTo: string }) {
  const [state, action, pending] = useActionState<TestEmailState, FormData>(sendTestEmail, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Send a test email to</span>
        <input
          name="to"
          type="email"
          required
          defaultValue={defaultTo}
          placeholder="recipient@example.com"
          className="w-72 rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
      >
        <Send className="h-4 w-4" />
        {pending ? "Sending…" : "Send test"}
      </button>
      {state.ok ? <p className="w-full text-sm text-status-valid">Sent — check the inbox (and spam).</p> : null}
      {state.error ? <p className="w-full text-sm text-status-expired">{state.error}</p> : null}
    </form>
  );
}
