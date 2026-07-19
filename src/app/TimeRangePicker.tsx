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

/** start + 1h, clamped to the end of the day. */
function addHour(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min((h + 1) * 60 + (m || 0), 23 * 60 + 59);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/**
 * Start / End time range as typed HH:MM fields (openstatus pattern): type over
 * the digits, arrow up/down to step, arrow left/right to move between fields.
 * It only collects the two times; opening hours, the minimum, and clashes are
 * enforced by the booking form and the server, not here.
 */
export default function TimeRangePicker({
  value,
  onChange,
  initial,
  disabled,
}: {
  value: TimeRange | null;
  onChange: (range: TimeRange) => void;
  /** First bookable time of the day, "HH:MM": the default the fields open on. */
  initial: string;
  disabled?: boolean;
}) {
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const from = value?.from ?? initial;
  const to = value?.to ?? addHour(initial);
  const fromDate = toDate(from);
  const toDate_ = toDate(to);

  // Pre-fill a sensible default, and reset it when the booth or day changes, so
  // what the fields show and what the form holds never disagree.
  React.useEffect(() => {
    onChangeRef.current({ from: initial, to: addHour(initial) });
  }, [initial]);

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
