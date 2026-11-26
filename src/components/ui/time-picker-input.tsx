"use client";

import * as React from "react";
import {
  getArrowByType,
  getDateByType,
  isCompleteEntry,
  nextDigits,
  setDateByType,
  type TimePickerType,
} from "@/lib/time-picker-utils";

// One fixed list, so no class-merging library ships to the booking page.
const FIELD_CLASS =
  "flex rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 h-11 w-[46px] px-1 py-0 text-center font-mono text-base leading-none tabular-nums focus:bg-accent focus:text-accent-foreground [&::-webkit-inner-spin-button]:appearance-none";

export interface TimePickerInputProps extends Omit<
  React.ComponentProps<"input">,
  "value" | "onChange"
> {
  picker: TimePickerType;
  date: Date;
  setDate: (date: Date) => void;
  onRightFocus?: () => void;
  onLeftFocus?: () => void;
}

const TimePickerInput = React.forwardRef<
  HTMLInputElement,
  TimePickerInputProps
>(
  (
    {
      className,
      type = "tel",
      id,
      name,
      date,
      setDate,
      picker,
      onLeftFocus,
      onRightFocus,
      onKeyDown,
      onFocus,
      onBlur,
      onMouseUp,
      ...props
    },
    ref,
  ) => {
    // The raw text being typed, so a lone "1" doesn't snap to "01" under the caret.
    const [draft, setDraft] = React.useState<string | null>(null);

    // True from entering the field until its first keystroke, the one that replaces.
    const freshRef = React.useRef(true);

    // Two digits wide, so the only useful caret position is the end.
    const caretToEnd = (el: HTMLInputElement) => {
      const n = el.value.length;
      el.setSelectionRange(n, n);
    };

    const shown = React.useMemo(
      () => getDateByType(date, picker),
      [date, picker],
    );

    // What this field's own typing leads to; anything else on show came from outside.
    const typedRef = React.useRef(shown);

    // The time moved under a focused field (the clock, the day bar): show it, not the stale draft.
    if (draft !== null && shown !== typedRef.current) setDraft(null);

    // A lone digit not yet a time, with the value it was typed over so a moved time voids it.
    const pendingRef = React.useRef<{ digits: string; over: string } | null>(
      null,
    );

    const commit = (digits: string) => {
      const next = setDateByType(new Date(date), digits, picker);
      typedRef.current = getDateByType(next, picker);
      pendingRef.current = null;
      setDate(next);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      const digits = nextDigits(
        el.value,
        el.selectionStart ?? el.value.length,
        freshRef.current,
      );
      freshRef.current = false;
      setDraft(digits);
      if (isCompleteEntry(digits, picker)) {
        commit(digits);
        onRightFocus?.();
        return;
      }
      // "1" on the way to "18" is no time yet: it waits for its second digit, or for the field to be left.
      typedRef.current = shown;
      pendingRef.current = digits ? { digits, over: shown } : null;
    };

    /** Leaving the field settles a lone digit as typed: "7" is 07. */
    const settle = () => {
      const pending = pendingRef.current;
      if (pending && pending.over === shown) commit(pending.digits);
      pendingRef.current = null;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setDraft(null);
        pendingRef.current = null;
        freshRef.current = true; // the stepped value is the one a digit replaces
        setDate(
          setDateByType(
            new Date(date),
            getArrowByType(shown, e.key === "ArrowUp" ? 1 : -1, picker),
            picker,
          ),
        );
        return;
      }
      // Only leave the field from its edge, so the caret can still move within it.
      const el = e.currentTarget;
      const caret = el.selectionStart ?? 0;
      const collapsed = caret === (el.selectionEnd ?? 0);
      if (e.key === "ArrowLeft" && collapsed && caret === 0) {
        e.preventDefault();
        onLeftFocus?.();
      }
      if (e.key === "ArrowRight" && collapsed && caret === el.value.length) {
        e.preventDefault();
        onRightFocus?.();
      }
    };

    return (
      <input
        ref={ref}
        id={id ?? picker}
        name={name ?? picker}
        className={className ? `${FIELD_CLASS} ${className}` : FIELD_CLASS}
        value={draft ?? shown}
        type={type}
        inputMode="decimal"
        onChange={handleChange}
        // Caret to the end, which a click would otherwise drop mid-field.
        onFocus={(e) => {
          freshRef.current = true;
          caretToEnd(e.currentTarget);
          onFocus?.(e);
        }}
        onMouseUp={(e) => {
          freshRef.current = true;
          caretToEnd(e.currentTarget);
          onMouseUp?.(e);
        }}
        // Drop the draft so a partial entry renders back zero-padded.
        onBlur={(e) => {
          settle();
          setDraft(null);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          handleKeyDown(e);
        }}
        {...props}
      />
    );
  },
);
TimePickerInput.displayName = "TimePickerInput";

export { TimePickerInput };
