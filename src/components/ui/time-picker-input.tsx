"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getArrowByType,
  getDateByType,
  isCompleteEntry,
  nextDigits,
  setDateByType,
  type TimePickerType,
} from "@/lib/time-picker-utils";

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

/** One time field: caret at the end, first keystroke replaces, arrows step. */
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

    const commit = (digits: string) => {
      if (digits) setDate(setDateByType(new Date(date), digits, picker));
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
      commit(digits);
      if (isCompleteEntry(digits, picker)) onRightFocus?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setDraft(null);
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
      <Input
        ref={ref}
        id={id ?? picker}
        name={name ?? picker}
        className={cn(
          "h-11 w-[46px] px-1 py-0 text-center font-mono text-base leading-none tabular-nums focus:bg-accent focus:text-accent-foreground [&::-webkit-inner-spin-button]:appearance-none",
          className,
        )}
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
        // Drop the draft so an empty or single digit renders back as "09".
        onBlur={(e) => {
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
