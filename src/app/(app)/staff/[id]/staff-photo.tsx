"use client";

import { useRef, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Camera, User, Loader2 } from "lucide-react";
import { IMAGE_ACCEPT_ATTR } from "@/lib/documents";
import { uploadDocument, type DocActionState } from "./doc-actions";

// The staff avatar shown next to the name. Backed by a PHOTO document (reuses the
// upload/storage/serve pipeline). Clicking the camera opens the file dialog and
// uploads immediately — no drop-down panel that would overlap the cards below.
export function StaffPhoto({
  staffId,
  photoId,
  initials,
  canView,
  canEdit,
}: {
  staffId: number;
  photoId: number | null;
  initials: string;
  canView: boolean;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<DocActionState, FormData>(
    uploadDocument.bind(null, staffId),
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // Re-render the server component so the freshly uploaded photo replaces the old
  // one (or the initials) straight away.
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <div className="relative flex-none">
      <div className="relative h-20 w-20 overflow-hidden rounded-full border border-border bg-secondary">
        {photoId && canView ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/documents/${photoId}`} alt="Staff photo" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
            {initials || <User className="h-8 w-8" />}
          </div>
        )}
        {pending ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <form ref={formRef} action={action} className="contents">
          <input type="hidden" name="type" value="PHOTO" />
          <label
            title={photoId ? "Change photo" : "Add photo"}
            className="absolute -bottom-1 -end-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border bg-white text-muted-foreground shadow transition-colors hover:text-foreground"
          >
            <Camera className="h-3.5 w-3.5" />
            <input
              type="file"
              name="file"
              accept={IMAGE_ACCEPT_ATTR}
              className="sr-only"
              disabled={pending}
              onChange={(e) => {
                if (e.target.files?.[0]) formRef.current?.requestSubmit();
              }}
            />
          </label>
        </form>
      ) : null}

      {state.error ? (
        <p className="absolute -bottom-6 start-0 whitespace-nowrap text-[11px] font-medium text-status-expired">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
