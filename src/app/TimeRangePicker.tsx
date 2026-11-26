"use client";

import * as React from "react";
import { ClockIcon } from "@/components/ui/icons";
import { TimePickerInput } from "@/components/ui/time-picker-input";
import { timeOfDate } from "@/lib/datetime";

/** Both ends as "HH:MM". */
export interface TimeRange {
  from: string;
  to: string;
}

// How long after the last keystroke a typed time counts as finished, and may be judged.
export const TYPING_PAUSE_MS = 1500;

function toDate(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** Only collects times; the form and the server enforce the rules. */
export default function TimeRangePicker({
  value,
  onChange,
  defaultRange,
  onEditing,
}: {
  value: TimeRange | null;
  onChange: (range: TimeRange) => void;
  /** The range the fields open on: a real free slot, never a clash. */
  defaultRange: TimeRange;
  /** True while a time is being typed: from each keystroke until a pause, or the caret leaving the fields. */
  onEditing?: (editing: boolean) => void;
}) {
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const from = value?.from ?? defaultRange.from;
  const to = value?.to ?? defaultRange.to;
  const fromDate = toDate(from);
  const toDate_ = toDate(to);

  // Seeds a parent with no range; re-announcing one would read as an edit.
  React.useEffect(() => {
    if (value) return;
    onChangeRef.current({ from: defaultRange.from, to: defaultRange.to });
  }, [defaultRange.from, defaultRange.to, value]);

  const onEditingRef = React.useRef(onEditing);
  onEditingRef.current = onEditing;
  const quietTimer = React.useRef(0);

  /** The typing is over: the pause ran out, the caret left, or the fields are gone. */
  const stopEditing = React.useCallback(() => {
    window.clearTimeout(quietTimer.current);
    onEditingRef.current?.(false);
  }, []);

  // Each keystroke restarts the wait, so the hour and its minutes are judged as one time.
  const keepEditing = () => {
    window.clearTimeout(quietTimer.current);
    onEditingRef.current?.(true);
    quietTimer.current = window.setTimeout(stopEditing, TYPING_PAUSE_MS);
  };

  // Unmounted mid-typing (a board reload), no blur says so and the timer must not outlive it.
  React.useEffect(() => stopEditing, [stopEditing]);

  const fromH = React.useRef<HTMLInputElement>(null);
  const fromM = React.useRef<HTMLInputElement>(null);
  const toH = React.useRef<HTMLInputElement>(null);
  const toM = React.useRef<HTMLInputElement>(null);

  const setFrom = (d: Date) => onChangeRef.current({ from: timeOfDate(d), to });
  const setTo = (d: Date) => onChangeRef.current({ from, to: timeOfDate(d) });

  return (
    <div
      className="tp-scope timerange-fields"
      onInput={keepEditing}
      onKeyDown={keepEditing}
      // Moving between the four fields is still typing; leaving them all ends it at once.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) stopEditing();
      }}
    >
      <div className="tp-group">
        <span className="tp-label">Start</span>
        <div className="tp-inputs">
          <TimePickerInput
            picker="hours"
            id="start-hours"
            name="start-hours"
            aria-label="Start hour"
            date={fromDate}
            setDate={setFrom}
            ref={fromH}
            onRightFocus={() => fromM.current?.focus()}
          />
          <span className="tp-colon">:</span>
          <TimePickerInput
            picker="minutes"
            id="start-minutes"
            name="start-minutes"
            aria-label="Start minute"
            date={fromDate}
            setDate={setFrom}
            ref={fromM}
            onLeftFocus={() => fromH.current?.focus()}
            onRightFocus={() => toH.current?.focus()}
          />
        </div>
      </div>

      <span className="tp-sep">to</span>

      <div className="tp-group">
        <span className="tp-label">End</span>
        <div className="tp-inputs">
          <TimePickerInput
            picker="hours"
            id="end-hours"
            name="end-hours"
            aria-label="End hour"
            date={toDate_}
            setDate={setTo}
            ref={toH}
            onLeftFocus={() => fromM.current?.focus()}
            onRightFocus={() => toM.current?.focus()}
          />
          <span className="tp-colon">:</span>
          <TimePickerInput
            picker="minutes"
            id="end-minutes"
            name="end-minutes"
            aria-label="End minute"
            date={toDate_}
            setDate={setTo}
            ref={toM}
            onLeftFocus={() => toH.current?.focus()}
          />
        </div>
      </div>

      <ClockIcon />
    </div>
  );
}
