// Email delivery (spec §7 escalation). Thin wrapper over nodemailer that reads
// SMTP_* from the environment. If SMTP isn't configured it logs and no-ops, so
// the notification engine keeps working in local dev without a mail server.
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;
let resolved = false;

function getTransport(): Transporter | null {
  if (resolved) return transporter;
  resolved = true;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return (transporter = null);
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

export type MailResult = { sent: boolean; reason?: string };

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<MailResult> {
  const from = process.env.SMTP_FROM || "BME MIS <no-reply@bmeventsksa.com>";
  const t = getTransport();
  if (!t) {
    console.log(`[mail:skipped — no SMTP_HOST] to=${opts.to} subject="${opts.subject}"`);
    return { sent: false, reason: "SMTP not configured" };
  }
  try {
    await t.sendMail({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    console.error(`[mail:error] ${reason}`);
    return { sent: false, reason };
  }
}
