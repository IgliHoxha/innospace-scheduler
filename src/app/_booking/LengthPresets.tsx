export function LengthPresets({
  presets,
  current,
  onPick,
}: {
  presets: { minutes: number; end: number | null }[];
  /** The length on screen now, so its button reads as chosen. */
  current: number;
  onPick: (endMin: number) => void;
}) {
  if (presets.length === 0) return null;
  return (
    <div className="length-presets" role="group" aria-label="Quick length">
      {presets.map(({ minutes, end }) => (
        <button
          key={minutes}
          type="button"
          className={`chip ${minutes === current ? "active" : ""}`}
          aria-pressed={minutes === current}
          disabled={end == null}
          title={end == null ? "Not free for that long" : undefined}
          onClick={() => end != null && onPick(end)}
        >
          {minutes} min
        </button>
      ))}
    </div>
  );
}
