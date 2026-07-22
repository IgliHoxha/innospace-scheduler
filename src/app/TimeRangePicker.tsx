"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { TimePickerInput } from "@/components/ui/time-picker-input";

export interface TimeRange {
  /** "HH:MM" */
  from: string;
  /** "HH:MM" */
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function toDate(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

const toHHMM = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Start / End time range as typed HH:MM fields (openstatus pattern): type over
 * the digits, arrow up/down to step, arrow left/right to move between fields.
 * It only collects the two times; opening hours, the minimum, and clashes are
 * enforced by the reservation form and the server, not here.
 */
export default function TimeRangePicker({
  value,
  onChange,
  defaultRange,
  disabled,
}: {
  value: TimeRange | null;
  onChange: (range: TimeRange) => void;
  /** The range the fields open on: a real free slot, so it never opens on a clash. */
  defaultRange: TimeRange;
  disabled?: boolean;
}) {
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const from = value?.from ?? defaultRange.from;
  const to = value?.to ?? defaultRange.to;
  const fromDate = toDate(from);
  const toDate_ = toDate(to);

  // Pre-fill the default, and reset it when the booth or day changes, so what the
  // fields show and what the form holds never disagree.
  React.useEffect(() => {
    onChangeRef.current({ from: defaultRange.from, to: defaultRange.to });
  }, [defaultRange.from, defaultRange.to]);

  const fromH = React.useRef<HTMLInputElement>(null);
  const fromM = React.useRef<HTMLInputElement>(null);
  const toH = React.useRef<HTMLInputElement>(null);
  const toM = React.useRef<HTMLInputElement>(null);

  const setFrom = (d: Date) => onChangeRef.current({ from: toHHMM(d), to });
  const setTo = (d: Date) => onChangeRef.current({ from, to: toHHMM(d) });

  return (
    <div
      className="tp-scope timerange-fields"
      data-disabled={disabled || undefined}
    >
      <div className="tp-group">
        <span className="tp-label">Start</span>
        <div className="tp-inputs">
          <TimePickerInput
            picker="hours"
            date={fromDate}
            setDate={setFrom}
            ref={fromH}
            onRightFocus={() => fromM.current?.focus()}
            disabled={disabled}
          />
          <span className="tp-colon">:</span>
          <TimePickerInput
            picker="minutes"
            date={fromDate}
            setDate={setFrom}
            ref={fromM}
            onLeftFocus={() => fromH.current?.focus()}
            onRightFocus={() => toH.current?.focus()}
            disabled={disabled}
          />
        </div>
      </div>

      <span className="tp-sep">to</span>

      <div className="tp-group">
        <span className="tp-label">End</span>
        <div className="tp-inputs">
          <TimePickerInput
            picker="hours"
            date={toDate_}
            setDate={setTo}
            ref={toH}
            onLeftFocus={() => fromM.current?.focus()}
            onRightFocus={() => toM.current?.focus()}
            disabled={disabled}
          />
          <span className="tp-colon">:</span>
          <TimePickerInput
            picker="minutes"
            date={toDate_}
            setDate={setTo}
            ref={toM}
            onLeftFocus={() => toH.current?.focus()}
            disabled={disabled}
          />
        </div>
      </div>

      <Clock className="tp-clock" aria-hidden="true" />
    </div>
  );
}
