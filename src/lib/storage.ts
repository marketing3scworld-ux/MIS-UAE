import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Storage-service interface — local disk now, swap for S3 later without touching
// callers (spec §1). Files live under UPLOAD_DIR/staff/<id>/<type>/<uuid>.<ext>.
export type StoredFile = { relPath: string; size: number };

export interface StorageService {
  save(buffer: Buffer, opts: { staffId: number; type: string; ext: string }): Promise<StoredFile>;
  read(relPath: string): Promise<Buffer>;
  delete(relPath: string): Promise<void>;
}

class LocalStorage implements StorageService {
  private root = path.resolve(process.env.UPLOAD_DIR || "./uploads");

  private resolveInside(relPath: string): string {
    const abs = path.resolve(this.root, relPath);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error("Refusing path outside the upload root");
    }
    return abs;
  }

  async save(buffer: Buffer, { staffId, type, ext }: { staffId: number; type: string; ext: string }): Promise<StoredFile> {
    const dir = path.join(this.root, "staff", String(staffId), type.toLowerCase());
    await fs.mkdir(dir, { recursive: true });
    const safeExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    const abs = path.join(dir, `${randomUUID()}${safeExt}`);
    await fs.writeFile(abs, buffer);
    return { relPath: path.relative(this.root, abs).split(path.sep).join("/"), size: buffer.length };
  }

  async read(relPath: string): Promise<Buffer> {
    return fs.readFile(this.resolveInside(relPath));
  }

  async delete(relPath: string): Promise<void> {
    await fs.rm(this.resolveInside(relPath), { force: true });
  }
}

export const storage: StorageService = new LocalStorage();
