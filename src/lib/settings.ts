import { prisma } from "@/lib/prisma";

export type AppSettings = {
  expiryWindowDays: number;
  reNotifyIntervalDays: number;
  escalationThresholdCycles: number;
};

export const SETTINGS_DEFAULTS: AppSettings = {
  expiryWindowDays: 30,
  reNotifyIntervalDays: 3,
  escalationThresholdCycles: 3,
};

/** Read app settings (KV table) with sane fallbacks. */
export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.appSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: keyof AppSettings) => {
    const raw = map.get(k);
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : SETTINGS_DEFAULTS[k];
  };
  return {
    expiryWindowDays: num("expiryWindowDays"),
    reNotifyIntervalDays: num("reNotifyIntervalDays"),
    escalationThresholdCycles: num("escalationThresholdCycles"),
  };
}
