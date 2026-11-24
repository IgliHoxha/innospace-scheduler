import { Combobox } from "@/components/ui/combobox";

export function RepeatCard({
  weeks,
  maxWeeks,
  onChange,
}: {
  weeks: number;
  maxWeeks: number;
  onChange: (weeks: number) => void;
}) {
  const options = Array.from({ length: maxWeeks }, (_, i) => i + 1).map(
    (n) => ({
      value: String(n),
      label: n === 1 ? "Just this once" : `Every week for ${n} weeks`,
    }),
  );
  return (
    <>
      <div className="field-label">Repeat</div>
      <div className="card guest-card repeat-card">
        <div className="guest-row">
          {/* A div, not a label: a click on an option would else reopen the list. */}
          <div className="guest-field">
            <label htmlFor="repeatWeeks">
              <span>How often</span>
            </label>
            <Combobox
              id="repeatWeeks"
              options={options}
              value={String(weeks)}
              onChange={(v) => onChange(Number(v))}
              placeholder="Just this once"
            />
          </div>
        </div>
      </div>
    </>
  );
}
