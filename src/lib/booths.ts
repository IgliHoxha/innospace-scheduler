// Reservable booths, defined via the required SCHEDULER_BOOTHS var
// ("id:Name:capacity", comma-separated; capacity optional). Server-side only.
import { requireEnv } from "./env-app";

export interface Booth {
  id: string;
  name: string;
  capacity?: number;
}

function parseBooths(raw: string): Booth[] {
  const booths: Booth[] = [];
  for (const part of raw.split(",")) {
    const [id, name, cap] = part.split(":").map((s) => s.trim());
    if (!id) continue;
    const capacity = cap ? Number(cap) : undefined;
    booths.push({
      id,
      name: name || id,
      capacity: Number.isFinite(capacity) ? capacity : undefined,
    });
  }
  return booths;
}

let _booths: Booth[] | null = null;

/** The resolved booth list, parsed from the required SCHEDULER_BOOTHS var. */
export function getBooths(): Booth[] {
  if (_booths) return _booths;
  const booths = parseBooths(requireEnv("SCHEDULER_BOOTHS"));
  if (!booths.length) {
    throw new Error("SCHEDULER_BOOTHS did not define any valid booths.");
  }
  _booths = booths;
  return _booths;
}

export function isBoothId(id: string | undefined): boolean {
  if (!id) return false;
  return getBooths().some((b) => b.id === id);
}

export function boothName(id: string | undefined): string {
  if (!id) return "Booth";
  return getBooths().find((b) => b.id === id)?.name ?? id;
}
