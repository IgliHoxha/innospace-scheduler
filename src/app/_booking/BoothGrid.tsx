import { reservationCountLabel } from "@/lib/availability-url";
import type { Booth } from "@/lib/types";

export function BoothGrid({
  booths,
  selected,
  counts,
  onSelect,
}: {
  booths: Booth[];
  selected: string;
  /** Undefined until the selected date's board lands. */
  counts: Record<string, number> | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="field-label">Booth</div>
      <div className="booth-grid">
        {booths.map((b) => (
          <button
            key={b.id}
            className={`booth-card ${b.id === selected ? "active" : ""}`}
            onClick={() => onSelect(b.id)}
          >
            <span className="booth-name">{b.name}</span>
            {b.capacity ? (
              <span className="booth-cap">{b.capacity} seats</span>
            ) : null}
            {/* Always rendered, so cards do not grow when counts land. */}
            <span className="booth-count">
              {counts?.[b.id] == null
                ? " "
                : reservationCountLabel(counts[b.id])}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
