"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { titleCaseLabel } from "@/lib/format";
import { renameClient, renameProject, deleteClient, deleteProject } from "./actions";

// Rename / delete for a client or one of its events, inline on the list. Deleting is
// refused once anything has been scheduled against it — the server says so and the
// message is shown here, which is why this is a client component.

const btn = "rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary";
const fld = "rounded border border-input bg-white px-2 py-1 text-[11px] outline-none focus:border-brand-gold";

export function ClientRowActions({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      if (!confirm(`Delete the client "${titleCaseLabel(name)}" and its events?`)) return;
      const res = await deleteClient(id);
      setError(res.error ?? "");
      if (!res.error) router.refresh();
    });

  if (editing) {
    return (
      <form
        action={async (fd) => { await renameClient(id, fd); setEditing(false); router.refresh(); }}
        className="flex items-center gap-1"
      >
        <input name="name" defaultValue={name} autoFocus className={`${fld} w-44 uppercase`} />
        <button type="submit" className={btn}>Save</button>
        <button type="button" onClick={() => setEditing(false)} className={btn}>Cancel</button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {error ? <span className="me-1 text-[11px] text-status-expired">{error}</span> : null}
      <button type="button" onClick={() => setEditing(true)} className={btn} title="Rename">
        <Pencil className="h-3 w-3" />
      </button>
      <button type="button" onClick={remove} disabled={pending} className={`${btn} text-status-expired`} title="Delete">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

export function ProjectRowActions({
  id,
  name,
  location,
}: {
  id: number;
  name: string;
  location: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      if (!confirm(`Delete the event "${titleCaseLabel(name)}"?`)) return;
      const res = await deleteProject(id);
      setError(res.error ?? "");
      if (!res.error) router.refresh();
    });

  if (editing) {
    return (
      <form
        action={async (fd) => { await renameProject(id, fd); setEditing(false); router.refresh(); }}
        className="flex flex-wrap items-center gap-1"
      >
        <input name="name" defaultValue={name} autoFocus className={`${fld} w-40 uppercase`} />
        <input name="location" defaultValue={location ?? ""} placeholder="Location" className={`${fld} w-32 uppercase`} />
        <button type="submit" className={btn}>Save</button>
        <button type="button" onClick={() => setEditing(false)} className={btn}>Cancel</button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {error ? <span className="me-1 text-[11px] text-status-expired">{error}</span> : null}
      <button type="button" onClick={() => setEditing(true)} className={btn} title="Rename or change location">
        <Pencil className="h-3 w-3" />
      </button>
      <button type="button" onClick={remove} disabled={pending} className={`${btn} text-status-expired`} title="Delete">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
