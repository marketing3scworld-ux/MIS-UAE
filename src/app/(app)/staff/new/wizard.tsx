"use client";

import { useId, useState, useTransition } from "react";
import { ScanLine } from "lucide-react";
import type { DocumentType } from "@prisma/client";
import {
  DOC_SLOTS, DOC_TYPE_META, DOC_ACCEPT_ATTR, DOC_ACCEPT_HINT, IMAGE_ACCEPT_ATTR, IMAGE_ACCEPT_HINT,
} from "@/lib/documents";
import { FilePicker } from "@/components/file-picker";
import { analyzeEid, createStaffWithDocs } from "./actions";

type Options = {
  categories: string[];
  locations: string[]; // service/work sites
  residences: string[]; // emirates + Al Ain — where the person lives
  nationalities: string[];
  banks: string[];
};

// Every editable field on the profile. eidExpiry/ohcExpiry/… feed the doc slots.
type Values = {
  fullName: string;
  arabicName: string;
  eidNumber: string;
  category: string;
  mobileNumber: string;
  gender: string;
  nationality: string;
  location: string;
  residenceLocation: string;
  eidExpiry: string;
  ohcExpiry: string;
  bfhcExpiry: string;
  passportNumber: string;
  passportExpiry: string;
  visaExpiry: string;
  bankAccountTitle: string;
  iban: string;
  bankName: string;
};

const BLANK: Values = {
  fullName: "", arabicName: "", eidNumber: "", category: "", mobileNumber: "", gender: "",
  nationality: "", location: "", residenceLocation: "", eidExpiry: "", ohcExpiry: "", bfhcExpiry: "",
  passportNumber: "", passportExpiry: "", visaExpiry: "", bankAccountTitle: "", iban: "", bankName: "",
};

const inputCls =
  "w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold";

// Which document slot expiry mirrors which profile field (shown as a hint in step 3).
const SLOT_EXPIRY_FIELD: Partial<Record<DocumentType, keyof Values>> = {
  EID_FRONT: "eidExpiry",
  EID_BACK: "eidExpiry",
  PASSPORT: "passportExpiry",
  VISA: "visaExpiry",
  OHC: "ohcExpiry",
  BFHC: "bfhcExpiry",
};

