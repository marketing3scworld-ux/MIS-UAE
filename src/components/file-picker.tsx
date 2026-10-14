"use client";

import { useId, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImage, prettySize } from "@/lib/compress-image";

// A styled replacement for the raw <input type="file"> ("Choose File / No file
// chosen"). Keeps a real, named file input inside the DOM so it still submits
// with a <form>; the native control is visually hidden and driven by a button.
export function FilePicker({
  name,
  accept,
  hint,
  buttonLabel = "Choose file",
  multiple = false,
  onFile,
  onFiles,
  className,
}: {
  name?: string;
  accept?: string;
  hint?: string;
  buttonLabel?: string;
  multiple?: boolean;
  onFile?: (file: File | undefined) => void;
  onFiles?: (files: File[]) => void;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function clear() {
    if (ref.current) ref.current.value = "";
    setFileName("");
    setNote("");
    onFile?.(undefined);
    onFiles?.([]);
  }

  // Big photos are shrunk here, before anything leaves the device — a 9 MB camera
  // shot becomes a few hundred KB, which is what makes uploads over hotel wifi work.
  // The shrunk file is put back into the input so a plain <form> submit sends it too.
  async function handle(chosen: File[]) {
    setBusy(true);
    try {
      const before = chosen.reduce((n, f) => n + f.size, 0);
      const out = await Promise.all(chosen.map(compressImage));
      const after = out.reduce((n, f) => n + f.size, 0);

      if (ref.current && after < before) {
        const dt = new DataTransfer();
        for (const f of out) dt.items.add(f);
        ref.current.files = dt.files;
      }
      setFileName(out.length > 1 ? `${out.length} files: ${out.map((f) => f.name).join(", ")}` : (out[0]?.name ?? ""));
      setNote(after < before ? `Shrunk from ${prettySize(before)} to ${prettySize(after)} before upload` : prettySize(after));
      onFile?.(out[0]);
      onFiles?.(out);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <label
          htmlFor={id}
          className="inline-flex flex-none cursor-pointer items-center gap-2 rounded-md border border-input bg-white px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Upload className="h-4 w-4 text-muted-foreground" />
          {buttonLabel}
        </label>
        <span className={cn("min-w-0 flex-1 truncate text-xs", fileName ? "text-foreground" : "text-muted-foreground")}>
          {fileName || "No file selected"}
        </span>
        {fileName ? (
          <button type="button" onClick={clear} aria-label="Remove file" className="flex-none rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <input
        id={id}
        ref={ref}
        name={name}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => { void handle(Array.from(e.target.files ?? [])); }}
      />
      {busy ? <p className="mt-1.5 text-[11px] text-muted-foreground">Preparing the file…</p> : null}
      {!busy && note ? <p className="mt-1.5 text-[11px] text-muted-foreground">{note}</p> : null}
      {hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">Accepted: {hint}</p> : null}
    </div>
  );
}
