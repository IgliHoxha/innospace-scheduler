"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getArrowByType,
  getDateByType,
  isCompleteEntry,
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

/**
 * One editable time field (hours or minutes). A real text box: it shows a caret,
 * takes a single digit as readily as two, and selects itself on focus so typing
 * replaces. Arrow up/down steps; left/right cross to the sibling only from the
 * edge, leaving the caret free to move inside the field.
 */
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
      ...props
    },
    ref,
  ) => {
    // What is being typed, before it is padded. Null means "show the real value":
    // holding the raw text lets a lone "1" stay "1" instead of snapping to "01"
    // under the caret, while the committed date is always the padded one.
    const [draft, setDraft] = React.useState<string | null>(null);

    const shown = React.useMemo(
      () => getDateByType(date, picker),
      [date, picker],
    );

    const commit = (digits: string) => {
      if (digits) setDate(setDateByType(new Date(date), digits, picker));
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
      setDraft(digits);
      commit(digits);
      if (isCompleteEntry(digits, picker)) onRightFocus?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setDraft(null);
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
        maxLength={2}
        onChange={handleChange}
        // Select on entry so typing replaces; a second click still places a caret.
        onFocus={(e) => {
          e.currentTarget.select();
          onFocus?.(e);
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
