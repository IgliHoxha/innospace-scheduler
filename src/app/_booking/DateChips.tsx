export interface DateOption {
  value: string;
  label: string;
}

export function DateChips({
  dates,
  selected,
  onSelect,
}: {
  dates: DateOption[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <>
      <div className="field-label">Date</div>
      <div className="date-row">
        {dates.map((d) => (
          <button
            key={d.value}
            className={`chip ${d.value === selected ? "active" : ""}`}
            onClick={() => onSelect(d.value)}
          >
            {d.label}
          </button>
        ))}
      </div>
    </>
  );
}