export function NewProfileWizard({ options, willApprove }: { options: Options; willApprove: boolean }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [values, setValues] = useState<Values>(BLANK);
  const [autoFilled, setAutoFilled] = useState<Set<keyof Values>>(new Set());
  const [files, setFiles] = useState<Partial<Record<DocumentType, File>>>({});
  const [preview, setPreview] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [ocrMsg, setOcrMsg] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  function set<K extends keyof Values>(name: K, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }));
    setAutoFilled((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function pickEidFront(file: File | undefined) {
    if (!file) return;
    setFiles((prev) => ({ ...prev, EID_FRONT: file }));
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    setOcrMsg(null);
  }

  async function runAnalyze() {
    const file = files.EID_FRONT;
    if (!file) {
      setOcrMsg({ kind: "warn", text: "Choose an EID front image first." });
      return;
    }
    setAnalyzing(true);
    setOcrMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await analyzeEid(fd);
      if (res.ok) {
        const filled = new Set<keyof Values>();
        setValues((prev) => {
          const next = { ...prev };
          const map: [keyof Values, string][] = [
            ["fullName", res.fields.fullName],
            ["arabicName", res.fields.arabicName],
            ["eidNumber", res.fields.eidNumber],
            ["eidExpiry", res.fields.eidExpiry],
            ["nationality", res.fields.nationality],
            ["gender", res.fields.gender],
          ];
          for (const [k, v] of map) {
            if (v) { next[k] = v; filled.add(k); }
          }
          return next;
        });
        setAutoFilled(filled);
        setStep(2);
        setOcrMsg({
          kind: "ok",
          text: filled.size
            ? "Auto-filled from the Emirates ID — please verify every highlighted field."
            : "Couldn't read any fields — please enter the details manually.",
        });
      } else {
        setOcrMsg({ kind: "warn", text: res.reason });
      }
    } finally {
      setAnalyzing(false);
    }
  }

  function goStep2Manual() {
    setOcrMsg(null);
    setStep(2);
  }

  function toStep3() {
    if (!values.fullName.trim() || !values.eidNumber.trim()) {
      setStepError("Full name and EID number are required.");
      return;
    }
    setStepError(null);
    setStep(3);
  }

  function save() {
    setSaveError(null);
    const fd = new FormData();
    (Object.keys(values) as (keyof Values)[]).forEach((k) => fd.append(k, values[k]));
    for (const type of DOC_SLOTS) {
      const f = files[type];
      if (f) fd.append(`file_${type}`, f);
    }
    startSave(async () => {
      const res = await createStaffWithDocs(fd);
      if (res?.error) setSaveError(res.error);
      // On success the action redirects to the new profile.
    });
  }

  return (
    <div>
      <Stepper step={step} />

      {step === 1 ? (
        <section className="mt-5 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Step 1 — Emirates ID (front)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload the front of the Emirates ID. We&apos;ll read the name, EID number, expiry, nationality and gender for you to verify. This image is also saved as the EID (front) document.
          </p>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1 space-y-3">
              <FilePicker
                accept={IMAGE_ACCEPT_ATTR}
                hint={IMAGE_ACCEPT_HINT}
                buttonLabel="Choose EID front image"
                onFile={pickEidFront}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={runAnalyze}
                  disabled={analyzing || !files.EID_FRONT}
                  className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
                >
                  <ScanLine className="h-4 w-4" />
                  {analyzing ? "Reading the card…" : "Auto-fill from EID"}
                </button>
                <button
                  type="button"
                  onClick={goStep2Manual}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
                >
                  Skip — enter manually
                </button>
              </div>
              {ocrMsg ? (
                <p className={ocrMsg.kind === "ok" ? "text-sm text-status-valid" : "text-sm text-status-expiring"}>
                  {ocrMsg.text}
                </p>
              ) : null}
            </div>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="EID front preview"
                className="h-40 w-full rounded-md border border-border object-contain sm:w-64"
              />
            ) : (
              <div className="flex h-40 w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground sm:w-64">
                EID front preview
              </div>
            )}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <div className="mt-5 space-y-5">
          {ocrMsg ? (
            <div className={ocrMsg.kind === "ok"
              ? "rounded-md bg-status-valid/10 px-3 py-2 text-sm text-status-valid"
              : "rounded-md bg-status-expiring/10 px-3 py-2 text-sm text-status-expiring"}>
              {ocrMsg.text}
            </div>
          ) : null}

          <Section title="Identity">
            <Field label="Full Name (as per EID)" flagged={autoFilled.has("fullName")}>
              <input value={values.fullName} onChange={(e) => set("fullName", e.target.value)} className={inputCls} required />
            </Field>
            <Field label="Full Name (Arabic)" flagged={autoFilled.has("arabicName")}>
              <input value={values.arabicName} onChange={(e) => set("arabicName", e.target.value)} dir="rtl" className={`${inputCls} text-right`} />
            </Field>
            <Field label="Category">
              <Combo value={values.category} onChange={(v) => set("category", v)} options={options.categories} />
            </Field>
            <Field label="Mobile Number">
              <input value={values.mobileNumber} onChange={(e) => set("mobileNumber", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Gender" flagged={autoFilled.has("gender")}>
              <select value={values.gender} onChange={(e) => set("gender", e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </Field>
            <Field label="Nationality" flagged={autoFilled.has("nationality")}>
              <Combo value={values.nationality} onChange={(v) => set("nationality", v)} options={options.nationalities} />
            </Field>
            <Field label="Service Location">
              <Combo value={values.location} onChange={(v) => set("location", v)} options={options.locations} />
            </Field>
            <Field label="Residence Location">
              <Combo value={values.residenceLocation} onChange={(v) => set("residenceLocation", v)} options={options.residences} />
            </Field>
            <Field label="EID Number" flagged={autoFilled.has("eidNumber")}>
              <input value={values.eidNumber} onChange={(e) => set("eidNumber", e.target.value)} className={inputCls} required />
            </Field>
          </Section>

          <Section title="Documents & Expiry">
            <Field label="EID Expiry" flagged={autoFilled.has("eidExpiry")}>
              <input type="date" value={values.eidExpiry} onChange={(e) => set("eidExpiry", e.target.value)} className={inputCls} />
            </Field>
            <Field label="OHC Expiry">
              <input type="date" value={values.ohcExpiry} onChange={(e) => set("ohcExpiry", e.target.value)} className={inputCls} />
            </Field>
            <Field label="BFHC Expiry">
              <input type="date" value={values.bfhcExpiry} onChange={(e) => set("bfhcExpiry", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Passport Number">
              <input value={values.passportNumber} onChange={(e) => set("passportNumber", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Passport Expiry">
              <input type="date" value={values.passportExpiry} onChange={(e) => set("passportExpiry", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Visa Expiry">
              <input type="date" value={values.visaExpiry} onChange={(e) => set("visaExpiry", e.target.value)} className={inputCls} />
            </Field>
          </Section>

          <Section title="Bank Details">
            <Field label="Bank Account Title">
              <input value={values.bankAccountTitle} onChange={(e) => set("bankAccountTitle", e.target.value)} className={inputCls} />
            </Field>
            <Field label="IBAN">
              <input value={values.iban} onChange={(e) => set("iban", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Bank">
              <Combo value={values.bankName} onChange={(v) => set("bankName", v)} options={options.banks} />
            </Field>
          </Section>

          {stepError ? <p className="text-sm text-status-expired">{stepError}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">
              Back
            </button>
            <button type="button" onClick={toStep3} className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90">
              Next — Documents
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-5 space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Step 3 — Documents</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Attach the files. Expiry dates come from the details you verified in step 2. All are optional except the EID front, which is best captured now.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DOC_SLOTS.map((type) => (
                <DocSlot
                  key={type}
                  type={type}
                  file={files[type]}
                  expiryHint={SLOT_EXPIRY_FIELD[type] ? values[SLOT_EXPIRY_FIELD[type]!] : ""}
                  linked={!!SLOT_EXPIRY_FIELD[type]}
                  onPick={(f) => {
                    setFiles((prev) => {
                      const next = { ...prev };
                      if (f) next[type] = f; else delete next[type];
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            Saving creates an <span className="font-medium text-foreground">Active</span> profile
            {willApprove ? " (Approved)." : " (Pending approval)."}
          </p>
          {saveError ? <p className="text-sm text-status-expired">{saveError}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(2)} className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">
              Back
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-brand-gold px-4 py-2 text-sm font-medium text-brand-navy-deep hover:bg-brand-gold/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Upload EID", "Verify details", "Documents"];
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = n === step;
        const done = n < step;
        return (
          <div key={label} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
              active ? "bg-brand-navy text-white" : done ? "bg-brand-gold text-brand-navy-deep" : "bg-secondary text-muted-foreground"
            }`}>
              {n}
            </span>
            <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
            {i < steps.length - 1 ? <span className="mx-1 text-border">—</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, flagged, children }: { label: string; flagged?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {flagged ? (
          <span className="rounded bg-brand-gold/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-navy-deep">
            AI · verify
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function Combo({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  const id = useId();
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <>
      <input value={value} onChange={(e) => onChange(e.target.value)} list={id} className={inputCls} />
      <datalist id={id}>
        {opts.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

function DocSlot({
  type,
  file,
  expiryHint,
  linked,
  onPick,
}: {
  type: DocumentType;
  file: File | undefined;
  expiryHint: string;
  linked: boolean;
  onPick: (f: File | undefined) => void;
}) {
  const meta = DOC_TYPE_META[type];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{meta.label}</span>
        {file ? (
          <span className="text-[11px] font-medium text-status-valid">Attached</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Optional</span>
        )}
      </div>
      {meta.hasExpiry ? (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {linked ? `Expiry: ${expiryHint || "—"} (from step 2)` : "Expiry: set on the profile after saving"}
        </div>
      ) : null}
      <FilePicker accept={DOC_ACCEPT_ATTR} hint={DOC_ACCEPT_HINT} onFile={onPick} className="mt-3" />
    </div>
  );
}
