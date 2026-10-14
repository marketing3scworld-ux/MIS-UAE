"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Copy, Check, KeyRound } from "lucide-react";
import { setUserPassword, type SetPasswordState } from "./actions";

// Password cell in the Super-Admin user list: hidden by default, revealed on the
// eye toggle, copyable, plus an inline "Set" form.
//
// `password` is null when the account pre-dates the recoverable copy (its original
// password is a one-way bcrypt hash and genuinely cannot be recovered) — setting a
// new one here is what fills it in.
export function UserPasswordCell({ id, password }: { id: number; password: string | null }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<SetPasswordState>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Called with the form's own FormData. Awaiting the action here — rather than
  // reacting to it in an effect — lets us close the panel and pull the row down
  // again the moment it succeeds, so the reveal shows the password just set instead
  // of the previous one (or "not recorded").
  const formAction = (fd: FormData) =>
    startTransition(async () => {
      const res = await setUserPassword(id, {}, fd);
      setState(res);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });

  const copy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin / permissions) — the reveal still works.
    }
  };

  const iconBtn = "rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground";

  return (
    <div className="min-w-[200px]">
      <div className="flex items-center gap-1">
        {password ? (
          <>
            <span className={shown ? "font-mono text-xs text-foreground" : "text-xs tracking-widest text-muted-foreground"}>
              {shown ? password : "••••••••"}
            </span>
            <button type="button" onClick={() => setShown((v) => !v)} className={iconBtn} title={shown ? "Hide password" : "Show password"} aria-label={shown ? "Hide password" : "Show password"}>
              {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={copy} className={iconBtn} title="Copy password" aria-label="Copy password">
              {copied ? <Check className="h-3.5 w-3.5 text-status-valid" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground" title="Set a new password to record one">
            not recorded
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className={iconBtn}
          title="Set a new password"
          aria-label="Set a new password"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
      </div>

      {editing ? (
        <form action={formAction} className="mt-1.5 flex items-center gap-1">
          <input
            name="password"
            type="text"
            autoComplete="off"
            placeholder="New password (min 8)"
            className="w-40 rounded-md border border-input bg-white px-2 py-1 text-xs outline-none focus:border-brand-gold"
          />
          <button type="submit" disabled={pending} className="rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-secondary disabled:opacity-50">
            {pending ? "Saving…" : "Set"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="px-1 text-[11px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </form>
      ) : null}

      {state.error ? <p className="mt-1 text-[11px] text-status-expired">{state.error}</p> : null}
      {state.ok ? <p className="mt-1 text-[11px] text-status-valid">{state.ok}</p> : null}
    </div>
  );
}
