"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, Trash2 } from "lucide-react";
import type { DocumentType } from "@prisma/client";
import { DOC_SLOTS, DOC_TYPE_META, DOC_ACCEPT_ATTR, DOC_ACCEPT_HINT } from "@/lib/documents";
import { FilePicker } from "@/components/file-picker";
import { uploadDocument, updateDocument, deleteDocument, type DocActionState } from "./doc-actions";

export type GalleryDoc = {
  id: number;
  type: DocumentType;
  fileName: string;
  mimeType: string;
  expiryDate: string; // yyyy-mm-dd or ""
  handlingStatus: string;
  version: number;
};

export function DocumentGallery({
  staffId,
  documents,
  canEditProfile,
  canEditBank,
  canView,
  gridClassName = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
}: {
  staffId: number;
  documents: GalleryDoc[];
  canEditProfile: boolean;
  canEditBank: boolean;
  canView: boolean;
  gridClassName?: string;
}) {
  const byType = new Map(documents.map((d) => [d.type, d]));
  return (
    <div className={gridClassName}>
      {DOC_SLOTS.map((type) => {
        const canEdit = type === "BANK_PROOF" ? canEditProfile || canEditBank : canEditProfile;
        return (
          <DocSlot key={type} staffId={staffId} type={type} doc={byType.get(type)} canEdit={canEdit} canView={canView} />
        );
      })}
    </div>
  );
}

function DocSlot({
  staffId,
  type,
  doc,
  canEdit,
  canView,
}: {
  staffId: number;
  type: DocumentType;
  doc: GalleryDoc | undefined;
  canEdit: boolean;
  canView: boolean;
}) {
  const meta = DOC_TYPE_META[type];
  const [state, setState] = useState<DocActionState>({});
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  const edit = (fd: FormData) =>
    startTransition(async () => {
      if (!doc) return;
      const res = await updateDocument(doc.id, {}, fd);
      setState(res);
      if (res.ok) { setEditing(false); router.refresh(); }
    });

  const remove = () =>
    startTransition(async () => {
      if (!doc) return;
      if (!confirm(`Remove this ${meta.label}? The file is deleted; an earlier version, if there is one, takes its place.`)) return;
      const res = await deleteDocument(doc.id);
      setState(res);
      if (res.ok) router.refresh();
    });

  // Awaiting the upload here — rather than reacting to it in an effect — lets us
  // close the panel and pull the surrounding server component down again the moment
  // it succeeds, so the new version number, expiry and thumbnail replace the old
  // ones without a manual page reload.
  const action = (fd: FormData) =>
    startTransition(async () => {
      const res = await uploadDocument(staffId, {}, fd);
      setState(res);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });

  const isImg = doc?.mimeType.startsWith("image/");

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{meta.label}</span>
        {doc ? (
          <span className="text-[11px] text-muted-foreground">v{doc.version}</span>
        ) : (
          <span className="text-[11px] font-medium text-status-missing">Not uploaded</span>
        )}
      </div>

      {doc && canView ? (
        <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" className="mt-3 block">
          {isImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/documents/${doc.id}`}
              alt={meta.label}
              className="h-32 w-full rounded-md border border-border object-cover"
            />
          ) : (
            <div className="flex h-32 w-full items-center justify-center rounded-md border border-border bg-secondary text-sm text-muted-foreground">
              Open {doc.fileName.split(".").pop()?.toUpperCase()} ↗
            </div>
          )}
        </a>
      ) : doc ? (
        <div className="mt-3 flex h-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          Uploaded — no view permission
        </div>
      ) : (
        <div className="mt-3 flex h-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          No file
        </div>
      )}

      {doc ? (
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div className="truncate" title={doc.fileName}>{doc.fileName}</div>
          {meta.hasExpiry ? <div>Expiry: {doc.expiryDate || "—"}</div> : null}
          <div>Status: {doc.handlingStatus.replace(/_/g, " ").toLowerCase()}</div>
        </div>
      ) : null}

      {doc && canEdit && editing ? (
        <form action={edit} className="mt-3 space-y-2 rounded-md border border-border p-2">
          <label className="block text-[11px] text-muted-foreground">
            Name
            <input name="fileName" defaultValue={doc.fileName} className="mt-0.5 w-full rounded border border-input px-2 py-1 text-xs" />
          </label>
          {meta.hasExpiry ? (
            <label className="block text-[11px] text-muted-foreground">
              Expiry
              <input type="date" name="expiryDate" defaultValue={doc.expiryDate} className="mt-0.5 w-full rounded border border-input px-2 py-1 text-xs" />
            </label>
          ) : null}
          <label className="block text-[11px] text-muted-foreground">
            Status
            <select name="handlingStatus" defaultValue={doc.handlingStatus} className="mt-0.5 w-full rounded border border-input px-2 py-1 text-xs">
              <option value="WITH_EMPLOYEE">With Employee</option>
              <option value="WITH_HR">With HR</option>
              <option value="SUBMITTED">Submitted</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="rounded bg-brand-navy px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
              {pending ? "Saving…" : "Save details"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-border px-2 py-1 text-xs">Cancel</button>
          </div>
        </form>
      ) : null}

      {canEdit && open ? (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="type" value={type} />
          <FilePicker name="file" accept={DOC_ACCEPT_ATTR} hint={DOC_ACCEPT_HINT} buttonLabel="Choose file" />
          {meta.hasExpiry ? (
            <input
              type="date"
              name="expiryDate"
              defaultValue={doc?.expiryDate || ""}
              className="w-full rounded border border-input px-2 py-1 text-xs"
            />
          ) : null}
          <select
            name="handlingStatus"
            defaultValue={doc?.handlingStatus || "SUBMITTED"}
            className="w-full rounded border border-input px-2 py-1 text-xs"
          >
            <option value="WITH_EMPLOYEE">With Employee</option>
            <option value="WITH_HR">With HR</option>
            <option value="SUBMITTED">Submitted</option>
          </select>
          {state.error ? <p className="text-xs text-status-expired">{state.error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-brand-navy px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
            >
              {pending ? "Uploading…" : doc ? "Replace file" : "Upload"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded border border-border px-2 py-1 text-xs">
              Cancel
            </button>
          </div>
        </form>
      ) : (doc && canView) || canEdit ? (
        <div className="mt-3 flex gap-2">
          {doc && canView ? (
            <a
              href={`/api/documents/${doc.id}?dl=1`}
              download={doc.fileName}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-xs font-medium hover:bg-secondary"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
          ) : canEdit ? (
            <span
              title="No file to download yet"
              aria-disabled="true"
              className="flex flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-xs font-medium text-muted-foreground/50"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </span>
          ) : null}
          {canEdit ? (
            <button
              onClick={() => setOpen(true)}
              className="flex-1 rounded-md border border-border py-1.5 text-xs font-medium hover:bg-secondary"
            >
              {doc ? "Replace" : "Upload"}
            </button>
          ) : null}
          {doc && canEdit ? (
            <>
              <button
                type="button"
                onClick={() => { setEditing((v) => !v); setOpen(false); }}
                title="Edit name, expiry and status"
                className="rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-secondary"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                title="Delete this document"
                className="rounded-md border border-border px-2 py-1.5 text-xs font-medium text-status-expired hover:bg-status-expired/10 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {state.error ? <p className="mt-2 text-xs text-status-expired">{state.error}</p> : null}
    </div>
  );
}
