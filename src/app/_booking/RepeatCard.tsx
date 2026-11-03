export function RepeatCard({
  weeks,
  maxWeeks,
  onChange,
}: {
  weeks: number;
  maxWeeks: number;
  onChange: (weeks: number) => void;
}) {
  return (
    <>
      <div className="field-label">Repeat</div>
      <div className="card guest-card">
        <div className="guest-row">
          <label className="guest-field">
            <span>How often</span>
            <select
              id="repeatWeeks"
              name="repeatWeeks"
              value={weeks}
              onChange={(e) => onChange(Number(e.target.value))}
            >
              {Array.from({ length: maxWeeks }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Just this once" : `Every week for ${n} weeks`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </>
  );
}
