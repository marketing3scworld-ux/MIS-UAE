import crypto from "node:crypto";

// Reversible encryption for the recoverable password copy on User.passwordEnc.
//
// AES-256-GCM with a random 12-byte IV per value; the key is derived from
// NEXTAUTH_SECRET with scrypt so there is no second secret to manage. Format is
// `v1.<iv>.<tag>.<ciphertext>`, all base64url — the version prefix leaves room to
// rotate the scheme later without guessing at what old rows contain.
//
// This is NOT part of authentication. Sign-in only ever checks the bcrypt
// passwordHash; this exists solely so Settings can show a Super Admin the password
// of an account they created. Anyone who holds both the database and
// NEXTAUTH_SECRET can decrypt these, so treat backups accordingly.

const VERSION = "v1";
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to encrypt/decrypt stored passwords");
  // Fixed salt: the secret is already high-entropy, and a per-value salt would
  // have to be stored alongside anyway. scrypt gives us a clean 32-byte key.
  cachedKey = crypto.scryptSync(secret, "bme-mis/password-box", 32);
  return cachedKey;
}

const b64 = (b: Buffer) => b.toString("base64url");

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(enc)].join(".");
}

/** Returns null for anything unreadable — a rotated secret, a corrupt or legacy row. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, data] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
