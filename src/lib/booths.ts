// Bookable booths, overridable via SCHEDULER_BOOTHS ("id:Name:capacity",
// comma-separated; capacity optional). Server-side only.
export interface Booth {
  id: string;
  name: string;
  capacity?: number;
}

const DEFAULT_BOOTHS: Booth[] = [
  { id: "booth-1", name: "Booth 1", capacity: 2 },
  { id: "booth-2", name: "Booth 2", capacity: 4 },
  { id: "booth-3", name: "Booth 3", capacity: 6 },
];

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

/** The resolved booth list (env override, else the seeded defaults). */
export function getBooths(): Booth[] {
  if (_booths) return _booths;
  const raw = process.env.SCHEDULER_BOOTHS?.trim();
  const booths = raw ? parseBooths(raw) : DEFAULT_BOOTHS;
  _booths = booths.length ? booths : DEFAULT_BOOTHS;
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
