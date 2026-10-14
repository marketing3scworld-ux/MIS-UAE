"use client";

import { useActionState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { titleCaseName, titleCaseLabel } from "@/lib/format";
import { updateStaff, type UpdateState } from "./actions";

export type StaffFormValues = {
  id: number;
  fullName: string;
  arabicName: string;
  eidNumber: string;
  category: string;
  mobileNumber: string;
  eidExpiry: string;
  ohcExpiry: string;
  bfhcExpiry: string;
  passportNumber: string;
  passportExpiry: string;
  visaExpiry: string;
  gender: string;
  nationality: string;
  location: string;
  residenceLocation: string;
  employmentStatus: string; // derived from document expiry — displayed, never posted
  bankAccountTitle: string;
  iban: string;
  bankName: string;
};

type Options = {
  categories: string[];
  locations: string[]; // service/work sites
  residences: string[]; // emirates + Al Ain — where the person lives
  nationalities: string[];
  banks: string[];
};

const inputCls =
  "w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold read-only:bg-secondary read-only:text-muted-foreground disabled:bg-secondary disabled:text-muted-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Text({ name, def, ro, required, dir }: { name: string; def: string; ro: boolean; required?: boolean; dir?: "rtl" }) {
  return <input name={name} defaultValue={def} readOnly={ro} required={required} dir={dir} className={cn(inputCls, dir === "rtl" && "text-right")} />;
}

function DateInput({ name, def, ro }: { name: string; def: string; ro: boolean }) {
  return <input type="date" name={name} defaultValue={def} readOnly={ro} className={inputCls} />;
}

function Combo({ name, def, options, ro }: { name: string; def: string; options: string[]; ro: boolean }) {
  const id = useId();
  // Display Title-Cased (acronyms preserved); the value is re-normalized to
  // UPPERCASE on save so the stored data + filters stay consistent.
  const d = titleCaseLabel(def);
  const opts = [...new Set(options.map((o) => titleCaseLabel(o)))];
  const list = d && !opts.includes(d) ? [d, ...opts] : opts;
  return (
    <>
      <input name={name} defaultValue={d} list={id} disabled={ro} className={inputCls} />
      <datalist id={id}>
        {list.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

function Select({ name, def, options, ro }: { name: string; def: string; options: [string, string][]; ro: boolean }) {
  return (
    <select name={name} defaultValue={def} disabled={ro} className={inputCls}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
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

export function EditForm({
  initial,
  options,
  canEditProfile,
  canEditBank,
}: {
  initial: StaffFormValues;
  options: Options;
  canEditProfile: boolean;
  canEditBank: boolean;
}) {
  const [state, action, pending] = useActionState<UpdateState, FormData>(
    updateStaff.bind(null, initial.id),
    {},
  );
  const roP = !canEditProfile;
  const roB = !canEditBank;
  const derivedActive = initial.employmentStatus === "ACTIVE";

  const router = useRouter();
  // A save changes the header, the expiry status cards and the Documents summary
  // above this form — all server-rendered. Refresh so they follow the save instead
  // of showing the pre-edit values until the page is reloaded by hand.
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <form action={action} className="space-y-5">
      {state.error ? (
        <div className="rounded-md bg-status-expired/10 px-3 py-2 text-sm text-status-expired">{state.error}</div>
      ) : null}
      {state.ok ? (
        <div className="rounded-md bg-status-valid/10 px-3 py-2 text-sm text-status-valid">
          Saved.{state.warning ? ` ${state.warning}` : ""}
        </div>
      ) : null}

      <Section title="Identity">
        <Field label="Full Name (as per EID)"><Text name="fullName" def={titleCaseName(initial.fullName)} ro={roP} required /></Field>
        <Field label="Full Name (Arabic)"><Text name="arabicName" def={initial.arabicName} ro={roP} dir="rtl" /></Field>
        <Field label="Category"><Combo name="category" def={initial.category} options={options.categories} ro={roP} /></Field>
        <Field label="Mobile Number"><Text name="mobileNumber" def={initial.mobileNumber} ro={roP} /></Field>
        <Field label="Gender">
          <Select name="gender" def={initial.gender} ro={roP} options={[["", "—"], ["MALE", "Male"], ["FEMALE", "Female"]]} />
        </Field>
        <Field label="Nationality"><Combo name="nationality" def={initial.nationality} options={options.nationalities} ro={roP} /></Field>
        <Field label="Service Location"><Combo name="location" def={initial.location} options={options.locations} ro={roP} /></Field>
        <Field label="Residence Location"><Combo name="residenceLocation" def={initial.residenceLocation} options={options.residences} ro={roP} /></Field>
        <Field label="EID Number"><Text name="eidNumber" def={initial.eidNumber} ro={roP} /></Field>
        {/* Active/Inactive is derived from document expiry and cannot be typed in:
            one lapsed document makes someone Inactive automatically. Shown read-only
            so the profile agrees with the Status column on the staff list. */}
        <Field label="Status (from documents)">
          <div className={`${inputCls} flex items-center justify-between bg-secondary`}>
            <span className={derivedActive ? "font-medium text-status-valid" : "text-status-expired"}>
              {derivedActive ? "Active" : "Inactive"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {derivedActive ? "all documents on file and in date" : "a document is expired or missing"}
            </span>
          </div>
        </Field>
      </Section>

      <Section title="Documents & Expiry">
        <Field label="EID Expiry"><DateInput name="eidExpiry" def={initial.eidExpiry} ro={roP} /></Field>
        <Field label="OHC Expiry"><DateInput name="ohcExpiry" def={initial.ohcExpiry} ro={roP} /></Field>
        <Field label="BFHC Expiry"><DateInput name="bfhcExpiry" def={initial.bfhcExpiry} ro={roP} /></Field>
        <Field label="Passport Number"><Text name="passportNumber" def={initial.passportNumber} ro={roP} /></Field>
        <Field label="Passport Expiry"><DateInput name="passportExpiry" def={initial.passportExpiry} ro={roP} /></Field>
        <Field label="Visa Expiry"><DateInput name="visaExpiry" def={initial.visaExpiry} ro={roP} /></Field>
      </Section>

      <Section title="Bank Details">
        <Field label="Bank Account Title"><Text name="bankAccountTitle" def={initial.bankAccountTitle} ro={roB} /></Field>
        <Field label="IBAN"><Text name="iban" def={initial.iban} ro={roB} /></Field>
        <Field label="Bank"><Combo name="bankName" def={initial.bankName} options={options.banks} ro={roB} /></Field>
      </Section>

      <div className="flex items-center gap-3">
        {canEditProfile || canEditBank ? (
          <button
            type="submit"
            disabled={pending}
            className={cn(
              "rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60",
            )}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">You have read-only access to this record.</p>
        )}
        {canEditBank && !canEditProfile ? (
          <span className="text-xs text-muted-foreground">Finance role: bank details only.</span>
        ) : null}
      </div>
    </form>
  );
}
